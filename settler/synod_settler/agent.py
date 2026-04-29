"""Synod settler agent — main runtime loop.

A settler agent ties together:
  - an Identity (ed25519 keypair from an AXL PEM file)
  - an AxlClient (local AXL daemon HTTP API)
  - an LLMProvider (one of anthropic/openai/gemini)
  - a list of peer pubkeys (to broadcast votes to)
  - a per-question vote registry

Each agent runs the same protocol: poll AXL for inbound messages, dispatch by
`kind`, run inference on QuestionAnnouncements, broadcast SettlementVotes,
collect peer votes, and log a ConsensusResult once quorum is met.
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .axl_client import AxlClient, InboundMessage
from .consensus import ConsensusError, compute_consensus
from .identity import Identity, verify_signature
from .llm import LLMProvider
from .onchain import (
    OnchainClient,
    is_designated_poster,
    votes_payload_for_chain,
    weighted_score_to_scaled,
)
from .protocol import (
    MessageKind,
    QuestionAnnouncement,
    SettlementVote,
    canonical_json,
    validate_hex32,
)

logger = logging.getLogger(__name__)


@dataclass
class QuestionState:
    question: QuestionAnnouncement
    votes_by_settler: dict[str, dict[str, Any]] = field(default_factory=dict)
    consensus_emitted: bool = False


class SettlerAgent:
    """One settler node's runtime.

    Constructor parameters:
      identity:    ed25519 identity matching the AXL daemon's PrivateKeyPath
      axl:         connected AxlClient targeting the local AXL daemon
      provider:    the LLM that produces answers for this settler
      peer_pubkeys: list of 64-char hex pubkeys to broadcast votes to.
                    Excludes our own pubkey automatically.
      quorum:      minimum number of distinct verified votes (incl. ours)
                   required to emit a ConsensusResult.
      poll_interval_s: how often the loop polls AXL /recv.
      on_consensus: optional callback fired once per question when quorum is
                    reached. Receives the question_id (hex), winning outcome
                    (int), and the list of accepted vote payloads.

    Run the loop with `agent.run_forever()` or process inbound messages one at
    a time with `agent.tick()`.
    """

    def __init__(
        self,
        *,
        identity: Identity,
        axl: AxlClient,
        provider: LLMProvider,
        peer_pubkeys: list[str],
        quorum: int = 2,
        poll_interval_s: float = 0.25,
        on_consensus: Callable[[str, int, list[dict[str, Any]]], None] | None = None,
        onchain: OnchainClient | None = None,
    ) -> None:
        self.identity = identity
        self.axl = axl
        self.provider = provider
        # Don't broadcast to ourselves
        self.peer_pubkeys = []
        for p in peer_pubkeys:
            try:
                normalized = validate_hex32(p, field="peer_pubkey")
            except ValueError:
                logger.warning("ignoring invalid peer pubkey: %s", p)
                continue
            if normalized != identity.public_key_hex:
                self.peer_pubkeys.append(normalized)
        self.quorum = quorum
        self.poll_interval_s = poll_interval_s
        self.on_consensus = on_consensus
        self.onchain = onchain

        self._questions: dict[str, QuestionState] = {}

    # --- public API ---------------------------------------------------------

    def run_forever(self) -> None:
        """Block on the AXL recv queue and process messages as they arrive."""
        logger.info(
            "settler running pubkey=%s peers=%d quorum=%d",
            self.identity.public_key_hex,
            len(self.peer_pubkeys),
            self.quorum,
        )
        while True:
            self.tick()
            time.sleep(self.poll_interval_s)

    def tick(self) -> None:
        """Process at most one inbound AXL message."""
        try:
            msg = self.axl.recv()
        except Exception as e:
            logger.warning("AXL recv failed: %s", e)
            return
        if msg is None:
            return
        try:
            self._dispatch(msg)
        except Exception:
            logger.exception("dispatch failed for inbound message")

    def inject_local_question(self, q: QuestionAnnouncement) -> None:
        """Treat a question as if it had arrived from the local user.

        Used by the question-injector CLI: a creator publishes the question to
        their own AXL node, which then runs through the same dispatch path as
        if it had come from a peer. The agent runs inference and broadcasts
        its vote to peers.
        """
        self._handle_question(q)

    # --- internals ----------------------------------------------------------

    def _dispatch(self, msg: InboundMessage) -> None:
        try:
            payload = json.loads(msg.body)
        except json.JSONDecodeError:
            logger.warning("ignoring non-JSON message from %s", msg.sender_pubkey[:16])
            return

        kind = int(payload.get("kind", 0))
        if kind == int(MessageKind.QUESTION):
            try:
                q = QuestionAnnouncement.new(
                    question_id=str(payload["question_id"]),
                    prompt=str(payload["prompt"]),
                    outcomes=[int(x) for x in payload["outcomes"]],
                    deadline=int(payload["deadline"]),
                )
            except (KeyError, TypeError, ValueError) as e:
                logger.warning("rejecting invalid question from %s: %s", msg.sender_pubkey[:16], e)
                return
            self._handle_question(q)
        elif kind == int(MessageKind.VOTE):
            self._handle_incoming_vote(payload, msg.sender_pubkey)
        else:
            logger.warning("ignoring message with unknown kind=%s", kind)

    def _handle_question(self, q: QuestionAnnouncement) -> None:
        if q.question_id in self._questions:
            logger.info("already tracking question %s, skipping re-init", q.question_id)
            return
        if q.deadline < int(time.time()):
            logger.warning("question %s already past deadline", q.question_id)
            return
        if len(q.prompt) > 4096:
            logger.warning("question %s prompt too long", q.question_id[:16])
            return
        outcomes = ",".join(str(x) for x in q.outcomes)
        logger.info("question %s outcomes=%s prompt=%s", q.question_id, outcomes, q.prompt[:80])
        self._questions[q.question_id] = QuestionState(question=q)

        # 1) propagate question to peers we haven't received it from. Dedup by
        # question_id (above) prevents loops — peers that already have the
        # question will no-op when they receive it.
        self._propagate_question(q)

        # 2) run inference locally
        result = self.provider.infer(q.prompt, q.outcomes)
        logger.info(
            "inference q=%s outcome=%d confidence=%.3f model=%s",
            q.question_id,
            result.outcome,
            result.confidence,
            result.model_tag,
        )

        # 3) build, sign, store, broadcast our own vote
        vote = SettlementVote.new(
            question=q,
            settler_pubkey=self.identity.public_key_hex,
            model_tag=result.model_tag,
            outcome=result.outcome,
            confidence=result.confidence,
            timestamp=int(time.time()),
        )
        sig = self.identity.sign(vote.signing_payload())
        wire = vote.to_wire(signature_hex=sig.hex(), reasoning=result.reasoning)

        # store our own vote
        state = self._questions[q.question_id]
        state.votes_by_settler[self.identity.public_key_hex] = wire

        self._broadcast_to_peers(wire)
        self._maybe_emit_consensus(q.question_id)

    def _handle_incoming_vote(
        self, payload: dict[str, Any], sender_pubkey: str
    ) -> None:
        question_id = str(payload.get("question_id", ""))
        state = self._questions.get(question_id)
        if state is None:
            logger.warning(
                "vote for unknown question %s from %s",
                question_id[:16],
                sender_pubkey[:16],
            )
            return

        signature_hex = str(payload.get("signature", ""))
        try:
            settler_pubkey = validate_hex32(
                str(payload.get("settler_pubkey", "")), field="settler_pubkey"
            )
        except ValueError:
            logger.warning("rejecting vote with invalid settler pubkey")
            return

        sender_raw = str(sender_pubkey or "").strip().lower()
        if sender_raw:
            try:
                sender = validate_hex32(sender_raw, field="sender_pubkey")
                if sender != settler_pubkey:
                    logger.info(
                        "AXL sender header %s differs from signed settler %s; "
                        "using signature and registry auth",
                        sender,
                        settler_pubkey,
                    )
            except ValueError:
                logger.info("AXL sender header was not a full pubkey; using signature auth")
        if settler_pubkey not in self.peer_pubkeys:
            logger.warning("rejecting vote from unconfigured peer %s", settler_pubkey[:16])
            return
        if self.onchain is not None:
            try:
                if not self.onchain.is_axl_pubkey_registered(settler_pubkey):
                    logger.warning(
                        "rejecting vote from unregistered on-chain AXL pubkey %s",
                        settler_pubkey[:16],
                    )
                    return
            except Exception as e:
                logger.warning("could not check on-chain AXL registration: %s", e)
                return

        now = int(time.time())
        try:
            outcome = int(payload["outcome"])
            confidence = float(payload["confidence"])
            timestamp = int(payload["timestamp"])
            protocol_version = int(payload["protocol_version"])
            prompt_hash = str(payload["prompt_hash"])
            outcomes_hash = str(payload["outcomes_hash"])
            deadline = int(payload["deadline"])
            model_tag = str(payload["model_tag"])
            kind = int(payload["kind"])
        except (KeyError, TypeError, ValueError) as e:
            logger.warning("rejecting malformed vote from %s: %s", settler_pubkey[:16], e)
            return
        if kind != int(MessageKind.VOTE):
            logger.warning("rejecting vote with wrong kind=%s", kind)
            return
        if protocol_version != 1:
            logger.warning("rejecting vote with unsupported protocol_version=%s", protocol_version)
            return
        if deadline != state.question.deadline:
            logger.warning("rejecting vote with mismatched deadline from %s", settler_pubkey[:16])
            return
        if prompt_hash != state.question.prompt_hash or outcomes_hash != state.question.outcomes_hash:
            logger.warning("rejecting vote with mismatched question domain from %s", settler_pubkey[:16])
            return
        if outcome not in state.question.outcomes:
            logger.warning("rejecting vote with invalid outcome=%s from %s", outcome, settler_pubkey[:16])
            return
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            logger.warning("rejecting vote with invalid confidence=%s from %s", confidence, settler_pubkey[:16])
            return
        if timestamp > state.question.deadline:
            logger.warning("rejecting late vote from %s", settler_pubkey[:16])
            return
        if timestamp > now + 300:
            logger.warning("rejecting future-dated vote from %s", settler_pubkey[:16])
            return
        existing = state.votes_by_settler.get(settler_pubkey)
        if existing is not None:
            if existing.get("signature") != signature_hex:
                logger.warning("rejecting equivocation from %s", settler_pubkey[:16])
            return

        # The signed payload is the vote without the signature/reasoning fields.
        vote_for_signing = SettlementVote(
            kind=kind,
            protocol_version=protocol_version,
            question_id=question_id,
            prompt_hash=prompt_hash,
            outcomes_hash=outcomes_hash,
            deadline=deadline,
            settler_pubkey=settler_pubkey,
            model_tag=model_tag,
            outcome=outcome,
            confidence=confidence,
            timestamp=timestamp,
        )
        if not verify_signature(
            settler_pubkey, vote_for_signing.signing_payload(), signature_hex
        ):
            logger.warning(
                "rejecting vote with invalid signature from %s", settler_pubkey[:16]
            )
            return

        # Store, dedup by settler_pubkey
        state.votes_by_settler[settler_pubkey] = payload
        logger.info(
            "accepted vote q=%s settler=%s outcome=%d (%d/%d)",
            question_id,
            settler_pubkey[:16],
            outcome,
            len(state.votes_by_settler),
            self.quorum,
        )

        self._maybe_emit_consensus(question_id)

    def _broadcast_to_peers(self, wire: dict[str, Any]) -> None:
        if not self.peer_pubkeys:
            logger.info("no peer pubkeys configured; skipping broadcast")
            return
        body = canonical_json(wire)
        for pk in self.peer_pubkeys:
            self._send_with_retry(pk, body, kind="broadcast vote")

    def _propagate_question(self, q: QuestionAnnouncement) -> None:
        """Forward a freshly-seen question to every configured peer.

        Loop prevention is handled by the question_id dedup check at the top
        of `_handle_question`: when peers receive a question they already
        have, they no-op without re-broadcasting.
        """
        if not self.peer_pubkeys:
            return
        body = canonical_json(q.to_dict())
        for pk in self.peer_pubkeys:
            self._send_with_retry(pk, body, kind=f"propagate q={q.question_id[:16]}")

    def _send_with_retry(
        self,
        pubkey: str,
        body: bytes | str,
        *,
        kind: str,
        max_attempts: int = 3,
        base_delay: float = 0.4,
    ) -> bool:
        """AXL /send retries with exponential backoff.

        AXL daemons return 502 when the inter-node session for a pubkey isn't
        ready yet (mesh routing converges lazily). Single-shot sends drop the
        message; quick retries usually succeed once the session warms up.
        """
        last_err: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                self.axl.send(pubkey, body)
                if attempt == 1:
                    logger.info("%s -> %s ok", kind, pubkey[:16])
                else:
                    logger.info("%s -> %s ok (attempt %d)", kind, pubkey[:16], attempt)
                return True
            except Exception as e:  # noqa: BLE001
                last_err = e
                if attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    time.sleep(delay)
        logger.warning(
            "%s -> %s failed after %d attempts: %s",
            kind,
            pubkey[:16],
            max_attempts,
            last_err,
        )
        return False

    def _maybe_emit_consensus(self, question_id: str) -> None:
        state = self._questions.get(question_id)
        if state is None or state.consensus_emitted:
            return
        votes = list(state.votes_by_settler.values())
        if len(votes) < self.quorum:
            return
        try:
            outcome = compute_consensus(votes, threshold=self.quorum)
        except ConsensusError as e:
            logger.warning("consensus failed for %s: %s", question_id[:16], e)
            return

        state.consensus_emitted = True
        logger.info(
            "CONSENSUS q=%s outcome=%d quorum=%d weighted_score=%.3f",
            question_id,
            outcome.outcome,
            outcome.quorum_size,
            outcome.weighted_score,
        )
        if self.on_consensus:
            self.on_consensus(question_id, outcome.outcome, outcome.votes)
        self._maybe_post_onchain(question_id, outcome.outcome, outcome.quorum_size,
                                 outcome.weighted_score, outcome.votes)

    def _maybe_post_onchain(
        self,
        question_id: str,
        outcome: int,
        quorum_size: int,
        weighted_score: float,
        votes: list[dict[str, Any]],
    ) -> None:
        """Post the consensus to SynodRegistry if this settler is the designated poster.

        Designation rule: the settler with the lowest hex pubkey among the
        voters submits. This makes the choice deterministic across the
        network — every node arrives at the same poster from local state,
        no coordination beyond consensus is required.
        """
        if self.onchain is None:
            return
        voter_pubkeys = [
            str(v["settler_pubkey"]) for v in votes if int(v["outcome"]) == outcome
        ]
        if not is_designated_poster(self.identity.public_key_hex, voter_pubkeys):
            logger.info(
                "not the designated poster for q=%s; another settler will submit",
                question_id,
            )
            return
        if self.onchain.is_settled(question_id):
            logger.info("q=%s already settled on-chain; skipping submit",
                        question_id[:16])
            return
        try:
            state = self._questions[question_id]
            payload = votes_payload_for_chain(votes, question=state.question.to_dict())
            scaled = weighted_score_to_scaled(weighted_score)
            receipt = self.onchain.submit_settlement(
                question_id_hex=question_id,
                outcome=outcome,
                quorum_size=quorum_size,
                weighted_score_scaled=scaled,
                signed_votes_payload=payload,
            )
            tx_hash = receipt["transactionHash"].hex()
            logger.info(
                "ONCHAIN q=%s tx=%s outcome=%d quorum=%d",
                question_id[:16],
                tx_hash,
                outcome,
                quorum_size,
            )
        except Exception as e:
            logger.exception("on-chain submission failed for q=%s: %s",
                             question_id[:16], e)

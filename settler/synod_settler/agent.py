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
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .axl_client import AxlClient, InboundMessage
from .consensus import ConsensusError, compute_consensus
from .identity import Identity, verify_signature
from .llm import LLMProvider
from .protocol import (
    MessageKind,
    QuestionAnnouncement,
    SettlementVote,
    canonical_json,
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
    ) -> None:
        self.identity = identity
        self.axl = axl
        self.provider = provider
        # Don't broadcast to ourselves
        self.peer_pubkeys = [
            p.lower() for p in peer_pubkeys if p.lower() != identity.public_key_hex
        ]
        self.quorum = quorum
        self.poll_interval_s = poll_interval_s
        self.on_consensus = on_consensus

        self._questions: dict[str, QuestionState] = {}

    # --- public API ---------------------------------------------------------

    def run_forever(self) -> None:
        """Block on the AXL recv queue and process messages as they arrive."""
        logger.info(
            "settler running pubkey=%s peers=%d quorum=%d",
            self.identity.public_key_hex[:16],
            len(self.peer_pubkeys),
            self.quorum,
        )
        while True:
            self.tick()
            time.sleep(self.poll_interval_s)

    def tick(self) -> None:
        """Process at most one inbound AXL message."""
        msg = self.axl.recv()
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
            q = QuestionAnnouncement(
                kind=int(payload["kind"]),
                question_id=str(payload["question_id"]),
                prompt=str(payload["prompt"]),
                outcomes=[int(x) for x in payload["outcomes"]],
                deadline=int(payload["deadline"]),
            )
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
        logger.info("question %s prompt=%s", q.question_id[:16], q.prompt[:80])
        self._questions[q.question_id] = QuestionState(question=q)

        # 1) run inference locally
        result = self.provider.infer(q.prompt, q.outcomes)
        logger.info(
            "inference q=%s outcome=%d confidence=%.3f model=%s",
            q.question_id[:16],
            result.outcome,
            result.confidence,
            result.model_tag,
        )

        # 2) build, sign, store, broadcast our own vote
        vote = SettlementVote.new(
            question_id=q.question_id,
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
        settler_pubkey = str(payload.get("settler_pubkey", "")).lower()

        # The signed payload is the vote without the signature/reasoning fields.
        vote_for_signing = SettlementVote(
            kind=int(payload["kind"]),
            question_id=question_id,
            settler_pubkey=settler_pubkey,
            model_tag=str(payload["model_tag"]),
            outcome=int(payload["outcome"]),
            confidence=float(payload["confidence"]),
            timestamp=int(payload["timestamp"]),
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
            question_id[:16],
            settler_pubkey[:16],
            int(payload["outcome"]),
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
            try:
                self.axl.send(pk, body)
                logger.info("broadcast vote to %s", pk[:16])
            except Exception as e:
                logger.warning("broadcast to %s failed: %s", pk[:16], e)

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
            question_id[:16],
            outcome.outcome,
            outcome.quorum_size,
            outcome.weighted_score,
        )
        if self.on_consensus:
            self.on_consensus(question_id, outcome.outcome, outcome.votes)

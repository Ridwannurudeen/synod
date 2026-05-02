"""Independent verifier for Synod signed-vote settlement proofs.

The verifier is deliberately shared by tests and the CLI. It does not trust
agent logs or UI state: it parses the stored proof payload, verifies ed25519
signatures against AXL pubkeys, checks registry membership via a caller-supplied
callback, and recomputes the on-chain quorum and weighted score.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .identity import verify_signature
from .protocol import (
    MessageKind,
    PROTOCOL_VERSION,
    reasoning_sha256_hex,
    QuestionAnnouncement,
    SettlementVote,
    canonical_sha256_hex,
    text_sha256_hex,
    validate_hex32,
)


SCALE = 1_000_000


@dataclass(frozen=True)
class SettlementSnapshot:
    """On-chain settlement fields needed to verify a proof payload."""

    question_id: str
    outcome: int
    quorum_size: int
    weighted_score_scaled: int

    @classmethod
    def new(
        cls,
        *,
        question_id: str,
        outcome: int,
        quorum_size: int,
        weighted_score_scaled: int,
    ) -> SettlementSnapshot:
        return cls(
            question_id=validate_hex32(question_id.removeprefix("0x"), field="question_id"),
            outcome=int(outcome),
            quorum_size=int(quorum_size),
            weighted_score_scaled=int(weighted_score_scaled),
        )


@dataclass
class VerifiedVote:
    pubkey: str
    model_tag: str
    outcome: int
    confidence: float
    registered: bool = False
    signature_valid: bool = False
    valid: bool = False
    errors: list[str] = field(default_factory=list)


@dataclass
class ProofVerification:
    status: str
    settlement: SettlementSnapshot
    winner_votes: int
    weighted_score_scaled: int
    votes: list[VerifiedVote]
    errors: list[str]

    @property
    def verified(self) -> bool:
        return self.status == "verified"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "question_id": self.settlement.question_id,
            "outcome": self.settlement.outcome,
            "quorum_size": self.settlement.quorum_size,
            "winner_votes": self.winner_votes,
            "weighted_score_scaled": self.weighted_score_scaled,
            "expected_weighted_score_scaled": self.settlement.weighted_score_scaled,
            "errors": list(self.errors),
            "votes": [
                {
                    "pubkey": v.pubkey,
                    "model_tag": v.model_tag,
                    "outcome": v.outcome,
                    "confidence": v.confidence,
                    "registered": v.registered,
                    "signature_valid": v.signature_valid,
                    "valid": v.valid,
                    "errors": list(v.errors),
                }
                for v in self.votes
            ],
        }


def _is_signature_hex(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 128:
        return False
    try:
        raw = bytes.fromhex(value)
    except ValueError:
        return False
    return len(raw) == 64 and value.lower() == value.strip().lower()


def _parse_question(raw: Any, errors: list[str]) -> QuestionAnnouncement | None:
    if not isinstance(raw, dict):
        errors.append("proof payload is missing question")
        return None
    try:
        q = QuestionAnnouncement.new(
            question_id=str(raw["question_id"]),
            prompt=str(raw["prompt"]),
            outcomes=[int(x) for x in raw["outcomes"]],
            deadline=int(raw["deadline"]),
        )
    except (KeyError, TypeError, ValueError) as e:
        errors.append(f"invalid question: {e}")
        return None
    if int(raw.get("kind", MessageKind.QUESTION)) != int(MessageKind.QUESTION):
        errors.append("question has wrong kind")
    return q


def verify_proof_payload(
    payload_bytes: bytes,
    settlement: SettlementSnapshot,
    is_registered_pubkey: Callable[[str], bool],
) -> ProofVerification:
    """Verify a Synod proof payload against an expected settlement snapshot."""

    errors: list[str] = []
    verified_votes: list[VerifiedVote] = []

    try:
        parsed = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ProofVerification(
            status="invalid",
            settlement=settlement,
            winner_votes=0,
            weighted_score_scaled=0,
            votes=[],
            errors=["signedVotesPayload is not valid JSON"],
        )

    if not isinstance(parsed, dict):
        errors.append("proof payload must be a JSON object")
        parsed = {}
    if parsed.get("protocol_version") not in (1, PROTOCOL_VERSION):
        errors.append(f"unsupported protocol_version {parsed.get('protocol_version')}")

    question = _parse_question(parsed.get("question"), errors)
    if question and question.question_id != settlement.question_id:
        errors.append("question_id does not match settlement")

    raw_votes = parsed.get("votes")
    if not isinstance(raw_votes, list) or not raw_votes:
        errors.append("proof payload has no votes")
        raw_votes = []

    seen: set[str] = set()
    outcome_counts: dict[int, int] = {}
    outcome_weights: dict[int, float] = {}

    for index, raw_vote in enumerate(raw_votes):
        if not isinstance(raw_vote, dict):
            errors.append(f"vote {index} is not an object")
            continue

        vote_errors: list[str] = []
        pubkey = ""
        model_tag = str(raw_vote.get("model_tag", ""))
        outcome = -1
        confidence = math.nan
        try:
            pubkey = validate_hex32(str(raw_vote.get("settler_pubkey", "")), field="settler_pubkey")
        except ValueError as e:
            vote_errors.append(str(e))

        try:
            outcome = int(raw_vote["outcome"])
            confidence = float(raw_vote["confidence"])
        except (KeyError, TypeError, ValueError) as e:
            vote_errors.append(f"invalid outcome/confidence: {e}")

        row = VerifiedVote(
            pubkey=pubkey,
            model_tag=model_tag,
            outcome=outcome,
            confidence=confidence,
        )

        if pubkey:
            if pubkey in seen:
                vote_errors.append("duplicate vote from settler")
            seen.add(pubkey)
            try:
                row.registered = bool(is_registered_pubkey(pubkey))
            except Exception as e:  # pragma: no cover - defensive around RPC failures
                vote_errors.append(f"registry membership check failed: {e}")
            if not row.registered:
                vote_errors.append("settler pubkey is not registered")

        signature = str(raw_vote.get("signature", ""))
        if not _is_signature_hex(signature):
            vote_errors.append("signature must be 64-byte hex")

        try:
            protocol_version = int(raw_vote["protocol_version"])
            kind = int(raw_vote["kind"])
            deadline = int(raw_vote["deadline"])
            timestamp = int(raw_vote["timestamp"])
            prompt_hash = str(raw_vote["prompt_hash"])
            outcomes_hash = str(raw_vote["outcomes_hash"])
            question_id = validate_hex32(str(raw_vote["question_id"]), field="question_id")
        except (KeyError, TypeError, ValueError) as e:
            vote_errors.append(f"malformed signed vote fields: {e}")
        else:
            if kind != int(MessageKind.VOTE):
                vote_errors.append("vote has wrong kind")
            if protocol_version not in (1, PROTOCOL_VERSION):
                vote_errors.append("vote has unsupported protocol_version")
            if question_id != settlement.question_id:
                vote_errors.append("vote question_id does not match settlement")
            if question:
                if deadline != question.deadline:
                    vote_errors.append("vote deadline does not match question")
                if prompt_hash != text_sha256_hex(question.prompt):
                    vote_errors.append("vote prompt_hash does not match question")
                if outcomes_hash != canonical_sha256_hex(question.outcomes):
                    vote_errors.append("vote outcomes_hash does not match question")
                if outcome not in question.outcomes:
                    vote_errors.append("vote outcome is not in question outcomes")
            if timestamp > deadline:
                vote_errors.append("vote timestamp is after deadline")
            if not math.isfinite(confidence) or confidence < 0.0 or confidence > 1.0:
                vote_errors.append("vote confidence is outside [0, 1]")

            # v2+: reasoning_hash must be present and bind the displayed reasoning
            reasoning_hash = ""
            if protocol_version >= 2:
                rh = raw_vote.get("reasoning_hash")
                reasoning_text = str(raw_vote.get("reasoning", ""))
                expected = reasoning_sha256_hex(reasoning_text)
                if not isinstance(rh, str) or len(rh) != 64:
                    vote_errors.append("missing or malformed reasoning_hash")
                elif rh != expected:
                    vote_errors.append("reasoning text does not match signed reasoning_hash")
                reasoning_hash = rh if isinstance(rh, str) else ""

            if pubkey and _is_signature_hex(signature):
                vote_for_signing = SettlementVote(
                    kind=kind,
                    protocol_version=protocol_version,
                    question_id=question_id,
                    prompt_hash=prompt_hash,
                    outcomes_hash=outcomes_hash,
                    deadline=deadline,
                    settler_pubkey=pubkey,
                    model_tag=model_tag,
                    outcome=outcome,
                    confidence=confidence,
                    timestamp=timestamp,
                    reasoning_hash=reasoning_hash,
                )
                row.signature_valid = verify_signature(
                    pubkey,
                    vote_for_signing.signing_payload(),
                    signature,
                )
                if not row.signature_valid:
                    vote_errors.append("ed25519 signature is invalid")

        row.errors = vote_errors
        row.valid = not vote_errors
        verified_votes.append(row)
        errors.extend(f"{pubkey[:16] or f'vote {index}'}: {e}" for e in vote_errors)

        if row.valid:
            outcome_counts[outcome] = outcome_counts.get(outcome, 0) + 1
            outcome_weights[outcome] = outcome_weights.get(outcome, 0.0) + round(confidence, 4)

    winner_votes = outcome_counts.get(settlement.outcome, 0)
    weighted_score_scaled = int(round(outcome_weights.get(settlement.outcome, 0.0) * SCALE))
    if winner_votes < settlement.quorum_size:
        errors.append("winning outcome does not meet settlement quorum_size")
    if weighted_score_scaled != settlement.weighted_score_scaled:
        errors.append("weighted score does not match settlement")

    return ProofVerification(
        status="verified" if not errors else "invalid",
        settlement=settlement,
        winner_votes=winner_votes,
        weighted_score_scaled=weighted_score_scaled,
        votes=verified_votes,
        errors=errors,
    )

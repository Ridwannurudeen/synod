"""Synod deliberation protocol — message types and canonical serialization.

Every message exchanged between settlers over AXL is one of:
  - QuestionAnnouncement: a market resolution request
  - SettlementVote: a settler's signed answer
  - ConsensusResult: an aggregated quorum proof

Wire format is canonical JSON (sorted keys, no whitespace) so that signatures
are deterministic across settler implementations.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import IntEnum
from typing import Any


CANONICAL_JSON_SEPARATORS = (",", ":")
PROTOCOL_VERSION = 1
HEX_CHARS = frozenset("0123456789abcdef")


class MessageKind(IntEnum):
    QUESTION = 1
    VOTE = 2
    CONSENSUS = 3


def canonical_json(obj: Any) -> bytes:
    """Serialize to canonical JSON: sorted keys, no whitespace, UTF-8.

    The exact byte sequence produced here is what gets fed to ed25519 sign and
    verify. Any deviation (different whitespace, key ordering) breaks
    signatures.
    """
    return json.dumps(
        obj,
        sort_keys=True,
        separators=CANONICAL_JSON_SEPARATORS,
        ensure_ascii=False,
    ).encode("utf-8")


def canonical_sha256_hex(obj: Any) -> str:
    """SHA-256 over the canonical JSON encoding of `obj`."""
    return hashlib.sha256(canonical_json(obj)).hexdigest()


def text_sha256_hex(text: str) -> str:
    """SHA-256 over UTF-8 text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_hex32(value: str, *, field: str) -> str:
    """Return a lower-case 32-byte hex string or raise ValueError."""
    lowered = value.strip().lower()
    if len(lowered) != 64 or any(ch not in HEX_CHARS for ch in lowered):
        raise ValueError(f"{field} must be a 64-character hex string")
    try:
        raw = bytes.fromhex(lowered)
    except ValueError as e:
        raise ValueError(f"{field} must be hex") from e
    if len(raw) != 32:
        raise ValueError(f"{field} must be 32 bytes, got {len(raw)}")
    return lowered


@dataclass(frozen=True)
class QuestionAnnouncement:
    """A market resolution request broadcast by a market creator (or simulator).

    `question_id` is a 32-byte hex string. `prompt` is the resolution prompt the
    market creator wrote. `outcomes` enumerates the valid outcome indices —
    binary markets are `[0, 1]`, multi-outcome markets are `[0, 1, ..., N-1]`.
    `deadline` is a Unix timestamp; settlers ignore late votes.
    """

    kind: int
    question_id: str
    prompt: str
    outcomes: list[int]
    deadline: int

    @classmethod
    def new(
        cls,
        question_id: str,
        prompt: str,
        outcomes: list[int],
        deadline: int,
    ) -> QuestionAnnouncement:
        question_id = validate_hex32(question_id, field="question_id")
        if len(outcomes) < 2:
            raise ValueError("question must have at least two outcomes")
        if len(set(outcomes)) != len(outcomes):
            raise ValueError("question outcomes must be unique")
        return cls(
            kind=int(MessageKind.QUESTION),
            question_id=question_id,
            prompt=prompt,
            outcomes=outcomes,
            deadline=deadline,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "question_id": self.question_id,
            "prompt": self.prompt,
            "outcomes": list(self.outcomes),
            "deadline": self.deadline,
        }

    @property
    def prompt_hash(self) -> str:
        return text_sha256_hex(self.prompt)

    @property
    def outcomes_hash(self) -> str:
        return canonical_sha256_hex(list(self.outcomes))

    def domain_fields(self) -> dict[str, Any]:
        """Fields that bind a vote to this exact question domain."""
        return {
            "protocol_version": PROTOCOL_VERSION,
            "question_id": self.question_id,
            "prompt_hash": self.prompt_hash,
            "outcomes_hash": self.outcomes_hash,
            "deadline": self.deadline,
        }


@dataclass(frozen=True)
class SettlementVote:
    """A settler's answer to a QuestionAnnouncement.

    `outcome` is the chosen index from `QuestionAnnouncement.outcomes`.
    `confidence` is in [0.0, 1.0]; lower means the model is less certain.
    `reasoning` is a short audit trail; it is NOT covered by the signature
    domain in v1 to keep votes terse on the wire — only the structured fields
    are signed.
    """

    kind: int
    protocol_version: int
    question_id: str
    prompt_hash: str
    outcomes_hash: str
    deadline: int
    settler_pubkey: str  # 64-char hex (ed25519 raw pubkey)
    model_tag: str
    outcome: int
    confidence: float
    timestamp: int

    @classmethod
    def new(
        cls,
        question: QuestionAnnouncement,
        settler_pubkey: str,
        model_tag: str,
        outcome: int,
        confidence: float,
        timestamp: int,
    ) -> SettlementVote:
        if not (0.0 <= confidence <= 1.0):
            raise ValueError(f"confidence out of range: {confidence}")
        if outcome not in question.outcomes:
            raise ValueError(f"outcome {outcome} not in valid set {question.outcomes}")
        settler_pubkey = validate_hex32(settler_pubkey, field="settler_pubkey")
        return cls(
            kind=int(MessageKind.VOTE),
            protocol_version=PROTOCOL_VERSION,
            question_id=question.question_id,
            prompt_hash=question.prompt_hash,
            outcomes_hash=question.outcomes_hash,
            deadline=question.deadline,
            settler_pubkey=settler_pubkey,
            model_tag=model_tag,
            outcome=outcome,
            confidence=confidence,
            timestamp=timestamp,
        )

    def signing_payload(self) -> bytes:
        """Bytes the settler signs. Must be reproducible across settlers."""
        return canonical_json(
            {
                "kind": self.kind,
                "protocol_version": self.protocol_version,
                "question_id": self.question_id,
                "prompt_hash": self.prompt_hash,
                "outcomes_hash": self.outcomes_hash,
                "deadline": self.deadline,
                "settler_pubkey": self.settler_pubkey,
                "model_tag": self.model_tag,
                "outcome": self.outcome,
                # confidence is rounded to 4 decimals so floating-point
                # representation differences across providers don't break sigs
                "confidence": round(self.confidence, 4),
                "timestamp": self.timestamp,
            }
        )

    def to_wire(self, signature_hex: str, reasoning: str | None) -> dict[str, Any]:
        """Wire-format payload including the signature and optional reasoning."""
        out: dict[str, Any] = {
            "kind": self.kind,
            "protocol_version": self.protocol_version,
            "question_id": self.question_id,
            "prompt_hash": self.prompt_hash,
            "outcomes_hash": self.outcomes_hash,
            "deadline": self.deadline,
            "settler_pubkey": self.settler_pubkey,
            "model_tag": self.model_tag,
            "outcome": self.outcome,
            "confidence": round(self.confidence, 4),
            "timestamp": self.timestamp,
            "signature": signature_hex,
        }
        if reasoning:
            out["reasoning"] = reasoning
        return out


@dataclass(frozen=True)
class ConsensusResult:
    """The aggregated quorum-signed result for a question.

    `votes` is the list of accepted SettlementVote wire payloads. `outcome` is
    the winning index. The full `votes` list is what gets posted on-chain so
    SynodRegistry.recordSettlement can re-verify each signature.
    """

    kind: int
    question_id: str
    outcome: int
    quorum_size: int
    votes: list[dict[str, Any]]

    @classmethod
    def new(
        cls,
        question_id: str,
        outcome: int,
        quorum_size: int,
        votes: list[dict[str, Any]],
    ) -> ConsensusResult:
        return cls(
            kind=int(MessageKind.CONSENSUS),
            question_id=question_id,
            outcome=outcome,
            quorum_size=quorum_size,
            votes=list(votes),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "question_id": self.question_id,
            "outcome": self.outcome,
            "quorum_size": self.quorum_size,
            "votes": list(self.votes),
        }

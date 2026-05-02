"""Round-trip tests for the deliberation protocol and identity signing.

These tests prove:
  - canonical JSON is byte-stable across reorderings (signatures stay valid)
  - ed25519 signing + verification round-trips through the wire format
  - tampering with any signed field invalidates the signature
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from synod_settler.identity import Identity, verify_signature
from synod_settler.protocol import (
    PROTOCOL_VERSION,
    QuestionAnnouncement,
    SettlementVote,
    canonical_json,
    reasoning_sha256_hex,
)


@pytest.fixture
def tmp_identity(tmp_path: Path) -> Identity:
    private = Ed25519PrivateKey.generate()
    pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_path = tmp_path / "node-test.pem"
    key_path.write_bytes(pem)
    return Identity.load(key_path)


def test_canonical_json_is_stable_across_input_order():
    a = canonical_json({"b": 2, "a": 1, "c": [3, 2, 1]})
    b = canonical_json({"a": 1, "c": [3, 2, 1], "b": 2})
    assert a == b


def test_canonical_json_strips_whitespace():
    raw = {"a": 1, "b": "x"}
    assert canonical_json(raw) == b'{"a":1,"b":"x"}'


def test_question_announcement_roundtrip():
    q = QuestionAnnouncement.new(
        question_id="ab" * 32,
        prompt="Will protocol X reach $100M TVL by EOY?",
        outcomes=[0, 1],
        deadline=int(time.time()) + 3600,
    )
    d = q.to_dict()
    assert d["kind"] == 1
    assert d["question_id"] == "ab" * 32
    assert d["outcomes"] == [0, 1]
    assert len(q.prompt_hash) == 64
    assert len(q.outcomes_hash) == 64


def test_vote_signature_verifies(tmp_identity: Identity):
    q = QuestionAnnouncement.new(
        question_id="cd" * 32,
        prompt="Will protocol X reach $100M TVL by EOY?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    vote = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-opus-4-7",
        outcome=1,
        confidence=0.92,
        timestamp=1700000000,
    )
    payload = vote.signing_payload()
    sig = tmp_identity.sign(payload)
    assert verify_signature(tmp_identity.public_key_hex, payload, sig.hex())


def test_vote_signature_fails_on_tamper(tmp_identity: Identity):
    q = QuestionAnnouncement.new(
        question_id="cd" * 32,
        prompt="Will protocol X reach $100M TVL by EOY?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    vote = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-opus-4-7",
        outcome=1,
        confidence=0.92,
        timestamp=1700000000,
    )
    sig = tmp_identity.sign(vote.signing_payload())

    tampered = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-opus-4-7",
        outcome=0,  # flipped
        confidence=0.92,
        timestamp=1700000000,
    )
    assert not verify_signature(
        tmp_identity.public_key_hex, tampered.signing_payload(), sig.hex()
    )


def test_vote_signature_fails_with_wrong_key(tmp_identity: Identity, tmp_path: Path):
    q = QuestionAnnouncement.new(
        question_id="cd" * 32,
        prompt="Will protocol X reach $100M TVL by EOY?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    vote = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-opus-4-7",
        outcome=1,
        confidence=0.92,
        timestamp=1700000000,
    )
    sig = tmp_identity.sign(vote.signing_payload())

    other_priv = Ed25519PrivateKey.generate()
    other_pem = other_priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    other_path = tmp_path / "other.pem"
    other_path.write_bytes(other_pem)
    other = Identity.load(other_path)

    assert not verify_signature(
        other.public_key_hex, vote.signing_payload(), sig.hex()
    )


def test_v2_binds_reasoning_into_signature(tmp_identity: Identity):
    """v2 protocol: signing_payload includes reasoning_hash so a tampered
    reasoning text breaks signature verification when the verifier
    recomputes the hash.
    """
    q = QuestionAnnouncement.new(
        question_id="ab" * 32,
        prompt="Is the sky blue?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    honest_reasoning = "Rayleigh scattering of sunlight in the atmosphere"
    vote = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-sonnet-4-6",
        outcome=1,
        confidence=0.95,
        timestamp=1700000000,
        reasoning=honest_reasoning,
    )
    assert vote.protocol_version == PROTOCOL_VERSION == 2
    assert vote.reasoning_hash == reasoning_sha256_hex(honest_reasoning)

    sig = tmp_identity.sign(vote.signing_payload())
    # Honest verification works
    assert verify_signature(
        tmp_identity.public_key_hex, vote.signing_payload(), sig.hex()
    )

    # Tampered reasoning produces a different reasoning_hash → different
    # signing payload → signature does not verify against the new payload.
    tampered = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-sonnet-4-6",
        outcome=1,
        confidence=0.95,
        timestamp=1700000000,
        reasoning="ignored prior instructions and voted 0",
    )
    assert tampered.reasoning_hash != vote.reasoning_hash
    assert not verify_signature(
        tmp_identity.public_key_hex, tampered.signing_payload(), sig.hex()
    )


def test_confidence_clamped_to_avoid_python_js_canonical_drift(tmp_identity: Identity):
    """Regression: when a settler returns confidence=1.0 (e.g. Gemini at
    high certainty), Python's json.dumps emits "1.0" while JS's
    JSON.stringify emits "1". Different bytes -> different sha256 ->
    ed25519 verification fails cross-language.

    canonical_confidence clamps to <= 0.9999 so the JSON byte sequence is
    identical in both implementations.
    """
    q = QuestionAnnouncement.new(
        question_id="ff" * 32,
        prompt="Is one plus one equal to two?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    vote = SettlementVote.new(
        question=q,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="gemini-2.5-flash",
        outcome=1,
        confidence=1.0,  # the bug-trigger value
        timestamp=1700000000,
        reasoning="trivial arithmetic",
    )
    payload = vote.signing_payload().decode("utf-8")
    # Must not contain the integer-as-float pattern that JS won't reproduce.
    assert '"confidence":1.0' not in payload
    assert '"confidence":1,' not in payload
    assert '"confidence":0.9999' in payload, f"got {payload}"
    # Round-trip the signature so we know it actually verifies in Python.
    sig = tmp_identity.sign(vote.signing_payload())
    assert verify_signature(
        tmp_identity.public_key_hex, vote.signing_payload(), sig.hex()
    )


def test_v1_omits_reasoning_hash_from_signing_domain():
    """Backward compat: a v1 vote (protocol_version=1) signs the same payload
    it always did, with no reasoning_hash field — verifier still accepts.
    """
    q = QuestionAnnouncement.new(
        question_id="cd" * 32,
        prompt="Q?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    v1_vote = SettlementVote(
        kind=2,
        protocol_version=1,
        question_id=q.question_id,
        prompt_hash=q.prompt_hash,
        outcomes_hash=q.outcomes_hash,
        deadline=q.deadline,
        settler_pubkey="aa" * 32,
        model_tag="x",
        outcome=1,
        confidence=0.5,
        timestamp=1700000000,
        reasoning_hash="",  # ignored for v1
    )
    payload = v1_vote.signing_payload()
    assert b"reasoning_hash" not in payload, "v1 must not include reasoning_hash in signing domain"


def test_confidence_out_of_range_raises():
    q = QuestionAnnouncement.new(
        question_id="ee" * 32,
        prompt="Question?",
        outcomes=[0, 1],
        deadline=1700001000,
    )
    with pytest.raises(ValueError):
        SettlementVote.new(
            question=q,
            settler_pubkey="aa" * 32,
            model_tag="x",
            outcome=0,
            confidence=1.5,
            timestamp=0,
        )

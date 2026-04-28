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
    QuestionAnnouncement,
    SettlementVote,
    canonical_json,
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


def test_vote_signature_verifies(tmp_identity: Identity):
    vote = SettlementVote.new(
        question_id="cd" * 32,
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
    vote = SettlementVote.new(
        question_id="cd" * 32,
        settler_pubkey=tmp_identity.public_key_hex,
        model_tag="claude-opus-4-7",
        outcome=1,
        confidence=0.92,
        timestamp=1700000000,
    )
    sig = tmp_identity.sign(vote.signing_payload())

    tampered = SettlementVote.new(
        question_id="cd" * 32,
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
    vote = SettlementVote.new(
        question_id="cd" * 32,
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


def test_confidence_out_of_range_raises():
    with pytest.raises(ValueError):
        SettlementVote.new(
            question_id="ee" * 32,
            settler_pubkey="aa" * 32,
            model_tag="x",
            outcome=0,
            confidence=1.5,
            timestamp=0,
        )

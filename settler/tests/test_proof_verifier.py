from __future__ import annotations

from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from synod_settler.identity import Identity
from synod_settler.onchain import votes_payload_for_chain
from synod_settler.proof_verifier import SettlementSnapshot, verify_proof_payload
from synod_settler.protocol import QuestionAnnouncement, SettlementVote


def make_identity(tmp_path: Path, name: str) -> Identity:
    private = Ed25519PrivateKey.generate()
    pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_path = tmp_path / f"{name}.pem"
    key_path.write_bytes(pem)
    return Identity.load(key_path)


def make_vote(
    identity: Identity,
    question: QuestionAnnouncement,
    *,
    outcome: int = 1,
    confidence: float = 0.9,
    model_tag: str = "test-model",
) -> dict[str, object]:
    vote = SettlementVote.new(
        question=question,
        settler_pubkey=identity.public_key_hex,
        model_tag=model_tag,
        outcome=outcome,
        confidence=confidence,
        timestamp=question.deadline - 10,
    )
    return vote.to_wire(signature_hex=identity.sign(vote.signing_payload()).hex(), reasoning=None)


def test_verifies_valid_signed_vote_proof(tmp_path: Path):
    a = make_identity(tmp_path, "a")
    b = make_identity(tmp_path, "b")
    q = QuestionAnnouncement.new(
        question_id="12" * 32,
        prompt="Was the Bitcoin genesis block mined on January 3, 2009?",
        outcomes=[0, 1],
        deadline=1_900_000_000,
    )
    votes = [
        make_vote(a, q, confidence=0.9, model_tag="a"),
        make_vote(b, q, confidence=0.8, model_tag="b"),
    ]
    payload = votes_payload_for_chain(votes, question=q.to_dict())
    settlement = SettlementSnapshot.new(
        question_id=q.question_id,
        outcome=1,
        quorum_size=2,
        weighted_score_scaled=1_700_000,
    )

    result = verify_proof_payload(
        payload,
        settlement,
        lambda pk: pk in {a.public_key_hex, b.public_key_hex},
    )

    assert result.verified
    assert result.winner_votes == 2
    assert result.weighted_score_scaled == 1_700_000
    assert all(v.valid for v in result.votes)


def test_rejects_tampered_signature(tmp_path: Path):
    a = make_identity(tmp_path, "a")
    b = make_identity(tmp_path, "b")
    q = QuestionAnnouncement.new(
        question_id="34" * 32,
        prompt="Question?",
        outcomes=[0, 1],
        deadline=1_900_000_000,
    )
    vote_a = make_vote(a, q, confidence=0.9)
    vote_b = make_vote(b, q, confidence=0.8)
    vote_b["outcome"] = 0
    payload = votes_payload_for_chain([vote_a, vote_b], question=q.to_dict())
    settlement = SettlementSnapshot.new(
        question_id=q.question_id,
        outcome=1,
        quorum_size=2,
        weighted_score_scaled=1_700_000,
    )

    result = verify_proof_payload(
        payload,
        settlement,
        lambda pk: pk in {a.public_key_hex, b.public_key_hex},
    )

    assert not result.verified
    assert any("ed25519 signature is invalid" in e for e in result.errors)


def test_rejects_weighted_score_mismatch(tmp_path: Path):
    a = make_identity(tmp_path, "a")
    b = make_identity(tmp_path, "b")
    q = QuestionAnnouncement.new(
        question_id="56" * 32,
        prompt="Question?",
        outcomes=[0, 1],
        deadline=1_900_000_000,
    )
    votes = [make_vote(a, q, confidence=0.9), make_vote(b, q, confidence=0.8)]
    payload = votes_payload_for_chain(votes, question=q.to_dict())
    settlement = SettlementSnapshot.new(
        question_id=q.question_id,
        outcome=1,
        quorum_size=2,
        weighted_score_scaled=1_600_000,
    )

    result = verify_proof_payload(
        payload,
        settlement,
        lambda pk: pk in {a.public_key_hex, b.public_key_hex},
    )

    assert not result.verified
    assert "weighted score does not match settlement" in result.errors


def test_rejects_winner_without_quorum(tmp_path: Path):
    a = make_identity(tmp_path, "a")
    b = make_identity(tmp_path, "b")
    q = QuestionAnnouncement.new(
        question_id="78" * 32,
        prompt="Question?",
        outcomes=[0, 1],
        deadline=1_900_000_000,
    )
    votes = [
        make_vote(a, q, outcome=1, confidence=0.9),
        make_vote(b, q, outcome=0, confidence=0.8),
    ]
    payload = votes_payload_for_chain(votes, question=q.to_dict())
    settlement = SettlementSnapshot.new(
        question_id=q.question_id,
        outcome=1,
        quorum_size=2,
        weighted_score_scaled=900_000,
    )

    result = verify_proof_payload(
        payload,
        settlement,
        lambda pk: pk in {a.public_key_hex, b.public_key_hex},
    )

    assert not result.verified
    assert "winning outcome does not meet settlement quorum_size" in result.errors

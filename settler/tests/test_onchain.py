"""Pure-logic tests for onchain helpers. No RPC calls in these tests —
end-to-end on-chain integration is exercised by tools/run_onchain_test.sh
which spins up an anvil chain and asserts a real recordSettlement tx.
"""

from __future__ import annotations

import pytest

from synod_settler.onchain import (
    is_designated_poster,
    question_id_to_bytes32,
    votes_payload_for_chain,
    weighted_score_to_scaled,
)


def test_question_id_to_bytes32_roundtrip():
    qid = "ab" * 32
    raw = question_id_to_bytes32(qid)
    assert len(raw) == 32
    assert raw.hex() == qid


def test_question_id_to_bytes32_rejects_wrong_length():
    with pytest.raises(ValueError):
        question_id_to_bytes32("ab" * 16)  # 16 bytes not 32


def test_designated_poster_is_lowest_pubkey():
    a = "aa" + "00" * 31
    b = "bb" + "00" * 31
    c = "cc" + "00" * 31
    voters = [c, a, b]
    assert is_designated_poster(a, voters) is True
    assert is_designated_poster(b, voters) is False
    assert is_designated_poster(c, voters) is False


def test_designated_poster_requires_membership():
    a = "aa" + "00" * 31
    b = "bb" + "00" * 31
    c = "cc" + "00" * 31
    # `a` has the lowest pubkey, but if it's not among voters, it doesn't post
    assert is_designated_poster(a, [b, c]) is False


def test_designated_poster_case_insensitive():
    a_upper = "AA" + "00" * 31
    a_lower = "aa" + "00" * 31
    b = "bb" + "00" * 31
    assert is_designated_poster(a_upper, [a_lower, b]) is True


def test_weighted_score_to_scaled():
    assert weighted_score_to_scaled(1.98) == 1_980_000
    assert weighted_score_to_scaled(0.0) == 0
    assert weighted_score_to_scaled(2.5, scale=100) == 250


def test_votes_payload_is_canonical_json():
    votes = [
        {"settler_pubkey": "aa" * 32, "outcome": 1, "confidence": 0.9},
        {"settler_pubkey": "bb" * 32, "outcome": 1, "confidence": 0.8},
    ]
    payload = votes_payload_for_chain(votes)
    # Must contain both settler keys; key ordering must be sorted (canonical)
    text = payload.decode("utf-8")
    assert '"votes":' in text
    # canonical_json sorts keys alphabetically inside each object
    first = text.find('"settler_pubkey"')
    confidence = text.find('"confidence"')
    assert confidence < first  # 'confidence' sorts before 'settler_pubkey'

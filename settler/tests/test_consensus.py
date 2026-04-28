"""Tests for the consensus aggregation algorithm."""

from __future__ import annotations

import pytest

from synod_settler.consensus import ConsensusError, compute_consensus


def _vote(pubkey: str, outcome: int, confidence: float) -> dict:
    return {
        "kind": 2,
        "question_id": "ab" * 32,
        "settler_pubkey": pubkey,
        "model_tag": "test-model",
        "outcome": outcome,
        "confidence": confidence,
        "timestamp": 0,
        "signature": "deadbeef",
    }


def test_majority_wins():
    votes = [
        _vote("aa" * 32, outcome=1, confidence=0.9),
        _vote("bb" * 32, outcome=1, confidence=0.7),
        _vote("cc" * 32, outcome=0, confidence=0.6),
    ]
    out = compute_consensus(votes, threshold=2)
    assert out.outcome == 1
    assert out.quorum_size == 3
    assert out.weighted_score == pytest.approx(1.6)


def test_low_confidence_majority_loses_to_high_confidence_minority():
    # Two voters say outcome=0 with low confidence (0.3 each = 0.6 total)
    # One voter says outcome=1 with high confidence (0.95)
    # Confidence-weighted majority should pick outcome=1
    votes = [
        _vote("aa" * 32, outcome=0, confidence=0.3),
        _vote("bb" * 32, outcome=0, confidence=0.3),
        _vote("cc" * 32, outcome=1, confidence=0.95),
    ]
    out = compute_consensus(votes, threshold=2)
    assert out.outcome == 1
    assert out.weighted_score == pytest.approx(0.95)


def test_below_threshold_raises():
    votes = [_vote("aa" * 32, outcome=1, confidence=0.9)]
    with pytest.raises(ConsensusError):
        compute_consensus(votes, threshold=2)


def test_dedup_by_settler_pubkey():
    # Same settler casts two votes; only the latest counts and quorum is short
    votes = [
        _vote("aa" * 32, outcome=0, confidence=0.5),
        _vote("aa" * 32, outcome=1, confidence=0.5),
    ]
    with pytest.raises(ConsensusError):
        compute_consensus(votes, threshold=2)


def test_tie_breaks_to_lower_outcome_index():
    votes = [
        _vote("aa" * 32, outcome=0, confidence=0.5),
        _vote("bb" * 32, outcome=1, confidence=0.5),
    ]
    out = compute_consensus(votes, threshold=2)
    assert out.outcome == 0


def test_empty_votes_raises():
    with pytest.raises(ConsensusError):
        compute_consensus([], threshold=1)

"""Tests for the test-only DeterministicProvider.

Used by the smoke-test path so AXL → consensus → on-chain settlement can
run without real API keys.
"""

from __future__ import annotations

import os

import pytest

from synod_settler.llm import DeterministicProvider, build_provider


def test_default_returns_first_valid_outcome(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SYNOD_DETERMINISTIC_OUTCOME", raising=False)
    monkeypatch.delenv("SYNOD_DETERMINISTIC_CONFIDENCE", raising=False)
    p = DeterministicProvider()
    r = p.infer("any prompt", [0, 1])
    assert r.outcome == 0
    assert r.confidence == pytest.approx(0.95)
    assert r.model_tag == "deterministic-v1"
    assert "deterministic provider" in r.reasoning


def test_pinned_outcome_and_confidence_are_used(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYNOD_DETERMINISTIC_OUTCOME", "1")
    monkeypatch.setenv("SYNOD_DETERMINISTIC_CONFIDENCE", "0.7")
    p = DeterministicProvider()
    r = p.infer("any", [0, 1])
    assert r.outcome == 1
    assert r.confidence == pytest.approx(0.7)


def test_pinned_outcome_outside_valid_set_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SYNOD_DETERMINISTIC_OUTCOME", "99")
    monkeypatch.delenv("SYNOD_DETERMINISTIC_CONFIDENCE", raising=False)
    p = DeterministicProvider()
    r = p.infer("any", [0, 1])
    assert r.outcome == 0  # falls back to first valid


def test_pinned_confidence_out_of_range_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SYNOD_DETERMINISTIC_OUTCOME", raising=False)
    monkeypatch.setenv("SYNOD_DETERMINISTIC_CONFIDENCE", "1.5")
    p = DeterministicProvider()
    r = p.infer("any", [0, 1])
    assert r.confidence == pytest.approx(0.95)


def test_build_provider_dispatches_deterministic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SYNOD_DETERMINISTIC_OUTCOME", raising=False)
    monkeypatch.delenv("SYNOD_DETERMINISTIC_CONFIDENCE", raising=False)
    p = build_provider("deterministic")
    assert isinstance(p, DeterministicProvider)
    r = p.infer("Q?", [0, 1, 2])
    assert r.outcome in [0, 1, 2]
    assert r.model_tag == "deterministic-v1"


def test_build_provider_unknown_raises() -> None:
    with pytest.raises(ValueError):
        build_provider("nonexistent")

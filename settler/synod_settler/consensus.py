"""Vote aggregation for Synod settlement consensus.

Given a list of accepted SettlementVote payloads (already signature-verified by
the caller), compute the consensus outcome via confidence-weighted majority.

Algorithm (v1):
  1. Group votes by `outcome` index.
  2. A candidate is eligible only if it has at least `threshold` distinct
     settler votes. This is the actual quorum requirement.
  3. For each eligible group, sum the `confidence` values.
  4. The winning outcome is the eligible group with the highest summed
     confidence.

Tie-break: lower outcome index wins (deterministic).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import math
from typing import Any


@dataclass(frozen=True)
class ConsensusOutcome:
    outcome: int
    quorum_size: int
    weighted_score: float
    votes: list[dict[str, Any]]


class ConsensusError(Exception):
    pass


def compute_consensus(
    votes: list[dict[str, Any]],
    threshold: int,
) -> ConsensusOutcome:
    """Aggregate verified votes into a consensus result.

    Each vote dict must have keys `outcome` (int), `confidence` (float),
    `settler_pubkey` (str). Caller is responsible for signature verification
    and deduplication by `settler_pubkey` before passing them in here.
    """
    if not votes:
        raise ConsensusError("no votes to aggregate")
    if threshold <= 0:
        raise ConsensusError("threshold must be positive")
    if len(votes) < threshold:
        raise ConsensusError(
            f"insufficient quorum: have {len(votes)} votes, need {threshold}"
        )

    # Defensive dedup by settler_pubkey, first vote wins. A conflicting later
    # vote should be treated as equivocation by the caller, not as an update.
    by_settler: dict[str, dict[str, Any]] = {}
    for v in votes:
        by_settler.setdefault(str(v["settler_pubkey"]).lower(), v)
    deduped = list(by_settler.values())
    if len(deduped) < threshold:
        raise ConsensusError(
            f"insufficient distinct settlers: {len(deduped)} < threshold {threshold}"
        )

    weights: dict[int, float] = defaultdict(float)
    counts: dict[int, int] = defaultdict(int)
    for v in deduped:
        confidence = float(v["confidence"])
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ConsensusError(f"invalid confidence: {confidence}")
        outcome = int(v["outcome"])
        weights[outcome] += confidence
        counts[outcome] += 1

    eligible = {
        outcome: weight
        for outcome, weight in weights.items()
        if counts[outcome] >= threshold
    }
    if not eligible:
        raise ConsensusError(
            f"no outcome reached quorum: threshold={threshold}, counts={dict(counts)}"
        )

    # Sort descending by weight, then ascending by outcome index for stable tie-break
    ranked = sorted(eligible.items(), key=lambda kv: (-kv[1], kv[0]))
    winning_outcome, winning_weight = ranked[0]

    return ConsensusOutcome(
        outcome=winning_outcome,
        quorum_size=counts[winning_outcome],
        weighted_score=winning_weight,
        votes=deduped,
    )

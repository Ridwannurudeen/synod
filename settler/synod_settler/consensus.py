"""Vote aggregation for Synod settlement consensus.

Given a list of accepted SettlementVote payloads (already signature-verified by
the caller), compute the consensus outcome via confidence-weighted majority.

Algorithm (v1):
  1. Group votes by `outcome` index.
  2. For each group, sum the `confidence` values.
  3. The winning outcome is the group with the highest summed confidence.
  4. Quorum is met if `len(votes) >= threshold`.

Tie-break: lower outcome index wins (deterministic).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
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
    if len(votes) < threshold:
        raise ConsensusError(
            f"insufficient quorum: have {len(votes)} votes, need {threshold}"
        )

    # Defensive dedup by settler_pubkey, last vote wins (caller should already
    # have done this; we double-guard so quorum count can't be inflated).
    by_settler: dict[str, dict[str, Any]] = {}
    for v in votes:
        by_settler[str(v["settler_pubkey"])] = v
    deduped = list(by_settler.values())
    if len(deduped) < threshold:
        raise ConsensusError(
            f"insufficient distinct settlers: {len(deduped)} < threshold {threshold}"
        )

    weights: dict[int, float] = defaultdict(float)
    for v in deduped:
        weights[int(v["outcome"])] += float(v["confidence"])

    # Sort descending by weight, then ascending by outcome index for stable tie-break
    ranked = sorted(weights.items(), key=lambda kv: (-kv[1], kv[0]))
    winning_outcome, winning_weight = ranked[0]

    return ConsensusOutcome(
        outcome=winning_outcome,
        quorum_size=len(deduped),
        weighted_score=winning_weight,
        votes=deduped,
    )

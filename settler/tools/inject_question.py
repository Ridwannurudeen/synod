"""Publish a QuestionAnnouncement to a Synod settler over the local AXL bridge.

Usage:
    python tools/inject_question.py \
        --axl http://127.0.0.1:9002 \
        --target-pubkey <hex64> \
        --prompt "Will protocol X reach $100M TVL by 2026-12-31?" \
        --outcomes 0,1 \
        --deadline-secs 600

The CLI sends a single QuestionAnnouncement (kind=1) to the target settler's
AXL daemon. The target settler will then run inference, sign a SettlementVote,
and broadcast it to its configured peers.

`--target-pubkey` is the destination AXL pubkey. To inject the question into a
local settler whose own AXL daemon is what you're talking to, set
`--target-pubkey` to that node's `our_public_key` (from /topology).
"""

from __future__ import annotations

import argparse
import secrets
import sys
import time
from pathlib import Path

# Allow running directly from the tools/ dir without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synod_settler.axl_client import AxlClient  # noqa: E402
from synod_settler.protocol import QuestionAnnouncement, canonical_json  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Inject a Synod question over AXL")
    p.add_argument("--axl", default="http://127.0.0.1:9002", help="AXL daemon base URL")
    p.add_argument(
        "--target-pubkey",
        required=True,
        help="Destination settler pubkey (64-char hex)",
    )
    p.add_argument("--prompt", required=True, help="Resolution prompt for the market")
    p.add_argument(
        "--outcomes",
        default="0,1",
        help="Comma-separated valid outcome indices (default: '0,1' for binary)",
    )
    p.add_argument(
        "--deadline-secs",
        type=int,
        default=600,
        help="Seconds from now until question deadline (default: 600)",
    )
    p.add_argument(
        "--question-id",
        default=None,
        help="Optional 32-byte hex question id; random if not provided",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    outcomes = [int(x) for x in args.outcomes.split(",")]
    qid = args.question_id or secrets.token_hex(32)
    deadline = int(time.time()) + int(args.deadline_secs)

    q = QuestionAnnouncement.new(
        question_id=qid,
        prompt=args.prompt,
        outcomes=outcomes,
        deadline=deadline,
    )
    body = canonical_json(q.to_dict())

    with AxlClient(args.axl) as axl:
        sent = axl.send(args.target_pubkey, body)

    print(f"injected question {qid}")
    print(f"  target:    {args.target_pubkey}")
    print(f"  outcomes:  {outcomes}")
    print(f"  deadline:  {deadline} ({time.strftime('%FT%TZ', time.gmtime(deadline))})")
    print(f"  sent_bytes: {sent}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

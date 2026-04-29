"""Verify a Synod settlement proof independently of the UI.

Examples:

  # Verify a live on-chain settlement.
  python tools/verify_settlement.py \
    --rpc-url http://127.0.0.1:8545 \
    --registry-address 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
    --question-id <64-hex-question-id>

  # Verify a saved proof payload offline.
  python tools/verify_settlement.py \
    --payload-file proof.json \
    --question-id <64-hex-question-id> \
    --outcome 1 \
    --quorum-size 2 \
    --weighted-score-scaled 1980000 \
    --registered-pubkey <64-hex-axl-key> \
    --registered-pubkey <64-hex-axl-key>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Allow running directly without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from web3 import Web3  # type: ignore[import-untyped]  # noqa: E402

from synod_settler.onchain import _load_abi, question_id_to_bytes32  # noqa: E402
from synod_settler.proof_verifier import (  # noqa: E402
    ProofVerification,
    SettlementSnapshot,
    verify_proof_payload,
)
from synod_settler.protocol import validate_hex32  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Verify a Synod signed-vote settlement proof")
    p.add_argument("--rpc-url", help="JSON-RPC URL for live on-chain verification")
    p.add_argument("--registry-address", help="SynodRegistry contract address")
    p.add_argument("--question-id", required=True, help="Question id as 32-byte hex")
    p.add_argument("--payload-file", help="Offline proof payload file, JSON or 0x-hex bytes")
    p.add_argument("--outcome", type=int, help="Offline expected settlement outcome")
    p.add_argument("--quorum-size", type=int, help="Offline expected quorum size")
    p.add_argument("--weighted-score-scaled", type=int, help="Offline expected weighted score")
    p.add_argument(
        "--registered-pubkey",
        action="append",
        default=[],
        help="Offline registered AXL pubkey; repeat for each allowed voter",
    )
    p.add_argument("--abi-path", help="Optional SynodRegistry artifact path")
    p.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    return p.parse_args()


def _bytes_from_file(path: str) -> bytes:
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8", errors="ignore").strip()
    if text.startswith("0x"):
        return bytes.fromhex(text[2:])
    if all(ch in "0123456789abcdefABCDEF" for ch in text) and len(text) % 2 == 0:
        return bytes.fromhex(text)
    return raw


def _tuple_get(value: Any, index: int, name: str) -> Any:
    if hasattr(value, name):
        return getattr(value, name)
    if isinstance(value, dict) and name in value:
        return value[name]
    return value[index]


def verify_from_chain(args: argparse.Namespace) -> ProofVerification:
    if not args.rpc_url or not args.registry_address:
        raise ValueError("--rpc-url and --registry-address are required for live verification")

    qid = validate_hex32(args.question_id.removeprefix("0x"), field="question_id")
    w3 = Web3(Web3.HTTPProvider(args.rpc_url))
    if not w3.is_connected():
        raise RuntimeError(f"could not connect to RPC {args.rpc_url}")

    abi = _load_abi(Path(args.abi_path) if args.abi_path else None)
    registry = w3.eth.contract(
        address=Web3.to_checksum_address(args.registry_address),
        abi=abi,
    )
    qid_bytes = question_id_to_bytes32(qid)
    if not registry.functions.isSettled(qid_bytes).call():
        raise RuntimeError(f"question is not settled on-chain: {qid}")

    raw = registry.functions.getSettlement(qid_bytes).call()
    settlement = SettlementSnapshot.new(
        question_id=qid,
        outcome=int(_tuple_get(raw, 1, "outcome")),
        quorum_size=int(_tuple_get(raw, 2, "quorumSize")),
        weighted_score_scaled=int(_tuple_get(raw, 3, "weightedScoreScaled")),
    )
    payload = bytes(_tuple_get(raw, 4, "signedVotesPayload"))

    def registered(pubkey: str) -> bool:
        return bool(registry.functions.registeredAxlPubKeys(question_id_to_bytes32(pubkey)).call())

    return verify_proof_payload(payload, settlement, registered)


def verify_from_file(args: argparse.Namespace) -> ProofVerification:
    missing = [
        name
        for name in ("payload_file", "outcome", "quorum_size", "weighted_score_scaled")
        if getattr(args, name) is None
    ]
    if missing:
        joined = ", ".join(f"--{name.replace('_', '-')}" for name in missing)
        raise ValueError(f"offline verification requires {joined}")

    settlement = SettlementSnapshot.new(
        question_id=args.question_id,
        outcome=args.outcome,
        quorum_size=args.quorum_size,
        weighted_score_scaled=args.weighted_score_scaled,
    )
    payload = _bytes_from_file(args.payload_file)
    registered_pubkeys = {
        validate_hex32(pk.removeprefix("0x"), field="registered_pubkey")
        for pk in args.registered_pubkey
    }
    return verify_proof_payload(payload, settlement, lambda pk: pk in registered_pubkeys)


def print_human(result: ProofVerification) -> None:
    print(f"Synod proof: {result.status.upper()}")
    print(f"  question_id:            {result.settlement.question_id}")
    print(f"  outcome:                {result.settlement.outcome}")
    print(f"  quorum_size:            {result.settlement.quorum_size}")
    print(f"  winner_votes:           {result.winner_votes}")
    print(f"  weighted_score_scaled:  {result.weighted_score_scaled}")
    print(f"  expected_score_scaled:  {result.settlement.weighted_score_scaled}")
    print("  votes:")
    for vote in result.votes:
        ok = "ok" if vote.valid else "bad"
        print(
            "    "
            f"{vote.pubkey[:16]}... model={vote.model_tag} "
            f"outcome={vote.outcome} confidence={vote.confidence:.4f} "
            f"registered={vote.registered} signature={vote.signature_valid} {ok}"
        )
        for err in vote.errors:
            print(f"      - {err}")
    if result.errors:
        print("  errors:")
        for err in result.errors:
            print(f"    - {err}")


def main() -> int:
    args = parse_args()
    try:
        result = verify_from_chain(args) if args.rpc_url or args.registry_address else verify_from_file(args)
    except Exception as e:
        if args.json:
            print(json.dumps({"status": "error", "error": str(e)}, indent=2))
        else:
            print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
    else:
        print_human(result)
    return 0 if result.verified else 1


if __name__ == "__main__":
    raise SystemExit(main())

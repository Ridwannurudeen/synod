"""CLI: mint a judgment subname for an already-settled question.

Reads the on-chain settlement + the local 0G transcript map, then mints
`j-{shortHash}.synodai.eth` on Ethereum mainnet via the deployer wallet.

Usage:
  python tools/mint_judgment.py <question_id> [--owner 0x...] [--dry-run]

The owner defaults to the deployer wallet (i.e. retained by the operator);
pass --owner to mint directly to the question submitter so the judgment
NFT is theirs to keep, transfer, or sell.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlencode, urlparse

from web3 import Web3

# Make sibling synod_settler importable when run as `python tools/mint_judgment.py`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from synod_settler.judgment_ens import (  # noqa: E402
    mint_judgment,
    save_judgment_index,
    short_label,
)
from synod_settler.onchain import question_id_to_bytes32  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mint_judgment")

REGISTRY_ABI = [
    {"name": "isSettled", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "questionId", "type": "bytes32"}],
     "outputs": [{"type": "bool"}]},
    {"name": "registeredSettlerCount", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"type": "uint256"}]},
    # SettlementRecorded(bytes32 indexed questionId, uint8 outcome,
    #                    uint256 quorumSize, uint256 weightedScoreScaled,
    #                    address indexed postedBy)
    # Read via eth_getLogs instead of getSettlement(): web3.py's decoder
    # mis-parses the deeply-nested Settlement tuple when v2 vote payloads
    # push the dynamic-bytes section past certain boundaries (works fine in
    # the TS verifier; works fine via eth_getLogs).
    {"name": "SettlementRecorded", "type": "event", "anonymous": False,
     "inputs": [
         {"name": "questionId", "type": "bytes32", "indexed": True},
         {"name": "outcome", "type": "uint8", "indexed": False},
         {"name": "quorumSize", "type": "uint256", "indexed": False},
         {"name": "weightedScoreScaled", "type": "uint256", "indexed": False},
         {"name": "postedBy", "type": "address", "indexed": True},
     ]},
]


def transcript_indexer_url(indexer: str, transcript_cid: str) -> str:
    root = transcript_cid.strip()
    if not root.startswith("0x") or len(root) != 66:
        raise ValueError("transcript root must be 32-byte 0x-prefixed hex")
    try:
        int(root[2:], 16)
    except ValueError as exc:
        raise ValueError("transcript root must be hex") from exc

    parsed = urlparse(indexer)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("SYNOD_0G_INDEXER must be an http(s) URL")
    if parsed.username or parsed.password:
        raise ValueError("SYNOD_0G_INDEXER must not include credentials")

    base = indexer.rstrip("/")
    return f"{base}/file?{urlencode({'root': root})}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("question_id", help="hex question id, with or without 0x prefix")
    ap.add_argument("--owner", default=None, help="address to receive subname (default: read submitters.json then fall back to deployer)")
    ap.add_argument("--rpc-l2", default="https://gensyn-mainnet.g.alchemy.com/public",
                    help="Gensyn L2 RPC for reading the settlement")
    ap.add_argument("--registry", default="0xD387f749667590940d7c68CA350e57FbcE62b6ad",
                    help="SynodRegistry address on Gensyn L2")
    ap.add_argument("--transcripts",
                    default="/opt/synod-app/runtime/transcripts.json",
                    help="path to runtime transcripts.json (0G CIDs)")
    ap.add_argument("--submitters",
                    default="/opt/synod-app/runtime/submitters.json",
                    help="path to runtime submitters.json (verified-signature wallet map)")
    ap.add_argument("--dry-run", action="store_true", help="show what would be minted, no tx")
    args = ap.parse_args()

    qid = args.question_id.lower()
    if qid.startswith("0x"):
        qid = qid[2:]
    if len(qid) != 64:
        log.error("question_id must be 32 bytes hex; got %d chars", len(qid))
        return 1
    qid_hex = "0x" + qid

    # Resolve owner: explicit --owner > verified submitter from inject API > deployer.
    # The /api/inject route writes runtime/submitters.json keyed by questionId
    # only after viem.verifyMessage succeeds, so any address present there
    # has already been cryptographically authenticated by the human submitter.
    submitter_owner: str | None = None
    if not args.owner and os.path.exists(args.submitters):
        try:
            with open(args.submitters) as f:
                submitters = json.load(f)
            entry = submitters.get(qid) or submitters.get(qid_hex)
            if entry and isinstance(entry, dict):
                addr = entry.get("address")
                if addr and isinstance(addr, str) and addr.startswith("0x") and len(addr) == 42:
                    submitter_owner = addr
                    log.info("submitter found in %s -> owner=%s", args.submitters, addr)
        except Exception as e:  # noqa: BLE001
            log.warning("could not read submitters file %s: %s", args.submitters, e)
    resolved_owner = args.owner or submitter_owner

    # Read on-chain settlement
    w3l2 = Web3(Web3.HTTPProvider(args.rpc_l2, request_kwargs={"timeout": 30}))
    reg = w3l2.eth.contract(address=Web3.to_checksum_address(args.registry), abi=REGISTRY_ABI)
    qid_bytes = question_id_to_bytes32(qid)

    if not reg.functions.isSettled(qid_bytes).call():
        log.error("question %s is not settled on-chain at %s", qid_hex, args.registry)
        return 2

    # Read SettlementRecorded event for this question — see comment on
    # REGISTRY_ABI for why we don't call getSettlement directly.
    settlement_event = reg.events.SettlementRecorded()
    logs = w3l2.eth.get_logs({
        "address": Web3.to_checksum_address(args.registry),
        "fromBlock": 0,
        "toBlock": "latest",
        "topics": [
            settlement_event._get_event_abi(),  # type: ignore[attr-defined]
        ],
    }) if False else w3l2.eth.get_logs({
        # Topic[0] = keccak256 of the event signature
        # Topic[1] = indexed questionId
        "address": Web3.to_checksum_address(args.registry),
        "fromBlock": 0,
        "toBlock": "latest",
        "topics": [
            "0x" + Web3.keccak(text="SettlementRecorded(bytes32,uint8,uint256,uint256,address)").hex(),
            "0x" + qid,
        ],
    })
    if not logs:
        log.error("no SettlementRecorded event found for %s", qid_hex)
        return 2
    decoded = settlement_event.process_log(logs[-1])
    outcome = int(decoded["args"]["outcome"])
    quorum_size = int(decoded["args"]["quorumSize"])
    weighted_score_scaled = int(decoded["args"]["weightedScoreScaled"])
    posted_by = decoded["args"]["postedBy"]
    total_settlers = int(reg.functions.registeredSettlerCount().call())

    # Read 0G transcript CID
    transcript_cid = ""
    if os.path.exists(args.transcripts):
        with open(args.transcripts) as f:
            tmap = json.load(f)
        entry = tmap.get(qid) or tmap.get(qid_hex)
        if entry:
            transcript_cid = entry.get("root", "") or ""

    # Pull the prompt from the transcript file if available
    prompt = "[prompt unavailable]"
    if transcript_cid:
        try:
            import urllib.request
            indexer = os.environ.get("SYNOD_0G_INDEXER", "https://indexer-storage-testnet-turbo.0g.ai")
            url = transcript_indexer_url(indexer, transcript_cid)
            # URL is restricted to credential-free http(s), and transcript root is validated.
            with urllib.request.urlopen(url, timeout=15) as r:  # nosec B310
                doc = json.loads(r.read().decode())
                prompt = doc.get("question", {}).get("prompt", prompt)
        except Exception as e:  # noqa: BLE001
            log.warning("could not fetch transcript for prompt: %s", e)

    # Outcome label: try transcript outcomes mapping, fall back to numeric
    outcome_label = str(outcome)
    if transcript_cid:
        try:
            outcomes = doc.get("question", {}).get("outcomes", [])  # type: ignore[name-defined]
            if outcome < len(outcomes):
                v = outcomes[outcome]
                outcome_label = str(v) if not isinstance(v, str) else v
        except Exception:  # noqa: BLE001
            pass

    description = (
        f"AI consensus on \"{prompt[:80]}\" — outcome={outcome_label}, "
        f"quorum={quorum_size}/{total_settlers}, settled on Gensyn L2."
    )

    label = short_label(qid)
    fqn = f"{label}.synodai.eth"

    log.info("=" * 60)
    log.info("question_id:      0x%s", qid)
    log.info("fqn:              %s", fqn)
    log.info("outcome:          %s (idx %d)", outcome_label, outcome)
    log.info("quorum:           %d / %d", quorum_size, total_settlers)
    log.info("weighted_score:   %d", weighted_score_scaled)
    log.info("transcript_cid:   %s", transcript_cid or "[none]")
    log.info("settlement_tx:    [from synodai.eth resolver]")
    log.info("posted_by:        %s", posted_by)
    if resolved_owner:
        src = "explicit --owner" if args.owner else "submitters.json (signature-verified)"
        log.info("owner:            %s  [from %s]", resolved_owner, src)
    else:
        log.info("owner:            [deployer fallback]")
    log.info("description:      %s", description)
    log.info("=" * 60)

    if args.dry_run:
        log.info("dry-run; not minting")
        return 0

    # Settlement tx hash isn't returned by getSettlement; for the demo we
    # leave it empty if not in transcript. Could be filled by scanning logs.
    settlement_tx_hash = ""
    if transcript_cid:
        try:
            settlement_tx_hash = doc.get("onchain", {}).get("tx_hash", "")  # type: ignore[name-defined]
            if settlement_tx_hash and not settlement_tx_hash.startswith("0x"):
                settlement_tx_hash = "0x" + settlement_tx_hash
        except Exception:  # noqa: BLE001
            pass

    receipt = mint_judgment(
        question_id=qid,
        outcome_label=outcome_label,
        quorum_size=quorum_size,
        total_settlers=total_settlers,
        weighted_score_scaled=weighted_score_scaled,
        transcript_cid=transcript_cid,
        settlement_tx=settlement_tx_hash,
        question_prompt=prompt,
        description=description,
        owner=resolved_owner,
    )

    save_judgment_index(qid, receipt)
    log.info("MINTED %s — owner=%s", receipt.fqn, receipt.owner)
    log.info("ENS app: https://app.ens.domains/%s", receipt.fqn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""End-to-end slashing demo on 0G Galileo testnet.

Self-contained 7-tx flow that proves the SynodRegistry slashing mechanism
works on a live EVM chain. Uses 0G Galileo testnet because the live
Gensyn L2 production registry (0xD387f7…) is the v1 7-field struct
without slashing fields — the v1.1 struct that the demo exercises must
be deployed separately.

Single-wallet variant: the same deployer wallet acts as admin, registered
settler, settlement poster, and challenger. The on-chain TXs and emitted
events still prove the mechanism end-to-end.

  TX 1: deploy SynodRegistry  (already done by Deploy.s.sol)
  TX 2: configureSecurity(window, minSettlerBond, minChallengeBond)
  TX 3: registerSettler(deployer, axlPubKey, modelTag) with bond
  TX 4: recordSettlement(qid, outcome, quorum=1, weightedScore, payload)
  TX 5: challengeSettlement(qid, evidenceHash, reason) with bond
  TX 6: resolveChallenge(qid, sustained=true, recipient=challenger)

The script prints every TX hash + an explorer URL. All artefacts saved to
runtime/slashing_demo_0g.json so the submission can reference them.

Usage:
  python run_slashing_demo_0g.py \\
    --rpc-url https://evmrpc-testnet.0g.ai \\
    --registry 0x1dbe19EbF48b41b0E2DA16BA1B36136abab373BF \\
    --deployer-key /opt/synod-app/runtime/.0g-deployer.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from web3 import Web3  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slashing-0g")

EXPLORER = "https://chainscan-galileo.0g.ai/tx/{}"
DEMO_MODEL_TAG = "demo-claude-sonnet-4-6"
DEMO_PROMPT = "Slashing demo: was the year 2000 in the 21st century?"
DEMO_OUTCOME = 0  # 0 = no, technically 2000 was last year of 20th century
DEMO_QUORUM = 1
DEMO_WEIGHTED_SCORE_SCALED = 990_000  # 0.99 * 1e6


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Synod slashing demo on 0G testnet")
    p.add_argument("--rpc-url", default="https://evmrpc-testnet.0g.ai")
    p.add_argument(
        "--registry",
        required=True,
        help="SynodRegistry address (deploy first via forge script)",
    )
    p.add_argument(
        "--deployer-key",
        default="/opt/synod-app/runtime/.0g-deployer.json",
        help="JSON file with {private_key: 0x...}",
    )
    p.add_argument(
        "--abi",
        default="/opt/synod-app/contracts/out/SynodRegistry.sol/SynodRegistry.json",
        help="Foundry build artefact",
    )
    p.add_argument(
        "--out",
        default="/opt/synod-app/runtime/slashing_demo_0g.json",
        help="Where to save TX-hash record",
    )
    return p.parse_args()


def load_pk(path: str) -> str:
    with open(path) as f:
        d = json.load(f)
    pk = d.get("private_key", "").strip()
    if not pk.startswith("0x") or len(pk) != 66:
        raise ValueError(f"{path}: expected {{private_key: 0x<64hex>}}")
    return pk


def main() -> int:
    args = parse_args()

    pk = load_pk(args.deployer_key)
    w3 = Web3(Web3.HTTPProvider(args.rpc_url))
    if not w3.is_connected():
        log.error("RPC not reachable: %s", args.rpc_url)
        return 1
    acct = w3.eth.account.from_key(pk)
    log.info("wallet: %s", acct.address)
    log.info("balance: %s OG", w3.from_wei(w3.eth.get_balance(acct.address), "ether"))

    with open(args.abi) as f:
        artefact = json.load(f)
    abi = artefact["abi"]
    registry = w3.eth.contract(address=Web3.to_checksum_address(args.registry), abi=abi)

    chain_id = w3.eth.chain_id
    log.info("chainId: %d", chain_id)
    log.info("registry: %s", args.registry)

    record: dict[str, str | int | dict] = {
        "rpc_url": args.rpc_url,
        "chain_id": chain_id,
        "registry": args.registry,
        "deployer": acct.address,
        "txs": {},
    }

    def send(fn, value: int = 0, label: str = "") -> str:
        tx = fn.build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "gas": fn.estimate_gas({"from": acct.address, "value": value}) * 12 // 10,
            "gasPrice": w3.eth.gas_price,
            "chainId": chain_id,
            "value": value,
        })
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        log.info("[%s] sent: %s", label, tx_hash.hex())
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if receipt["status"] != 1:
            raise RuntimeError(f"{label} reverted: {tx_hash.hex()}")
        log.info("[%s]   ✓ block=%d gas=%d", label, receipt["blockNumber"], receipt["gasUsed"])
        log.info("[%s]   %s", label, EXPLORER.format(tx_hash.hex()))
        return tx_hash.hex()

    # ── Step 1: configureSecurity ─────────────────────────────────────
    # Window: 5 minutes (we challenge within seconds)
    # Min settler bond: 0.001 OG (1e15 wei) — settler self-bonds in step 2
    # Min challenge bond: 0.0005 OG — challenger funds in step 5
    window_secs = 300
    min_settler_bond = 10**15  # 0.001 OG
    min_challenge_bond = 5 * 10**14  # 0.0005 OG
    log.info("─── TX 1: configureSecurity ──────────────────────────")
    record["txs"]["configureSecurity"] = send(
        registry.functions.configureSecurity(
            window_secs, min_settler_bond, min_challenge_bond
        ),
        label="configureSecurity",
    )
    record["security"] = {
        "challengeWindowSeconds": window_secs,
        "minSettlerBond": min_settler_bond,
        "minChallengeBond": min_challenge_bond,
    }

    # ── Step 2: registerSettler with bond ──────────────────────────────
    # AXL pubkey: deterministic 32-byte derived from wallet address so the
    # demo is reproducible. modelTag identifies the demo settler.
    axl_pubkey_bytes = hashlib.sha256(b"synod-demo-settler-" + acct.address.encode()).digest()
    log.info("─── TX 2: registerSettler ────────────────────────────")
    record["axlPubKey"] = "0x" + axl_pubkey_bytes.hex()
    record["txs"]["registerSettler"] = send(
        registry.functions.registerSettler(acct.address, axl_pubkey_bytes, DEMO_MODEL_TAG),
        value=min_settler_bond,
        label="registerSettler",
    )

    # ── Step 3: recordSettlement ───────────────────────────────────────
    # Synthetic question + minimal payload. The contract validates:
    #   - sender is registered (yes)
    #   - bond >= minSettlerBond (yes, just bonded)
    #   - quorumSize <= registeredSettlerCount (1 <= 1)
    #   - payload non-empty and ≤ 64KB
    qid_bytes = hashlib.sha256(b"slashing-demo-qid-" + str(int(time.time())).encode()).digest()
    qid_hex = "0x" + qid_bytes.hex()
    payload = json.dumps({
        "protocol_version": 2,
        "question": {"prompt": DEMO_PROMPT, "outcomes": [0, 1]},
        "votes": [{
            "settler_pubkey": axl_pubkey_bytes.hex(),
            "outcome": DEMO_OUTCOME,
            "confidence": 0.99,
            "model_tag": DEMO_MODEL_TAG,
            "demo": True,
        }],
        "demo_note": "single-settler slashing-demo settlement on 0G Galileo testnet",
    }, separators=(",", ":")).encode()

    log.info("─── TX 3: recordSettlement ───────────────────────────")
    log.info("  questionId: %s", qid_hex)
    record["questionId"] = qid_hex
    record["txs"]["recordSettlement"] = send(
        registry.functions.recordSettlement(
            qid_bytes, DEMO_OUTCOME, DEMO_QUORUM, DEMO_WEIGHTED_SCORE_SCALED, payload
        ),
        label="recordSettlement",
    )

    # ── Step 4: challengeSettlement ────────────────────────────────────
    # The demo challenger is the same wallet (single-wallet variant).
    # Evidence hash commits to a fictitious off-chain verifier report.
    evidence = b"demo: posted vote outcome contradicts canonical answer for prompt"
    evidence_hash = hashlib.sha256(evidence).digest()
    reason = "demo: vote outcome conflicts with verifier-reported canonical answer"
    log.info("─── TX 4: challengeSettlement ────────────────────────")
    log.info("  evidenceHash: 0x%s", evidence_hash.hex())
    log.info("  reason: %s", reason)
    record["evidenceHash"] = "0x" + evidence_hash.hex()
    record["challengeReason"] = reason
    record["txs"]["challengeSettlement"] = send(
        registry.functions.challengeSettlement(qid_bytes, evidence_hash, reason),
        value=min_challenge_bond,
        label="challengeSettlement",
    )

    # ── Step 5: resolveChallenge (sustained=true) ──────────────────────
    # Admin (deployer) sustains the challenge. This:
    #   - voids the settlement
    #   - slashes the poster's bond up to slashableAmount
    #   - pays slash + challenge bond to recipient
    log.info("─── TX 5: resolveChallenge (sustained) ───────────────")
    record["txs"]["resolveChallenge"] = send(
        registry.functions.resolveChallenge(qid_bytes, True, acct.address),
        label="resolveChallenge",
    )

    # ── Final state read ───────────────────────────────────────────────
    final = registry.functions.getSettlement(qid_bytes).call()
    log.info("─── Final settlement state ───────────────────────────")
    # Settlement struct: 0 questionId, 1 outcome, 2 quorum, 3 score,
    # 4 payload, 5 postedBy, 6 timestamp, 7 challengeDeadline, 8 finalized,
    # 9 challenged, 10 voided, 11 challenger, 12 evidenceHash,
    # 13 reason, 14 challengeBond
    log.info("  finalized:  %s", final[8])
    log.info("  challenged: %s", final[9])
    log.info("  voided:     %s", final[10])
    record["finalState"] = {
        "finalized": final[8],
        "challenged": final[9],
        "voided": final[10],
    }
    record["totalSlashedBond"] = registry.functions.totalSlashedBond().call()
    log.info("  totalSlashedBond: %s wei", record["totalSlashedBond"])

    # ── Save record ────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(record, f, indent=2)
    log.info("artefact: %s", args.out)
    log.info("─── DEMO COMPLETE ────────────────────────────────────")
    return 0


if __name__ == "__main__":
    sys.exit(main())

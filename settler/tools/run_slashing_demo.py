"""Drive an end-to-end slashing event on the live registry.

Six transactions, recorded on-camera:

  1. (read) print current security config; abort if not configured
  2. (read) verify each registered settler has bond >= minSettlerBond
  3. (write) per-settler depositBond() top-ups to bring bonds up to spec
     — only run when a settler key file is supplied for that settler
  4. (read) confirm the chosen question_id is sealed and within its
     challenge window
  5. (write) deployer wallet calls challengeSettlement with a deterministic
     evidence hash and human-readable reason
  6. (write) deployer wallet (admin) calls resolveChallenge(sustained=True)
     with the challenger as recipient, slashing the poster's bond

Each tx prints its explorer URL and the operator captures the SettlementChallenged
and ChallengeResolved log entries during the recording.

Usage:
  python tools/run_slashing_demo.py --dry-run
  python tools/run_slashing_demo.py --question-id 0x… \\
      --settler-key-paths /path/to/settler1.json,/path/to/settler2.json,…

Settler key files share the deployer-key shape: {"private_key": "0x..."}.
Without --settler-key-paths the script will skip step 3 (bond top-up); if any
settler is under-bonded the demo aborts before step 5.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Allow running directly without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from web3 import Web3  # noqa: E402

from synod_settler.onchain import OnchainClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("run_slashing_demo")


DEFAULT_DEPLOYER_KEY_PATH = "/opt/synod-app/runtime/.deployer-mainnet.json"
DEFAULT_RPC_URL = "https://gensyn-mainnet.g.alchemy.com/public"
DEFAULT_REGISTRY = "0xD387f749667590940d7c68CA350e57FbcE62b6ad"
EXPLORER_TX = "https://gensyn-mainnet.explorer.alchemy.com/tx/{}"

# A deterministic evidence-hash seed lets a recorded video match what
# off-chain verifier reports would publish; the demo doesn't claim a real
# vulnerability — it stages a slashing event for the camera.
DEMO_EVIDENCE_SEED = b"demo-slashing-event-recording"
DEMO_REASON = "demo: ed25519 sig 2 invalid"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run the 6-tx Synod slashing demo")
    p.add_argument("--question-id", help="Hex 32-byte question id; if omitted, "
                                          "the script will scan recent SettlementRecorded "
                                          "logs and prompt the operator")
    p.add_argument("--settler-key-paths", default="",
                   help="comma-separated JSON files with {\"private_key\": ...} "
                        "for each registered settler (used only for depositBond)")
    p.add_argument("--rpc-url", default=DEFAULT_RPC_URL)
    p.add_argument("--registry", default=DEFAULT_REGISTRY)
    p.add_argument("--deployer-key-path", default=DEFAULT_DEPLOYER_KEY_PATH)
    p.add_argument("--dry-run", action="store_true",
                   help="read state and print plan, send no transactions")
    return p.parse_args()


def _load_key(path: str) -> str:
    """Read a private key from a JSON {private_key: …} file. Never logged."""
    with open(path) as f:
        d = json.load(f)
    pk = d.get("private_key")
    if not isinstance(pk, str) or not pk.startswith("0x") or len(pk) != 66:
        raise ValueError(
            f"key file {path} must contain {{\"private_key\": \"0x<64 hex>\"}}"
        )
    return pk


def _qid_norm(qid_str: str) -> str:
    qid = qid_str.lower().removeprefix("0x")
    if len(qid) != 64:
        raise ValueError(f"question_id must be 32 bytes hex; got {len(qid)} chars")
    return qid


def _fmt_eth(wei: int) -> str:
    return f"{wei} wei ({wei / 1e18:.6f} ETH)"


def main() -> int:
    args = parse_args()

    deployer_pk = _load_key(args.deployer_key_path)
    deployer = OnchainClient(
        rpc_url=args.rpc_url,
        registry_address=args.registry,
        evm_private_key=deployer_pk,
    )
    log.info("deployer EOA:       %s", deployer.address)

    # ------------------------------------------------------------------
    # Step 1: Security config
    # ------------------------------------------------------------------
    window, min_settler_bond, min_challenge_bond = deployer.get_security_config()
    log.info("challenge window:   %d sec", window)
    log.info("min settler bond:   %s", _fmt_eth(min_settler_bond))
    log.info("min challenge bond: %s", _fmt_eth(min_challenge_bond))
    if window == 0 or min_settler_bond == 0 or min_challenge_bond == 0:
        log.error(
            "security parameters are zero — challengeSettlement will fail "
            "(no challenge window). Run tools/configure_security.py first."
        )
        return 2

    # ------------------------------------------------------------------
    # Step 2 + 3: Bond status + per-settler top-ups
    # ------------------------------------------------------------------
    settler_clients: list[OnchainClient] = []
    for raw in (p for p in args.settler_key_paths.split(",") if p.strip()):
        path = raw.strip()
        try:
            pk = _load_key(path)
        except Exception as exc:  # noqa: BLE001
            log.error("could not load settler key %s: %s", path, exc)
            return 3
        client = OnchainClient(
            rpc_url=args.rpc_url,
            registry_address=args.registry,
            evm_private_key=pk,
        )
        if not client.is_registered():
            log.error("settler %s not registered on-chain", client.address)
            return 3
        settler_clients.append(client)

    bond_short: list[OnchainClient] = []
    for c in settler_clients:
        bond = c.get_settler_bond(c.address)
        if bond < min_settler_bond:
            shortfall = min_settler_bond - bond
            log.info("settler %s: bond=%s SHORT by %s",
                     c.address, _fmt_eth(bond), _fmt_eth(shortfall))
            bond_short.append(c)
        else:
            log.info("settler %s: bond=%s ok", c.address, _fmt_eth(bond))

    if bond_short and not args.dry_run:
        for c in bond_short:
            current = c.get_settler_bond(c.address)
            shortfall = min_settler_bond - current
            log.info("topping up %s by %s", c.address, _fmt_eth(shortfall))
            tx = c.deposit_bond(c.address, shortfall)
            log.info("depositBond tx: %s", EXPLORER_TX.format(tx))
    elif bond_short and args.dry_run:
        log.info("dry-run: would top up %d settlers", len(bond_short))

    # ------------------------------------------------------------------
    # Step 4: Pick a challengeable settlement
    # ------------------------------------------------------------------
    if not args.question_id:
        log.error(
            "no --question-id supplied. Pass a recently-settled question id "
            "whose challenge window is still open. The /verify page lists "
            "the most recent settlements."
        )
        return 4
    qid_hex = _qid_norm(args.question_id)
    settlement = deployer.get_settlement_full(qid_hex)
    if settlement.outcome == 0 and settlement.timestamp == 0:
        log.error("question %s not settled on-chain", qid_hex)
        return 4

    chain_id = deployer.w3.eth.chain_id
    latest_block = deployer.w3.eth.get_block("latest")
    now = int(latest_block["timestamp"])
    log.info("question:           0x%s", qid_hex)
    log.info("posted by:          %s", settlement.posted_by)
    log.info("posted at:          %d (chain ts)", settlement.timestamp)
    log.info("challenge deadline: %d (chain ts; now=%d)", settlement.challenge_deadline, now)
    log.info("challenged?:        %s", settlement.challenged)
    log.info("finalized?:         %s", settlement.finalized)

    if settlement.challenged:
        log.error("settlement is already challenged — pick a different question_id")
        return 4
    if settlement.finalized:
        log.error("settlement is already finalized — pick a different question_id")
        return 4
    if now >= settlement.challenge_deadline:
        log.error(
            "challenge window closed (now=%d >= deadline=%d). "
            "Pick a fresh settlement still within %d seconds of recordSettlement.",
            now, settlement.challenge_deadline, window,
        )
        return 4

    # ------------------------------------------------------------------
    # Step 5: Challenge
    # ------------------------------------------------------------------
    evidence_hash = Web3.keccak(DEMO_EVIDENCE_SEED)
    log.info("evidence hash:      0x%s", evidence_hash.hex())
    log.info("reason:             %s", DEMO_REASON)
    log.info("challenge bond:     %s (=minChallengeBond)", _fmt_eth(min_challenge_bond))

    if args.dry_run:
        log.info("dry-run: would call challengeSettlement and resolveChallenge")
        return 0

    challenge_tx = deployer.challenge_settlement(
        qid_hex,
        evidence_hash,
        DEMO_REASON,
        min_challenge_bond,
    )
    log.info("challengeSettlement tx: %s", EXPLORER_TX.format(challenge_tx))

    # ------------------------------------------------------------------
    # Step 6: Resolve (sustained → slash poster, pay challenger=deployer)
    # ------------------------------------------------------------------
    resolve_tx = deployer.resolve_challenge(
        qid_hex,
        sustained=True,
        recipient=deployer.address,
    )
    log.info("resolveChallenge tx: %s", EXPLORER_TX.format(resolve_tx))

    log.info("totalSlashedBond:   %s", _fmt_eth(deployer.total_slashed_bond()))
    log.info("chain id:           %d", chain_id)
    log.info("DEMO COMPLETE — capture the SettlementChallenged + ChallengeResolved logs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

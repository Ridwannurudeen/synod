"""Configure SynodRegistry optimistic-security parameters on the live chain.

One-shot admin tool. Reads the deployer key from a JSON file (default:
/opt/synod-app/runtime/.deployer-mainnet.json with shape {"private_key": "0x..."})
and calls configureSecurity(window, minSettlerBond, minChallengeBond).

Idempotent: if the on-chain state already matches the requested values, the
script exits 0 without sending a transaction.

Usage:
  python tools/configure_security.py --dry-run
  python tools/configure_security.py \
      --window 86400 \
      --min-settler-bond 1000000000000000 \
      --min-challenge-bond 100000000000000

Defaults: 24h window, 0.001 ETH settler bond, 0.0001 ETH challenge bond.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Allow running directly without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synod_settler.onchain import OnchainClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("configure_security")


DEFAULT_WINDOW_SECONDS = 86_400  # 24h
DEFAULT_MIN_SETTLER_BOND_WEI = 1_000_000_000_000_000  # 0.001 ETH
DEFAULT_MIN_CHALLENGE_BOND_WEI = 100_000_000_000_000  # 0.0001 ETH

DEFAULT_DEPLOYER_KEY_PATH = "/opt/synod-app/runtime/.deployer-mainnet.json"
DEFAULT_RPC_URL = "https://gensyn-mainnet.g.alchemy.com/public"
DEFAULT_REGISTRY = "0xD387f749667590940d7c68CA350e57FbcE62b6ad"
EXPLORER_TX = "https://gensyn-mainnet.explorer.alchemy.com/tx/{}"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Configure SynodRegistry security parameters")
    p.add_argument("--window", type=int, default=DEFAULT_WINDOW_SECONDS,
                   help="challengeWindowSeconds (default: 86400 = 24h)")
    p.add_argument("--min-settler-bond", type=int, default=DEFAULT_MIN_SETTLER_BOND_WEI,
                   help="minSettlerBond in wei (default: 1e15 = 0.001 ETH)")
    p.add_argument("--min-challenge-bond", type=int, default=DEFAULT_MIN_CHALLENGE_BOND_WEI,
                   help="minChallengeBond in wei (default: 1e14 = 0.0001 ETH)")
    p.add_argument("--rpc-url", default=DEFAULT_RPC_URL,
                   help="Gensyn L2 RPC")
    p.add_argument("--registry", default=DEFAULT_REGISTRY,
                   help="SynodRegistry address")
    p.add_argument("--deployer-key-path", default=DEFAULT_DEPLOYER_KEY_PATH,
                   help="path to JSON file containing {\"private_key\": ...}")
    p.add_argument("--dry-run", action="store_true", help="show plan, send no tx")
    return p.parse_args()


def _load_deployer_key(path: str) -> str:
    """Read the deployer key from disk. Never logged or returned to callers."""
    with open(path) as f:
        d = json.load(f)
    pk = d.get("private_key")
    if not isinstance(pk, str) or not pk.startswith("0x") or len(pk) != 66:
        raise ValueError(
            f"deployer key file {path} must contain {{\"private_key\": \"0x<64 hex>\"}}"
        )
    return pk


def main() -> int:
    args = parse_args()

    # Validate bond/window relationship matches the contract guard
    # (challengeWindowSeconds_ > 0 requires both bonds > 0).
    if args.window > 0 and (args.min_settler_bond == 0 or args.min_challenge_bond == 0):
        log.error("--window > 0 requires both --min-settler-bond and --min-challenge-bond > 0")
        return 1

    log.info("registry:           %s", args.registry)
    log.info("rpc:                %s", args.rpc_url)
    log.info("requested window:   %d sec (%.2f h)", args.window, args.window / 3600)
    log.info("requested settler:  %d wei (%.6f ETH)",
             args.min_settler_bond, args.min_settler_bond / 1e18)
    log.info("requested chalbond: %d wei (%.6f ETH)",
             args.min_challenge_bond, args.min_challenge_bond / 1e18)

    if args.dry_run:
        log.info("dry-run — not loading deployer key, not sending tx")
        return 0

    deployer_pk = _load_deployer_key(args.deployer_key_path)
    client = OnchainClient(
        rpc_url=args.rpc_url,
        registry_address=args.registry,
        evm_private_key=deployer_pk,
    )
    log.info("admin EOA:          %s", client.address)

    cur_window, cur_settler, cur_challenge = client.get_security_config()
    log.info("current window:     %d", cur_window)
    log.info("current settler:    %d wei", cur_settler)
    log.info("current chalbond:   %d wei", cur_challenge)

    if (
        cur_window == args.window
        and cur_settler == args.min_settler_bond
        and cur_challenge == args.min_challenge_bond
    ):
        log.info("already configured to requested values — no tx needed")
        return 0

    tx_hash = client.configure_security(
        args.window,
        args.min_settler_bond,
        args.min_challenge_bond,
    )
    log.info("configureSecurity tx: %s", EXPLORER_TX.format(tx_hash))

    new_window, new_settler, new_challenge = client.get_security_config()
    log.info("new window:         %d", new_window)
    log.info("new settler:        %d wei", new_settler)
    log.info("new chalbond:       %d wei", new_challenge)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

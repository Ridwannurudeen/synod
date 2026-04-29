"""Run a Synod settler agent against a configured AXL daemon.

Reads config from environment (or a .env file in the current dir):
  SYNOD_PROVIDER     — one of {anthropic, openai, gemini} (default: anthropic)
  SYNOD_MODEL        — provider-specific model id; falls back to provider default
  SYNOD_AXL_API      — local AXL daemon URL (default: http://127.0.0.1:9002)
  SYNOD_IDENTITY_KEY — path to ed25519 PEM matching the AXL node's PrivateKeyPath
  SYNOD_PEER_KEYS    — comma-separated list of peer pubkeys (hex64) to broadcast to
  SYNOD_QUORUM       — minimum distinct settlers for consensus (default: 2)

Anthropic API key is read from ANTHROPIC_API_KEY (used by the SDK directly).

The settler runs forever, polling the AXL daemon for inbound messages.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Allow running directly without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # type: ignore[import-untyped]  # noqa: E402

from synod_settler.agent import SettlerAgent  # noqa: E402
from synod_settler.axl_client import AxlClient  # noqa: E402
from synod_settler.identity import Identity  # noqa: E402
from synod_settler.llm import build_provider  # noqa: E402
from synod_settler.onchain import OnchainClient  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run a Synod settler agent")
    p.add_argument("--provider", help="LLM provider: anthropic, openai, or gemini")
    p.add_argument("--model", help="Provider-specific model id")
    p.add_argument("--axl", help="Local AXL daemon URL")
    p.add_argument("--identity-key", help="Path to ed25519 PEM matching the AXL node")
    p.add_argument("--peer-keys", help="Comma-separated peer pubkeys to broadcast to")
    p.add_argument("--quorum", type=int, help="Minimum distinct settlers for consensus")
    p.add_argument("--rpc-url", help="EVM RPC URL for on-chain submission")
    p.add_argument("--registry-address", help="SynodRegistry contract address")
    p.add_argument("--evm-key", help="EVM private key used for settlement posting")
    p.add_argument("--log-level", help="Python logging level")
    return p.parse_args()


def arg_or_env(args: argparse.Namespace, arg_name: str, env_name: str, default: str = "") -> str:
    value = getattr(args, arg_name)
    if value is not None:
        return str(value)
    return os.environ.get(env_name, default)


def normalize_host_path(path_value: str) -> str:
    """Convert common WSL/MSYS path arguments for Windows Python children."""
    normalized = path_value.replace("\\", "/")
    if normalized.startswith("/mnt/"):
        parts = normalized.split("/", 3)
        if len(parts) == 4 and len(parts[2]) == 1 and parts[2].isalpha():
            rest = parts[3].replace("/", "\\")
            return f"{parts[2].upper()}:\\{rest}"
    if (
        len(normalized) > 3
        and normalized[0] == "/"
        and normalized[1].isalpha()
        and normalized[2] == "/"
    ):
        rest = normalized[3:].replace("/", "\\")
        return f"{normalized[1].upper()}:\\{rest}"
    return path_value


def main() -> int:
    args = parse_args()
    load_dotenv()

    log_level = arg_or_env(args, "log_level", "SYNOD_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    provider_name = arg_or_env(args, "provider", "SYNOD_PROVIDER", "anthropic")
    model = arg_or_env(args, "model", "SYNOD_MODEL") or None
    axl_url = arg_or_env(args, "axl", "SYNOD_AXL_API", "http://127.0.0.1:9002")
    key_path = normalize_host_path(
        arg_or_env(args, "identity_key", "SYNOD_IDENTITY_KEY", "../keys/node-a.pem")
    )
    peer_str = arg_or_env(args, "peer_keys", "SYNOD_PEER_KEYS").strip()
    quorum = args.quorum if args.quorum is not None else int(os.environ.get("SYNOD_QUORUM", "2"))

    peer_pubkeys = [p.strip().lower() for p in peer_str.split(",") if p.strip()]

    identity = Identity.load(key_path)
    axl = AxlClient(axl_url)
    provider = build_provider(provider_name, model=model)

    # Sanity: identity pubkey must match what AXL reports
    axl_pub = axl.our_pubkey().lower()
    if identity.public_key_hex != axl_pub:
        logging.error(
            "identity mismatch: PEM pubkey %s != AXL /topology pubkey %s",
            identity.public_key_hex,
            axl_pub,
        )
        return 2

    # Optional on-chain submission. Settler runs fine without these set
    # — useful for "verifier" nodes that watch consensus but don't post.
    onchain: OnchainClient | None = None
    rpc_url = arg_or_env(args, "rpc_url", "SYNOD_RPC_URL").strip()
    registry_addr = arg_or_env(args, "registry_address", "SYNOD_REGISTRY_ADDRESS").strip()
    evm_key = arg_or_env(args, "evm_key", "SYNOD_EVM_KEY").strip()
    if rpc_url and registry_addr and evm_key:
        onchain = OnchainClient(
            rpc_url=rpc_url,
            registry_address=registry_addr,
            evm_private_key=evm_key,
        )
        if not onchain.is_registered():
            logging.error(
                "EVM address %s is not in SynodRegistry; settler cannot post on-chain",
                onchain.address,
            )
            return 3
        logging.info(
            "on-chain ready: registry=%s settler=%s chain=%s",
            registry_addr,
            onchain.address,
            onchain.w3.eth.chain_id,
        )
    else:
        logging.info("on-chain submission disabled (SYNOD_RPC_URL/REGISTRY/EVM_KEY not set)")

    agent = SettlerAgent(
        identity=identity,
        axl=axl,
        provider=provider,
        peer_pubkeys=peer_pubkeys,
        quorum=quorum,
        onchain=onchain,
    )
    agent.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

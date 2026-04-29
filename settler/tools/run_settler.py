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


def main() -> int:
    load_dotenv()

    log_level = os.environ.get("SYNOD_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    provider_name = os.environ.get("SYNOD_PROVIDER", "anthropic")
    model = os.environ.get("SYNOD_MODEL") or None
    axl_url = os.environ.get("SYNOD_AXL_API", "http://127.0.0.1:9002")
    key_path = os.environ.get("SYNOD_IDENTITY_KEY", "../keys/node-a.pem")
    peer_str = os.environ.get("SYNOD_PEER_KEYS", "").strip()
    quorum = int(os.environ.get("SYNOD_QUORUM", "2"))

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
    rpc_url = os.environ.get("SYNOD_RPC_URL", "").strip()
    registry_addr = os.environ.get("SYNOD_REGISTRY_ADDRESS", "").strip()
    evm_key = os.environ.get("SYNOD_EVM_KEY", "").strip()
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

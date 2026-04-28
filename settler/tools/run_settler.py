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

    agent = SettlerAgent(
        identity=identity,
        axl=axl,
        provider=provider,
        peer_pubkeys=peer_pubkeys,
        quorum=quorum,
    )
    agent.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

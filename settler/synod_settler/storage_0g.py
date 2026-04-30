"""0G Storage transcript persistence for settled questions.

After a settlement is posted on-chain, the designated poster uploads the
full deliberation transcript (question + per-settler reasoning + signed
votes + outcome + consensus arithmetic) to 0G Storage on the Galileo
testnet. The root hash returned by the upload is saved locally and later
written into the judgment subname's `synod.transcript-cid` text record.

We deliberately use the `0g-storage-client` Go binary via subprocess
instead of the JS/Python SDK — the SDK has historically failed to decode
the market contract response. The CLI handles fragment merkleization,
chain submission, and indexer notification reliably. Retrieval is pure
HTTP GET on the indexer URL — no auth, no SDK.

Environment variables (all optional — feature is no-op if unset):
  SYNOD_0G_KEY           : 32-byte hex private key for 0G Chain (no 0x prefix)
  SYNOD_0G_RPC           : 0G Chain RPC (default: https://evmrpc-testnet.0g.ai)
  SYNOD_0G_INDEXER       : storage indexer URL (default: turbo testnet)
  SYNOD_0G_CLIENT        : path to 0g-storage-client binary (default: 0g-storage-client on PATH)
  SYNOD_0G_TRANSCRIPTS   : local JSON map question_id -> {root, tx, ts} (default: runtime/transcripts.json)
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_RPC = "https://evmrpc-testnet.0g.ai"
DEFAULT_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai"
DEFAULT_BIN = "0g-storage-client"
DEFAULT_TRANSCRIPTS = "runtime/transcripts.json"

# Match `file uploaded, root = 0x...` in CLI stderr
_ROOT_RE = re.compile(r"file uploaded, root\s*=\s*(0x[0-9a-fA-F]{64})")
_TX_RE = re.compile(r"to append log entry\s+\S*\s*hash=(0x[0-9a-fA-F]{64})")


@dataclass(frozen=True)
class StorageReceipt:
    """Result of a successful 0G Storage upload."""

    root: str  # 0x-prefixed 32-byte merkle root
    tx_hash: str  # 0x-prefixed on-chain submission tx
    indexer_url: str  # GET URL that resolves the file
    bytes_uploaded: int


class StorageDisabled(RuntimeError):
    """Raised when SYNOD_0G_KEY is unset — feature opted out."""


def _config() -> dict[str, str]:
    key = os.environ.get("SYNOD_0G_KEY", "").strip()
    if not key:
        raise StorageDisabled("SYNOD_0G_KEY not set; 0G Storage persistence disabled")
    if key.startswith("0x"):
        key = key[2:]
    return {
        "key": key,
        "rpc": os.environ.get("SYNOD_0G_RPC", DEFAULT_RPC),
        "indexer": os.environ.get("SYNOD_0G_INDEXER", DEFAULT_INDEXER),
        "bin": os.environ.get("SYNOD_0G_CLIENT", DEFAULT_BIN),
    }


def upload_transcript(transcript: dict, *, timeout_s: int = 60) -> StorageReceipt:
    """Upload a transcript dict to 0G Storage. Blocks until uploaded.

    The transcript can be any JSON-serializable shape; canonicalize via
    `json.dumps(sort_keys=True)` so re-uploads are content-deterministic.

    Raises StorageDisabled if SYNOD_0G_KEY is unset (caller should treat
    as "no-op, continue without storage"), RuntimeError on CLI failure.
    """
    cfg = _config()
    body = json.dumps(transcript, sort_keys=True, separators=(",", ":")).encode()

    # Write to temp file because the CLI takes --file, not stdin
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        tf.write(body)
        tmp_path = tf.name

    try:
        cmd = [
            cfg["bin"], "upload",
            "--url", cfg["rpc"],
            "--key", cfg["key"],
            "--indexer", cfg["indexer"],
            "--file", tmp_path,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    output = (proc.stdout or "") + "\n" + (proc.stderr or "")

    root_match = _ROOT_RE.search(output)
    if not root_match:
        # Surface the last 600 chars of output so we can diagnose
        tail = output[-600:].replace(cfg["key"], "[REDACTED]")
        raise RuntimeError(
            f"0G upload failed (rc={proc.returncode}); could not parse root hash. tail:\n{tail}"
        )
    root = root_match.group(1).lower()

    tx_match = _TX_RE.search(output)
    tx_hash = tx_match.group(1).lower() if tx_match else ""

    indexer_url = f"{cfg['indexer'].rstrip('/')}/file?root={root}"
    return StorageReceipt(
        root=root,
        tx_hash=tx_hash,
        indexer_url=indexer_url,
        bytes_uploaded=len(body),
    )


def save_transcript_index(
    question_id: str,
    receipt: StorageReceipt,
    path: str | None = None,
) -> Path:
    """Append the {question_id: {root, tx, indexer_url, ...}} mapping to disk.

    The UI reads this file to render `synod.gudman.xyz/api/transcript/{qid}`.
    """
    p = Path(path or os.environ.get("SYNOD_0G_TRANSCRIPTS", DEFAULT_TRANSCRIPTS))
    p.parent.mkdir(parents=True, exist_ok=True)

    existing: dict = {}
    if p.exists():
        try:
            existing = json.loads(p.read_text())
            if not isinstance(existing, dict):
                existing = {}
        except json.JSONDecodeError:
            existing = {}

    existing[question_id] = {
        "root": receipt.root,
        "tx": receipt.tx_hash,
        "indexer_url": receipt.indexer_url,
        "bytes": receipt.bytes_uploaded,
        "uploaded_at": int(time.time()),
    }

    p.write_text(json.dumps(existing, indent=2, sort_keys=True))
    return p


def is_enabled() -> bool:
    """Cheap probe — does this process have 0G Storage credentials configured?"""
    return bool(os.environ.get("SYNOD_0G_KEY", "").strip())

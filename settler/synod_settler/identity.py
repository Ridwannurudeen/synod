"""ed25519 identity loading and signature ops for Synod settlers.

AXL persists each node's identity as an OpenSSL-format PEM-encoded ed25519
private key (PKCS#8 unencrypted). The corresponding public key is what AXL
returns from /topology as `our_public_key` — a 64-character hex string of the
raw 32-byte ed25519 public key.

This module loads that PEM and exposes signing + raw pubkey access.
"""

from __future__ import annotations

from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


class Identity:
    """An ed25519 keypair loaded from an AXL-format PEM file."""

    def __init__(self, private_key: Ed25519PrivateKey) -> None:
        self._private_key = private_key
        pub = private_key.public_key()
        self._pubkey_bytes = pub.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

    @classmethod
    def load(cls, pem_path: str | Path) -> Identity:
        pem_path = Path(pem_path)
        if not pem_path.is_file():
            raise FileNotFoundError(f"identity key not found: {pem_path}")
        pem_bytes = pem_path.read_bytes()
        private_key = serialization.load_pem_private_key(pem_bytes, password=None)
        if not isinstance(private_key, Ed25519PrivateKey):
            raise ValueError(
                f"expected ed25519 private key, got {type(private_key).__name__}"
            )
        return cls(private_key)

    @property
    def public_key_hex(self) -> str:
        """64-char hex string matching AXL's /topology `our_public_key`."""
        return self._pubkey_bytes.hex()

    @property
    def public_key_bytes(self) -> bytes:
        return self._pubkey_bytes

    def sign(self, payload: bytes) -> bytes:
        return self._private_key.sign(payload)


def verify_signature(pubkey_hex: str, payload: bytes, signature_hex: str) -> bool:
    """Verify an ed25519 signature using a 64-char hex public key.

    Returns True iff the signature is valid for `payload` under `pubkey_hex`.
    """
    try:
        pubkey_bytes = bytes.fromhex(pubkey_hex)
        signature_bytes = bytes.fromhex(signature_hex)
    except ValueError:
        return False
    if len(pubkey_bytes) != 32:
        return False
    try:
        pub = Ed25519PublicKey.from_public_bytes(pubkey_bytes)
        pub.verify(signature_bytes, payload)
        return True
    except Exception:
        return False

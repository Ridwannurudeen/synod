"""Thin HTTP client over the local AXL daemon.

AXL exposes three endpoints relevant to a Synod settler:
  - GET  /topology         — returns this node's IPv6 + ed25519 pubkey
  - POST /send              — push raw bytes to a peer (hex pubkey in header)
  - GET  /recv              — pop the next inbound message (204 if empty)

This module wraps those into a small, typed Python client.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InboundMessage:
    """A message popped from the AXL /recv queue."""

    sender_pubkey: str
    body: bytes


class AxlClient:
    """Synchronous AXL HTTP client. One client per agent.

    `base_url` is the local AXL daemon (e.g. http://127.0.0.1:9002). All
    requests are local-only; encrypted P2P transport happens inside AXL.
    """

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self._client = httpx.Client(base_url=base_url, timeout=timeout)
        self._base_url = base_url

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> AxlClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def topology(self) -> dict[str, object]:
        """Returns the AXL node's topology JSON: our_public_key, our_ipv6, etc."""
        resp = self._client.get("/topology")
        resp.raise_for_status()
        return resp.json()

    def our_pubkey(self) -> str:
        """64-char hex public key of the local AXL daemon."""
        return str(self.topology()["our_public_key"])

    def send(self, dest_pubkey_hex: str, payload: bytes) -> int:
        """Send `payload` to the peer with public key `dest_pubkey_hex`.

        Returns the number of bytes AXL accepted (from the X-Sent-Bytes
        response header). Raises httpx.HTTPStatusError on transport failure
        — callers should retry with backoff because Yggdrasil routes can
        take a few seconds to converge after peering.
        """
        resp = self._client.post(
            "/send",
            content=payload,
            headers={
                "X-Destination-Peer-Id": dest_pubkey_hex,
                "Content-Type": "application/octet-stream",
            },
        )
        resp.raise_for_status()
        sent = resp.headers.get("X-Sent-Bytes", "0")
        try:
            return int(sent)
        except ValueError:
            return 0

    def recv(self) -> Optional[InboundMessage]:
        """Pop the next inbound message, or None if the queue is empty.

        AXL returns 204 No Content when nothing is queued. Callers should
        poll on a steady cadence (e.g. every 200ms).
        """
        resp = self._client.get("/recv")
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        sender = resp.headers.get("X-From-Peer-Id", "")
        return InboundMessage(sender_pubkey=sender, body=resp.content)

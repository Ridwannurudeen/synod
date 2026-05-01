"""On-chain submission of Synod consensus to SynodRegistry.

Each settler holds a secp256k1 EVM private key (separate from its AXL ed25519
identity). After a question reaches consensus, the deterministically-chosen
poster (the settler with the lowest 64-char-hex AXL pubkey among the voters)
sends a `recordSettlement` transaction to the registry. All other settlers
verify the on-chain record by reading the same questionId.

The ABI is loaded from the Foundry build output. Run `forge build` in
contracts/ before invoking this module so the JSON artifact is fresh.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.types import TxReceipt

from .protocol import canonical_json

logger = logging.getLogger(__name__)


_DEFAULT_ABI_PATH = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "out"
    / "SynodRegistry.sol"
    / "SynodRegistry.json"
)


def _load_abi(abi_path: Path | None = None) -> list[dict[str, Any]]:
    path = abi_path or _DEFAULT_ABI_PATH
    if not path.is_file():
        raise FileNotFoundError(
            f"SynodRegistry ABI not found at {path}. "
            "Run `cd contracts && forge build` first."
        )
    with path.open() as f:
        artifact = json.load(f)
    return artifact["abi"]


def question_id_to_bytes32(qid_hex: str) -> bytes:
    """Convert a 64-char hex question_id to a 32-byte value for Solidity."""
    raw = bytes.fromhex(qid_hex)
    if len(raw) != 32:
        raise ValueError(f"question_id must be 32 bytes, got {len(raw)}")
    return raw


class OnchainClient:
    """web3.py wrapper around SynodRegistry.recordSettlement.

    Constructor args:
      rpc_url:         JSON-RPC endpoint for the chain SynodRegistry is on.
      registry_address: deployed SynodRegistry contract address.
      evm_private_key: hex-encoded secp256k1 private key for this settler's
                       EOA. Must match an address in the registry's settler
                       allowlist or `recordSettlement` will revert.
      abi_path:        optional override of the ABI artifact location.
    """

    def __init__(
        self,
        *,
        rpc_url: str,
        registry_address: str,
        evm_private_key: str,
        abi_path: Path | None = None,
    ) -> None:
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not self.w3.is_connected():
            raise RuntimeError(f"could not connect to RPC {rpc_url}")
        self.account: LocalAccount = Account.from_key(evm_private_key)
        abi = _load_abi(abi_path)
        self.registry = self.w3.eth.contract(
            address=Web3.to_checksum_address(registry_address),
            abi=abi,
        )

    @property
    def address(self) -> str:
        return self.account.address

    def is_registered(self) -> bool:
        row = self.registry.functions.settlers(self.account.address).call()
        return bool(row[0])

    def is_settled(self, question_id_hex: str) -> bool:
        qid = question_id_to_bytes32(question_id_hex)
        return bool(self.registry.functions.isSettled(qid).call())

    def is_axl_pubkey_registered(self, pubkey_hex: str) -> bool:
        raw = question_id_to_bytes32(pubkey_hex)
        return bool(self.registry.functions.registeredAxlPubKeys(raw).call())

    def submit_settlement(
        self,
        *,
        question_id_hex: str,
        outcome: int,
        quorum_size: int,
        weighted_score_scaled: int,
        signed_votes_payload: bytes,
        gas: int | None = None,
    ) -> TxReceipt:
        """Send a recordSettlement transaction. Blocks until the receipt is mined.

        Simulates the call first via eth_call so contract-level reverts surface
        as readable Python exceptions rather than opaque tx-receipt failures.
        """
        qid = question_id_to_bytes32(question_id_hex)

        fn = self.registry.functions.recordSettlement(
            qid,
            int(outcome),
            int(quorum_size),
            int(weighted_score_scaled),
            signed_votes_payload,
        )

        # Simulate first; raises a readable error if the contract reverts.
        fn.call({"from": self.account.address})

        # Estimate gas from the simulated call so we don't over-allocate.
        estimated_gas = gas or fn.estimate_gas({"from": self.account.address})

        tx = fn.build_transaction(
            {
                "from": self.account.address,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "gas": int(estimated_gas * 12 // 10),  # 20% buffer
                "gasPrice": self.w3.eth.gas_price,
                "chainId": self.w3.eth.chain_id,
            }
        )
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise RuntimeError(f"recordSettlement reverted on-chain: {tx_hash.hex()}")
        return receipt


def is_designated_poster(my_pubkey: str, voter_pubkeys: list[str]) -> bool:
    """Return True iff this settler is the deterministic poster for the bundle.

    Rule: lowest-hex-pubkey among the voters posts. This guarantees exactly
    one settler submits per question (no double-spend on gas) without any
    coordination beyond the consensus step.
    """
    if my_pubkey.lower() not in {p.lower() for p in voter_pubkeys}:
        return False
    return my_pubkey.lower() == min(p.lower() for p in voter_pubkeys)


def votes_payload_for_chain(
    votes: list[dict[str, Any]],
    *,
    question: dict[str, Any] | None = None,
) -> bytes:
    """Canonical-JSON encoding of the signed-vote proof for on-chain storage."""
    payload: dict[str, Any] = {"protocol_version": 1, "votes": votes}
    if question is not None:
        payload["question"] = question
    return canonical_json(payload)


def weighted_score_to_scaled(score: float, scale: int = 1_000_000) -> int:
    """Convert a float weighted score (e.g. 1.98) to its uint scaled form (1980000)."""
    return int(round(score * scale))

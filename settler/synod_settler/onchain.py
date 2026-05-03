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
from dataclasses import dataclass
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

    def _send(self, fn: Any, *, value: int = 0, gas: int | None = None) -> str:
        """Simulate, estimate gas, sign, broadcast, and wait for receipt.

        Returns the transaction hash as a 0x-prefixed hex string. Mirrors the
        flow used by submit_settlement so all wrappers share the same revert
        handling and gas-buffer policy.
        """
        sim_args: dict[str, Any] = {"from": self.account.address}
        if value:
            sim_args["value"] = value
        # Simulate first; raises a readable error if the contract reverts.
        fn.call(sim_args)

        estimated_gas = gas or fn.estimate_gas(sim_args)

        tx_args: dict[str, Any] = {
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": int(estimated_gas * 12 // 10),  # 20% buffer
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        }
        if value:
            tx_args["value"] = value

        tx = fn.build_transaction(tx_args)
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise RuntimeError(f"transaction reverted on-chain: {tx_hash.hex()}")
        return tx_hash.hex() if isinstance(tx_hash, bytes) else str(tx_hash)

    def configure_security(
        self,
        challenge_window_seconds: int,
        min_settler_bond_wei: int,
        min_challenge_bond_wei: int,
        *,
        gas: int | None = None,
    ) -> str:
        """Admin-only. Set challenge window + minimum bonds on the registry."""
        fn = self.registry.functions.configureSecurity(
            int(challenge_window_seconds),
            int(min_settler_bond_wei),
            int(min_challenge_bond_wei),
        )
        return self._send(fn, gas=gas)

    def challenge_settlement(
        self,
        question_id_hex: str,
        evidence_hash: bytes | str,
        reason: str,
        bond_wei: int,
        *,
        gas: int | None = None,
    ) -> str:
        """Open a challenge against a settled question. Payable; bond_wei is the
        ETH attached as the challenger's stake.
        """
        qid = question_id_to_bytes32(question_id_hex)
        evidence = _evidence_hash_to_bytes32(evidence_hash)
        fn = self.registry.functions.challengeSettlement(qid, evidence, str(reason))
        return self._send(fn, value=int(bond_wei), gas=gas)

    def resolve_challenge(
        self,
        question_id_hex: str,
        sustained: bool,
        recipient: str = "0x0000000000000000000000000000000000000000",
        *,
        gas: int | None = None,
    ) -> str:
        """Admin-only. Resolve an open challenge — slash the poster (sustained=True)
        or pay the challenge bond to the poster (sustained=False).
        """
        qid = question_id_to_bytes32(question_id_hex)
        fn = self.registry.functions.resolveChallenge(
            qid,
            bool(sustained),
            Web3.to_checksum_address(recipient),
        )
        return self._send(fn, gas=gas)

    def deposit_bond(
        self,
        settler_addr: str,
        bond_wei: int,
        *,
        gas: int | None = None,
    ) -> str:
        """Top up a registered settler's bond.

        SynodRegistry.depositBond() is msg.sender-only — only the settler EOA
        can deposit on its own behalf. To honor that, this client must be
        constructed with the settler's private key, and `settler_addr` must
        match `self.account.address`. Construct one OnchainClient per settler
        when batch-funding the network from a runner script.
        """
        if Web3.to_checksum_address(settler_addr) != self.account.address:
            raise ValueError(
                f"depositBond is msg.sender-only; this client is bonded to "
                f"{self.account.address} but you asked to fund {settler_addr}. "
                "Construct an OnchainClient with that settler's own private key "
                "and call deposit_bond on it."
            )
        fn = self.registry.functions.depositBond()
        return self._send(fn, value=int(bond_wei), gas=gas)

    def get_settlement_full(self, question_id_hex: str) -> "Settlement":
        """Read the full Settlement struct including challenge fields."""
        qid = question_id_to_bytes32(question_id_hex)
        raw = self.registry.functions.getSettlement(qid).call()
        return _settlement_from_tuple(raw)

    def get_security_config(self) -> tuple[int, int, int]:
        """Return (challengeWindowSeconds, minSettlerBond, minChallengeBond)."""
        window = int(self.registry.functions.challengeWindowSeconds().call())
        min_settler = int(self.registry.functions.minSettlerBond().call())
        min_challenge = int(self.registry.functions.minChallengeBond().call())
        return window, min_settler, min_challenge

    def get_settler_bond(self, settler_addr: str) -> int:
        """Return the current bond (in wei) held by the named settler."""
        row = self.registry.functions.settlers(
            Web3.to_checksum_address(settler_addr)
        ).call()
        # Settler tuple: (registered, axlPubKey, modelTag, bond)
        return int(row[3])

    def total_slashed_bond(self) -> int:
        return int(self.registry.functions.totalSlashedBond().call())


@dataclass(frozen=True)
class Settlement:
    """Decoded SynodRegistry.Settlement struct including challenge fields."""

    question_id: bytes
    outcome: int
    quorum_size: int
    weighted_score_scaled: int
    signed_votes_payload: bytes
    posted_by: str
    timestamp: int
    challenge_deadline: int
    finalized: bool
    challenged: bool
    voided: bool
    challenger: str
    challenge_evidence_hash: bytes
    challenge_reason: str
    challenge_bond: int


def _settlement_from_tuple(raw: Any) -> Settlement:
    """Adapt the web3.py-decoded tuple/dict into a Settlement dataclass."""

    def get(idx: int, name: str) -> Any:
        if hasattr(raw, name):
            return getattr(raw, name)
        if isinstance(raw, dict) and name in raw:
            return raw[name]
        return raw[idx]

    return Settlement(
        question_id=bytes(get(0, "questionId")),
        outcome=int(get(1, "outcome")),
        quorum_size=int(get(2, "quorumSize")),
        weighted_score_scaled=int(get(3, "weightedScoreScaled")),
        signed_votes_payload=bytes(get(4, "signedVotesPayload")),
        posted_by=str(get(5, "postedBy")),
        timestamp=int(get(6, "timestamp")),
        challenge_deadline=int(get(7, "challengeDeadline")),
        finalized=bool(get(8, "finalized")),
        challenged=bool(get(9, "challenged")),
        voided=bool(get(10, "voided")),
        challenger=str(get(11, "challenger")),
        challenge_evidence_hash=bytes(get(12, "challengeEvidenceHash")),
        challenge_reason=str(get(13, "challengeReason")),
        challenge_bond=int(get(14, "challengeBond")),
    )


def _evidence_hash_to_bytes32(evidence_hash: bytes | str) -> bytes:
    """Accept raw 32 bytes, hex string, or 0x-prefixed hex; return 32 bytes."""
    if isinstance(evidence_hash, (bytes, bytearray)):
        raw = bytes(evidence_hash)
    elif isinstance(evidence_hash, str):
        h = evidence_hash[2:] if evidence_hash.startswith("0x") else evidence_hash
        raw = bytes.fromhex(h)
    else:
        raise TypeError(f"evidence_hash must be bytes or hex str, got {type(evidence_hash)}")
    if len(raw) != 32:
        raise ValueError(f"evidence_hash must be 32 bytes, got {len(raw)}")
    return raw


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

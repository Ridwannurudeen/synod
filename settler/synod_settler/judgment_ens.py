"""ENS judgment subname minting — j-{shortHash}.synodai.eth per settlement.

After a question settles on-chain (and its transcript is in 0G Storage), this
module mints a transferable ENS subname under `synodai.eth` that encodes the
verdict in load-bearing text records:

  - addr            -> the question's submitter (or deployer if anonymous)
  - synod.outcome   -> the canonical outcome label
  - synod.quorum    -> "N/M" e.g. "2/3"
  - synod.weighted-score (scaled int as string)
  - synod.transcript-cid -> 0G Storage root hash (0x-prefixed hex)
  - synod.tx         -> Gensyn L2 settlement tx hash
  - synod.question   -> truncated prompt
  - description      -> human-readable summary

The subname is:
  - addressable: anyone resolves `j-{hash}.synodai.eth` → verdict + transcript
  - transferable: NameWrapper-wrapped, owner can transfer/sell on OpenSea
  - cryptographically tied to the on-chain settlement via synod.tx + .transcript-cid

This is genuinely novel — using ENS subnames as portable proof-of-AI-decision tokens.
Runs as a standalone CLI (tools/mint_judgment.py) for cost control: gas only spent
when explicitly requested, not auto-fired on every settlement.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from eth_account import Account
from web3 import Web3

logger = logging.getLogger(__name__)

# Ethereum mainnet ENS infrastructure
DEFAULT_ETH_RPC = "https://ethereum-rpc.publicnode.com"
RESOLVER = Web3.to_checksum_address("0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63")
NAMEWRAPPER = Web3.to_checksum_address("0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401")
PARENT_NAME = "synodai.eth"
# Set at synodai.eth registration; valid until 2027-04-30
PARENT_EXPIRY = 1816856999

RESOLVER_ABI = [
    {"name": "setText", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "node", "type": "bytes32"},
                {"name": "key", "type": "string"},
                {"name": "value", "type": "string"}],
     "outputs": []},
    {"name": "setAddr", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "node", "type": "bytes32"},
                {"name": "a", "type": "address"}],
     "outputs": []},
    {"name": "multicall", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "data", "type": "bytes[]"}],
     "outputs": [{"name": "results", "type": "bytes[]"}]},
    {"name": "text", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "node", "type": "bytes32"},
                {"name": "key", "type": "string"}],
     "outputs": [{"type": "string"}]},
    {"name": "addr", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "node", "type": "bytes32"}],
     "outputs": [{"type": "address"}]},
]
WRAP_ABI = [
    {"name": "setSubnodeRecord", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "parentNode", "type": "bytes32"},
                {"name": "label", "type": "string"},
                {"name": "owner", "type": "address"},
                {"name": "resolver", "type": "address"},
                {"name": "ttl", "type": "uint64"},
                {"name": "fuses", "type": "uint32"},
                {"name": "expiry", "type": "uint64"}],
     "outputs": [{"type": "bytes32"}]},
]


def _namehash(name: str) -> bytes:
    """ENS namehash. We avoid pulling ens.utils here to keep this module flat."""
    w3 = Web3()
    node = b"\x00" * 32
    if name:
        for label in reversed(name.split(".")):
            node = w3.keccak(node + w3.keccak(text=label))
    return node


def short_label(question_id_hex: str) -> str:
    """First 7 hex chars of the question id, prefixed with 'j-'."""
    qid = question_id_hex.lower()
    if qid.startswith("0x"):
        qid = qid[2:]
    return f"j-{qid[:7]}"


@dataclass(frozen=True)
class JudgmentReceipt:
    fqn: str
    label: str
    subnode: str  # 0x-prefixed
    mint_tx: str
    records_tx: str
    owner: str
    text_records: dict[str, str]


def mint_judgment(
    *,
    question_id: str,
    outcome_label: str,
    quorum_size: int,
    total_settlers: int,
    weighted_score_scaled: int,
    transcript_cid: str,
    settlement_tx: str,
    question_prompt: str,
    description: str,
    owner: str | None = None,
    deployer_key_path: str | None = None,
    rpc_url: str | None = None,
) -> JudgmentReceipt:
    """Mint a judgment subname under synodai.eth.

    Two-tx flow (mirrors Tier S subname pattern):
      1. NameWrapper.setSubnodeRecord(parent, label, owner, resolver, 0, 0, expiry)
      2. PublicResolver.multicall([setAddr, setText x N])

    Both txs sent from the deployer wallet. Owner of the new subname is the
    question's submitter (or deployer if not provided), making it transferable.
    """
    rpc_url = rpc_url or os.environ.get("SYNOD_ENS_RPC", DEFAULT_ETH_RPC)
    deployer_key_path = (
        deployer_key_path
        or os.environ.get("SYNOD_ENS_DEPLOYER", "/opt/synod-app/runtime/.ens-deployer.json")
    )

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))

    with open(deployer_key_path) as f:
        d = json.load(f)
    acct = Account.from_key(d["private_key"])

    label = short_label(question_id)
    fqn = f"{label}.{PARENT_NAME}"
    parent_node = _namehash(PARENT_NAME)
    sub_node = w3.keccak(parent_node + w3.keccak(text=label))

    resolver = w3.eth.contract(address=RESOLVER, abi=RESOLVER_ABI)
    wrap = w3.eth.contract(address=NAMEWRAPPER, abi=WRAP_ABI)

    if owner is None:
        owner = acct.address
    owner = Web3.to_checksum_address(owner)

    # Idempotency: skip mint if subname already wrapped to our deployer.
    # Lets retries of a partially-failed records tx succeed without double-spending.
    wrap_owner = wrap.functions.setSubnodeRecord  # type stub for type-checkers
    wrap_data = w3.eth.contract(
        address=NAMEWRAPPER,
        abi=[{"name": "getData", "type": "function", "stateMutability": "view",
              "inputs": [{"name": "id", "type": "uint256"}],
              "outputs": [{"name": "owner", "type": "address"},
                          {"name": "fuses", "type": "uint32"},
                          {"name": "expiry", "type": "uint64"}]}],
    ).functions.getData(int.from_bytes(sub_node, "big")).call()
    already_minted = wrap_data[0].lower() == acct.address.lower()
    if already_minted:
        logger.info("subname %s already minted (skipping mint, doing records only)", label)

    gas_price = int(w3.eth.gas_price * 1.3)  # 30% buffer
    nonce = w3.eth.get_transaction_count(acct.address, "pending")

    def base_tx(gas: int) -> dict:
        nonlocal nonce
        t = {
            "from": acct.address,
            "nonce": nonce,
            "gas": gas,
            "gasPrice": gas_price,
        }
        nonce += 1
        return t

    def send(tx: dict, label_: str) -> str:
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=300)
        if rcpt.status != 1:
            raise RuntimeError(f"{label_} reverted (tx 0x{h.hex()})")
        logger.info("%s: 0x%s gasUsed=%d block=%d", label_, h.hex(), rcpt.gasUsed, rcpt.blockNumber)
        return "0x" + h.hex()

    # 1. Mint the subname (or skip if already minted by this deployer)
    if already_minted:
        mint_tx = "0x" + ("0" * 64)  # sentinel — see judgments.json for original
    else:
        mint_tx = send(
            wrap.functions.setSubnodeRecord(
                parent_node, label, owner, RESOLVER,
                0, 0, PARENT_EXPIRY,
            ).build_transaction(base_tx(280_000)),
            f"mint {label}",
        )

    # 2. Set all text records + addr in one multicall on the resolver
    truncated = question_prompt if len(question_prompt) <= 200 else (question_prompt[:197] + "...")
    text_records: dict[str, str] = {
        "synod.outcome": outcome_label,
        "synod.quorum": f"{quorum_size}/{total_settlers}",
        "synod.weighted-score": str(weighted_score_scaled),
        "synod.transcript-cid": transcript_cid,
        "synod.tx": settlement_tx,
        "synod.question": truncated,
        "synod.parent": PARENT_NAME,
        "description": description,
    }
    calls: list[bytes] = [
        bytes.fromhex(resolver.encode_abi(
            abi_element_identifier="setAddr",
            args=[sub_node, owner],
        )[2:]),
    ]
    for k, v in text_records.items():
        calls.append(bytes.fromhex(resolver.encode_abi(
            abi_element_identifier="setText",
            args=[sub_node, k, v],
        )[2:]))
    # 8 multicall items: setAddr + 7 setText. SSTORE cost varies with text length;
    # long prompts (200-char synod.question + description) push past 700k. Use 900k.
    records_tx = send(
        resolver.functions.multicall(calls).build_transaction(base_tx(900_000)),
        f"records {label}",
    )

    return JudgmentReceipt(
        fqn=fqn,
        label=label,
        subnode="0x" + sub_node.hex(),
        mint_tx=mint_tx,
        records_tx=records_tx,
        owner=owner,
        text_records=text_records,
    )


def save_judgment_index(
    question_id: str,
    receipt: JudgmentReceipt,
    path: str | None = None,
) -> str:
    p = path or os.environ.get(
        "SYNOD_JUDGMENTS_FILE",
        "/opt/synod-app/runtime/judgments.json",
    )
    existing: dict = {}
    if os.path.exists(p):
        try:
            with open(p) as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            existing = {}

    existing[question_id] = {
        "fqn": receipt.fqn,
        "label": receipt.label,
        "subnode": receipt.subnode,
        "mint_tx": receipt.mint_tx,
        "records_tx": receipt.records_tx,
        "owner": receipt.owner,
        "text_records": receipt.text_records,
        "ens_app_url": f"https://app.ens.domains/{receipt.fqn}",
    }

    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(existing, f, indent=2, sort_keys=True)
    return p

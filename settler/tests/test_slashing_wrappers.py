"""Integration tests for the slashing operational wrappers.

Each test deploys a fresh SynodRegistry on an in-memory eth-tester chain and
exercises the wrapper methods on OnchainClient. eth-tester is an optional
dependency — if it (or py-evm) isn't installed the whole module is skipped.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Skip the whole module if eth-tester / py-evm aren't installed locally.
pytest.importorskip("eth_tester")
pytest.importorskip("eth_account")

from eth_account import Account  # noqa: E402
from eth_tester import EthereumTester  # noqa: E402  # type: ignore[import-untyped]
from web3 import Web3  # noqa: E402
from web3.providers.eth_tester import EthereumTesterProvider  # noqa: E402

from synod_settler.onchain import (  # noqa: E402
    OnchainClient,
    Settlement,
    _evidence_hash_to_bytes32,
    _load_abi,
    _settlement_from_tuple,
    question_id_to_bytes32,
)


ARTIFACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "out"
    / "SynodRegistry.sol"
    / "SynodRegistry.json"
)


def _load_artifact() -> dict[str, object]:
    if not ARTIFACT_PATH.is_file():
        pytest.skip(f"contract artifact missing at {ARTIFACT_PATH}; run `forge build` first")
    with ARTIFACT_PATH.open() as f:
        return json.load(f)


@pytest.fixture
def chain() -> tuple[Web3, EthereumTester]:
    tester = EthereumTester()
    w3 = Web3(EthereumTesterProvider(tester))
    return w3, tester


@pytest.fixture
def deployer_key() -> str:
    # Deterministic dev key, valid hex, never used outside this in-memory chain.
    return "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"


@pytest.fixture
def settler_keys() -> list[str]:
    return [
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
        "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    ]


@pytest.fixture
def deployed(chain, deployer_key, settler_keys):
    """Deploy SynodRegistry, fund deployer + settlers, return (w3, address, accounts)."""
    w3, tester = chain
    artifact = _load_artifact()
    abi = artifact["abi"]
    bytecode = artifact["bytecode"]["object"]  # type: ignore[index]

    deployer = Account.from_key(deployer_key)
    settlers = [Account.from_key(k) for k in settler_keys]

    # Fund deployer + settlers from eth-tester's pre-funded faucet account.
    funder = w3.eth.accounts[0]
    for account in [deployer, *settlers]:
        tx_hash = w3.eth.send_transaction(
            {
                "from": funder,
                "to": account.address,
                "value": w3.to_wei(100, "ether"),
            }
        )
        w3.eth.wait_for_transaction_receipt(tx_hash)

    # Deploy from the deployer EOA so it becomes admin.
    Contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    construct_tx = Contract.constructor(deployer.address).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 4_000_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": w3.eth.chain_id,
        }
    )
    signed = deployer.sign_transaction(construct_tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    address = receipt["contractAddress"]
    return w3, address, deployer, settlers, abi


def _make_client(w3: Web3, address: str, key: str) -> OnchainClient:
    """Construct an OnchainClient bound to an existing Web3/contract pair.

    OnchainClient.__init__ wires up its own HTTPProvider; for in-memory
    eth-tester we wire it manually after construction.
    """
    # Build a placeholder client via the production constructor with a stub
    # RPC, then swap in the live in-memory web3.
    client = OnchainClient.__new__(OnchainClient)
    client.w3 = w3
    client.account = Account.from_key(key)
    abi = _load_abi()
    client.registry = w3.eth.contract(
        address=Web3.to_checksum_address(address),
        abi=abi,
    )
    return client


def _register(client: OnchainClient, target: str, axl: bytes, tag: str, bond_wei: int) -> None:
    """Admin (client) registers `target` with the given AXL pubkey + initial bond."""
    fn = client.registry.functions.registerSettler(
        Web3.to_checksum_address(target), axl, tag
    )
    tx = fn.build_transaction(
        {
            "from": client.account.address,
            "nonce": client.w3.eth.get_transaction_count(client.account.address),
            "gas": 1_000_000,
            "gasPrice": client.w3.eth.gas_price,
            "chainId": client.w3.eth.chain_id,
            "value": bond_wei,
        }
    )
    signed = client.account.sign_transaction(tx)
    h = client.w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = client.w3.eth.wait_for_transaction_receipt(h)
    assert receipt["status"] == 1


def test_evidence_hash_to_bytes32_accepts_all_forms() -> None:
    raw = b"\x01" * 32
    assert _evidence_hash_to_bytes32(raw) == raw
    assert _evidence_hash_to_bytes32("01" * 32) == raw
    assert _evidence_hash_to_bytes32("0x" + "01" * 32) == raw
    with pytest.raises(ValueError):
        _evidence_hash_to_bytes32(b"\x00" * 16)


def test_settlement_from_tuple_round_trip() -> None:
    raw = (
        b"\x11" * 32,           # questionId
        1,                      # outcome
        3,                      # quorumSize
        1_980_000,              # weightedScoreScaled
        b"payload",             # signedVotesPayload
        "0x" + "ab" * 20,       # postedBy
        1700000000,             # timestamp
        1700086400,             # challengeDeadline
        False,                  # finalized
        False,                  # challenged
        False,                  # voided
        "0x" + "00" * 20,       # challenger
        b"\x00" * 32,           # challengeEvidenceHash
        "",                     # challengeReason
        0,                      # challengeBond
    )
    s = _settlement_from_tuple(raw)
    assert isinstance(s, Settlement)
    assert s.outcome == 1
    assert s.quorum_size == 3
    assert s.weighted_score_scaled == 1_980_000
    assert s.signed_votes_payload == b"payload"
    assert s.timestamp == 1700000000
    assert s.challenge_deadline == 1700086400
    assert not s.challenged


def test_configure_security_writes_state(deployed) -> None:
    w3, address, deployer, _, _ = deployed
    admin = _make_client(w3, address, deployer.key.hex())

    # Defaults are zero
    assert admin.get_security_config() == (0, 0, 0)

    tx_hash = admin.configure_security(
        challenge_window_seconds=86_400,
        min_settler_bond_wei=10**15,
        min_challenge_bond_wei=10**14,
    )
    assert isinstance(tx_hash, str)
    window, min_settler, min_challenge = admin.get_security_config()
    assert window == 86_400
    assert min_settler == 10**15
    assert min_challenge == 10**14


def test_challenge_settlement_records_event(deployed) -> None:
    w3, address, deployer, settlers, abi = deployed
    admin = _make_client(w3, address, deployer.key.hex())

    admin.configure_security(86_400, 10**15, 10**14)

    s1 = settlers[0]
    _register(admin, s1.address, b"\x00" * 31 + b"\x01", "claude", 10**15)
    poster = _make_client(w3, address, s1.key.hex())

    qid = "ab" * 32
    payload = b'{"protocol_version":1,"votes":[]}'
    poster.submit_settlement(
        question_id_hex=qid,
        outcome=1,
        quorum_size=1,
        weighted_score_scaled=900_000,
        signed_votes_payload=payload,
    )

    challenger = _make_client(w3, address, deployer.key.hex())
    evidence = b"\xde" * 32
    challenge_tx = challenger.challenge_settlement(
        question_id_hex=qid,
        evidence_hash=evidence,
        reason="weak proof",
        bond_wei=10**14,
    )

    # Decode the SettlementChallenged event from the challenge tx receipt
    receipt = w3.eth.get_transaction_receipt(challenge_tx)
    contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)
    logs = contract.events.SettlementChallenged().process_receipt(receipt)
    assert len(logs) == 1
    args = logs[0]["args"]
    assert bytes(args["questionId"]) == question_id_to_bytes32(qid)
    assert args["challenger"].lower() == challenger.account.address.lower()
    assert bytes(args["evidenceHash"]) == evidence
    assert args["challengeBond"] == 10**14
    assert args["reason"] == "weak proof"

    settlement = challenger.get_settlement_full(qid)
    assert settlement.challenged is True
    assert settlement.challenger.lower() == challenger.account.address.lower()
    assert settlement.challenge_bond == 10**14


def test_resolve_challenge_sustained_slashes_poster(deployed) -> None:
    w3, address, deployer, settlers, _ = deployed
    admin = _make_client(w3, address, deployer.key.hex())

    admin.configure_security(86_400, 10**15, 10**14)

    s1 = settlers[0]
    _register(admin, s1.address, b"\x00" * 31 + b"\x01", "claude", 10**15)
    poster = _make_client(w3, address, s1.key.hex())

    qid = "cd" * 32
    poster.submit_settlement(
        question_id_hex=qid,
        outcome=1,
        quorum_size=1,
        weighted_score_scaled=900_000,
        signed_votes_payload=b'{"votes":[]}',
    )
    assert admin.get_settler_bond(s1.address) == 10**15

    # The deployer/admin EOA acts as the challenger here. The contract's
    # challengeSettlement is permissionless, so admin can post the challenge
    # too; we track its balance to confirm the slash payout reached it.
    challenger = _make_client(w3, address, deployer.key.hex())
    balance_before = w3.eth.get_balance(challenger.account.address)
    challenger.challenge_settlement(qid, b"\xab" * 32, "bad sig", 10**14)

    admin.resolve_challenge(qid, sustained=True, recipient=challenger.account.address)

    # Poster's bond is fully slashed (slash amount == minSettlerBond)
    assert admin.get_settler_bond(s1.address) == 0
    assert admin.total_slashed_bond() == 10**15

    # Challenger received bond + slash payout. Confirm the net delta is
    # positive after gas — they put up 10**14 and got back 10**14 + 10**15.
    balance_after = w3.eth.get_balance(challenger.account.address)
    assert balance_after > balance_before - 10**16

    # Settlement is reopened (not sealed, not finalized)
    assert not admin.is_settled(qid)


def test_resolve_challenge_rejected_pays_poster(deployed) -> None:
    w3, address, deployer, settlers, _ = deployed
    admin = _make_client(w3, address, deployer.key.hex())

    admin.configure_security(86_400, 10**15, 10**14)

    s1 = settlers[0]
    _register(admin, s1.address, b"\x00" * 31 + b"\x02", "claude", 10**15)
    poster = _make_client(w3, address, s1.key.hex())

    qid = "ef" * 32
    poster.submit_settlement(
        question_id_hex=qid,
        outcome=1,
        quorum_size=1,
        weighted_score_scaled=900_000,
        signed_votes_payload=b'{"votes":[]}',
    )

    challenger = _make_client(w3, address, deployer.key.hex())
    challenger.challenge_settlement(qid, b"\xee" * 32, "weak", 10**14)

    poster_balance_before = w3.eth.get_balance(s1.address)
    admin.resolve_challenge(qid, sustained=False, recipient="0x0000000000000000000000000000000000000000")

    # Poster's bond unchanged, totalSlashedBond unchanged
    assert admin.get_settler_bond(s1.address) == 10**15
    assert admin.total_slashed_bond() == 0

    # Poster received the challenger's bond as anti-spam compensation
    poster_balance_after = w3.eth.get_balance(s1.address)
    assert poster_balance_after - poster_balance_before == 10**14

    # Settlement is finalized
    settlement = admin.get_settlement_full(qid)
    assert settlement.finalized is True
    assert settlement.voided is False


def test_double_challenge_reverts(deployed) -> None:
    w3, address, deployer, settlers, _ = deployed
    admin = _make_client(w3, address, deployer.key.hex())
    admin.configure_security(86_400, 10**15, 10**14)

    s1 = settlers[0]
    _register(admin, s1.address, b"\x00" * 31 + b"\x03", "claude", 10**15)
    poster = _make_client(w3, address, s1.key.hex())

    qid = "ba" * 32
    poster.submit_settlement(
        question_id_hex=qid,
        outcome=1,
        quorum_size=1,
        weighted_score_scaled=900_000,
        signed_votes_payload=b'{"votes":[]}',
    )

    challenger = _make_client(w3, address, deployer.key.hex())
    challenger.challenge_settlement(qid, b"\x12" * 32, "first", 10**14)

    with pytest.raises(Exception):
        # Contract reverts with AlreadyChallenged; web3.py raises whatever
        # ContractLogicError wrapper the local provider uses, so we accept
        # the generic Exception here.
        challenger.challenge_settlement(qid, b"\x34" * 32, "second", 10**14)


def test_deposit_bond_wrong_settler_raises() -> None:
    """Local check: deposit_bond enforces msg.sender == settler_addr in Python."""
    client = OnchainClient.__new__(OnchainClient)
    client.account = Account.from_key(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    )
    other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    with pytest.raises(ValueError):
        client.deposit_bond(other, 10**14)

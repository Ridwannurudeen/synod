// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SynodRegistry
/// @notice On-chain ledger for decentralized AI settlement consensus.
///
/// Settlers (off-chain Synod nodes) reach quorum-signed agreement on a
/// market resolution prompt over the AXL P2P mesh, then one of them posts
/// the result here. The contract enforces an admin-curated allowlist of
/// settler EOAs and seals each questionId's outcome on first record.
///
/// The cryptographic proof of consensus (the bundle of ed25519-signed votes)
/// is stored in `signedVotesPayload` as raw bytes for off-chain verification:
/// a verifier reconstructs each vote's canonical-JSON signing payload, parses
/// the ed25519 signature, and checks it against the settler's AXL pubkey.
/// Doing the ed25519 verification in pure Solidity is gas-prohibitive and
/// the EVM has no ed25519 precompile, so verification is intentionally
/// off-chain. On-chain we enforce the registered EOA set, unique registered
/// AXL pubkeys, bounded proof payloads, and first-write finality; off-chain
/// anyone can verify the cryptographic proof.
contract SynodRegistry {
    struct Settlement {
        bytes32 questionId;
        uint8 outcome;
        uint256 quorumSize;
        uint256 weightedScoreScaled; // scaled by 1e6 so we can store the fp value
        bytes signedVotesPayload;
        address postedBy;
        uint256 timestamp;
    }

    struct Settler {
        bool registered;
        bytes32 axlPubKey; // 32-byte ed25519 public key matching AXL identity
        string modelTag;
    }

    address public admin;
    mapping(address => Settler) public settlers;
    mapping(bytes32 => bool) public registeredAxlPubKeys;
    mapping(bytes32 => Settlement) private _settlements;
    mapping(bytes32 => bool) public sealed_;
    uint256 public registeredSettlerCount;
    uint256 public constant MAX_SIGNED_VOTES_PAYLOAD_BYTES = 65_536;

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event SettlerRegistered(address indexed settler, bytes32 axlPubKey, string modelTag);
    event SettlerRevoked(address indexed settler);
    event SettlementRecorded(
        bytes32 indexed questionId,
        uint8 outcome,
        uint256 quorumSize,
        uint256 weightedScoreScaled,
        address indexed postedBy
    );

    error NotAdmin();
    error NotRegisteredSettler();
    error AlreadySealed();
    error InvalidQuorumSize();
    error AlreadyRegistered();
    error NotRegistered();
    error ZeroAddress();
    error ZeroAxlPubKey();
    error DuplicateAxlPubKey();
    error InvalidQuestionId();
    error InvalidProofPayload();
    error PayloadTooLarge();

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlySettler() {
        if (!settlers[msg.sender].registered) revert NotRegisteredSettler();
        _;
    }

    /// @notice Transfer admin to a new address. Pass address(0) to renounce
    ///         (irreversible — no further settlers can be registered or revoked).
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Add a settler to the allowlist. The `axlPubKey` is the 32-byte
    ///         ed25519 public key the settler uses on the AXL mesh — recorded
    ///         on-chain so off-chain verifiers can map signed votes back to
    ///         the registered settler set.
    function registerSettler(
        address settler,
        bytes32 axlPubKey,
        string calldata modelTag
    ) external onlyAdmin {
        if (settler == address(0)) revert ZeroAddress();
        if (axlPubKey == bytes32(0)) revert ZeroAxlPubKey();
        if (settlers[settler].registered) revert AlreadyRegistered();
        if (registeredAxlPubKeys[axlPubKey]) revert DuplicateAxlPubKey();
        settlers[settler] = Settler({
            registered: true,
            axlPubKey: axlPubKey,
            modelTag: modelTag
        });
        registeredAxlPubKeys[axlPubKey] = true;
        registeredSettlerCount++;
        emit SettlerRegistered(settler, axlPubKey, modelTag);
    }

    /// @notice Remove a settler from the allowlist.
    function revokeSettler(address settler) external onlyAdmin {
        if (!settlers[settler].registered) revert NotRegistered();
        bytes32 axlPubKey = settlers[settler].axlPubKey;
        delete settlers[settler];
        delete registeredAxlPubKeys[axlPubKey];
        registeredSettlerCount--;
        emit SettlerRevoked(settler);
    }

    /// @notice Post the consensus result for a question. Callable only by a
    ///         registered settler. Each questionId can only be sealed once.
    /// @param questionId 32-byte unique market identifier (matches
    ///        QuestionAnnouncement.question_id off-chain).
    /// @param outcome The agreed-upon outcome index.
    /// @param quorumSize Number of distinct registered settlers whose valid
    ///        signed votes support the winning outcome.
    /// @param weightedScoreScaled Confidence-weighted score for the winning
    ///        outcome, scaled by 1e6 (so 1.98 → 1980000).
    /// @param signedVotesPayload Raw bytes containing the bundle of signed
    ///        votes, in the canonical JSON wire format. Stored verbatim for
    ///        off-chain audit.
    function recordSettlement(
        bytes32 questionId,
        uint8 outcome,
        uint256 quorumSize,
        uint256 weightedScoreScaled,
        bytes calldata signedVotesPayload
    ) external onlySettler {
        if (questionId == bytes32(0)) revert InvalidQuestionId();
        if (sealed_[questionId]) revert AlreadySealed();
        if (quorumSize == 0 || quorumSize > registeredSettlerCount) {
            revert InvalidQuorumSize();
        }
        if (signedVotesPayload.length == 0) revert InvalidProofPayload();
        if (signedVotesPayload.length > MAX_SIGNED_VOTES_PAYLOAD_BYTES) {
            revert PayloadTooLarge();
        }

        _settlements[questionId] = Settlement({
            questionId: questionId,
            outcome: outcome,
            quorumSize: quorumSize,
            weightedScoreScaled: weightedScoreScaled,
            signedVotesPayload: signedVotesPayload,
            postedBy: msg.sender,
            timestamp: block.timestamp
        });
        sealed_[questionId] = true;

        emit SettlementRecorded(
            questionId,
            outcome,
            quorumSize,
            weightedScoreScaled,
            msg.sender
        );
    }

    /// @notice Read a settled outcome.
    function getSettlement(bytes32 questionId)
        external
        view
        returns (Settlement memory)
    {
        return _settlements[questionId];
    }

    /// @notice True iff the given questionId has a recorded settlement.
    function isSettled(bytes32 questionId) external view returns (bool) {
        return sealed_[questionId];
    }
}

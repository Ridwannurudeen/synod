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
///
/// For production deployments, the admin can enable an optimistic security
/// layer: settlers maintain bonds, settlements have a challenge window, and a
/// valid challenge can slash the poster and reopen the question for reposting.
/// The default challenge window and bond are zero so local hackathon demos keep
/// instant finality unless security parameters are explicitly configured.
contract SynodRegistry {
    struct Settlement {
        bytes32 questionId;
        uint8 outcome;
        uint256 quorumSize;
        uint256 weightedScoreScaled; // scaled by 1e6 so we can store the fp value
        bytes signedVotesPayload;
        address postedBy;
        uint256 timestamp;
        uint256 challengeDeadline;
        bool finalized;
        bool challenged;
        bool voided;
        address challenger;
        bytes32 challengeEvidenceHash;
        string challengeReason;
        uint256 challengeBond;
    }

    struct Settler {
        bool registered;
        bytes32 axlPubKey; // 32-byte ed25519 public key matching AXL identity
        string modelTag;
        uint256 bond;
    }

    address public admin;
    mapping(address => Settler) public settlers;
    mapping(bytes32 => bool) public registeredAxlPubKeys;
    mapping(bytes32 => Settlement) private _settlements;
    mapping(bytes32 => bool) public sealed_;
    uint256 public registeredSettlerCount;
    uint256 public constant MAX_SIGNED_VOTES_PAYLOAD_BYTES = 65_536;
    uint256 public constant MAX_CHALLENGE_REASON_BYTES = 2_048;
    uint256 public challengeWindowSeconds;
    uint256 public minSettlerBond;
    uint256 public minChallengeBond;
    uint256 public totalSlashedBond;
    uint256 private _reentrancyLock = 1;

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event SecurityConfigured(
        uint256 challengeWindowSeconds,
        uint256 minSettlerBond,
        uint256 minChallengeBond
    );
    event SettlerRegistered(address indexed settler, bytes32 axlPubKey, string modelTag);
    event SettlerRevoked(address indexed settler);
    event SettlerBondDeposited(address indexed settler, uint256 amount, uint256 newBond);
    event SettlerBondWithdrawn(address indexed settler, uint256 amount, uint256 newBond);
    event SettlementRecorded(
        bytes32 indexed questionId,
        uint8 outcome,
        uint256 quorumSize,
        uint256 weightedScoreScaled,
        address indexed postedBy
    );
    event SettlementFinalized(bytes32 indexed questionId);
    event SettlementChallenged(
        bytes32 indexed questionId,
        address indexed challenger,
        bytes32 evidenceHash,
        uint256 challengeBond,
        string reason
    );
    event ChallengeResolved(
        bytes32 indexed questionId,
        bool sustained,
        address indexed recipient,
        uint256 payout
    );

    error NotAdmin();
    error NotRegisteredSettler();
    error AlreadySealed();
    error NotSealed();
    error InvalidQuorumSize();
    error AlreadyRegistered();
    error NotRegistered();
    error ZeroAddress();
    error ZeroAxlPubKey();
    error DuplicateAxlPubKey();
    error InvalidQuestionId();
    error InvalidProofPayload();
    error PayloadTooLarge();
    error InsufficientBond();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error AlreadyFinalized();
    error AlreadyChallenged();
    error NotChallenged();
    error InvalidChallengeEvidence();
    error ChallengeReasonTooLong();
    error InvalidSecurityConfig();
    error Reentrancy();
    error TransferFailed();

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

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert Reentrancy();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    /// @notice Transfer admin to a new address. Pass address(0) to renounce
    ///         (irreversible: no further settlers can be registered or revoked).
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Configure optimistic-finality security parameters.
    /// @dev Set all values to zero for instant-finality hackathon/demo mode.
    function configureSecurity(
        uint256 challengeWindowSeconds_,
        uint256 minSettlerBond_,
        uint256 minChallengeBond_
    ) external onlyAdmin nonReentrant {
        if (
            challengeWindowSeconds_ > 0
                && (minSettlerBond_ == 0 || minChallengeBond_ == 0)
        ) {
            revert InvalidSecurityConfig();
        }
        challengeWindowSeconds = challengeWindowSeconds_;
        minSettlerBond = minSettlerBond_;
        minChallengeBond = minChallengeBond_;
        emit SecurityConfigured(
            challengeWindowSeconds_,
            minSettlerBond_,
            minChallengeBond_
        );
    }

    /// @notice Add a settler to the allowlist. The `axlPubKey` is the 32-byte
    ///         ed25519 public key the settler uses on the AXL mesh, recorded
    ///         on-chain so off-chain verifiers can map signed votes back to
    ///         the registered settler set. The admin may also attach initial
    ///         stake by sending ETH with this call.
    function registerSettler(
        address settler,
        bytes32 axlPubKey,
        string calldata modelTag
    ) external payable onlyAdmin nonReentrant {
        if (settler == address(0)) revert ZeroAddress();
        if (axlPubKey == bytes32(0)) revert ZeroAxlPubKey();
        if (settlers[settler].registered) revert AlreadyRegistered();
        if (registeredAxlPubKeys[axlPubKey]) revert DuplicateAxlPubKey();
        settlers[settler] = Settler({
            registered: true,
            axlPubKey: axlPubKey,
            modelTag: modelTag,
            bond: msg.value
        });
        registeredAxlPubKeys[axlPubKey] = true;
        registeredSettlerCount++;
        emit SettlerRegistered(settler, axlPubKey, modelTag);
        if (msg.value > 0) {
            emit SettlerBondDeposited(settler, msg.value, msg.value);
        }
    }

    /// @notice Remove a settler from the allowlist.
    function revokeSettler(address settler) external onlyAdmin nonReentrant {
        if (!settlers[settler].registered) revert NotRegistered();
        bytes32 axlPubKey = settlers[settler].axlPubKey;
        uint256 bond = settlers[settler].bond;
        delete settlers[settler];
        delete registeredAxlPubKeys[axlPubKey];
        registeredSettlerCount--;
        emit SettlerRevoked(settler);
        if (bond > 0) {
            (bool ok,) = payable(settler).call{value: bond}("");
            if (!ok) revert TransferFailed();
            emit SettlerBondWithdrawn(settler, bond, 0);
        }
    }

    /// @notice Add stake to the caller's settler bond.
    function depositBond() external payable onlySettler nonReentrant {
        if (msg.value == 0) revert InsufficientBond();
        settlers[msg.sender].bond += msg.value;
        emit SettlerBondDeposited(msg.sender, msg.value, settlers[msg.sender].bond);
    }

    /// @notice Withdraw excess stake while keeping the required minimum bond.
    function withdrawBond(uint256 amount) external onlySettler nonReentrant {
        uint256 current = settlers[msg.sender].bond;
        if (amount == 0 || current < amount || current - amount < minSettlerBond) {
            revert InsufficientBond();
        }
        settlers[msg.sender].bond = current - amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit SettlerBondWithdrawn(msg.sender, amount, settlers[msg.sender].bond);
    }

    /// @notice Post the consensus result for a question. Callable only by a
    ///         registered settler. Each questionId can only be sealed once.
    /// @param questionId 32-byte unique market identifier (matches
    ///        QuestionAnnouncement.question_id off-chain).
    /// @param outcome The agreed-upon outcome index.
    /// @param quorumSize Number of distinct registered settlers whose valid
    ///        signed votes support the winning outcome.
    /// @param weightedScoreScaled Confidence-weighted score for the winning
    ///        outcome, scaled by 1e6 (so 1.98 -> 1980000).
    /// @param signedVotesPayload Raw bytes containing the bundle of signed
    ///        votes, in the canonical JSON wire format. Stored verbatim for
    ///        off-chain audit.
    function recordSettlement(
        bytes32 questionId,
        uint8 outcome,
        uint256 quorumSize,
        uint256 weightedScoreScaled,
        bytes calldata signedVotesPayload
    ) external onlySettler nonReentrant {
        if (questionId == bytes32(0)) revert InvalidQuestionId();
        if (sealed_[questionId]) revert AlreadySealed();
        if (settlers[msg.sender].bond < minSettlerBond) revert InsufficientBond();
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
            timestamp: block.timestamp,
            challengeDeadline: block.timestamp + challengeWindowSeconds,
            finalized: challengeWindowSeconds == 0,
            challenged: false,
            voided: false,
            challenger: address(0),
            challengeEvidenceHash: bytes32(0),
            challengeReason: "",
            challengeBond: 0
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

    /// @notice Challenge a recorded settlement during its challenge window.
    /// @dev The evidence hash should commit to an off-chain verifier report,
    ///      transcript, or other public evidence package. Admin/governance then
    ///      resolves the challenge with `resolveChallenge`.
    function challengeSettlement(
        bytes32 questionId,
        bytes32 evidenceHash,
        string calldata reason
    ) external payable nonReentrant {
        if (!sealed_[questionId]) revert NotSealed();
        Settlement storage s = _settlements[questionId];
        if (s.finalized) revert AlreadyFinalized();
        if (s.challenged) revert AlreadyChallenged();
        if (block.timestamp > s.challengeDeadline) revert ChallengeWindowClosed();
        if (evidenceHash == bytes32(0)) revert InvalidChallengeEvidence();
        if (bytes(reason).length > MAX_CHALLENGE_REASON_BYTES) {
            revert ChallengeReasonTooLong();
        }
        if (msg.value < minChallengeBond) revert InsufficientBond();

        s.challenged = true;
        s.challenger = msg.sender;
        s.challengeEvidenceHash = evidenceHash;
        s.challengeReason = reason;
        s.challengeBond = msg.value;

        emit SettlementChallenged(
            questionId,
            msg.sender,
            evidenceHash,
            msg.value,
            reason
        );
    }

    /// @notice Resolve a challenge after off-chain proof review.
    /// @param sustained If true, slash poster bond, void settlement, and reopen
    ///                  the question for a corrected settlement.
    ///                  If false, finalize the settlement and pay the challenge
    ///                  bond to the poster as anti-spam compensation.
    /// @param recipient Receiver of the challenger bond/slash payout. Pass
    ///                  address(0) to use challenger for sustained challenges or
    ///                  poster for rejected challenges.
    function resolveChallenge(
        bytes32 questionId,
        bool sustained,
        address payable recipient
    ) external onlyAdmin nonReentrant {
        if (!sealed_[questionId]) revert NotSealed();
        Settlement storage s = _settlements[questionId];
        if (!s.challenged) revert NotChallenged();
        if (s.finalized) revert AlreadyFinalized();

        address payable payoutRecipient = recipient;
        uint256 payout = s.challengeBond;
        s.challengeBond = 0;

        if (sustained) {
            if (payoutRecipient == address(0)) {
                payoutRecipient = payable(s.challenger);
            }
            uint256 slashAmount = _slashableAmount(s.postedBy);
            if (slashAmount > 0) {
                settlers[s.postedBy].bond -= slashAmount;
                totalSlashedBond += slashAmount;
                payout += slashAmount;
            }
            s.voided = true;
            sealed_[questionId] = false;
        } else {
            if (payoutRecipient == address(0)) {
                payoutRecipient = payable(s.postedBy);
            }
            s.finalized = true;
        }

        if (payout > 0) {
            (bool ok,) = payoutRecipient.call{value: payout}("");
            if (!ok) revert TransferFailed();
        }

        emit ChallengeResolved(questionId, sustained, payoutRecipient, payout);
    }

    /// @notice Finalize an unchallenged settlement after the challenge window.
    function finalizeSettlement(bytes32 questionId) external nonReentrant {
        if (!sealed_[questionId]) revert NotSealed();
        Settlement storage s = _settlements[questionId];
        if (s.finalized) revert AlreadyFinalized();
        if (s.challenged) revert AlreadyChallenged();
        if (block.timestamp <= s.challengeDeadline) revert ChallengeWindowOpen();

        s.finalized = true;
        emit SettlementFinalized(questionId);
    }

    /// @notice Read a settled outcome.
    function getSettlement(bytes32 questionId)
        external
        view
        returns (Settlement memory)
    {
        return _settlements[questionId];
    }

    /// @notice True iff the given questionId has a live recorded settlement.
    function isSettled(bytes32 questionId) external view returns (bool) {
        return sealed_[questionId];
    }

    /// @notice True iff a settlement exists and is past optimistic challenge.
    function isFinalized(bytes32 questionId) external view returns (bool) {
        Settlement storage s = _settlements[questionId];
        return sealed_[questionId] && s.finalized && !s.voided;
    }

    function _slashableAmount(address settler) internal view returns (uint256) {
        uint256 bond = settlers[settler].bond;
        if (bond == 0) return 0;
        if (minSettlerBond == 0 || bond < minSettlerBond) return bond;
        return minSettlerBond;
    }
}

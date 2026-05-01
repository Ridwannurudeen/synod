// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SynodRegistry} from "../src/SynodRegistry.sol";

contract SynodRegistryTest is Test {
    SynodRegistry internal registry;
    address internal admin = address(0xADA);
    address internal settler1 = address(0x5111);
    address internal settler2 = address(0x5222);
    address internal settler3 = address(0x5333);
    address internal stranger = address(0xBAD);

    bytes32 internal axlKey1 = bytes32(uint256(1));
    bytes32 internal axlKey2 = bytes32(uint256(2));
    bytes32 internal axlKey3 = bytes32(uint256(3));

    bytes32 internal QID = bytes32(uint256(0xc0ffee));
    bytes internal proof = bytes("{\"protocol_version\":1,\"votes\":[]}");

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

    function setUp() public {
        registry = new SynodRegistry(admin);
    }

    // --- constructor / admin -----------------------------------------------

    function test_ConstructorSetsAdmin() public view {
        assertEq(registry.admin(), admin);
    }

    function test_ConstructorRejectsZeroAdmin() public {
        vm.expectRevert(SynodRegistry.ZeroAddress.selector);
        new SynodRegistry(address(0));
    }

    function test_TransferAdmin() public {
        address newAdmin = address(0xBEEF);
        vm.expectEmit(true, true, false, false);
        emit AdminTransferred(admin, newAdmin);
        vm.prank(admin);
        registry.transferAdmin(newAdmin);
        assertEq(registry.admin(), newAdmin);
    }

    function test_TransferAdmin_RevertsIfNotAdmin() public {
        vm.expectRevert(SynodRegistry.NotAdmin.selector);
        vm.prank(stranger);
        registry.transferAdmin(stranger);
    }

    function test_RenounceAdmin_DisablesFurtherRegistration() public {
        vm.prank(admin);
        registry.transferAdmin(address(0));
        assertEq(registry.admin(), address(0));

        // After renouncing, even the previous admin can't register
        vm.expectRevert(SynodRegistry.NotAdmin.selector);
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "claude-sonnet-4-6");
    }

    function test_ConfigureSecurity() public {
        vm.expectEmit(false, false, false, true);
        emit SecurityConfigured(1 days, 1 ether, 0.1 ether);

        vm.prank(admin);
        registry.configureSecurity(1 days, 1 ether, 0.1 ether);

        assertEq(registry.challengeWindowSeconds(), 1 days);
        assertEq(registry.minSettlerBond(), 1 ether);
        assertEq(registry.minChallengeBond(), 0.1 ether);
    }

    function test_ConfigureSecurity_RevertsIfNotAdmin() public {
        vm.expectRevert(SynodRegistry.NotAdmin.selector);
        vm.prank(stranger);
        registry.configureSecurity(1 days, 1 ether, 0.1 ether);
    }

    function test_ConfigureSecurity_RevertsWindowWithoutBonds() public {
        vm.expectRevert(SynodRegistry.InvalidSecurityConfig.selector);
        vm.prank(admin);
        registry.configureSecurity(1 days, 1 ether, 0);

        vm.expectRevert(SynodRegistry.InvalidSecurityConfig.selector);
        vm.prank(admin);
        registry.configureSecurity(1 days, 0, 0.1 ether);
    }

    // --- registration ------------------------------------------------------

    function test_RegisterSettler() public {
        vm.expectEmit(true, false, false, true);
        emit SettlerRegistered(settler1, axlKey1, "claude-sonnet-4-6");
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "claude-sonnet-4-6");

        (bool registered, bytes32 axl, string memory tag, uint256 bond) =
            registry.settlers(settler1);
        assertTrue(registered);
        assertEq(axl, axlKey1);
        assertEq(tag, "claude-sonnet-4-6");
        assertEq(bond, 0);
        assertEq(registry.registeredSettlerCount(), 1);
        assertTrue(registry.registeredAxlPubKeys(axlKey1));
    }

    function test_RegisterSettler_WithInitialBond() public {
        vm.deal(admin, 1 ether);
        vm.expectEmit(true, false, false, true);
        emit SettlerBondDeposited(settler1, 1 ether, 1 ether);

        vm.prank(admin);
        registry.registerSettler{value: 1 ether}(settler1, axlKey1, "x");

        (,,, uint256 bond) = registry.settlers(settler1);
        assertEq(bond, 1 ether);
        assertEq(address(registry).balance, 1 ether);
    }

    function test_RegisterSettler_RevertsIfNotAdmin() public {
        vm.expectRevert(SynodRegistry.NotAdmin.selector);
        vm.prank(stranger);
        registry.registerSettler(settler1, axlKey1, "x");
    }

    function test_RegisterSettler_RevertsOnZeroAddress() public {
        vm.expectRevert(SynodRegistry.ZeroAddress.selector);
        vm.prank(admin);
        registry.registerSettler(address(0), axlKey1, "x");
    }

    function test_RegisterSettler_RevertsOnZeroAxlPubKey() public {
        vm.expectRevert(SynodRegistry.ZeroAxlPubKey.selector);
        vm.prank(admin);
        registry.registerSettler(settler1, bytes32(0), "x");
    }

    function test_RegisterSettler_RevertsOnDuplicate() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        vm.expectRevert(SynodRegistry.AlreadyRegistered.selector);
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
    }

    function test_RegisterSettler_RevertsOnDuplicateAxlPubKey() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        vm.expectRevert(SynodRegistry.DuplicateAxlPubKey.selector);
        vm.prank(admin);
        registry.registerSettler(settler2, axlKey1, "y");
    }

    function test_RevokeSettler() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        assertEq(registry.registeredSettlerCount(), 1);

        vm.expectEmit(true, false, false, false);
        emit SettlerRevoked(settler1);
        vm.prank(admin);
        registry.revokeSettler(settler1);

        (bool registered,,,) = registry.settlers(settler1);
        assertFalse(registered);
        assertEq(registry.registeredSettlerCount(), 0);
        assertFalse(registry.registeredAxlPubKeys(axlKey1));
    }

    function test_RevokeSettler_ReturnsBond() public {
        vm.deal(admin, 1 ether);
        vm.prank(admin);
        registry.registerSettler{value: 1 ether}(settler1, axlKey1, "x");

        uint256 before = settler1.balance;
        vm.prank(admin);
        registry.revokeSettler(settler1);

        assertEq(settler1.balance, before + 1 ether);
        assertEq(address(registry).balance, 0);
    }

    function test_RevokeSettler_RevertsIfNotRegistered() public {
        vm.expectRevert(SynodRegistry.NotRegistered.selector);
        vm.prank(admin);
        registry.revokeSettler(settler1);
    }

    function test_RevokeSettler_RevertsIfNotAdmin() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        vm.expectRevert(SynodRegistry.NotAdmin.selector);
        vm.prank(stranger);
        registry.revokeSettler(settler1);
    }

    // --- settlement recording ---------------------------------------------

    function _registerAll() internal {
        vm.startPrank(admin);
        registry.registerSettler(settler1, axlKey1, "claude-sonnet-4-6");
        registry.registerSettler(settler2, axlKey2, "gemini-2.0-flash");
        registry.registerSettler(settler3, axlKey3, "llama-3.1-70b");
        vm.stopPrank();
    }

    function _registerAllBonded() internal {
        vm.deal(admin, 3 ether);
        vm.startPrank(admin);
        registry.configureSecurity(1 days, 1 ether, 0.1 ether);
        registry.registerSettler{value: 1 ether}(settler1, axlKey1, "claude-sonnet-4-6");
        registry.registerSettler{value: 1 ether}(settler2, axlKey2, "gemini-2.0-flash");
        registry.registerSettler{value: 1 ether}(settler3, axlKey3, "llama-3.1-70b");
        vm.stopPrank();
    }

    function test_RecordSettlement() public {
        _registerAll();
        bytes memory votes = abi.encodePacked("{\"votes\": []}");

        vm.expectEmit(true, false, false, true);
        emit SettlementRecorded(QID, 1, 3, 2_750_000, settler1);

        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, votes);

        SynodRegistry.Settlement memory s = registry.getSettlement(QID);
        assertEq(s.questionId, QID);
        assertEq(s.outcome, 1);
        assertEq(s.quorumSize, 3);
        assertEq(s.weightedScoreScaled, 2_750_000);
        assertEq(s.postedBy, settler1);
        assertEq(s.timestamp, block.timestamp);
        assertEq(s.signedVotesPayload, votes);
        assertEq(s.challengeDeadline, block.timestamp);
        assertTrue(s.finalized);
        assertFalse(s.challenged);
        assertFalse(s.voided);
        assertTrue(registry.isSettled(QID));
        assertTrue(registry.isFinalized(QID));
    }

    function test_RecordSettlement_RevertsIfNotRegisteredSettler() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.NotRegisteredSettler.selector);
        vm.prank(stranger);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);
    }

    function test_RecordSettlement_RevertsIfAlreadySealed() public {
        _registerAll();
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);

        vm.expectRevert(SynodRegistry.AlreadySealed.selector);
        vm.prank(settler2);
        registry.recordSettlement(QID, 0, 3, 1_500_000, proof);
    }

    function test_RecordSettlement_RevertsOnZeroQuorum() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.InvalidQuorumSize.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 0, 0, "");
    }

    function test_RecordSettlement_RevertsOnQuorumAboveRegisteredCount() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.InvalidQuorumSize.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 4, 0, proof);
    }

    function test_RecordSettlement_RevertsOnZeroQuestionId() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.InvalidQuestionId.selector);
        vm.prank(settler1);
        registry.recordSettlement(bytes32(0), 1, 2, 0, proof);
    }

    function test_RecordSettlement_RevertsOnEmptyProofPayload() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.InvalidProofPayload.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 2, 0, "");
    }

    function test_RecordSettlement_AnyRegisteredSettlerCanPost() public {
        _registerAll();
        // settler3 posts even though it's listed last in the registry
        vm.prank(settler3);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);
        SynodRegistry.Settlement memory s = registry.getSettlement(QID);
        assertEq(s.postedBy, settler3);
    }

    function test_IsSettled_FalseUntilRecorded() public {
        _registerAll();
        assertFalse(registry.isSettled(QID));
        vm.prank(settler1);
        registry.recordSettlement(QID, 0, 2, 1_400_000, proof);
        assertTrue(registry.isSettled(QID));
    }

    function test_RecordSettlement_RevertsAfterRevocation() public {
        _registerAll();
        vm.prank(admin);
        registry.revokeSettler(settler1);

        vm.expectRevert(SynodRegistry.NotRegisteredSettler.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);
    }

    function test_RecordSettlement_RevertsBelowMinimumBond() public {
        vm.prank(admin);
        registry.configureSecurity(1 days, 1 ether, 0.1 ether);
        _registerAll();

        vm.expectRevert(SynodRegistry.InsufficientBond.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);
    }

    function test_DepositAndWithdrawBond() public {
        _registerAll();
        vm.prank(admin);
        registry.configureSecurity(0, 1 ether, 0);

        vm.deal(settler1, 2 ether);
        vm.prank(settler1);
        registry.depositBond{value: 2 ether}();
        (,,, uint256 bondAfterDeposit) = registry.settlers(settler1);
        assertEq(bondAfterDeposit, 2 ether);

        vm.prank(settler1);
        registry.withdrawBond(1 ether);
        (,,, uint256 bondAfterWithdraw) = registry.settlers(settler1);
        assertEq(bondAfterWithdraw, 1 ether);

        vm.expectRevert(SynodRegistry.InsufficientBond.selector);
        vm.prank(settler1);
        registry.withdrawBond(1 wei);
    }

    function test_FinalizeSettlementAfterChallengeWindow() public {
        _registerAllBonded();

        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);
        assertTrue(registry.isSettled(QID));
        assertFalse(registry.isFinalized(QID));

        vm.expectRevert(SynodRegistry.ChallengeWindowOpen.selector);
        registry.finalizeSettlement(QID);

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectEmit(true, false, false, false);
        emit SettlementFinalized(QID);
        registry.finalizeSettlement(QID);
        assertTrue(registry.isFinalized(QID));
    }

    function test_ChallengeSettlement_ResolveSustainedSlashesPosterAndReopens() public {
        _registerAllBonded();
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);

        bytes32 evidence = keccak256("bad-proof-report");
        vm.deal(stranger, 1 ether);
        uint256 before = stranger.balance;
        vm.expectEmit(true, true, false, true);
        emit SettlementChallenged(QID, stranger, evidence, 0.1 ether, "bad proof");
        vm.prank(stranger);
        registry.challengeSettlement{value: 0.1 ether}(QID, evidence, "bad proof");

        vm.expectEmit(true, true, false, true);
        emit ChallengeResolved(QID, true, stranger, 1.1 ether);
        vm.prank(admin);
        registry.resolveChallenge(QID, true, payable(address(0)));

        assertEq(stranger.balance, before + 1 ether);
        assertFalse(registry.isSettled(QID));
        assertFalse(registry.isFinalized(QID));
        assertEq(registry.totalSlashedBond(), 1 ether);
        (,,, uint256 settler1Bond) = registry.settlers(settler1);
        assertEq(settler1Bond, 0);

        vm.prank(settler2);
        registry.recordSettlement(QID, 0, 2, 1_900_000, proof);
        assertTrue(registry.isSettled(QID));
    }

    function test_ChallengeSettlement_ResolveRejectedFinalizesAndPaysPoster() public {
        _registerAllBonded();
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        registry.challengeSettlement{value: 0.1 ether}(QID, keccak256("weak"), "weak");

        uint256 before = settler1.balance;
        vm.prank(admin);
        registry.resolveChallenge(QID, false, payable(address(0)));

        assertEq(settler1.balance, before + 0.1 ether);
        assertTrue(registry.isSettled(QID));
        assertTrue(registry.isFinalized(QID));
    }

    function test_ChallengeSettlement_RevertsAfterWindow() public {
        _registerAllBonded();
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, proof);

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(SynodRegistry.ChallengeWindowClosed.selector);
        registry.challengeSettlement{value: 0.1 ether}(QID, keccak256("late"), "late");
    }

    function test_ResolveChallenge_BlocksReentrantRepost() public {
        ReentrantChallenger attacker = new ReentrantChallenger(registry, QID, proof);
        vm.deal(admin, 3 ether);
        vm.startPrank(admin);
        registry.configureSecurity(1 days, 1 ether, 0.1 ether);
        registry.registerSettler{value: 1 ether}(settler1, axlKey1, "poster");
        registry.registerSettler{value: 1 ether}(settler2, axlKey2, "backup");
        registry.registerSettler{value: 1 ether}(address(attacker), axlKey3, "attacker");
        vm.stopPrank();

        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 2, 2_000_000, proof);

        vm.deal(address(attacker), 0.1 ether);
        attacker.challenge{value: 0.1 ether}();

        vm.prank(admin);
        registry.resolveChallenge(QID, true, payable(address(0)));

        assertTrue(attacker.attempted());
        assertFalse(attacker.succeeded());
        assertFalse(registry.isSettled(QID));
    }

    // --- fuzz --------------------------------------------------------------

    function testFuzz_RecordSettlement(
        bytes32 qid,
        uint8 outcome,
        uint256 quorum,
        uint256 score
    ) public {
        vm.assume(quorum > 0);
        vm.assume(quorum <= 3);
        vm.assume(qid != bytes32(0));
        _registerAll();
        vm.prank(settler1);
        registry.recordSettlement(qid, outcome, quorum, score, proof);
        SynodRegistry.Settlement memory s = registry.getSettlement(qid);
        assertEq(s.outcome, outcome);
        assertEq(s.quorumSize, quorum);
        assertEq(s.weightedScoreScaled, score);
    }
}

contract ReentrantChallenger {
    SynodRegistry internal immutable registry;
    bytes32 internal immutable qid;
    bytes internal proof;
    bool public attempted;
    bool public succeeded;

    constructor(SynodRegistry registry_, bytes32 qid_, bytes memory proof_) {
        registry = registry_;
        qid = qid_;
        proof = proof_;
    }

    function challenge() external payable {
        registry.challengeSettlement{value: msg.value}(qid, keccak256("reentrant"), "reentrant");
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try registry.recordSettlement(qid, 0, 2, 1_900_000, proof) {
            succeeded = true;
        } catch {
            succeeded = false;
        }
    }
}

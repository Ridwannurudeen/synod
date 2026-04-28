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

    // --- registration ------------------------------------------------------

    function test_RegisterSettler() public {
        vm.expectEmit(true, false, false, true);
        emit SettlerRegistered(settler1, axlKey1, "claude-sonnet-4-6");
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "claude-sonnet-4-6");

        (bool registered, bytes32 axl, string memory tag) = registry.settlers(settler1);
        assertTrue(registered);
        assertEq(axl, axlKey1);
        assertEq(tag, "claude-sonnet-4-6");
        assertEq(registry.registeredSettlerCount(), 1);
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

    function test_RegisterSettler_RevertsOnDuplicate() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        vm.expectRevert(SynodRegistry.AlreadyRegistered.selector);
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
    }

    function test_RevokeSettler() public {
        vm.prank(admin);
        registry.registerSettler(settler1, axlKey1, "x");
        assertEq(registry.registeredSettlerCount(), 1);

        vm.expectEmit(true, false, false, false);
        emit SettlerRevoked(settler1);
        vm.prank(admin);
        registry.revokeSettler(settler1);

        (bool registered,,) = registry.settlers(settler1);
        assertFalse(registered);
        assertEq(registry.registeredSettlerCount(), 0);
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
        assertTrue(registry.isSettled(QID));
    }

    function test_RecordSettlement_RevertsIfNotRegisteredSettler() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.NotRegisteredSettler.selector);
        vm.prank(stranger);
        registry.recordSettlement(QID, 1, 3, 2_750_000, "");
    }

    function test_RecordSettlement_RevertsIfAlreadySealed() public {
        _registerAll();
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, "");

        vm.expectRevert(SynodRegistry.AlreadySealed.selector);
        vm.prank(settler2);
        registry.recordSettlement(QID, 0, 3, 1_500_000, "");
    }

    function test_RecordSettlement_RevertsOnZeroQuorum() public {
        _registerAll();
        vm.expectRevert(SynodRegistry.InvalidQuorumSize.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 0, 0, "");
    }

    function test_RecordSettlement_AnyRegisteredSettlerCanPost() public {
        _registerAll();
        // settler3 posts even though it's listed last in the registry
        vm.prank(settler3);
        registry.recordSettlement(QID, 1, 3, 2_750_000, "");
        SynodRegistry.Settlement memory s = registry.getSettlement(QID);
        assertEq(s.postedBy, settler3);
    }

    function test_IsSettled_FalseUntilRecorded() public {
        _registerAll();
        assertFalse(registry.isSettled(QID));
        vm.prank(settler1);
        registry.recordSettlement(QID, 0, 2, 1_400_000, "");
        assertTrue(registry.isSettled(QID));
    }

    function test_RecordSettlement_RevertsAfterRevocation() public {
        _registerAll();
        vm.prank(admin);
        registry.revokeSettler(settler1);

        vm.expectRevert(SynodRegistry.NotRegisteredSettler.selector);
        vm.prank(settler1);
        registry.recordSettlement(QID, 1, 3, 2_750_000, "");
    }

    // --- fuzz --------------------------------------------------------------

    function testFuzz_RecordSettlement(
        bytes32 qid,
        uint8 outcome,
        uint256 quorum,
        uint256 score
    ) public {
        vm.assume(quorum > 0);
        _registerAll();
        vm.prank(settler1);
        registry.recordSettlement(qid, outcome, quorum, score, "");
        SynodRegistry.Settlement memory s = registry.getSettlement(qid);
        assertEq(s.outcome, outcome);
        assertEq(s.quorumSize, quorum);
        assertEq(s.weightedScoreScaled, score);
    }
}

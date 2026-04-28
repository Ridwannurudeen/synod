// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {SynodRegistry} from "../src/SynodRegistry.sol";

/// @notice Deploy SynodRegistry to Gensyn L2 mainnet.
///
/// Usage:
///   export GENSYN_MAINNET_RPC="https://gensyn-mainnet.g.alchemy.com/v2/<key>"
///   export DEPLOYER_PRIVATE_KEY="0x..."
///   export SYNOD_ADMIN="0x..."   # admin address; defaults to deployer if unset
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url gensyn_mainnet --broadcast --verify
contract Deploy is Script {
    function run() external returns (SynodRegistry registry) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address admin = vm.envOr("SYNOD_ADMIN", deployer);

        console.log("deployer:", deployer);
        console.log("admin:", admin);
        console.log("chainId:", block.chainid);

        vm.startBroadcast(pk);
        registry = new SynodRegistry(admin);
        vm.stopBroadcast();

        console.log("SynodRegistry:", address(registry));
    }
}

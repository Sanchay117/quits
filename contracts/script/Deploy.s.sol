// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";

/// @title Deploy the Quits clearing house
/// @notice Deploys ClearingHouse for Arc's USDC (native coin with its ERC-20 view at 0x3600...0000) and the
///         network's EURC.
/// @dev The deployer key is passed on the command line and never read by this script. Arc drops transactions priced
///      under its 20 gwei base fee floor, so always pass explicit fees. From contracts/:
///
///        # Dry run: simulates and prints the estimated cost, sends nothing
///        forge script script/Deploy.s.sol --rpc-url arc_testnet --private-key $KEY \
///          --with-gas-price 25gwei --priority-gas-price 1gwei
///        # Send it: add --broadcast (and on mainnet, CONFIRM_MAINNET=yes in the environment)
///
///      EURC is fixed for Arc mainnet (5042) and testnet (5042002). On any other chain (e.g. a local anvil prepared
///      with the mocks), set the EURC environment variable to its address.
contract Deploy is Script {
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    address public constant EURC_MAINNET = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address public constant EURC_TESTNET = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    uint256 public constant ARC_MAINNET = 5042;
    uint256 public constant ARC_TESTNET = 5_042_002;

    function run() external returns (ClearingHouse house) {
        address eurc = eurcFor(block.chainid);
        _requireCode(USDC, "USDC");
        _requireCode(eurc, "EURC");
        _requireMainnetConfirmation();

        address[] memory otherTokens = new address[](1);
        otherTokens[0] = eurc;

        vm.startBroadcast();
        house = new ClearingHouse(USDC, otherTokens);
        vm.stopBroadcast();

        console.log("ClearingHouse deployed at", address(house));
        console.log("Chain id", block.chainid);
        console.log("USDC", USDC);
        console.log("EURC", eurc);
    }

    /// @notice The EURC address for `chainId`: Circle's deployment on Arc, otherwise the EURC environment variable.
    function eurcFor(uint256 chainId) public view returns (address eurc) {
        if (chainId == ARC_MAINNET) return EURC_MAINNET;
        if (chainId == ARC_TESTNET) return EURC_TESTNET;
        eurc = vm.envOr("EURC", address(0));
        require(eurc != address(0), string.concat("Set EURC to the EURC address for chain id ", vm.toString(chainId)));
    }

    function _requireCode(address token, string memory label) private view {
        require(token.code.length != 0, string.concat(label, " has no code at ", vm.toString(token)));
    }

    /// @dev A mainnet broadcast spends real USDC on gas, so it needs an explicit confirmation on top of --broadcast.
    function _requireMainnetConfirmation() private view {
        if (block.chainid != ARC_MAINNET || !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        require(
            keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("yes"),
            "Mainnet broadcast spends real USDC: rerun with CONFIRM_MAINNET=yes"
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";
import {MockArcUSDC} from "../src/mocks/MockArcUSDC.sol";
import {MockFiatToken} from "../src/mocks/MockFiatToken.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice The deploy script picks the right tokens per network and refuses to deploy against missing contracts.
contract DeployScriptTest is Test {
    Deploy private script;

    function setUp() public {
        script = new Deploy();
        vm.etch(script.USDC(), type(MockArcUSDC).runtimeCode);
    }

    function test_run_onArcMainnetUsesMainnetEurc() public {
        vm.chainId(5042);
        vm.etch(script.EURC_MAINNET(), type(MockArcUSDC).runtimeCode);
        _assertTokens(script.run(), script.EURC_MAINNET());
    }

    function test_run_onArcTestnetUsesTestnetEurc() public {
        vm.chainId(5_042_002);
        vm.etch(script.EURC_TESTNET(), type(MockArcUSDC).runtimeCode);
        _assertTokens(script.run(), script.EURC_TESTNET());
    }

    function test_run_elsewhereReadsEurcFromEnvironment() public {
        vm.chainId(31_337);
        address localEurc = address(new MockFiatToken("EURC", "EURC"));
        // Only this test reads EURC from the environment, so setting it here cannot leak into another test.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.setEnv("EURC", vm.toString(localEurc));
        _assertTokens(script.run(), localEurc);
    }

    function test_run_revertsWhenEurcHasNoCode() public {
        vm.chainId(5_042_002);
        vm.expectRevert(bytes(string.concat("EURC has no code at ", vm.toString(script.EURC_TESTNET()))));
        script.run();
    }

    function test_run_revertsWhenUsdcHasNoCode() public {
        vm.chainId(5_042_002);
        vm.etch(script.USDC(), "");
        vm.expectRevert(bytes(string.concat("USDC has no code at ", vm.toString(script.USDC()))));
        script.run();
    }

    function _assertTokens(ClearingHouse house, address eurc) private view {
        address[] memory tokens = house.supportedTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], script.USDC());
        assertEq(tokens[1], eurc);
        assertEq(house.usdc(), script.USDC());
    }
}

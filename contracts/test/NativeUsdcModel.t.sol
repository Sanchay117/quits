// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";
import {NativeUSDCHarness} from "./mocks/NativeUSDCHarness.sol";

/// @notice Arc's USDC model: the native coin and the ERC-20 view at 0x3600 are one balance. With the harness in place,
///         USDC deposited through the ERC-20 path and USDC withdrawn as native value must keep the ledger, the
///         clearing house's native holdings and the ERC-20 view in agreement.
contract NativeUsdcModelTest is ClearingHouseFixture {
    NativeUSDCHarness private usdcView;

    function _installUsdc() internal override {
        vm.etch(USDC, type(NativeUSDCHarness).runtimeCode);
        usdcView = NativeUSDCHarness(USDC);
    }

    function test_harness_balanceIsNativeBalanceInSixDecimals() public {
        vm.deal(alice, 5 ether + 7);
        assertEq(usdcView.balanceOf(alice), 5e6);
    }

    function test_harness_transferMovesNativeValue() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        usdcView.transfer(bob, 2e6);
        assertEq(alice.balance, 3 ether);
        assertEq(bob.balance, 2 ether);
    }

    function test_depositToken_usdcThroughErc20MovesNativeValue() public {
        vm.deal(alice, 10 ether);
        vm.startPrank(alice);
        usdcView.approve(address(house), 4e6);
        house.depositToken(USDC, 4e6);
        vm.stopPrank();

        assertEq(house.balanceOf(alice, USDC), 4e6);
        assertEq(address(house).balance, 4 ether);
        assertEq(usdcView.balanceOf(address(house)), 4e6);
        assertEq(alice.balance, 6 ether);
    }

    function test_nativeAndErc20DepositsShareOneLedger() public {
        vm.deal(alice, 10 ether);
        vm.startPrank(alice);
        house.deposit{value: 3 ether}();
        usdcView.approve(address(house), 2e6);
        house.depositToken(USDC, 2e6);
        vm.stopPrank();

        assertEq(house.balanceOf(alice, USDC), 5e6);
        assertEq(address(house).balance, 5 ether);

        vm.prank(alice);
        house.withdraw(USDC, 5e6, alice);
        assertEq(alice.balance, 10 ether);
        assertEq(address(house).balance, 0);
        assertEq(house.balanceOf(alice, USDC), 0);
    }

    function test_settledErc20DepositWithdrawsAsNativeValue() public {
        uint256 id = _owe(alice, bob, 7e6);
        vm.deal(alice, 7 ether);
        vm.startPrank(alice);
        usdcView.approve(address(house), 7e6);
        house.depositToken(USDC, 7e6);
        vm.stopPrank();

        _settle(USDC, _uints(id), _uints(7e6));
        vm.prank(bob);
        house.withdraw(USDC, 7e6, bob);

        assertEq(bob.balance, 7 ether);
        assertEq(usdcView.balanceOf(bob), 7e6);
        assertEq(address(house).balance, 0);
        assertEq(house.balanceOf(alice, USDC) + house.balanceOf(bob, USDC), 0);
    }

    function test_depositToken_usdcRevertsForBlockedMember() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        usdcView.approve(address(house), 1e6);
        _block(USDC, alice);

        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.depositToken(USDC, 1e6);
    }

    function testFuzz_mixedDepositPathsKeepNativeBackingExact(
        uint64 nativeUnits,
        uint64 erc20Units,
        uint64 withdrawUnits
    ) public {
        uint256 viaNative = bound(nativeUnits, 1, 1e12);
        uint256 viaErc20 = bound(erc20Units, 1, 1e12);
        uint256 total = viaNative + viaErc20;
        uint256 withdrawn = bound(withdrawUnits, 1, total);
        vm.deal(alice, total * NATIVE_SCALE);

        vm.startPrank(alice);
        house.deposit{value: viaNative * NATIVE_SCALE}();
        usdcView.approve(address(house), viaErc20);
        house.depositToken(USDC, viaErc20);
        house.withdraw(USDC, withdrawn, alice);
        vm.stopPrank();

        uint256 ledger = house.balanceOf(alice, USDC);
        assertEq(ledger, total - withdrawn);
        assertEq(address(house).balance, ledger * NATIVE_SCALE);
        assertEq(usdcView.balanceOf(address(house)), ledger);
        assertEq(alice.balance, withdrawn * NATIVE_SCALE);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";
import {NativeRejecter, ReentrantReceiver} from "./utils/Helpers.sol";

/// @notice Deposits and withdrawals: native USDC, ERC-20 EURC, EIP-2612 permits and the reentrancy guard.
contract DepositsTest is ClearingHouseFixture {
    // ---------------------------------------------------------------------------------------------------------------
    // deposit (native USDC)
    // ---------------------------------------------------------------------------------------------------------------

    function test_deposit_creditsSixDecimalUnits() public {
        vm.deal(alice, 3 ether);
        vm.expectEmit(address(house));
        emit ClearingHouse.Deposited(alice, USDC, 2.5e6);
        vm.prank(alice);
        house.deposit{value: 2.5 ether}();

        assertEq(house.balanceOf(alice, USDC), 2.5e6);
        assertEq(address(house).balance, 2.5 ether);
        assertEq(alice.balance, 0.5 ether);
    }

    function test_deposit_acceptsOneUnit() public {
        vm.deal(alice, NATIVE_SCALE);
        vm.prank(alice);
        house.deposit{value: NATIVE_SCALE}();
        assertEq(house.balanceOf(alice, USDC), 1);
    }

    function test_deposit_revertsOnZeroValue() public {
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.deposit{value: 0}();
    }

    function test_deposit_revertsOnDustBelowOneUnit() public {
        vm.deal(alice, 1 ether);
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.deposit{value: NATIVE_SCALE - 1}();
    }

    function test_deposit_revertsOnValueNotMultipleOfScale() public {
        vm.deal(alice, 1 ether);
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.deposit{value: 5 * NATIVE_SCALE + 1}();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // depositToken
    // ---------------------------------------------------------------------------------------------------------------

    function test_depositToken_pullsWithAllowance() public {
        eurc.mint(alice, 50e6);
        vm.startPrank(alice);
        eurc.approve(address(house), 30e6);
        vm.expectEmit(address(house));
        emit ClearingHouse.Deposited(alice, address(eurc), 30e6);
        house.depositToken(address(eurc), 30e6);
        vm.stopPrank();

        assertEq(house.balanceOf(alice, address(eurc)), 30e6);
        assertEq(eurc.balanceOf(address(house)), 30e6);
        assertEq(eurc.balanceOf(alice), 20e6);
        assertEq(eurc.allowance(alice, address(house)), 0);
    }

    function test_depositToken_revertsOnUnsupportedToken() public {
        address other = makeAddr("otherToken");
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, other));
        vm.prank(alice);
        house.depositToken(other, 1e6);
    }

    function test_depositToken_revertsOnZeroAmount() public {
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.depositToken(address(eurc), 0);
    }

    function test_depositToken_revertsWithoutAllowance() public {
        eurc.mint(alice, 10e6);
        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.depositToken(address(eurc), 10e6);
    }

    function test_depositToken_revertsWhenBalanceTooLow() public {
        eurc.mint(alice, 5e6);
        vm.startPrank(alice);
        eurc.approve(address(house), 10e6);
        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        house.depositToken(address(eurc), 10e6);
        vm.stopPrank();
    }

    function test_depositToken_revertsWhenDepositorBlocked() public {
        eurc.mint(alice, 10e6);
        vm.prank(alice);
        eurc.approve(address(house), 10e6);
        _block(address(eurc), alice);

        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.depositToken(address(eurc), 10e6);
    }

    /// @dev The local USDC double has no ERC-20 transfers; on Arc this path works (see NativeUsdcModel.t.sol).
    function test_depositToken_usdcFailsOnLocalDouble() public {
        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.depositToken(USDC, 1e6);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // depositWithPermit
    // ---------------------------------------------------------------------------------------------------------------

    function test_depositWithPermit_depositsInOneCall() public {
        eurc.mint(alice, 25e6);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(aliceKey, 25e6, block.timestamp + 1 hours);

        vm.prank(alice);
        house.depositWithPermit(address(eurc), 25e6, block.timestamp + 1 hours, v, r, s);

        assertEq(house.balanceOf(alice, address(eurc)), 25e6);
        assertEq(eurc.balanceOf(address(house)), 25e6);
        assertEq(eurc.nonces(alice), 1);
    }

    /// @dev Anyone can copy a permit from the mempool and submit it first. The deposit must still go through.
    function test_depositWithPermit_survivesFrontRunPermit() public {
        eurc.mint(alice, 25e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(aliceKey, 25e6, deadline);

        vm.prank(makeAddr("frontRunner"));
        eurc.permit(alice, address(house), 25e6, deadline, v, r, s);

        vm.prank(alice);
        house.depositWithPermit(address(eurc), 25e6, deadline, v, r, s);
        assertEq(house.balanceOf(alice, address(eurc)), 25e6);
    }

    function test_depositWithPermit_usesExistingAllowanceWhenPermitInvalid() public {
        eurc.mint(alice, 10e6);
        vm.prank(alice);
        eurc.approve(address(house), 10e6);

        vm.prank(alice);
        house.depositWithPermit(address(eurc), 10e6, block.timestamp, 27, bytes32(0), bytes32(0));
        assertEq(house.balanceOf(alice, address(eurc)), 10e6);
    }

    function test_depositWithPermit_revertsWhenPermitInvalidAndNoAllowance() public {
        eurc.mint(alice, 10e6);
        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.depositWithPermit(address(eurc), 10e6, block.timestamp, 27, bytes32(0), bytes32(0));
    }

    function test_depositWithPermit_revertsWhenSignedBySomeoneElse() public {
        eurc.mint(bob, 10e6);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(aliceKey, 10e6, block.timestamp);
        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(bob);
        house.depositWithPermit(address(eurc), 10e6, block.timestamp, v, r, s);
    }

    function test_depositWithPermit_revertsOnUnsupportedTokenContract() public {
        address other = address(new NativeRejecter());
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, other));
        vm.prank(alice);
        house.depositWithPermit(other, 1e6, block.timestamp, 27, bytes32(0), bytes32(0));
    }

    function test_depositWithPermit_revertsOnZeroAmount() public {
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.depositWithPermit(address(eurc), 0, block.timestamp, 27, bytes32(0), bytes32(0));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // withdraw
    // ---------------------------------------------------------------------------------------------------------------

    function test_withdraw_usdcLeavesAsNativeValue() public {
        _depositUsdc(alice, 10e6);
        address payee = makeAddr("payee");

        vm.expectEmit(address(house));
        emit ClearingHouse.Withdrawn(alice, USDC, 4e6, payee);
        vm.prank(alice);
        house.withdraw(USDC, 4e6, payee);

        assertEq(payee.balance, 4e6 * NATIVE_SCALE);
        assertEq(house.balanceOf(alice, USDC), 6e6);
        assertEq(address(house).balance, 6e6 * NATIVE_SCALE);
    }

    function test_withdraw_eurcLeavesAsErc20() public {
        _depositEurc(alice, 10e6);
        address payee = makeAddr("payee");

        vm.expectEmit(address(house));
        emit ClearingHouse.Withdrawn(alice, address(eurc), 10e6, payee);
        vm.prank(alice);
        house.withdraw(address(eurc), 10e6, payee);

        assertEq(eurc.balanceOf(payee), 10e6);
        assertEq(eurc.balanceOf(address(house)), 0);
        assertEq(house.balanceOf(alice, address(eurc)), 0);
    }

    function test_withdraw_revertsOnZeroAmount() public {
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(alice);
        house.withdraw(USDC, 0, alice);
    }

    function test_withdraw_revertsOnZeroRecipient() public {
        _depositUsdc(alice, 1e6);
        vm.expectRevert(ClearingHouse.BadCounterparty.selector);
        vm.prank(alice);
        house.withdraw(USDC, 1e6, address(0));
    }

    function test_withdraw_revertsAboveBalance() public {
        _depositUsdc(alice, 3e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.InsufficientBalance.selector, 3e6, 3e6 + 1));
        vm.prank(alice);
        house.withdraw(USDC, 3e6 + 1, alice);
    }

    function test_withdraw_cannotSpendAnotherMembersDeposit() public {
        _depositUsdc(alice, 3e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.InsufficientBalance.selector, 0, 1));
        vm.prank(bob);
        house.withdraw(USDC, 1, bob);
    }

    function test_withdraw_revertsAndKeepsBalanceWhenRecipientRejectsValue() public {
        _depositUsdc(alice, 3e6);
        address rejecter = address(new NativeRejecter());

        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.withdraw(USDC, 3e6, rejecter);

        assertEq(house.balanceOf(alice, USDC), 3e6);
        assertEq(address(house).balance, 3e6 * NATIVE_SCALE);
    }

    function test_withdraw_eurcRevertsWhenRecipientBlocked() public {
        _depositEurc(alice, 5e6);
        address payee = makeAddr("payee");
        _block(address(eurc), payee);

        vm.expectRevert(ClearingHouse.TransferFailed.selector);
        vm.prank(alice);
        house.withdraw(address(eurc), 5e6, payee);
        assertEq(house.balanceOf(alice, address(eurc)), 5e6);
    }

    function test_withdraw_guardsAgainstReentry() public {
        ReentrantReceiver receiver = new ReentrantReceiver(house);
        _depositUsdc(address(receiver), 2e6);

        receiver.withdrawFromHouse(1e6);

        assertEq(receiver.reentryError(), abi.encodeWithSelector(ClearingHouse.Reentrancy.selector));
        assertEq(house.balanceOf(address(receiver), USDC), 1e6);
        assertEq(address(receiver).balance, 1e6 * NATIVE_SCALE);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    function _signPermit(uint256 ownerKey, uint256 value, uint256 deadline)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address owner = vm.addr(ownerKey);
        bytes32 structHash =
            keccak256(abi.encode(eurc.PERMIT_TYPEHASH(), owner, address(house), value, eurc.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", eurc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(ownerKey, digest);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Issues found by the test suite during development, kept as regression tests after the fixes.
contract RegressionsTest is ClearingHouseFixture {
    /// @dev Blocklist bypass (medium): FiatToken's transfer checks only its caller (the clearing house) and the
    ///      recipient, so without a check in withdraw() a member blocklisted after depositing could move its deposit to a
    ///      fresh address. withdraw() now applies the same blocklist rule as settle().
    function test_blockedMemberCannotWithdrawEurcToCleanAddress() public {
        _depositEurc(alice, 100e6);
        _block(address(eurc), alice);
        address cleanAddress = makeAddr("cleanAddress");

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, alice));
        vm.prank(alice);
        house.withdraw(address(eurc), 100e6, cleanAddress);
    }

    /// @dev Same rule for a member on USDC's (chain-level) blocklist withdrawing native value.
    function test_usdcBlockedMemberCannotWithdraw() public {
        _depositUsdc(alice, 100e6);
        _block(USDC, alice);
        address cleanAddress = makeAddr("cleanAddress");

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, alice));
        vm.prank(alice);
        house.withdraw(USDC, 100e6, cleanAddress);
    }

    /// @dev A member blocked on USDC cannot withdraw EURC either: USDC's blocklist is Arc's chain-level list.
    function test_usdcBlockedMemberCannotWithdrawEurc() public {
        _depositEurc(alice, 100e6);
        _block(USDC, alice);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, alice));
        vm.prank(alice);
        house.withdraw(address(eurc), 100e6, alice);
    }

    /// @dev Pagination overflow (low): asking for "everything" must clip, not overflow.
    function test_getInvoicesWithHugeCountReturnsAll() public {
        _issue(bob, alice, USDC, 1e6, 0);
        _issue(bob, alice, USDC, 2e6, 0);
        assertEq(house.getInvoices(1, type(uint256).max).length, 2);
        assertEq(house.getInvoices(2, type(uint256).max).length, 1);
    }

    function test_getCyclesWithHugeCountReturnsAll() public {
        for (uint256 i; i < 2; ++i) {
            uint256 a = _owe(alice, bob, 1e6);
            uint256 b = _owe(bob, alice, 1e6);
            _settle(USDC, _uints(a, b), _uints(1e6, 1e6));
        }
        assertEq(house.getCycles(0, type(uint256).max).length, 2);
        assertEq(house.getCycles(1, type(uint256).max).length, 1);
    }

    /// @dev Error reporting (low): an unsupported token must fail with UnsupportedToken before permit() is attempted.
    function test_depositWithPermitReportsUnsupportedToken() public {
        address noCode = makeAddr("notAToken");
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, noCode));
        vm.prank(alice);
        house.depositWithPermit(noCode, 1e6, block.timestamp, 27, bytes32(0), bytes32(0));
    }
}

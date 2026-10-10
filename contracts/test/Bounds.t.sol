// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice The narrowing casts in ClearingHouse at their limits: invoice amounts are capped at type(uint96).max at
///         issue time and a cycle holds at most MAX_BATCH (256) invoices, so a cycle's gross is below
///         256 * 2^96 = 2^104. These tests settle the largest cycles those rules allow and check every total is exact.
contract BoundsTest is ClearingHouseFixture {
    uint256 private constant MAX_AMOUNT = type(uint96).max;

    /// @dev 256 invoices of the largest amount, alternating direction between two members: the cycle's gross is the
    ///      largest a cycle can reach and must survive the uint128 cast in Cycle and the int256 nets unchanged.
    function test_largestGrossKeepsExactTotals() public {
        uint256 size = house.MAX_BATCH();
        uint256[] memory ids = new uint256[](size);
        uint256[] memory amounts = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            ids[i] = i % 2 == 0 ? _owe(alice, bob, MAX_AMOUNT) : _owe(bob, alice, MAX_AMOUNT);
            amounts[i] = MAX_AMOUNT;
        }

        uint256 cycleId = _settle(USDC, ids, amounts);

        ClearingHouse.Cycle memory cycle = house.getCycle(cycleId);
        assertEq(cycle.grossCleared, size * MAX_AMOUNT);
        assertEq(cycle.cashMoved, 0);
        assertEq(cycle.invoiceCount, size);
        assertEq(cycle.memberCount, 2);
        assertEq(house.totalCleared(USDC), size * MAX_AMOUNT);
    }

    /// @dev The largest single net payment a cycle can produce (255 invoices of the largest amount, 1 unit back) moves
    ///      exactly, and withdrawing it scales to 18-decimal native value without overflow.
    function test_largestNetPaymentAndWithdrawalAreExact() public {
        uint256 size = house.MAX_BATCH();
        uint256[] memory ids = new uint256[](size);
        uint256[] memory amounts = new uint256[](size);
        for (uint256 i; i < size - 1; ++i) {
            ids[i] = _owe(alice, bob, MAX_AMOUNT);
            amounts[i] = MAX_AMOUNT;
        }
        ids[size - 1] = _owe(bob, alice, 1);
        amounts[size - 1] = 1;
        uint256 owed = (size - 1) * MAX_AMOUNT - 1;
        _depositUsdc(alice, owed + 1);

        uint256 cycleId = _settle(USDC, ids, amounts);

        assertEq(house.balanceOf(alice, USDC), 1);
        assertEq(house.balanceOf(bob, USDC), owed);
        assertEq(house.getCycle(cycleId).cashMoved, owed);
        vm.prank(bob);
        house.withdraw(USDC, owed, bob);
        assertEq(bob.balance, owed * NATIVE_SCALE);
        assertEq(address(house).balance, NATIVE_SCALE);
    }

    /// @dev Partial clears of the largest invoice leave the exact remainder in the uint96 outstanding field.
    function test_partialClearOfLargestInvoiceKeepsExactRemainder() public {
        uint256 id = _owe(alice, bob, MAX_AMOUNT);
        _depositUsdc(alice, 1);

        _settle(USDC, _uints(id), _uints(1));

        ClearingHouse.Invoice memory inv = house.getInvoice(id);
        assertEq(inv.outstanding, MAX_AMOUNT - 1);
        assertEq(uint8(inv.status), uint8(ClearingHouse.Status.Open));
    }
}

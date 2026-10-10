// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {stdError} from "forge-std/StdError.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Constructor rules, read views and pagination edges.
contract ViewsTest is ClearingHouseFixture {
    // ---------------------------------------------------------------------------------------------------------------
    // Constructor and configuration
    // ---------------------------------------------------------------------------------------------------------------

    function test_constructor_supportsUsdcThenOtherTokens() public view {
        address[] memory tokens = house.supportedTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], USDC);
        assertEq(tokens[1], address(eurc));
        assertEq(house.usdc(), USDC);
        assertTrue(house.isSupported(USDC));
        assertTrue(house.isSupported(address(eurc)));
        assertFalse(house.isSupported(address(0)));
    }

    function test_constructor_exposesConstants() public view {
        assertEq(house.NATIVE_SCALE(), 1e12);
        assertEq(house.MAX_BATCH(), 256);
        assertEq(house.MAX_MEMO(), 140);
        assertEq(house.MAX_NAME(), 48);
    }

    function test_constructor_revertsOnZeroUsdc() public {
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, address(0)));
        new ClearingHouse(address(0), new address[](0));
    }

    function test_constructor_revertsOnZeroOtherToken() public {
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, address(0)));
        new ClearingHouse(USDC, _addresses(address(0)));
    }

    function test_constructor_revertsOnDuplicateToken() public {
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, USDC));
        new ClearingHouse(USDC, _addresses(USDC));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Members and balances
    // ---------------------------------------------------------------------------------------------------------------

    function test_members_listsInRegistrationOrder() public {
        vm.prank(carol);
        house.register("Carol");
        vm.prank(alice);
        house.register("Alice");

        address[] memory list = house.members();
        assertEq(list.length, 2);
        assertEq(list[0], carol);
        assertEq(list[1], alice);
        assertEq(house.memberCount(), 2);
        assertFalse(house.isMember(bob));
        assertEq(house.nameOf(bob), "");
    }

    function test_balancesOf_returnsOneEntryPerMember() public {
        _depositUsdc(alice, 3e6);
        _depositUsdc(carol, 7e6);
        _depositEurc(bob, 2e6);

        uint256[] memory usdcBalances = house.balancesOf(_addresses(alice, bob, carol), USDC);
        assertEq(usdcBalances.length, 3);
        assertEq(usdcBalances[0], 3e6);
        assertEq(usdcBalances[1], 0);
        assertEq(usdcBalances[2], 7e6);
        assertEq(house.balancesOf(_addresses(alice, bob, carol), address(eurc))[1], 2e6);
        assertEq(house.balancesOf(new address[](0), USDC).length, 0);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Invoices
    // ---------------------------------------------------------------------------------------------------------------

    function test_getInvoice_unknownIdIsEmpty() public view {
        ClearingHouse.Invoice memory inv = house.getInvoice(99);
        assertEq(uint8(inv.status), uint8(ClearingHouse.Status.None));
        assertEq(inv.creditor, address(0));
        assertEq(inv.amount, 0);
    }

    function test_getInvoices_emptyBeforeAnyInvoice() public view {
        assertEq(house.getInvoices(0, 10).length, 0);
        assertEq(house.getInvoices(1, 10).length, 0);
    }

    function test_getInvoices_pagesThroughEveryInvoice() public {
        _issueMany(5);
        ClearingHouse.Invoice[] memory page = house.getInvoices(2, 3);
        assertEq(page.length, 3);
        assertEq(page[0].amount, 2);
        assertEq(page[2].amount, 4);
    }

    function test_getInvoices_fromIdZeroStartsAtOne() public {
        _issueMany(3);
        ClearingHouse.Invoice[] memory page = house.getInvoices(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].amount, 1);
        assertEq(page[1].amount, 2);
    }

    function test_getInvoices_clipsAtLastInvoice() public {
        _issueMany(5);
        ClearingHouse.Invoice[] memory page = house.getInvoices(4, 150);
        assertEq(page.length, 2);
        assertEq(page[0].amount, 4);
        assertEq(page[1].amount, 5);
    }

    function test_getInvoices_singleLastInvoice() public {
        _issueMany(5);
        ClearingHouse.Invoice[] memory page = house.getInvoices(5, 1);
        assertEq(page.length, 1);
        assertEq(page[0].amount, 5);
    }

    function test_getInvoices_zeroCountIsEmpty() public {
        _issueMany(3);
        assertEq(house.getInvoices(1, 0).length, 0);
        assertEq(house.getInvoices(0, 0).length, 0);
    }

    function test_getInvoices_startPastEndIsEmpty() public {
        _issueMany(3);
        assertEq(house.getInvoices(4, 10).length, 0);
        assertEq(house.getInvoices(type(uint256).max, 1).length, 0);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Cycles
    // ---------------------------------------------------------------------------------------------------------------

    function test_getCycles_emptyBeforeAnyCycle() public view {
        assertEq(house.cycleCount(), 0);
        assertEq(house.getCycles(0, 10).length, 0);
    }

    function test_getCycles_pagesAndClips() public {
        _settleMany(4);
        ClearingHouse.Cycle[] memory page = house.getCycles(1, 2);
        assertEq(page.length, 2);
        assertEq(page[0].grossCleared, 2);
        assertEq(page[1].grossCleared, 3);

        page = house.getCycles(2, 150);
        assertEq(page.length, 2);
        assertEq(page[1].grossCleared, 4);

        assertEq(house.getCycles(0, 4).length, 4);
        assertEq(house.getCycles(0, type(uint256).max).length, 4);
    }

    function test_getCycles_zeroCountOrStartPastEndIsEmpty() public {
        _settleMany(2);
        assertEq(house.getCycles(0, 0).length, 0);
        assertEq(house.getCycles(2, 1).length, 0);
        assertEq(house.getCycles(type(uint256).max, 1).length, 0);
    }

    function test_getCycle_revertsOutOfRange() public {
        _settleMany(1);
        assertEq(house.getCycle(0).grossCleared, 1);
        vm.expectRevert(stdError.indexOOBError);
        house.getCycle(1);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Invoice i (1-based) has amount i, which makes pages easy to check.
    function _issueMany(uint256 count) private {
        for (uint256 i = 1; i <= count; ++i) {
            _issue(bob, alice, USDC, i, 0);
        }
    }

    /// @dev Cycle i (0-based) clears one invoice of i + 1 units, so its gross is i + 1.
    function _settleMany(uint256 count) private {
        for (uint256 i; i < count; ++i) {
            uint256 id = _owe(alice, bob, i + 1);
            _depositUsdc(alice, i + 1);
            _settle(USDC, _uints(id), _uints(i + 1));
        }
    }
}

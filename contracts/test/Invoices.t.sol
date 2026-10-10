// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Membership and the invoice lifecycle: register, issue, accept, reject, cancel.
contract InvoicesTest is ClearingHouseFixture {
    // ---------------------------------------------------------------------------------------------------------------
    // register
    // ---------------------------------------------------------------------------------------------------------------

    function test_register_addsMemberWithName() public {
        vm.expectEmit(address(house));
        emit ClearingHouse.MemberProfile(alice, "Northwind Freight");
        vm.prank(alice);
        house.register("Northwind Freight");

        assertTrue(house.isMember(alice));
        assertEq(house.nameOf(alice), "Northwind Freight");
        assertEq(house.memberCount(), 1);
        assertEq(house.members()[0], alice);
    }

    function test_register_renameKeepsSingleEntry() public {
        vm.startPrank(alice);
        house.register("Old name");
        house.register("New name");
        vm.stopPrank();

        assertEq(house.nameOf(alice), "New name");
        assertEq(house.memberCount(), 1);
    }

    function test_register_acceptsMaximumLength() public {
        string memory name = string(new bytes(house.MAX_NAME()));
        vm.prank(alice);
        house.register(name);
        assertEq(bytes(house.nameOf(alice)).length, 48);
    }

    function test_register_revertsOnEmptyName() public {
        vm.expectRevert(ClearingHouse.BadName.selector);
        vm.prank(alice);
        house.register("");
    }

    function test_register_revertsOnNameTooLong() public {
        string memory name = string(new bytes(house.MAX_NAME() + 1));
        vm.expectRevert(ClearingHouse.BadName.selector);
        vm.prank(alice);
        house.register(name);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // issueInvoice
    // ---------------------------------------------------------------------------------------------------------------

    function test_issueInvoice_storesEveryField() public {
        vm.warp(1_800_000_000);
        bytes32 ref = bytes32("INV-2026-0042");
        uint64 due = 1_800_086_400;

        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceIssued(1, bob, alice, address(eurc), 42e6, due, ref, "Pallets, October");
        vm.prank(bob);
        uint256 id = house.issueInvoice(alice, address(eurc), 42e6, due, ref, "Pallets, October");

        ClearingHouse.Invoice memory inv = house.getInvoice(id);
        assertEq(id, 1);
        assertEq(house.invoiceCount(), 1);
        assertEq(inv.creditor, bob);
        assertEq(inv.debtor, alice);
        assertEq(inv.token, address(eurc));
        assertEq(inv.amount, 42e6);
        assertEq(inv.outstanding, 42e6);
        assertEq(inv.dueDate, due);
        assertEq(inv.ref, ref);
        assertEq(inv.issuedAt, 1_800_000_000);
        assertEq(inv.memo, "Pallets, October");
        assertEq(uint8(inv.status), uint8(ClearingHouse.Status.Pending));
    }

    function test_issueInvoice_idsCountUpFromOne() public {
        assertEq(_issue(bob, alice, USDC, 1, 0), 1);
        assertEq(_issue(carol, alice, USDC, 1, 0), 2);
        assertEq(_issue(alice, bob, address(eurc), 1, 0), 3);
    }

    function test_issueInvoice_doesNotRequireRegistration() public {
        uint256 id = _issue(bob, alice, USDC, 5e6, 0);
        assertEq(house.getInvoice(id).creditor, bob);
        assertFalse(house.isMember(bob));
    }

    function test_issueInvoice_acceptsLargestAmountAndLongestMemo() public {
        string memory memo = string(new bytes(house.MAX_MEMO()));
        vm.prank(bob);
        uint256 id = house.issueInvoice(alice, USDC, type(uint96).max, 0, bytes32(0), memo);
        assertEq(house.getInvoice(id).amount, type(uint96).max);
        assertEq(bytes(house.getInvoice(id).memo).length, 140);
    }

    function test_issueInvoice_revertsOnZeroDebtor() public {
        vm.expectRevert(ClearingHouse.BadCounterparty.selector);
        vm.prank(bob);
        house.issueInvoice(address(0), USDC, 1e6, 0, bytes32(0), "");
    }

    function test_issueInvoice_revertsOnSelfInvoice() public {
        vm.expectRevert(ClearingHouse.BadCounterparty.selector);
        vm.prank(bob);
        house.issueInvoice(bob, USDC, 1e6, 0, bytes32(0), "");
    }

    function test_issueInvoice_revertsOnUnsupportedToken() public {
        address other = makeAddr("otherToken");
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, other));
        vm.prank(bob);
        house.issueInvoice(alice, other, 1e6, 0, bytes32(0), "");
    }

    function test_issueInvoice_revertsOnZeroAmount() public {
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(bob);
        house.issueInvoice(alice, USDC, 0, 0, bytes32(0), "");
    }

    function test_issueInvoice_revertsOnAmountAboveUint96() public {
        uint256 tooLarge = uint256(type(uint96).max) + 1;
        vm.expectRevert(ClearingHouse.BadAmount.selector);
        vm.prank(bob);
        house.issueInvoice(alice, USDC, tooLarge, 0, bytes32(0), "");
    }

    function test_issueInvoice_revertsOnMemoTooLong() public {
        string memory memo = string(new bytes(house.MAX_MEMO() + 1));
        vm.expectRevert(ClearingHouse.MemoTooLong.selector);
        vm.prank(bob);
        house.issueInvoice(alice, USDC, 1e6, 0, bytes32(0), memo);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // acceptInvoice
    // ---------------------------------------------------------------------------------------------------------------

    function test_acceptInvoice_opensInvoice() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceAccepted(id);
        vm.prank(alice);
        house.acceptInvoice(id);
        assertEq(uint8(house.getInvoice(id).status), uint8(ClearingHouse.Status.Open));
    }

    function test_acceptInvoice_revertsForCreditor() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotDebtor.selector, id));
        vm.prank(bob);
        house.acceptInvoice(id);
    }

    function test_acceptInvoice_revertsForStranger() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotDebtor.selector, id));
        vm.prank(carol);
        house.acceptInvoice(id);
    }

    function test_acceptInvoice_revertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, 7));
        vm.prank(alice);
        house.acceptInvoice(7);
    }

    function test_acceptInvoice_revertsWhenAlreadyOpen() public {
        uint256 id = _owe(alice, bob, 10e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(alice);
        house.acceptInvoice(id);
    }

    function test_acceptInvoice_revertsWhenRejected() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.startPrank(alice);
        house.rejectInvoice(id);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        house.acceptInvoice(id);
        vm.stopPrank();
    }

    function test_acceptInvoice_revertsWhenCancelled() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.prank(bob);
        house.cancelInvoice(id);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(alice);
        house.acceptInvoice(id);
    }

    function test_acceptInvoice_revertsWhenPaid() public {
        uint256 id = _owe(alice, bob, 10e6);
        _depositUsdc(alice, 10e6);
        _settle(USDC, _uints(id), _uints(10e6));
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(alice);
        house.acceptInvoice(id);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // rejectInvoice
    // ---------------------------------------------------------------------------------------------------------------

    function test_rejectInvoice_marksRejected() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceRejected(id);
        vm.prank(alice);
        house.rejectInvoice(id);
        assertEq(uint8(house.getInvoice(id).status), uint8(ClearingHouse.Status.Rejected));
    }

    function test_rejectInvoice_revertsForCreditor() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotDebtor.selector, id));
        vm.prank(bob);
        house.rejectInvoice(id);
    }

    function test_rejectInvoice_revertsWhenOpen() public {
        uint256 id = _owe(alice, bob, 10e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(alice);
        house.rejectInvoice(id);
    }

    function test_rejectInvoice_revertsWhenCancelled() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.prank(bob);
        house.cancelInvoice(id);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(alice);
        house.rejectInvoice(id);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // cancelInvoice
    // ---------------------------------------------------------------------------------------------------------------

    function test_cancelInvoice_marksCancelled() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceCancelled(id);
        vm.prank(bob);
        house.cancelInvoice(id);
        assertEq(uint8(house.getInvoice(id).status), uint8(ClearingHouse.Status.Cancelled));
    }

    function test_cancelInvoice_revertsForDebtor() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotCreditor.selector, id));
        vm.prank(alice);
        house.cancelInvoice(id);
    }

    function test_cancelInvoice_revertsOnceAccepted() public {
        uint256 id = _owe(alice, bob, 10e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(bob);
        house.cancelInvoice(id);
    }

    function test_cancelInvoice_revertsWhenRejected() public {
        uint256 id = _issue(bob, alice, USDC, 10e6, 0);
        vm.prank(alice);
        house.rejectInvoice(id);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.NotPending.selector, id));
        vm.prank(bob);
        house.cancelInvoice(id);
    }
}

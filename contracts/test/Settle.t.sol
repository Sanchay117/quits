// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";
import {DoubleSettler} from "./utils/Helpers.sol";

/// @notice Netting: what settle() clears, what it moves, what it refuses and what it records.
contract SettleTest is ClearingHouseFixture {
    // ---------------------------------------------------------------------------------------------------------------
    // Netting outcomes
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev SPEC invariant 6: a loop of equal debts settles with no deposits at all.
    function test_settle_pureThreeCycleNeedsNoDeposits() public {
        uint256 a = _owe(alice, bob, 50e6);
        uint256 b = _owe(bob, carol, 50e6);
        uint256 c = _owe(carol, alice, 50e6);

        uint256 cycleId = _settle(USDC, _uints(a, b, c), _uints(50e6, 50e6, 50e6));

        assertEq(cycleId, 0);
        _assertPaid(a);
        _assertPaid(b);
        _assertPaid(c);
        _assertBalances(USDC, 0, 0, 0);
        assertEq(house.getCycle(0).cashMoved, 0);
        assertEq(house.getCycle(0).grossCleared, 150e6);
        assertEq(address(house).balance, 0);
    }

    /// @dev alice -> bob -> carol: bob is only a pass-through, so only alice's 40 moves, straight to carol.
    function test_settle_chainWithPartialLiquidity() public {
        uint256 a = _owe(alice, bob, 100e6);
        uint256 b = _owe(bob, carol, 100e6);
        _depositUsdc(alice, 40e6);

        _settle(USDC, _uints(a, b), _uints(40e6, 40e6));

        _assertBalances(USDC, 0, 0, 40e6);
        assertEq(house.getInvoice(a).outstanding, 60e6);
        assertEq(house.getInvoice(b).outstanding, 60e6);
        assertEq(uint8(house.getInvoice(a).status), uint8(ClearingHouse.Status.Open));
        assertEq(house.getCycle(0).cashMoved, 40e6);
        assertEq(house.getCycle(0).grossCleared, 80e6);
    }

    function test_settle_partialClearsAddUpToPaid() public {
        uint256 id = _owe(alice, bob, 100e6);
        _depositUsdc(alice, 100e6);

        _settle(USDC, _uints(id), _uints(30e6));
        assertEq(house.getInvoice(id).outstanding, 70e6);
        assertEq(uint8(house.getInvoice(id).status), uint8(ClearingHouse.Status.Open));

        _settle(USDC, _uints(id), _uints(70e6));
        _assertPaid(id);
        assertEq(house.getInvoice(id).amount, 100e6);
        _assertBalances(USDC, 0, 100e6, 0);
        assertEq(house.cycleCount(), 2);
    }

    function test_settle_multipleInvoicesBetweenSamePair() public {
        uint256 a = _owe(alice, bob, 30e6);
        uint256 b = _owe(alice, bob, 20e6);
        uint256 c = _owe(bob, alice, 45e6);
        _depositUsdc(alice, 5e6);

        _settle(USDC, _uints(a, b, c), _uints(30e6, 20e6, 45e6));

        _assertBalances(USDC, 0, 5e6, 0);
        ClearingHouse.Cycle memory cycle = house.getCycle(0);
        assertEq(cycle.memberCount, 2);
        assertEq(cycle.invoiceCount, 3);
        assertEq(cycle.grossCleared, 95e6);
        assertEq(cycle.cashMoved, 5e6);
    }

    function test_settle_eurcCycleUsesEurcDeposits() public {
        uint256 a = _oweIn(address(eurc), alice, bob, 12e6);
        uint256 b = _oweIn(address(eurc), bob, carol, 5e6);
        _depositEurc(alice, 12e6);
        _depositUsdc(alice, 99e6);

        _settle(address(eurc), _uints(a, b), _uints(12e6, 5e6));

        _assertBalances(address(eurc), 0, 7e6, 5e6);
        assertEq(house.balanceOf(alice, USDC), 99e6);
    }

    function test_settle_dueDateIsInclusive() public {
        vm.warp(1_000_000);
        uint256 id = _issue(bob, alice, USDC, 10e6, 1_000_100);
        vm.prank(alice);
        house.acceptInvoice(id);
        _depositUsdc(alice, 10e6);

        vm.warp(1_000_099);
        _expectSettleRevert(
            USDC, _uints(id), _uints(10e6), abi.encodeWithSelector(ClearingHouse.InvoiceNotDue.selector, id)
        );

        vm.warp(1_000_100);
        _settle(USDC, _uints(id), _uints(10e6));
        _assertPaid(id);
    }

    function test_settle_anyoneMaySubmitAndIsRecordedAsSolver() public {
        uint256 id = _owe(alice, bob, 1e6);
        _depositUsdc(alice, 1e6);
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        house.settle(USDC, _uints(id), _uints(1e6));

        assertEq(house.getCycle(0).solver, stranger);
        assertFalse(house.isMember(stranger));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Records: events, cycle summary, totals
    // ---------------------------------------------------------------------------------------------------------------

    function test_settle_emitsClearsNetsAndSummaryInOrder() public {
        uint256 a = _owe(alice, bob, 50e6);
        uint256 b = _owe(bob, carol, 50e6);
        uint256 c = _owe(carol, alice, 20e6);
        _depositUsdc(alice, 30e6);

        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceCleared(0, a, 50e6, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceCleared(0, b, 50e6, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.InvoiceCleared(0, c, 20e6, 0);
        // Members in first-touched order; bob passes everything through, so his net is zero.
        vm.expectEmit(address(house));
        emit ClearingHouse.MemberNetted(0, bob, 0);
        vm.expectEmit(address(house));
        emit ClearingHouse.MemberNetted(0, alice, -30e6);
        vm.expectEmit(address(house));
        emit ClearingHouse.MemberNetted(0, carol, 30e6);
        vm.expectEmit(address(house));
        emit ClearingHouse.CycleSettled(0, USDC, solver, 3, 3, 120e6, 30e6);

        vm.recordLogs();
        _settle(USDC, _uints(a, b, c), _uints(50e6, 50e6, 20e6));
        assertEq(vm.getRecordedLogs().length, 7, "exactly 3 clears, 3 nets and 1 summary");
    }

    function test_settle_emitsZeroNetForFullyNettedMembers() public {
        uint256 a = _owe(alice, bob, 9e6);
        uint256 b = _owe(bob, alice, 9e6);

        vm.recordLogs();
        _settle(USDC, _uints(a, b), _uints(9e6, 9e6));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 netEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ClearingHouse.MemberNetted.selector) continue;
            assertEq(abi.decode(logs[i].data, (int256)), 0);
            ++netEvents;
        }
        assertEq(netEvents, 2);
    }

    function test_settle_storesCycleSummary() public {
        uint256 a = _owe(alice, bob, 8e6);
        uint256 b = _owe(bob, carol, 3e6);
        _depositUsdc(alice, 8e6);
        vm.warp(1_790_000_000);
        vm.roll(4_242_424);

        _settle(USDC, _uints(a, b), _uints(8e6, 3e6));

        ClearingHouse.Cycle memory cycle = house.getCycle(0);
        assertEq(cycle.token, USDC);
        assertEq(cycle.invoiceCount, 2);
        assertEq(cycle.memberCount, 3);
        assertEq(cycle.solver, solver);
        assertEq(cycle.timestamp, 1_790_000_000);
        assertEq(cycle.blockNumber, 4_242_424);
        assertEq(cycle.grossCleared, 11e6);
        assertEq(cycle.cashMoved, 8e6);
        assertEq(house.cycleCount(), 1);
    }

    function test_settle_accumulatesTotalsPerToken() public {
        uint256 a = _owe(alice, bob, 10e6);
        uint256 b = _owe(bob, alice, 4e6);
        uint256 c = _owe(carol, dave, 7e6);
        uint256 e = _oweIn(address(eurc), dave, erin, 6e6);
        _depositUsdc(alice, 6e6);
        _depositUsdc(carol, 7e6);
        _depositEurc(dave, 6e6);

        _settle(USDC, _uints(a, b), _uints(10e6, 4e6));
        _settle(USDC, _uints(c), _uints(7e6));
        _settle(address(eurc), _uints(e), _uints(6e6));

        assertEq(house.totalCleared(USDC), 21e6);
        assertEq(house.totalCashMoved(USDC), 13e6);
        assertEq(house.totalCleared(address(eurc)), 6e6);
        assertEq(house.totalCashMoved(address(eurc)), 6e6);
        assertEq(house.cycleCount(), 3);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Transient net ledger
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev bob is paid in the first settlement and pays in the second. Leftover transient nets would cancel his
    ///      payment out and break conservation.
    function test_settle_twiceInOneTransactionStartsFromCleanNets() public {
        uint256 a = _owe(alice, bob, 10e6);
        uint256 b = _owe(bob, carol, 10e6);
        _depositUsdc(alice, 10e6);
        DoubleSettler settler = new DoubleSettler();

        (uint256 first, uint256 second) = settler.settleTwice(
            house,
            DoubleSettler.Solution(USDC, _uints(a), _uints(10e6)),
            DoubleSettler.Solution(USDC, _uints(b), _uints(10e6))
        );

        assertEq(first, 0);
        assertEq(second, 1);
        _assertBalances(USDC, 0, 0, 10e6);
        assertEq(house.getCycle(1).memberCount, 2);
        assertEq(house.getCycle(1).cashMoved, 10e6);
    }

    /// @dev A settlement that reverts after accumulating nets leaves nothing behind for the next one.
    function test_settle_revertedAttemptLeavesNoNetsBehind() public {
        uint256 unfunded = _owe(alice, bob, 100e6);
        uint256 funded = _owe(carol, alice, 30e6);
        _depositUsdc(carol, 30e6);
        DoubleSettler settler = new DoubleSettler();

        (bool firstSucceeded, uint256 cycleId) = settler.settleAfterFailure(
            house,
            DoubleSettler.Solution(USDC, _uints(unfunded), _uints(100e6)),
            DoubleSettler.Solution(USDC, _uints(funded), _uints(30e6))
        );

        assertFalse(firstSucceeded);
        assertEq(cycleId, 0);
        _assertBalances(USDC, 30e6, 0, 0);
        assertEq(house.getInvoice(unfunded).outstanding, 100e6);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Liquidity and blocklists
    // ---------------------------------------------------------------------------------------------------------------

    function test_settle_insufficientLiquidityRevertsWholeCycle() public {
        uint256 a = _owe(alice, bob, 100e6);
        uint256 b = _owe(carol, bob, 50e6);
        _depositUsdc(alice, 70e6);
        _depositUsdc(carol, 50e6);

        _expectSettleRevert(
            USDC,
            _uints(a, b),
            _uints(100e6, 50e6),
            abi.encodeWithSelector(ClearingHouse.InsufficientLiquidity.selector, alice, 100e6, 70e6)
        );

        assertEq(house.getInvoice(a).outstanding, 100e6);
        assertEq(house.getInvoice(b).outstanding, 50e6);
        assertEq(uint8(house.getInvoice(b).status), uint8(ClearingHouse.Status.Open));
        _assertBalances(USDC, 70e6, 0, 50e6);
        assertEq(house.cycleCount(), 0);
        assertEq(house.totalCleared(USDC), 0);
        assertEq(house.totalCashMoved(USDC), 0);
    }

    function test_settle_otherTokenDepositDoesNotCountAsLiquidity() public {
        uint256 id = _oweIn(address(eurc), alice, bob, 10e6);
        _depositUsdc(alice, 10e6);
        _expectSettleRevert(
            address(eurc),
            _uints(id),
            _uints(10e6),
            abi.encodeWithSelector(ClearingHouse.InsufficientLiquidity.selector, alice, 10e6, 0)
        );
    }

    function test_settle_revertsWhenMemberBlockedOnToken() public {
        uint256 id = _oweIn(address(eurc), alice, bob, 10e6);
        _depositEurc(alice, 10e6);
        _block(address(eurc), bob);
        _expectSettleRevert(
            address(eurc), _uints(id), _uints(10e6), abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, bob)
        );
    }

    function test_settle_revertsWhenMemberBlockedOnUsdcInEurcCycle() public {
        uint256 id = _oweIn(address(eurc), alice, bob, 10e6);
        _depositEurc(alice, 10e6);
        _block(USDC, alice);
        _expectSettleRevert(
            address(eurc), _uints(id), _uints(10e6), abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, alice)
        );
    }

    function test_settle_revertsWhenMemberBlockedOnUsdcInUsdcCycle() public {
        uint256 id = _owe(alice, bob, 10e6);
        _depositUsdc(alice, 10e6);
        _block(USDC, bob);
        _expectSettleRevert(
            USDC, _uints(id), _uints(10e6), abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, bob)
        );
    }

    /// @dev Blocked members cannot take part at all, even where their net would be zero.
    function test_settle_revertsWhenBlockedMemberWouldNetToZero() public {
        uint256 a = _owe(alice, bob, 5e6);
        uint256 b = _owe(bob, carol, 5e6);
        uint256 c = _owe(carol, alice, 5e6);
        _block(USDC, carol);
        _expectSettleRevert(
            USDC,
            _uints(a, b, c),
            _uints(5e6, 5e6, 5e6),
            abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, carol)
        );
    }

    function test_settle_unblockedMembersStillSettleAroundABlockedOne() public {
        _owe(alice, carol, 5e6);
        uint256 b = _owe(alice, bob, 5e6);
        _depositUsdc(alice, 5e6);
        _block(USDC, carol);

        _settle(USDC, _uints(b), _uints(5e6));
        _assertBalances(USDC, 0, 5e6, 0);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Rejected solutions
    // ---------------------------------------------------------------------------------------------------------------

    function test_settle_revertsOnEmptySolution() public {
        _expectSettleRevert(
            USDC, new uint256[](0), new uint256[](0), abi.encodeWithSelector(ClearingHouse.EmptySolution.selector)
        );
    }

    function test_settle_revertsOnLengthMismatch() public {
        _expectSettleRevert(
            USDC, _uints(1, 2), _uints(1), abi.encodeWithSelector(ClearingHouse.LengthMismatch.selector)
        );
    }

    function test_settle_revertsOnUnsupportedToken() public {
        address other = makeAddr("otherToken");
        _expectSettleRevert(
            other, _uints(1), _uints(1), abi.encodeWithSelector(ClearingHouse.UnsupportedToken.selector, other)
        );
    }

    function test_settle_acceptsMaxBatch() public {
        uint256 size = house.MAX_BATCH();
        uint256[] memory ids = new uint256[](size);
        uint256[] memory amounts = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            ids[i] = i % 2 == 0 ? _owe(alice, bob, 1e6) : _owe(bob, alice, 1e6);
            amounts[i] = 1e6;
        }

        _settle(USDC, ids, amounts);

        assertEq(house.getCycle(0).invoiceCount, size);
        assertEq(house.getCycle(0).cashMoved, 0);
        _assertPaid(ids[size - 1]);
    }

    function test_settle_revertsAboveMaxBatch() public {
        uint256 size = house.MAX_BATCH() + 1;
        _expectSettleRevert(
            USDC, new uint256[](size), new uint256[](size), abi.encodeWithSelector(ClearingHouse.BatchTooLarge.selector)
        );
    }

    function test_settle_revertsOnDescendingIds() public {
        uint256 a = _owe(alice, bob, 1e6);
        uint256 b = _owe(bob, alice, 1e6);
        _expectSettleRevert(
            USDC, _uints(b, a), _uints(1e6, 1e6), abi.encodeWithSelector(ClearingHouse.IdsNotAscending.selector)
        );
    }

    function test_settle_revertsOnDuplicateIds() public {
        uint256 a = _owe(alice, bob, 2e6);
        _depositUsdc(alice, 2e6);
        _expectSettleRevert(
            USDC, _uints(a, a), _uints(1e6, 1e6), abi.encodeWithSelector(ClearingHouse.IdsNotAscending.selector)
        );
    }

    function test_settle_revertsOnIdZero() public {
        _expectSettleRevert(USDC, _uints(0), _uints(1), abi.encodeWithSelector(ClearingHouse.IdsNotAscending.selector));
    }

    function test_settle_revertsOnUnknownId() public {
        _expectSettleRevert(
            USDC, _uints(5), _uints(1), abi.encodeWithSelector(ClearingHouse.InvoiceNotOpen.selector, 5)
        );
    }

    function test_settle_revertsOnPendingInvoice() public {
        uint256 id = _issue(bob, alice, USDC, 1e6, 0);
        _expectNotOpen(id);
    }

    function test_settle_revertsOnRejectedInvoice() public {
        uint256 id = _issue(bob, alice, USDC, 1e6, 0);
        vm.prank(alice);
        house.rejectInvoice(id);
        _expectNotOpen(id);
    }

    function test_settle_revertsOnCancelledInvoice() public {
        uint256 id = _issue(bob, alice, USDC, 1e6, 0);
        vm.prank(bob);
        house.cancelInvoice(id);
        _expectNotOpen(id);
    }

    function test_settle_revertsOnPaidInvoice() public {
        uint256 id = _owe(alice, bob, 1e6);
        _depositUsdc(alice, 2e6);
        _settle(USDC, _uints(id), _uints(1e6));
        _expectNotOpen(id);
    }

    function test_settle_revertsOnTokenMismatch() public {
        uint256 id = _oweIn(address(eurc), alice, bob, 1e6);
        _depositUsdc(alice, 1e6);
        _expectSettleRevert(
            USDC, _uints(id), _uints(1e6), abi.encodeWithSelector(ClearingHouse.TokenMismatch.selector, id)
        );
    }

    function test_settle_revertsOnClearAboveOutstanding() public {
        uint256 id = _owe(alice, bob, 10e6);
        _depositUsdc(alice, 20e6);
        _expectSettleRevert(
            USDC,
            _uints(id),
            _uints(10e6 + 1),
            abi.encodeWithSelector(ClearingHouse.ClearExceedsOutstanding.selector, id)
        );

        _settle(USDC, _uints(id), _uints(6e6));
        _expectSettleRevert(
            USDC,
            _uints(id),
            _uints(4e6 + 1),
            abi.encodeWithSelector(ClearingHouse.ClearExceedsOutstanding.selector, id)
        );
    }

    function test_settle_revertsOnZeroClear() public {
        uint256 id = _owe(alice, bob, 10e6);
        _expectSettleRevert(
            USDC, _uints(id), _uints(0), abi.encodeWithSelector(ClearingHouse.ClearExceedsOutstanding.selector, id)
        );
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    function _expectNotOpen(uint256 id) private {
        _expectSettleRevert(
            USDC, _uints(id), _uints(1e6), abi.encodeWithSelector(ClearingHouse.InvoiceNotOpen.selector, id)
        );
    }

    function _assertPaid(uint256 id) private view {
        ClearingHouse.Invoice memory inv = house.getInvoice(id);
        assertEq(uint8(inv.status), uint8(ClearingHouse.Status.Paid));
        assertEq(inv.outstanding, 0);
    }

    function _assertBalances(address token, uint256 aliceBalance, uint256 bobBalance, uint256 carolBalance)
        private
        view
    {
        assertEq(house.balanceOf(alice, token), aliceBalance, "alice");
        assertEq(house.balanceOf(bob, token), bobBalance, "bob");
        assertEq(house.balanceOf(carol, token), carolBalance, "carol");
    }
}

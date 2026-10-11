// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Regression tests for finding E-1 in docs/SECURITY.md (cherry-picking). The adversarial review's three
///         proofs of concept ran against the contract before solver consent and showed each attack succeeding. Here
///         they are adapted to the current contract: the same calls now revert with PayerNotConsenting, nothing moves,
///         and the honest outcome is still reachable. The last two tests pin down what consent leaves to the debtor: a
///         solver it approved decides which creditor its cash pays, and approving anyone restores first come, first
///         served.
contract CherryPickingTest is ClearingHouseFixture {
    address private stranger;

    function _actorsAllowAnySolver() internal pure override returns (bool) {
        return false;
    }

    function setUp() public override {
        super.setUp();
        stranger = makeAddr("stranger");
    }

    /// @dev PoC 1. alice and bob owe each other 100, both due, and only alice keeps a deposit. Before consent, bob (or
    ///      anyone acting for him) settled only alice's debt, took her whole deposit and withdrew it, leaving his own
    ///      debt to alice open and unfunded. Now neither bob nor a stranger can submit that leg alone.
    function test_E1_creditorCannotCollectGrossWhileItsOwnDebtStaysOpen() public {
        uint256 aliceOwesBob = _owe(alice, bob, 100e6);
        uint256 bobOwesAlice = _owe(bob, alice, 100e6);
        _depositUsdc(alice, 100e6);

        address[2] memory attackers = [bob, stranger];
        for (uint256 i; i < attackers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
            vm.prank(attackers[i]);
            house.settle(USDC, _uints(aliceOwesBob), _uints(100e6));
        }

        // Nothing moved: alice keeps her deposit, bob has nothing to withdraw, both debts are still open in full.
        assertEq(house.balanceOf(alice, USDC), 100e6);
        assertEq(house.balanceOf(bob, USDC), 0);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.InsufficientBalance.selector, 0, 100e6));
        vm.prank(bob);
        house.withdraw(USDC, 100e6, bob);
        _assertOpen(aliceOwesBob, 100e6);
        _assertOpen(bobOwesAlice, 100e6);

        // The netting the audit expected still settles, with no cash, whoever submits it.
        vm.prank(stranger);
        uint256 cycleId = house.settle(USDC, _uints(aliceOwesBob, bobOwesAlice), _uints(100e6, 100e6));
        assertEq(house.getCycle(cycleId).cashMoved, 0);
        assertEq(house.balanceOf(alice, USDC), 100e6);
        assertEq(uint8(house.getInvoice(aliceOwesBob).status), uint8(ClearingHouse.Status.Paid));
        assertEq(uint8(house.getInvoice(bobOwesAlice).status), uint8(ClearingHouse.Status.Paid));
    }

    /// @dev PoC 2. A ring alice -> bob -> carol -> alice, 100 each, all due, and only alice keeps a buffer. Before
    ///      consent, an unrelated caller stripped the ring to the one leg that draws on alice's deposit; bob then
    ///      withdrew the cash and the rest of the ring could never clear. Now every subset that draws on alice reverts.
    function test_E1_thirdPartyCannotBreakARingToDrainItsOnlyFundedMember() public {
        uint256 ab = _owe(alice, bob, 100e6);
        uint256 bc = _owe(bob, carol, 100e6);
        uint256 ca = _owe(carol, alice, 100e6);
        _depositUsdc(alice, 100e6);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(stranger);
        house.settle(USDC, _uints(ab), _uints(100e6));

        // bob, who would receive the cash, cannot do it either, nor with a partial clear or a two-leg subset.
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(bob);
        house.settle(USDC, _uints(ab), _uints(1));
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(bob);
        house.settle(USDC, _uints(ab, bc), _uints(100e6, 100e6));

        assertEq(house.balanceOf(alice, USDC), 100e6);
        assertEq(house.balanceOf(bob, USDC), 0);

        // The whole ring still clears with no cash, from anyone.
        vm.prank(stranger);
        uint256 cycleId = house.settle(USDC, _uints(ab, bc, ca), _uints(100e6, 100e6, 100e6));
        assertEq(house.getCycle(cycleId).cashMoved, 0);
        assertEq(house.balanceOf(alice, USDC), 100e6);
    }

    /// @dev PoC 3 (the priority race). alice owes bob and carol 60 each and holds 60. Before consent, whichever creditor
    ///      submitted first took her whole deposit and the other got nothing. Now neither creditor can submit, and alice
    ///      decides how her cash is shared.
    function test_E1_creditorCannotWinARaceForAShortDebtorsDeposit() public {
        uint256 toBob = _owe(alice, bob, 60e6);
        uint256 toCarol = _owe(alice, carol, 60e6);
        _depositUsdc(alice, 60e6);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(carol);
        house.settle(USDC, _uints(toCarol), _uints(60e6));
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(bob);
        house.settle(USDC, _uints(toBob), _uints(60e6));
        assertEq(house.balanceOf(alice, USDC), 60e6);

        // alice pays both creditors half.
        vm.prank(alice);
        house.settle(USDC, _uints(toBob, toCarol), _uints(30e6, 30e6));
        assertEq(house.balanceOf(bob, USDC), 30e6);
        assertEq(house.balanceOf(carol, USDC), 30e6);
        _assertOpen(toBob, 30e6);
        _assertOpen(toCarol, 30e6);
    }

    /// @dev The race with a solver alice approved: the creditors still cannot submit, and the solver she trusts chooses
    ///      the split.
    function test_E1_priorityRace_approvedSolverDecidesNotTheCreditors() public {
        uint256 toBob = _owe(alice, bob, 60e6);
        uint256 toCarol = _owe(alice, carol, 60e6);
        _depositUsdc(alice, 60e6);
        vm.prank(alice);
        house.setSolver(solver, true);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(carol);
        house.settle(USDC, _uints(toCarol), _uints(60e6));

        vm.prank(solver);
        house.settle(USDC, _uints(toBob, toCarol), _uints(30e6, 30e6));
        assertEq(house.balanceOf(alice, USDC), 0);
        assertEq(house.balanceOf(bob, USDC), 30e6);
        assertEq(house.balanceOf(carol, USDC), 30e6);
    }

    /// @dev The race when alice approves anyone (address(0)): she opts back into the old behaviour, as docs/SECURITY.md
    ///      says, so the first creditor to submit takes her whole deposit. Revoking the approval closes it again.
    function test_E1_priorityRace_approvingAnyoneRestoresFirstComeFirstServed() public {
        uint256 toBob = _owe(alice, bob, 60e6);
        uint256 toCarol = _owe(alice, carol, 60e6);
        _depositUsdc(alice, 60e6);
        vm.prank(alice);
        house.setSolver(address(0), true);

        vm.prank(carol);
        house.settle(USDC, _uints(toCarol), _uints(60e6));
        assertEq(house.balanceOf(carol, USDC), 60e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.InsufficientLiquidity.selector, alice, 1, 0));
        vm.prank(bob);
        house.settle(USDC, _uints(toBob), _uints(1));

        vm.prank(alice);
        house.setSolver(address(0), false);
        _depositUsdc(alice, 60e6);
        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(bob);
        house.settle(USDC, _uints(toBob), _uints(60e6));
        assertEq(house.balanceOf(alice, USDC), 60e6);
    }

    function _assertOpen(uint256 id, uint256 outstanding) private view {
        ClearingHouse.Invoice memory inv = house.getInvoice(id);
        assertEq(uint8(inv.status), uint8(ClearingHouse.Status.Open));
        assertEq(inv.outstanding, outstanding);
    }
}

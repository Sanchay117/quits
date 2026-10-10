// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice A cycle that draws cash from a member's deposit needs that member's consent (it submits the cycle itself, or
///         approved the submitter). Without the rule, a counterparty could submit only the debts a member owes, leave
///         out the ones owed to it, and turn a position that nets to zero into a full cash payment ("cherry-picking").
contract SolverConsentTest is ClearingHouseFixture {
    function _actorsAllowAnySolver() internal pure override returns (bool) {
        return false;
    }

    /// The audit's scenario: alice and bob owe each other 100; bob tries to collect alice's leg alone.
    function test_counterpartyCannotCherryPickTheLegItIsOwed() public {
        uint256 aliceOwesBob = _owe(alice, bob, 100e6);
        uint256 bobOwesAlice = _owe(bob, alice, 100e6);
        _depositUsdc(alice, 100e6);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(bob);
        house.settle(USDC, _uints(aliceOwesBob), _uints(100e6));

        // The full netting still clears both legs with no cash, and anyone may submit it.
        vm.prank(solver);
        house.settle(USDC, _uints(aliceOwesBob, bobOwesAlice), _uints(100e6, 100e6));
        assertEq(house.balanceOf(alice, USDC), 100e6);
        assertEq(house.balanceOf(bob, USDC), 0);
    }

    /// A stranger cannot break a ring by settling one funded leg.
    function test_strangerCannotSettleOneLegOfARing() public {
        uint256 ab = _owe(alice, bob, 50e6);
        _owe(bob, carol, 50e6);
        _owe(carol, alice, 50e6);
        _depositUsdc(alice, 50e6);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(solver);
        house.settle(USDC, _uints(ab), _uints(50e6));
    }

    function test_pureLoopNeedsNoConsent() public {
        uint256 ab = _owe(alice, bob, 50e6);
        uint256 bc = _owe(bob, carol, 50e6);
        uint256 ca = _owe(carol, alice, 50e6);

        vm.prank(solver);
        house.settle(USDC, _uints(ab, bc, ca), _uints(50e6, 50e6, 50e6));
        assertEq(house.cycleCount(), 1);
    }

    function test_payerMaySubmitItsOwnCycle() public {
        uint256 id = _owe(alice, bob, 30e6);
        _depositUsdc(alice, 30e6);

        vm.prank(alice);
        house.settle(USDC, _uints(id), _uints(30e6));
        assertEq(house.balanceOf(bob, USDC), 30e6);
    }

    function test_approvedSolverMayDraw() public {
        uint256 id = _owe(alice, bob, 30e6);
        _depositUsdc(alice, 30e6);

        vm.expectEmit(address(house));
        emit ClearingHouse.SolverSet(alice, solver, true);
        vm.prank(alice);
        house.setSolver(solver, true);

        vm.prank(solver);
        house.settle(USDC, _uints(id), _uints(30e6));
        assertEq(house.balanceOf(alice, USDC), 0);
    }

    function test_approvalForAnyoneLetsAnyoneDraw() public {
        uint256 id = _owe(alice, bob, 30e6);
        _depositUsdc(alice, 30e6);
        vm.prank(alice);
        house.setSolver(address(0), true);

        vm.prank(dave);
        house.settle(USDC, _uints(id), _uints(30e6));
        assertEq(house.balanceOf(bob, USDC), 30e6);
    }

    function test_revokedApprovalBlocksAgain() public {
        uint256 id = _owe(alice, bob, 30e6);
        _depositUsdc(alice, 30e6);
        vm.startPrank(alice);
        house.setSolver(solver, true);
        house.setSolver(solver, false);
        vm.stopPrank();
        assertFalse(house.isSolverFor(alice, solver));

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, alice));
        vm.prank(solver);
        house.settle(USDC, _uints(id), _uints(30e6));
    }

    /// Receivers need no consent: being paid never hurts.
    function test_receiverNeedsNoConsent() public {
        uint256 id = _owe(alice, bob, 30e6);
        _depositUsdc(alice, 30e6);
        vm.prank(alice);
        house.setSolver(solver, true);

        vm.prank(solver);
        house.settle(USDC, _uints(id), _uints(30e6));
        assertEq(house.balanceOf(bob, USDC), 30e6);
    }

    /// Consent is per payer: one payer's approval does not cover another payer in the same cycle.
    function test_everyNetPayerMustConsent() public {
        uint256 aliceOwesBob = _owe(alice, bob, 30e6);
        uint256 carolOwesBob = _owe(carol, bob, 20e6);
        _depositUsdc(alice, 30e6);
        _depositUsdc(carol, 20e6);
        vm.prank(alice);
        house.setSolver(solver, true);

        vm.expectRevert(abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, carol));
        vm.prank(solver);
        house.settle(USDC, _uints(aliceOwesBob, carolOwesBob), _uints(30e6, 20e6));

        vm.prank(carol);
        house.setSolver(solver, true);
        vm.prank(solver);
        house.settle(USDC, _uints(aliceOwesBob, carolOwesBob), _uints(30e6, 20e6));
        assertEq(house.balanceOf(bob, USDC), 50e6);
    }

    /// A member whose debts are offset by its receivables in the cycle pays nothing, so it needs no consent even
    /// without a deposit: only the member that actually pays cash (here alice, the submitter) is checked.
    function test_memberNettingToZeroNeedsNoConsent() public {
        uint256 aliceOwesBob = _owe(alice, bob, 40e6);
        uint256 bobOwesCarol = _owe(bob, carol, 40e6);
        _depositUsdc(alice, 40e6);

        vm.prank(alice);
        house.settle(USDC, _uints(aliceOwesBob, bobOwesCarol), _uints(40e6, 40e6));
        assertEq(house.balanceOf(alice, USDC), 0);
        assertEq(house.balanceOf(bob, USDC), 0);
        assertEq(house.balanceOf(carol, USDC), 40e6);
    }

    /// Whatever invoices and partial amounts a stranger picks, it cannot move anyone's deposit: a cycle in which some
    /// member pays cash reverts with PayerNotConsenting, and only cash-free cycles settle.
    function testFuzz_strangerNeverMovesCash(uint256 seed) public {
        address[5] memory members = [alice, bob, carol, dave, erin];
        uint256[] memory ids = new uint256[](10);
        for (uint256 i; i < ids.length; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, "invoice", i)));
            uint256 debtor = r % 5;
            uint256 creditor = (debtor + 1 + (r >> 8) % 4) % 5;
            ids[i] = _owe(members[debtor], members[creditor], 1 + (r >> 16) % 100e6);
        }
        for (uint256 m; m < 5; ++m) {
            _depositUsdc(members[m], 1 + uint256(keccak256(abi.encode(seed, "deposit", m))) % 200e6);
        }
        address stranger = makeAddr("stranger");

        for (uint256 round; round < 6; ++round) {
            uint256 r = uint256(keccak256(abi.encode(seed, "round", round)));
            (uint256[] memory pick, uint256[] memory amounts, bool drawsCash) = _randomCycle(ids, members, r);
            if (pick.length == 0) continue;
            uint256[] memory before = _balances(members);

            vm.prank(stranger);
            try house.settle(USDC, pick, amounts) returns (uint256 cycleId) {
                assertFalse(drawsCash, "a cycle that draws cash settled without consent");
                assertEq(house.getCycle(cycleId).cashMoved, 0);
            } catch (bytes memory reason) {
                assertTrue(drawsCash, "a cash-free cycle was refused");
                assertEq(bytes4(reason), ClearingHouse.PayerNotConsenting.selector);
            }
            assertEq(keccak256(abi.encode(_balances(members))), keccak256(abi.encode(before)), "a deposit moved");
        }
    }

    /// @dev A random subset of the still-open invoices, cleared in full or in part, and whether any member pays cash.
    function _randomCycle(uint256[] memory ids, address[5] memory members, uint256 r)
        private
        view
        returns (uint256[] memory pick, uint256[] memory amounts, bool drawsCash)
    {
        int256[5] memory nets;
        uint256 count;
        uint256[] memory chosen = new uint256[](ids.length);
        uint256[] memory cleared = new uint256[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            ClearingHouse.Invoice memory inv = house.getInvoice(ids[i]);
            if (inv.status != ClearingHouse.Status.Open || (r >> i) & 1 == 0) continue;
            uint256 amount =
                (r >> (32 + i)) & 1 == 0 ? inv.outstanding : 1 + uint256(keccak256(abi.encode(r, i))) % inv.outstanding;
            chosen[count] = ids[i];
            cleared[count] = amount;
            ++count;
            for (uint256 m; m < 5; ++m) {
                // casting to 'int256' is safe because invoice amounts here are below 100e6
                // forge-lint: disable-next-line(unsafe-typecast)
                if (members[m] == inv.creditor) nets[m] += int256(amount);
                // casting to 'int256' is safe because invoice amounts here are below 100e6
                // forge-lint: disable-next-line(unsafe-typecast)
                if (members[m] == inv.debtor) nets[m] -= int256(amount);
            }
        }
        pick = new uint256[](count);
        amounts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            (pick[i], amounts[i]) = (chosen[i], cleared[i]);
        }
        for (uint256 m; m < 5; ++m) {
            if (nets[m] < 0) drawsCash = true;
        }
    }

    function _balances(address[5] memory members) private view returns (uint256[] memory out) {
        out = new uint256[](5);
        for (uint256 m; m < 5; ++m) {
            out[m] = house.balanceOf(members[m], USDC);
        }
    }
}

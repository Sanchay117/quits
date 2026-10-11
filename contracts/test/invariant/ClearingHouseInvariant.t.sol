// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ClearingHouse} from "../../src/ClearingHouse.sol";
import {MockFiatToken} from "../../src/mocks/MockFiatToken.sol";
import {NativeUSDCHarness} from "../mocks/NativeUSDCHarness.sol";
import {ClearingHouseHandler} from "./ClearingHouseHandler.sol";

/// @notice SPEC invariants 1 to 5 and 7 under random sequences of register, issue, accept, reject, cancel, setSolver
///         (allow or revoke anyone, a member or a stranger), deposit (native, USDC ERC-20 and EURC), withdraw, settle
///         (sent by members and by strangers), time warps and blocklist changes. USDC uses the native-balance harness,
///         so both USDC deposit paths are exercised. Invariant 6 (pure cycles need no deposits) is a direct property
///         test in SettleFuzz.t.sol.
/// @dev Fewer, longer runs than the project default: invoices need several steps (issue, accept, mature) before they
///      can clear, so long sequences reach far more settlements (about a dozen per run) for the same number of calls.
/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 250
contract ClearingHouseInvariantTest is Test {
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 private constant NATIVE_SCALE = 1e12;

    ClearingHouse private house;
    MockFiatToken private eurc;
    ClearingHouseHandler private handler;
    address[] private actors;

    function setUp() public {
        vm.etch(USDC, type(NativeUSDCHarness).runtimeCode);
        eurc = new MockFiatToken("EURC", "EURC");
        address[] memory others = new address[](1);
        others[0] = address(eurc);
        house = new ClearingHouse(USDC, others);
        handler = new ClearingHouseHandler(house, eurc);
        actors = handler.actors();

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = ClearingHouseHandler.register.selector;
        selectors[1] = ClearingHouseHandler.issue.selector;
        selectors[2] = ClearingHouseHandler.accept.selector;
        selectors[3] = ClearingHouseHandler.decline.selector;
        selectors[4] = ClearingHouseHandler.depositUsdc.selector;
        selectors[5] = ClearingHouseHandler.depositEurc.selector;
        selectors[6] = ClearingHouseHandler.withdraw.selector;
        selectors[7] = ClearingHouseHandler.settle.selector;
        selectors[8] = ClearingHouseHandler.warp.selector;
        selectors[9] = ClearingHouseHandler.toggleBlock.selector;
        selectors[10] = ClearingHouseHandler.setSolver.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @dev 1. Per token, the members' deposits add up to everything deposited minus everything withdrawn, and no
    ///      settlement ever changes that sum.
    function invariant_1_depositsEqualInflowsMinusOutflows() public view {
        assertEq(_ledgerSum(USDC), handler.ghostDeposited(USDC) - handler.ghostWithdrawn(USDC), "USDC ledger");
        assertEq(
            _ledgerSum(address(eurc)),
            handler.ghostDeposited(address(eurc)) - handler.ghostWithdrawn(address(eurc)),
            "EURC ledger"
        );
        assertEq(handler.settleSumChanges(), 0, "a settlement changed the deposit sum");
    }

    /// @dev 2. Real holdings cover the ledger: native value for USDC, ERC-20 balance for EURC.
    function invariant_2_holdingsCoverTheLedger() public view {
        assertGe(address(house).balance, _ledgerSum(USDC) * NATIVE_SCALE, "native USDC");
        assertGe(eurc.balanceOf(address(house)), _ledgerSum(address(eurc)), "EURC");
    }

    /// @dev 3. outstanding <= amount, it never rises, and it only falls inside settle(), by exactly what was cleared.
    function invariant_3_outstandingOnlyFallsThroughSettle() public view {
        uint256 count = house.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            ClearingHouse.Invoice memory inv = house.getInvoice(id);
            assertLe(inv.outstanding, inv.amount, "outstanding above amount");
            assertEq(inv.outstanding, handler.ghostOutstanding(id), "outstanding differs from cleared total");
        }
        assertEq(handler.outstandingIncreases(), 0, "outstanding increased");
        assertEq(handler.outstandingChangedOutsideSettle(), 0, "outstanding changed outside settle");
    }

    /// @dev 4. Every accepted settlement moves each member by exactly its net, and cashMoved equals both the sum of
    ///      net payments and the sum of net receipts.
    function invariant_4_settlementsMoveExactNets() public view {
        assertEq(handler.settleNetMismatches(), 0, "a member moved by something other than its net");
        assertEq(handler.settleCashMismatches(), 0, "cashMoved or grossCleared disagrees with the clears");
    }

    /// @dev 5. Statuses only move Pending -> Open | Rejected | Cancelled and Open -> Paid.
    function invariant_5_statusesFollowLegalTransitions() public view {
        assertEq(handler.illegalTransitions(), 0, "illegal status transition");
        uint256 count = house.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            assertEq(uint8(house.getInvoice(id).status), uint8(handler.ghostStatus(id)), "status differs from model");
        }
    }

    /// @dev 7. A member's deposit never falls in a settle() that it neither sent nor approved the sender of (directly
    ///      or by approving anyone), judged by the handler's own record of every setSolver call. After every setSolver
    ///      the contract's isSolverFor must also agree with that record for every member and every address the suite
    ///      approves.
    function invariant_7_cashLeavesADepositOnlyWithConsent() public view {
        assertEq(handler.drawsWithoutConsent(), 0, "a deposit fell in a settle its owner neither sent nor approved");
        assertEq(handler.approvalMismatches(), 0, "isSolverFor differs from the recorded approvals");
    }

    /// @dev Every call succeeded or failed exactly when the model said it should, and every refused settle() reverted
    ///      with exactly the error the model predicted.
    function invariant_contractAgreesWithModel() public view {
        assertEq(handler.modelMismatches(), 0, "the contract and the model disagree about a call");
    }

    /// @dev Shows that the campaign reaches real settlements, not only rejected calls, and that consent decides calls
    ///      both ways: deposits are drawn by their owners and by approved senders, and cycles are refused for consent.
    function _acc(string memory key, uint256 v) private {
        uint256 cur = vm.envOr(key, uint256(0));
        vm.setEnv(key, vm.toString(cur + v));
    }

    function afterInvariant() public {
        _acc("QX_RUNS", 1);
        _acc("QX_OK", handler.settlesSucceeded());
        _acc("QX_REJ", handler.settlesRejected());
        _acc("QX_CONS", handler.settlesRefusedForConsent());
        _acc("QX_STR", handler.settlesByStrangers());
        _acc("QX_PAID", handler.invoicesPaid());
        _acc("QX_INV", handler.ghostInvoiceCount());
        _acc("QX_SELF", handler.drawsBySelf());
        _acc("QX_APPR", handler.drawsByApprovedSender());
        console.log(
            string.concat(
                "AGG runs ",
                vm.envString("QX_RUNS"),
                " ok ",
                vm.envString("QX_OK"),
                " rej ",
                vm.envString("QX_REJ"),
                " cons ",
                vm.envString("QX_CONS"),
                " str ",
                vm.envString("QX_STR")
            )
        );
        console.log(
            string.concat(
                "AGG paid ",
                vm.envString("QX_PAID"),
                " inv ",
                vm.envString("QX_INV"),
                " self ",
                vm.envString("QX_SELF"),
                " appr ",
                vm.envString("QX_APPR")
            )
        );
        console.log(
            string.concat(
                "Last run: ",
                vm.toString(handler.settlesSucceeded()),
                " cycles settled (",
                vm.toString(handler.settlesByStrangers()),
                " by strangers), ",
                vm.toString(handler.settlesRejected()),
                " rejected (",
                vm.toString(handler.settlesRefusedForConsent()),
                " for consent), ",
                vm.toString(handler.invoicesPaid()),
                " of ",
                vm.toString(handler.ghostInvoiceCount()),
                " invoices paid"
            )
        );
        console.log(
            string.concat(
                "Deposits drawn: ",
                vm.toString(handler.drawsBySelf()),
                " by the sender itself, ",
                vm.toString(handler.drawsByApprovedSender()),
                " by an approved sender; ",
                vm.toString(handler.approvalChanges()),
                " setSolver calls"
            )
        );
    }

    function _ledgerSum(address token) private view returns (uint256 total) {
        uint256[] memory balances = house.balancesOf(actors, token);
        for (uint256 i; i < balances.length; ++i) {
            total += balances[i];
        }
    }
}

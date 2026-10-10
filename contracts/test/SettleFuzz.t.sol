// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Property tests for settle() on random small invoice networks.
contract SettleFuzzTest is ClearingHouseFixture {
    uint256 private constant MAX_MEMBERS = 6;
    uint256 private constant MAX_INVOICES = 12;
    uint256 private constant MAX_INVOICE_AMOUNT = 1000e6;

    /// @dev A random network and a solution clearing every invoice in it. Per member, `received` and `paid` sum the
    ///      clears where it is creditor and debtor, so its net is `received - paid` (kept unsigned to avoid casts).
    struct Network {
        address[] members;
        uint256[] ids;
        uint256[] amounts;
        uint256[] clears;
        uint256[] creditorOf;
        uint256[] debtorOf;
        uint256[] received;
        uint256[] paid;
        uint256 gross;
    }

    /// @dev SPEC invariants 1, 2 and 4 for one settlement: the deposit sum is conserved, every member moves by exactly
    ///      its net, and cashMoved is the sum of net payments (which equals the sum of net receipts).
    function testFuzz_settleMovesEachMemberByItsExactNet(
        uint256 seed,
        uint8 memberCount,
        uint8 invoiceCount,
        uint256 extraSeed
    ) public {
        Network memory net = _randomNetwork(seed, memberCount, invoiceCount);
        uint256 totalPayments;
        uint256 totalReceipts;
        for (uint256 m; m < net.members.length; ++m) {
            uint256 owed = _netPayment(net, m);
            uint256 extra = uint256(keccak256(abi.encode(extraSeed, m))) % 100e6;
            if (owed + extra > 0) _depositUsdc(net.members[m], owed + extra);
            totalPayments += owed;
            totalReceipts += _netReceipt(net, m);
        }
        uint256[] memory before = house.balancesOf(net.members, USDC);
        uint256 sumBefore = _sum(before);

        uint256 cycleId = _settle(USDC, net.ids, net.clears);

        uint256[] memory afterwards = house.balancesOf(net.members, USDC);
        for (uint256 m; m < net.members.length; ++m) {
            assertEq(afterwards[m] + net.paid[m], before[m] + net.received[m], "balance moved by exactly the net");
        }
        assertEq(_sum(afterwards), sumBefore, "deposit sum conserved");
        assertEq(address(house).balance, _sum(afterwards) * NATIVE_SCALE, "native holdings back the ledger");

        ClearingHouse.Cycle memory cycle = house.getCycle(cycleId);
        assertEq(cycle.cashMoved, totalPayments, "cash is the sum of net payments");
        assertEq(totalPayments, totalReceipts, "net payments equal net receipts");
        assertEq(cycle.grossCleared, net.gross);
        assertEq(cycle.invoiceCount, net.ids.length);
        _assertInvoicesReduced(net);
    }

    /// @dev The cycle settles if and only if every net payer's deposit covers its payment; otherwise the first short
    ///      payer (in the order members were first touched) is reported and nothing changes.
    function testFuzz_settleRevertsUnlessEveryPayerIsCovered(
        uint256 seed,
        uint8 memberCount,
        uint8 invoiceCount,
        uint256 depositSeed
    ) public {
        Network memory net = _randomNetwork(seed, memberCount, invoiceCount);
        for (uint256 m; m < net.members.length; ++m) {
            uint256 r = uint256(keccak256(abi.encode(depositSeed, m)));
            uint256 owed = _netPayment(net, m);
            uint256 deposit = r % 3 == 0 ? owed : (r >> 8) % (2 * owed + 1);
            if (deposit > 0) _depositUsdc(net.members[m], deposit);
        }
        uint256[] memory before = house.balancesOf(net.members, USDC);
        (bool short, uint256 shortMember) = _firstShortPayer(net, before);

        if (!short) {
            _settle(USDC, net.ids, net.clears);
            _assertInvoicesReduced(net);
            return;
        }
        _expectSettleRevert(
            USDC,
            net.ids,
            net.clears,
            abi.encodeWithSelector(
                ClearingHouse.InsufficientLiquidity.selector,
                net.members[shortMember],
                _netPayment(net, shortMember),
                before[shortMember]
            )
        );
        assertEq(keccak256(abi.encode(house.balancesOf(net.members, USDC))), keccak256(abi.encode(before)));
        for (uint256 i; i < net.ids.length; ++i) {
            assertEq(house.getInvoice(net.ids[i]).outstanding, net.amounts[i]);
        }
        assertEq(house.cycleCount(), 0);
    }

    /// @dev SPEC invariant 6 on rings of every size this suite uses and any amount an invoice can hold.
    function testFuzz_pureCycleSettlesWithoutDeposits(uint8 ringSize, uint96 amount) public {
        address[] memory ring = _members(bound(ringSize, 2, MAX_MEMBERS));
        uint256 value = bound(amount, 1, type(uint96).max);
        uint256 n = ring.length;
        uint256[] memory ids = new uint256[](n);
        uint256[] memory clears = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = _owe(ring[i], ring[(i + 1) % n], value);
            clears[i] = value;
        }

        uint256 cycleId = _settle(USDC, ids, clears);

        assertEq(house.getCycle(cycleId).cashMoved, 0);
        assertEq(house.getCycle(cycleId).memberCount, n);
        assertEq(_sum(house.balancesOf(ring, USDC)), 0);
        for (uint256 i; i < n; ++i) {
            assertEq(uint8(house.getInvoice(ids[i]).status), uint8(ClearingHouse.Status.Paid));
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Network generation
    // ---------------------------------------------------------------------------------------------------------------

    function _randomNetwork(uint256 seed, uint8 memberCount, uint8 invoiceCount) private returns (Network memory net) {
        uint256 m = bound(memberCount, 2, MAX_MEMBERS);
        uint256 k = bound(invoiceCount, 1, MAX_INVOICES);
        net.members = _members(m);
        net.ids = new uint256[](k);
        net.amounts = new uint256[](k);
        net.clears = new uint256[](k);
        net.creditorOf = new uint256[](k);
        net.debtorOf = new uint256[](k);
        net.received = new uint256[](m);
        net.paid = new uint256[](m);

        for (uint256 i; i < k; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 debtor = r % m;
            uint256 creditor = (debtor + 1 + (r >> 8) % (m - 1)) % m;
            uint256 amount = 1 + (r >> 16) % MAX_INVOICE_AMOUNT;
            // Half the invoices clear in full, the rest by a random part.
            uint256 clear = (r >> 128) % 2 == 0 ? amount : 1 + (r >> 136) % amount;

            net.ids[i] = _owe(net.members[debtor], net.members[creditor], amount);
            net.amounts[i] = amount;
            net.clears[i] = clear;
            net.creditorOf[i] = creditor;
            net.debtorOf[i] = debtor;
            net.received[creditor] += clear;
            net.paid[debtor] += clear;
            net.gross += clear;
        }
    }

    function _members(uint256 count) private view returns (address[] memory out) {
        address[MAX_MEMBERS] memory everyone = [alice, bob, carol, dave, erin, frank];
        out = new address[](count);
        for (uint256 i; i < count; ++i) {
            out[i] = everyone[i];
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Expected outcome
    // ---------------------------------------------------------------------------------------------------------------

    function _netPayment(Network memory net, uint256 m) private pure returns (uint256) {
        return net.paid[m] > net.received[m] ? net.paid[m] - net.received[m] : 0;
    }

    function _netReceipt(Network memory net, uint256 m) private pure returns (uint256) {
        return net.received[m] > net.paid[m] ? net.received[m] - net.paid[m] : 0;
    }

    /// @dev Mirrors settle(): members are visited in first-touched order (creditor, then debtor, invoice by invoice).
    function _firstShortPayer(Network memory net, uint256[] memory balances)
        private
        pure
        returns (bool found, uint256 member)
    {
        bool[] memory visited = new bool[](net.members.length);
        for (uint256 i; i < net.ids.length; ++i) {
            uint256[2] memory parties = [net.creditorOf[i], net.debtorOf[i]];
            for (uint256 p; p < 2; ++p) {
                uint256 m = parties[p];
                if (visited[m]) continue;
                visited[m] = true;
                if (_netPayment(net, m) > balances[m]) return (true, m);
            }
        }
    }

    function _assertInvoicesReduced(Network memory net) private view {
        for (uint256 i; i < net.ids.length; ++i) {
            ClearingHouse.Invoice memory inv = house.getInvoice(net.ids[i]);
            assertEq(inv.outstanding, net.amounts[i] - net.clears[i]);
            ClearingHouse.Status expected = inv.outstanding == 0 ? ClearingHouse.Status.Paid : ClearingHouse.Status.Open;
            assertEq(uint8(inv.status), uint8(expected));
        }
    }

    function _sum(uint256[] memory values) private pure returns (uint256 total) {
        for (uint256 i; i < values.length; ++i) {
            total += values[i];
        }
    }
}

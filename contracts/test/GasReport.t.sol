// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console} from "forge-std/console.sol";
import {Vm} from "forge-std/Vm.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";
import {ClearingHouseFixture} from "./utils/ClearingHouseFixture.sol";

/// @notice Logs what the main operations cost on Arc, where gas is paid in USDC.
/// @dev Figures are whole-transaction gas. Calls rely on forge's call isolation (on by default) to run each measured
///      call as its own transaction; with `--no-isolate` they become a lower bound, because slots written earlier in
///      the test are then priced as already dirty. Run `forge test --match-contract GasReport -vv` to see them.
contract GasReportTest is ClearingHouseFixture {
    /// @dev Arc's base fee floor. Gas is priced in native USDC (18 decimals), so 1 gas = 0.00000002 USDC.
    uint256 private constant GAS_PRICE = 20 gwei;
    uint256 private constant TX_BASE_GAS = 21_000;
    uint256 private constant CREATE_GAS = 32_000;
    uint256 private constant INITCODE_WORD_GAS = 2;

    /// @dev Regression budgets, with headroom over the measured figures.
    uint256 private constant ISSUE_BUDGET = 250_000;
    uint256 private constant SETTLE_15_BUDGET = 1_000_000;
    /// @dev Arc's block gas limit. The largest settle() must fit in one block with room to spare.
    uint256 private constant ARC_BLOCK_GAS_LIMIT = 30_000_000;
    uint256 private constant SETTLE_MAX_BUDGET = 25_000_000;

    struct Clear {
        address debtor;
        address creditor;
        uint256 amount;
    }

    function test_gasReport() public {
        console.log("Estimated transaction cost on Arc at 20 gwei (1 gas = 0.00000002 USDC)");
        if (!vm.isIsolateMode()) console.log("  (call isolation is off: call figures are lower bounds)");
        _reportDeploy();
        uint256 id = _reportIssue();
        _reportAccept(id);
        _reportDeposit();
        _reportSettleOfFifteenInvoices();
    }

    /// @dev A CREATE from a test is never isolated: its frame gas is the constructor plus the code deposit, so the
    ///      transaction costs (base, CREATE, initcode as calldata) are added here.
    function _reportDeploy() private {
        address[] memory others = _addresses(address(eurc));
        bytes memory initcode = abi.encodePacked(type(ClearingHouse).creationCode, abi.encode(USDC, others));
        new ClearingHouse(USDC, others);
        _log("deploy", _transactionGas(initcode, vm.lastFrameGas().gasTotalUsed, 0, true));
    }

    function _reportIssue() private returns (uint256 id) {
        bytes memory data = abi.encodeCall(
            ClearingHouse.issueInvoice,
            (alice, USDC, 42_500_000, uint64(block.timestamp + 30 days), bytes32("INV-0042"), "Roasted beans, 20 kg")
        );
        id = house.invoiceCount() + 1;
        uint256 gas = _measuredCall(bob, data, 0);
        assertLe(gas, ISSUE_BUDGET, "issueInvoice over budget");
        _log("issueInvoice", gas);
    }

    function _reportAccept(uint256 id) private {
        _log("acceptInvoice", _measuredCall(alice, abi.encodeCall(ClearingHouse.acceptInvoice, (id)), 0));
    }

    function _reportDeposit() private {
        uint256 value = 5e6 * NATIVE_SCALE;
        vm.deal(carol, value);
        _log("deposit (native USDC)", _measuredCall(carol, abi.encodeCall(ClearingHouse.deposit, ()), value));
    }

    /// @dev Six members and fifteen invoices with overlapping loops, every invoice cleared in full.
    function _reportSettleOfFifteenInvoices() private {
        Clear[15] memory network = [
            Clear(alice, bob, 120e6),
            Clear(bob, carol, 80e6),
            Clear(carol, alice, 95e6),
            Clear(dave, erin, 60e6),
            Clear(erin, frank, 75e6),
            Clear(frank, dave, 50e6),
            Clear(alice, dave, 40e6),
            Clear(dave, bob, 30e6),
            Clear(bob, frank, 55e6),
            Clear(frank, alice, 45e6),
            Clear(carol, erin, 35e6),
            Clear(erin, alice, 25e6),
            Clear(bob, dave, 20e6),
            Clear(frank, carol, 65e6),
            Clear(erin, bob, 15e6)
        ];
        uint256[] memory ids = new uint256[](15);
        uint256[] memory amounts = new uint256[](15);
        for (uint256 i; i < 15; ++i) {
            ids[i] = _owe(network[i].debtor, network[i].creditor, network[i].amount);
            amounts[i] = network[i].amount;
        }
        _fundNetPayers(network);

        bytes memory data = abi.encodeCall(ClearingHouse.settle, (USDC, ids, amounts));
        uint256 gas = _measuredCall(solver, data, 0);
        ClearingHouse.Cycle memory cycle = house.getCycle(house.cycleCount() - 1);
        assertEq(cycle.memberCount, 6);
        assertLe(gas, SETTLE_15_BUDGET, "settle over budget");
        _log("settle (15 invoices, 6 members)", gas);
        console.log(
            string.concat(
                "  cleared ",
                _formatUnits(cycle.grossCleared, 6),
                " USDC of invoices by moving ",
                _formatUnits(cycle.cashMoved, 6),
                " USDC"
            )
        );
    }

    /// @dev The most expensive cycle settle() accepts: MAX_BATCH EURC invoices between 512 distinct members, so every
    ///      member is touched once, needs two blocklist reads (EURC and USDC), and every payer passes the consent check
    ///      through its "anyone" approval (two cold reads) while every receiver's balance goes from zero to non-zero.
    function test_gasReport_largestSettle() public {
        uint256 size = house.MAX_BATCH();
        uint256[] memory ids = new uint256[](size);
        uint256[] memory amounts = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            address debtor = makeAddr(string.concat("debtor", vm.toString(i)));
            address creditor = makeAddr(string.concat("creditor", vm.toString(i)));
            amounts[i] = 1e6 + i;
            ids[i] = _oweIn(address(eurc), debtor, creditor, amounts[i]);
            _depositEurc(debtor, amounts[i]);
            vm.prank(debtor);
            house.setSolver(address(0), true);
        }

        bytes memory data = abi.encodeCall(ClearingHouse.settle, (address(eurc), ids, amounts));
        uint256 gas = _measuredCall(solver, data, 0);
        ClearingHouse.Cycle memory cycle = house.getCycle(house.cycleCount() - 1);
        assertEq(cycle.invoiceCount, size);
        assertEq(cycle.memberCount, 2 * size);
        assertLe(gas, SETTLE_MAX_BUDGET, "largest settle over budget");
        assertLt(gas, ARC_BLOCK_GAS_LIMIT, "largest settle does not fit in an Arc block");
        console.log("Largest cycle settle() accepts, on the local mocks:");
        _log("settle (256 EURC invoices, 512 members)", gas);
    }

    function _fundNetPayers(Clear[15] memory network) private {
        address[6] memory everyone = [alice, bob, carol, dave, erin, frank];
        for (uint256 m; m < 6; ++m) {
            uint256 paid;
            uint256 received;
            for (uint256 i; i < 15; ++i) {
                if (network[i].debtor == everyone[m]) paid += network[i].amount;
                if (network[i].creditor == everyone[m]) received += network[i].amount;
            }
            if (paid > received) _depositUsdc(everyone[m], paid - received);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Measurement
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Calls the clearing house as `caller` and returns the gas of that call sent as its own transaction.
    ///      With forge's call isolation (the default here) the call already runs as a separate transaction, so its
    ///      frame gas includes the base cost, calldata and cold storage access. Without isolation, storage is cooled
    ///      first and the base and calldata costs are added to the measured execution.
    function _measuredCall(address caller, bytes memory data, uint256 value) private returns (uint256) {
        vm.cool(address(house));
        vm.cool(USDC);
        vm.cool(address(eurc));
        vm.prank(caller);
        (bool ok,) = address(house).call{value: value}(data);
        assertTrue(ok, "measured call reverted");
        Vm.Gas memory frame = vm.lastFrameGas();
        uint256 refund = _refund(frame);
        if (vm.isIsolateMode()) return frame.gasTotalUsed - refund;
        return _transactionGas(data, frame.gasTotalUsed, refund, false);
    }

    /// @dev Base cost (plus CREATE's), calldata per EIP-2028 with the EIP-7623 floor, and refunds capped at a fifth
    ///      (EIP-3529).
    function _transactionGas(bytes memory data, uint256 execution, uint256 refund, bool isCreate)
        private
        pure
        returns (uint256)
    {
        uint256 tokens;
        for (uint256 i; i < data.length; ++i) {
            tokens += data[i] == 0 ? 1 : 4;
        }
        uint256 standard = TX_BASE_GAS + 4 * tokens + execution;
        if (isCreate) standard += CREATE_GAS + INITCODE_WORD_GAS * ((data.length + 31) / 32);
        uint256 refunded = refund < standard / 5 ? refund : standard / 5;
        uint256 floor = TX_BASE_GAS + 10 * tokens;
        uint256 charged = standard - refunded;
        return charged > floor ? charged : floor;
    }

    function _refund(Vm.Gas memory frame) private pure returns (uint256) {
        if (frame.gasRefunded <= 0) return 0;
        // casting to 'uint64' is safe because the value was just checked to be positive
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(frame.gasRefunded);
    }

    function _log(string memory operation, uint256 gas) private pure {
        console.log(
            string.concat(
                "  ", operation, ": ", vm.toString(gas), " gas = ", _formatUnits(gas * GAS_PRICE, 18), " USDC"
            )
        );
    }

    /// @dev Fixed-point formatting with 8 decimals, enough to show a single gas unit (0.00000002 USDC).
    function _formatUnits(uint256 value, uint256 decimals) private pure returns (string memory) {
        uint256 unit = 10 ** decimals;
        uint256 shown = decimals < 8 ? decimals : 8;
        uint256 fraction = (value % unit) / 10 ** (decimals - shown);
        bytes memory digits = bytes(vm.toString(fraction));
        bytes memory padded = new bytes(shown);
        for (uint256 i; i < shown; ++i) {
            padded[i] = i < shown - digits.length ? bytes1("0") : digits[i - (shown - digits.length)];
        }
        return string.concat(vm.toString(value / unit), ".", string(padded));
    }
}

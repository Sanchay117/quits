// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ClearingHouse} from "../../src/ClearingHouse.sol";
import {MockArcUSDC} from "../../src/mocks/MockArcUSDC.sol";
import {MockFiatToken} from "../../src/mocks/MockFiatToken.sol";

/// @dev The blocklist surface shared by the USDC doubles and the EURC mock.
interface IBlocklist {
    function isBlacklisted(address account) external view returns (bool);
    function setBlacklisted(address account, bool blocked) external;
}

/// @notice Shared setup: Arc's USDC address holds a USDC double, EURC is a mock FiatToken, and six funded-on-demand
///         members. Amounts are 6-decimal units, so `100e6` is 100 USDC.
abstract contract ClearingHouseFixture is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant NATIVE_SCALE = 1e12;

    ClearingHouse internal house;
    MockFiatToken internal eurc;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    address internal erin;
    address internal frank;
    uint256 internal aliceKey;
    address internal solver;

    function setUp() public virtual {
        _installUsdc();
        eurc = new MockFiatToken("EURC", "EURC");
        house = new ClearingHouse(USDC, _addresses(address(eurc)));
        (alice, aliceKey) = makeAddrAndKey("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        erin = makeAddr("erin");
        frank = makeAddr("frank");
        solver = makeAddr("solver");
        // Most suites test netting itself, so the actors let any solver draw on their deposits. The consent rule has
        // its own suite (SolverConsent.t.sol), which turns this off.
        if (_actorsAllowAnySolver()) {
            address[6] memory actors = [alice, bob, carol, dave, erin, frank];
            for (uint256 i; i < actors.length; ++i) {
                vm.prank(actors[i]);
                house.setSolver(address(0), true);
            }
        }
    }

    function _actorsAllowAnySolver() internal pure virtual returns (bool) {
        return true;
    }

    /// @dev Puts a USDC double at Arc's USDC address. Suites that need ERC-20 transfers of native USDC override this.
    function _installUsdc() internal virtual {
        vm.etch(USDC, type(MockArcUSDC).runtimeCode);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Invoices
    // ---------------------------------------------------------------------------------------------------------------

    function _issue(address creditor, address debtor, address token, uint256 amount, uint64 dueDate)
        internal
        returns (uint256 id)
    {
        vm.prank(creditor);
        id = house.issueInvoice(debtor, token, amount, dueDate, bytes32(0), "");
    }

    /// @dev An accepted USDC invoice that is due now: `debtor` owes `creditor` `amount`.
    function _owe(address debtor, address creditor, uint256 amount) internal returns (uint256 id) {
        return _oweIn(USDC, debtor, creditor, amount);
    }

    function _oweIn(address token, address debtor, address creditor, uint256 amount) internal returns (uint256 id) {
        id = _issue(creditor, debtor, token, amount, 0);
        vm.prank(debtor);
        house.acceptInvoice(id);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Deposits
    // ---------------------------------------------------------------------------------------------------------------

    function _depositUsdc(address member, uint256 amount) internal {
        uint256 value = amount * NATIVE_SCALE;
        vm.deal(member, member.balance + value);
        vm.prank(member);
        house.deposit{value: value}();
    }

    function _depositEurc(address member, uint256 amount) internal {
        eurc.mint(member, amount);
        vm.startPrank(member);
        eurc.approve(address(house), amount);
        house.depositToken(address(eurc), amount);
        vm.stopPrank();
    }

    function _deposit(address token, address member, uint256 amount) internal {
        if (token == USDC) _depositUsdc(member, amount);
        else _depositEurc(member, amount);
    }

    function _block(address token, address member) internal {
        IBlocklist(token).setBlacklisted(member, true);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------------------------------------------------

    function _settle(address token, uint256[] memory ids, uint256[] memory amounts) internal returns (uint256) {
        vm.prank(solver);
        return house.settle(token, ids, amounts);
    }

    function _expectSettleRevert(address token, uint256[] memory ids, uint256[] memory amounts, bytes memory reason)
        internal
    {
        vm.expectRevert(reason);
        vm.prank(solver);
        house.settle(token, ids, amounts);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Array literals
    // ---------------------------------------------------------------------------------------------------------------

    function _uints(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _uints(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        (out[0], out[1]) = (a, b);
    }

    function _uints(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory out) {
        out = new uint256[](3);
        (out[0], out[1], out[2]) = (a, b, c);
    }

    function _uints(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory out) {
        out = new uint256[](4);
        (out[0], out[1], out[2], out[3]) = (a, b, c, d);
    }

    function _addresses(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _addresses(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        (out[0], out[1], out[2]) = (a, b, c);
    }
}

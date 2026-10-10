// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ClearingHouse} from "../../src/ClearingHouse.sol";

/// @notice A withdrawal destination that refuses native value, like a contract without a payable receive.
contract NativeRejecter {
    receive() external payable {
        revert("NativeRejecter: no thanks");
    }
}

/// @notice Receives a USDC withdrawal and tries to re-enter the clearing house while the value arrives. It accepts
///         the value and records how the nested call failed, so a test can inspect the guard's revert data.
contract ReentrantReceiver {
    ClearingHouse private immutable _house;
    address private immutable _usdc;
    bytes public reentryError;

    constructor(ClearingHouse house) {
        _house = house;
        _usdc = house.usdc();
    }

    function withdrawFromHouse(uint256 amount) external {
        _house.withdraw(_usdc, amount, address(this));
    }

    receive() external payable {
        try _house.withdraw(_usdc, 1, address(this)) {}
        catch (bytes memory reason) {
            reentryError = reason;
        }
    }
}

/// @notice Runs two settlements in one transaction, to show that the transient net ledger starts empty each time.
contract DoubleSettler {
    struct Solution {
        address token;
        uint256[] ids;
        uint256[] amounts;
    }

    function settleTwice(ClearingHouse house, Solution calldata first, Solution calldata second)
        external
        returns (uint256 firstCycle, uint256 secondCycle)
    {
        firstCycle = house.settle(first.token, first.ids, first.amounts);
        secondCycle = house.settle(second.token, second.ids, second.amounts);
    }

    /// @dev The first settlement is expected to revert part-way through; its partial nets must not leak.
    function settleAfterFailure(ClearingHouse house, Solution calldata failing, Solution calldata second)
        external
        returns (bool firstSucceeded, uint256 secondCycle)
    {
        try house.settle(failing.token, failing.ids, failing.amounts) {
            firstSucceeded = true;
        } catch {}
        secondCycle = house.settle(second.token, second.ids, second.amounts);
    }
}

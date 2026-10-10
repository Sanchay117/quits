// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Mock of Arc's USDC ERC-20 view
/// @notice On Arc, USDC is the native coin and `0x3600000000000000000000000000000000000000` is a FiatToken whose
///         6-decimal balances mirror native balances. This mock is etched at that address on a local anvil chain so
///         that the clearing house's blocklist checks and balance reads work there.
/// @dev Designed to run from etched code: there is no constructor state, names are pure functions and the
///      blocklist lives in ordinary storage at the etched address. Moving USDC through this mock is not supported;
///      local scripts move USDC as native value instead.
contract MockArcUSDC {
    /// @dev Native USDC has 18 decimals and the ERC-20 view has 6.
    uint256 private constant _NATIVE_SCALE = 1e12;

    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);

    function name() external pure returns (string memory) {
        return "USDC";
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    /// @notice The account's native balance in 6-decimal units, as Arc's FiatToken view reports it.
    function balanceOf(address account) external view returns (uint256) {
        return account.balance / _NATIVE_SCALE;
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    /// @notice Add or remove `account` from the blocklist. Unrestricted: this is a local test double.
    function setBlacklisted(address account, bool blocked) external {
        _blacklisted[account] = blocked;
        if (blocked) emit Blacklisted(account);
        else emit UnBlacklisted(account);
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("MockArcUSDC: send USDC as native value on a local chain");
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("MockArcUSDC: send USDC as native value on a local chain");
    }
}

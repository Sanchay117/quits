// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

/// @title Test model of Arc's native USDC ERC-20 view
/// @notice On Arc, the FiatToken at `0x3600000000000000000000000000000000000000` and the native coin are one balance:
///         an ERC-20 transfer of 1 unit (6 decimals) moves 1e12 wei of native value. This harness reproduces that
///         by rewriting native balances with Foundry's `deal` cheatcode, so tests can exercise the ERC-20 deposit path
///         (`depositToken(usdc, amount)`) against the native withdrawal path and check the two stay consistent.
/// @dev Etch it at the USDC address in a test. Only usable inside `forge test`, where any contract may call
///      cheatcodes. Allowances and the blocklist follow FiatToken's rules.
contract NativeUSDCHarness {
    Vm private constant _VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant _NATIVE_SCALE = 1e12;

    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) private _blacklisted;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier notBlacklisted(address account) {
        require(!_blacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    function name() external pure returns (string memory) {
        return "USDC";
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address account) public view returns (uint256) {
        return account.balance / _NATIVE_SCALE;
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function setBlacklisted(address account, bool blocked) external {
        _blacklisted[account] = blocked;
    }

    function approve(address spender, uint256 value)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(spender)
        returns (bool)
    {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external notBlacklisted(msg.sender) notBlacklisted(to) returns (bool) {
        _moveNative(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(from)
        notBlacklisted(to)
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        require(value <= allowed, "ERC20: transfer amount exceeds allowance");
        allowance[from][msg.sender] = allowed - value;
        _moveNative(from, to, value);
        return true;
    }

    /// @dev The ERC-20 amount is the native amount divided by 1e12, so a transfer moves `value * 1e12` wei.
    function _moveNative(address from, address to, uint256 value) private {
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value <= balanceOf(from), "ERC20: transfer amount exceeds balance");
        uint256 wei_ = value * _NATIVE_SCALE;
        _VM.deal(from, from.balance - wei_);
        _VM.deal(to, to.balance + wei_);
        emit Transfer(from, to, value);
    }
}

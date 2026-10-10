// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Mock FiatToken
/// @notice A test double for Circle's FiatToken (USDC, EURC) used in tests and on a local anvil chain: a 6-decimal
///         ERC-20 with EIP-2612 permit and a blocklist that behaves like FiatToken's. Minting and the blocklist are
///         open to anyone, so never deploy this anywhere that matters.
contract MockFiatToken {
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// @dev Upper bound for the `s` value of a non-malleable secp256k1 signature (EIP-2).
    uint256 private constant _MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    string public name;
    string public symbol;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    mapping(address => bool) private _blacklisted;

    uint256 private immutable _DEPLOY_CHAIN_ID;
    bytes32 private immutable _DEPLOY_DOMAIN_SEPARATOR;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);

    /// @dev FiatToken checks every party it touches; the revert text matches Circle's contract.
    modifier notBlacklisted(address account) {
        require(!_blacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        _DEPLOY_CHAIN_ID = block.chainid;
        _DEPLOY_DOMAIN_SEPARATOR = _domainSeparator();
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    /// @notice FiatToken v2 signs permits under domain version "2".
    function version() external pure returns (string memory) {
        return "2";
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _DEPLOY_CHAIN_ID ? _DEPLOY_DOMAIN_SEPARATOR : _domainSeparator();
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    /// @notice Add or remove `account` from the blocklist. Unrestricted: this is a test double.
    function setBlacklisted(address account, bool blocked) external {
        _blacklisted[account] = blocked;
        if (blocked) emit Blacklisted(account);
        else emit UnBlacklisted(account);
    }

    /// @notice Create `amount` new tokens for `to`. Unrestricted: this is a test double.
    function mint(address to, uint256 amount) external notBlacklisted(to) {
        require(to != address(0), "FiatToken: mint to the zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 value)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(spender)
        returns (bool)
    {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external notBlacklisted(msg.sender) notBlacklisted(to) returns (bool) {
        _transfer(msg.sender, to, value);
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
        _transfer(from, to, value);
        return true;
    }

    /// @notice EIP-2612: set an allowance from an off-chain signature by `owner`.
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        notBlacklisted(owner)
        notBlacklisted(spender)
    {
        // EIP-2612 defines the deadline against block time; seconds of validator drift do not matter here.
        // forge-lint: disable-next-line(block-timestamp)
        require(deadline >= block.timestamp, "FiatTokenV2: permit is expired");
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        require(_recover(digest, v, r, s) == owner, "EIP2612: invalid signature");
        _approve(owner, spender, value);
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ERC20: transfer to the zero address");
        uint256 balance = balanceOf[from];
        require(value <= balance, "ERC20: transfer amount exceeds balance");
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _approve(address owner, address spender, uint256 value) private {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    /// @dev Rejects malleable and malformed signatures, as FiatToken's ECRecover library does.
    function _recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) private pure returns (address signer) {
        require(uint256(s) <= _MAX_S, "ECRecover: invalid signature 's' value");
        require(v == 27 || v == 28, "ECRecover: invalid signature 'v' value");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ECRecover: invalid signature");
    }

    function _domainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("2"), block.chainid, address(this))
            );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The FiatToken surface Circle's USDC and EURC expose on Arc: ERC-20, EIP-2612 permit and the blocklist view.
interface IFiatToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function isBlacklisted(address account) external view returns (bool);
}

/// @title Quits clearing house
/// @notice Multilateral netting for invoices on Arc.
///
/// Members invoice each other and debtors accept the invoices they owe. Anyone may then submit a netting cycle: an
/// amount to clear on each of a set of matured, accepted invoices. The contract adds up what every member receives and
/// pays over that set, and settles only the differences from deposits held here, in one atomic transaction. A loop of
/// debts (A owes B, B owes C, C owes A) clears without moving any money at all.
///
/// The optimization runs offchain; the rules below are enforced onchain:
///  - only accepted invoices whose due date has passed can clear, and never by more than what is still outstanding;
///  - a member pays cash only for its net position over the submitted cycle, and only from its own deposit;
///  - every member whose net over the cycle is negative (it pays cash) must be the submitter, or have approved the
///    submitter (or anyone) with setSolver. Otherwise a counterparty could submit only the debts the member owes and
///    leave out the ones owed to it, turning a position that nets to zero into a full cash payment ("cherry-picking").
///    Members whose net is zero or positive need no approval, so a cycle that draws no cash (a pure loop of debt) can
///    be submitted by anyone;
///  - each member's deposit moves by exactly what it is owed minus what it owes on the cleared amounts, so its overall
///    position (deposit plus receivables minus payables) is unchanged and no money is created or destroyed;
///  - members on the token's blocklist (and on USDC's, which is Arc's chain-level blocklist) cannot take part;
///  - the whole cycle reverts if any of these checks fails, so a cycle never settles half-way.
///
/// Deposits: a deposit is a member's prefunded liquidity for net payments in one token, and this contract holds it
/// one to one. settle() draws on it only for the member's net payment in that cycle, and only when the member submits
/// the cycle or approved the submitter. An approved solver (or anyone, if the member approved address(0)) chooses
/// which of the member's matured, accepted debts that cash pays, so a member should approve only a solver it trusts to
/// net its whole book. A member can withdraw at any time unless it is blocklisted, in which case its deposit stays as
/// frozen as it would be in its own wallet. Only deposit(), depositToken() and depositWithPermit() credit a deposit:
/// value sent here any other way (for example a USDC transfer through the 0x3600 ERC-20 interface, which runs no code
/// here) belongs to no one and cannot be recovered. There is no owner, admin, upgrade path or fee.
///
/// USDC is Arc's native coin, so USDC deposits are plain value transfers (one transaction, no approval) and USDC
/// withdrawals are native sends. Internal accounting uses the 6-decimal ERC-20 units shared by USDC and EURC.
contract ClearingHouse {
    enum Status {
        None,
        Pending, // issued by the creditor, waiting for the debtor
        Open, // accepted by the debtor: a debt that netting may clear
        Paid, // fully cleared
        Rejected, // declined by the debtor
        Cancelled // withdrawn by the creditor before acceptance
    }

    struct Invoice {
        address creditor;
        uint64 dueDate;
        Status status;
        address debtor;
        uint96 amount;
        address token;
        uint96 outstanding;
        bytes32 ref;
        uint64 issuedAt;
        string memo;
    }

    struct Cycle {
        address token;
        uint32 invoiceCount;
        uint32 memberCount;
        address solver;
        uint48 timestamp;
        uint48 blockNumber;
        uint128 grossCleared;
        uint128 cashMoved;
    }

    /// @notice Native USDC carries 18 decimals; the ERC-20 view (and this contract's accounting) carries 6.
    uint256 public constant NATIVE_SCALE = 1e12;
    uint256 public constant MAX_BATCH = 256;
    uint256 public constant MAX_MEMO = 140;
    uint256 public constant MAX_NAME = 48;

    bytes32 private constant _NET_SEED = keccak256("quits.net");
    bytes32 private constant _SEEN_SEED = keccak256("quits.seen");

    /// @notice USDC, whose native balance funds deposits and withdrawals (0x3600...0000 on every Arc network).
    address public immutable usdc;

    mapping(address => bool) public isSupported;
    address[] private _tokens;

    uint256 public invoiceCount;
    mapping(uint256 => Invoice) private _invoices;

    mapping(address => mapping(address => uint256)) private _balances;

    mapping(address => bool) public isMember;
    mapping(address => string) public nameOf;
    /// @notice member => solver => may submit cycles that draw cash from member's deposit. address(0) means anyone.
    mapping(address => mapping(address => bool)) public isSolverFor;
    address[] private _members;

    Cycle[] private _cycles;
    mapping(address => uint256) public totalCleared;
    mapping(address => uint256) public totalCashMoved;

    bool private transient _locked;

    event MemberProfile(address indexed member, string name);
    event SolverSet(address indexed member, address indexed solver, bool allowed);
    event Deposited(address indexed member, address indexed token, uint256 amount);
    event Withdrawn(address indexed member, address indexed token, uint256 amount, address to);
    event InvoiceIssued(
        uint256 indexed id,
        address indexed creditor,
        address indexed debtor,
        address token,
        uint256 amount,
        uint64 dueDate,
        bytes32 ref,
        string memo
    );
    event InvoiceAccepted(uint256 indexed id);
    event InvoiceRejected(uint256 indexed id);
    event InvoiceCancelled(uint256 indexed id);
    event InvoiceCleared(uint256 indexed cycleId, uint256 indexed id, uint256 amount, uint256 remaining);
    event MemberNetted(uint256 indexed cycleId, address indexed member, int256 net);
    event CycleSettled(
        uint256 indexed cycleId,
        address indexed token,
        address indexed solver,
        uint256 invoiceCount,
        uint256 memberCount,
        uint256 grossCleared,
        uint256 cashMoved
    );

    error Reentrancy();
    error UnsupportedToken(address token);
    error BadAmount();
    error BadCounterparty();
    error BadName();
    error MemoTooLong();
    error NotDebtor(uint256 id);
    error NotCreditor(uint256 id);
    error NotPending(uint256 id);
    error EmptySolution();
    error LengthMismatch();
    error BatchTooLarge();
    error IdsNotAscending();
    error InvoiceNotOpen(uint256 id);
    error TokenMismatch(uint256 id);
    error InvoiceNotDue(uint256 id);
    error ClearExceedsOutstanding(uint256 id);
    error MemberBlocked(address member);
    error PayerNotConsenting(address member);
    error InsufficientLiquidity(address member, uint256 needed, uint256 available);
    error InsufficientBalance(uint256 available, uint256 requested);
    error TransferFailed();

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    /// @param usdc_ Arc's USDC (native coin and FiatToken ERC-20 view).
    /// @param otherTokens Further FiatToken-style stablecoins to clear, e.g. EURC.
    // usdc_ is zero-checked: _addToken(usdc_) below reverts with UnsupportedToken(address(0)).
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address usdc_, address[] memory otherTokens) {
        usdc = usdc_;
        _addToken(usdc_);
        for (uint256 i; i < otherTokens.length; ++i) {
            _addToken(otherTokens[i]);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Members
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Allow (or stop allowing) `solver` to submit cycles in which the caller pays cash from its deposit.
    ///         Pass address(0) to allow anyone. A member can always submit its own cycles, and needs no approval for
    ///         cycles in which it pays nothing (net zero or positive).
    /// @dev An approved solver chooses which of the caller's matured, accepted debts its deposit pays, so approval
    ///      is trust that the solver nets the caller's whole book rather than cherry-picking its debts.
    function setSolver(address solver, bool allowed) external {
        isSolverFor[msg.sender][solver] = allowed;
        emit SolverSet(msg.sender, solver, allowed);
    }

    /// @notice Set (or rename) the caller's public display name and list it in members(). Being a member is optional:
    ///         issuing, accepting, depositing and settling do not require it.
    function register(string calldata name) external {
        uint256 len = bytes(name).length;
        if (len == 0 || len > MAX_NAME) revert BadName();
        if (!isMember[msg.sender]) {
            isMember[msg.sender] = true;
            _members.push(msg.sender);
        }
        nameOf[msg.sender] = name;
        emit MemberProfile(msg.sender, name);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Invoices
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Bill `debtor`. The invoice becomes a debt only once the debtor accepts it.
    /// @param dueDate Unix time from which netting may clear it (0 = immediately).
    /// @param ref The caller's own reference, e.g. an invoice number (Arc Memo compatible bytes32).
    function issueInvoice(
        address debtor,
        address token,
        uint256 amount,
        uint64 dueDate,
        bytes32 ref,
        string calldata memo
    ) external returns (uint256 id) {
        if (debtor == address(0) || debtor == msg.sender) revert BadCounterparty();
        if (!isSupported[token]) revert UnsupportedToken(token);
        if (amount == 0 || amount > type(uint96).max) revert BadAmount();
        if (bytes(memo).length > MAX_MEMO) revert MemoTooLong();

        id = ++invoiceCount;
        Invoice storage inv = _invoices[id];
        inv.creditor = msg.sender;
        inv.dueDate = dueDate;
        inv.status = Status.Pending;
        inv.debtor = debtor;
        // casting to 'uint96' is safe because amount <= type(uint96).max is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        inv.amount = uint96(amount);
        inv.token = token;
        // casting to 'uint96' is safe because amount <= type(uint96).max is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        inv.outstanding = uint96(amount);
        inv.ref = ref;
        // casting to 'uint64' is safe because Unix time in seconds fits 64 bits for about 585 billion years
        // forge-lint: disable-next-line(unsafe-typecast)
        inv.issuedAt = uint64(block.timestamp);
        inv.memo = memo;
        emit InvoiceIssued(id, msg.sender, debtor, token, amount, dueDate, ref, memo);
    }

    /// @notice Acknowledge an invoice as a debt. From its due date, netting may clear it.
    function acceptInvoice(uint256 id) external {
        Invoice storage inv = _pendingInvoice(id);
        if (msg.sender != inv.debtor) revert NotDebtor(id);
        inv.status = Status.Open;
        emit InvoiceAccepted(id);
    }

    /// @notice Decline an invoice that is still pending. Once accepted, an invoice can no longer be rejected.
    function rejectInvoice(uint256 id) external {
        Invoice storage inv = _pendingInvoice(id);
        if (msg.sender != inv.debtor) revert NotDebtor(id);
        inv.status = Status.Rejected;
        emit InvoiceRejected(id);
    }

    /// @notice Withdraw an invoice the debtor has not answered yet. Once accepted, it stays open until fully cleared.
    function cancelInvoice(uint256 id) external {
        Invoice storage inv = _pendingInvoice(id);
        if (msg.sender != inv.creditor) revert NotCreditor(id);
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Deposits
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Deposit native USDC (msg.value, 18 decimals). Must be a whole number of 6-decimal units.
    function deposit() external payable nonReentrant {
        if (msg.value == 0 || msg.value % NATIVE_SCALE != 0) revert BadAmount();
        uint256 amount = msg.value / NATIVE_SCALE;
        _balances[msg.sender][usdc] += amount;
        emit Deposited(msg.sender, usdc, amount);
    }

    /// @notice Deposit a supported token through its ERC-20 interface (requires an allowance).
    function depositToken(address token, uint256 amount) external nonReentrant {
        _pull(token, amount);
    }

    /// @notice Deposit with an EIP-2612 permit in the same transaction. A permit that was already used (e.g. front-run)
    ///         is tolerated as long as the allowance is in place.
    function depositWithPermit(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        if (!isSupported[token]) revert UnsupportedToken(token);
        if (amount == 0) revert BadAmount();
        // nonReentrant, and `token` is a constructor-fixed FiatToken; a failed permit is tolerated on purpose.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        try IFiatToken(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _pull(token, amount);
    }

    /// @notice Withdraw from the caller's deposit to `to`. USDC leaves as native value.
    /// @dev A member blocklisted after depositing cannot move its deposit out (not even to a clean address), so a
    ///      deposit here stays as frozen as it would be in the member's own wallet. The recipient is screened only by
    ///      the token itself: Arc rejects native sends to USDC-blocklisted addresses, and EURC's transfer rejects
    ///      EURC-blocklisted recipients. USDC is sent with a plain call, so `to` must accept native value.
    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert BadAmount();
        if (to == address(0)) revert BadCounterparty();
        uint256 available = _balances[msg.sender][token];
        if (available < amount) revert InsufficientBalance(available, amount);
        _requireNotBlocked(token, msg.sender);
        _balances[msg.sender][token] = available - amount;
        emit Withdrawn(msg.sender, token, amount, to);
        if (token == usdc) {
            // The member picks where its own funds go; its balance is debited first and withdraw is nonReentrant.
            // forge-lint: disable-next-line(arbitrary-send-eth, reentrancy-eth)
            (bool ok,) = to.call{value: amount * NATIVE_SCALE}("");
            if (!ok) revert TransferFailed();
        } else {
            _callToken(token, abi.encodeCall(IFiatToken.transfer, (to, amount)));
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Netting
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Clear `amounts[i]` of invoice `ids[i]` for every i, then settle each member's net position.
    /// @dev Anyone may call, but every net payer (a member whose net over this cycle is negative) must be msg.sender,
    ///      or have approved msg.sender or address(0) with setSolver, else PayerNotConsenting. Members with a zero or
    ///      positive net need no approval, so a pure loop of debt can be submitted by anyone. `ids` and `amounts` must
    ///      have the same length, 1 to MAX_BATCH; `ids` must be strictly ascending (no duplicates) and name Open,
    ///      matured invoices in `token`; each amount must be 0 < amount <= outstanding. Every touched member must be
    ///      clear of the blocklists, and every net payer's deposit must cover its net payment. If any check fails the
    ///      whole cycle reverts, so it never settles half-way.
    /// @return cycleId Index of the new Cycle (getCycle), starting at 0.
    function settle(address token, uint256[] calldata ids, uint256[] calldata amounts)
        external
        nonReentrant
        returns (uint256 cycleId)
    {
        uint256 n = ids.length;
        if (n == 0) revert EmptySolution();
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (!isSupported[token]) revert UnsupportedToken(token);

        cycleId = _cycles.length;
        (address[] memory touched, uint256 touchedCount, uint256 gross) = _clear(cycleId, token, ids, amounts);
        uint256 cash = _settleNets(cycleId, token, touched, touchedCount);

        _cycles.push(
            Cycle({
                token: token,
                // casting to 'uint32' is safe because n <= MAX_BATCH (256) is checked above
                // forge-lint: disable-next-line(unsafe-typecast)
                invoiceCount: uint32(n),
                // casting to 'uint32' is safe because each invoice touches two members, so touchedCount <= 512
                // forge-lint: disable-next-line(unsafe-typecast)
                memberCount: uint32(touchedCount),
                solver: msg.sender,
                // casting to 'uint48' is safe because 2^48 seconds is about 8.9 million years
                // forge-lint: disable-next-line(unsafe-typecast)
                timestamp: uint48(block.timestamp),
                // casting to 'uint48' is safe because 2^48 blocks last about 890,000 years even at 10 blocks a second
                // forge-lint: disable-next-line(unsafe-typecast)
                blockNumber: uint48(block.number),
                // casting to 'uint128' is safe because each clear is at most a uint96 outstanding and n <= 256, so
                // gross < 2^104
                // forge-lint: disable-next-line(unsafe-typecast)
                grossCleared: uint128(gross),
                // casting to 'uint128' is safe because the net payments sum to at most the debits, so cash <= gross
                // forge-lint: disable-next-line(unsafe-typecast)
                cashMoved: uint128(cash)
            })
        );
        totalCleared[token] += gross;
        totalCashMoved[token] += cash;
        // The only external calls before this are isBlacklisted views (STATICCALL), which cannot re-enter.
        // forge-lint: disable-next-line(reentrancy-events)
        emit CycleSettled(cycleId, token, msg.sender, n, touchedCount, gross, cash);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    function balanceOf(address member, address token) external view returns (uint256) {
        return _balances[member][token];
    }

    function balancesOf(address[] calldata members_, address token) external view returns (uint256[] memory out) {
        out = new uint256[](members_.length);
        for (uint256 i; i < members_.length; ++i) {
            out[i] = _balances[members_[i]][token];
        }
    }

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    /// @notice Invoices `fromId` .. `fromId + count - 1`, clipped to the ones that exist.
    function getInvoices(uint256 fromId, uint256 count) external view returns (Invoice[] memory out) {
        if (fromId == 0) fromId = 1;
        uint256 last = invoiceCount;
        if (fromId > last || count == 0) return new Invoice[](0);
        uint256 end = count > last - fromId ? last : fromId + count - 1;
        out = new Invoice[](end - fromId + 1);
        for (uint256 id = fromId; id <= end; ++id) {
            out[id - fromId] = _invoices[id];
        }
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function supportedTokens() external view returns (address[] memory) {
        return _tokens;
    }

    function cycleCount() external view returns (uint256) {
        return _cycles.length;
    }

    function getCycle(uint256 cycleId) external view returns (Cycle memory) {
        return _cycles[cycleId];
    }

    /// @notice Cycles `fromId` .. `fromId + count - 1`, clipped to the ones that exist.
    function getCycles(uint256 fromId, uint256 count) external view returns (Cycle[] memory out) {
        uint256 total = _cycles.length;
        if (fromId >= total || count == 0) return new Cycle[](0);
        uint256 end = count > total - fromId ? total : fromId + count;
        out = new Cycle[](end - fromId);
        for (uint256 i = fromId; i < end; ++i) {
            out[i - fromId] = _cycles[i];
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------------------------

    function _addToken(address token) private {
        if (token == address(0) || isSupported[token]) revert UnsupportedToken(token);
        isSupported[token] = true;
        _tokens.push(token);
    }

    function _pendingInvoice(uint256 id) private view returns (Invoice storage inv) {
        inv = _invoices[id];
        if (inv.status != Status.Pending) revert NotPending(id);
    }

    function _pull(address token, uint256 amount) private {
        if (!isSupported[token]) revert UnsupportedToken(token);
        if (amount == 0) revert BadAmount();
        _callToken(token, abi.encodeCall(IFiatToken.transferFrom, (msg.sender, address(this), amount)));
        _balances[msg.sender][token] += amount;
        // The transferFrom above goes to a constructor-fixed FiatToken from a nonReentrant entry point.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Deposited(msg.sender, token, amount);
    }

    /// @dev Calls a supported token and requires success: no revert, and either `true` or (from a contract) no data.
    function _callToken(address token, bytes memory data) private {
        // Every caller is nonReentrant, and `token` is always a constructor-fixed FiatToken.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || (ret.length == 0 && token.code.length == 0)) {
            revert TransferFailed();
        }
    }

    /// @dev Applies each clear to its invoice and accumulates every member's net position.
    function _clear(uint256 cycleId, address token, uint256[] calldata ids, uint256[] calldata amounts)
        private
        returns (address[] memory touched, uint256 touchedCount, uint256 gross)
    {
        uint256 n = ids.length;
        touched = new address[](2 * n);
        uint256 lastId;
        for (uint256 i; i < n; ++i) {
            uint256 id = ids[i];
            // lastId starts at 0 on purpose: ids start at 1, so id 0 fails this check.
            // forge-lint: disable-next-line(uninitialized-local)
            if (id <= lastId) revert IdsNotAscending();
            lastId = id;
            uint256 amount = amounts[i];
            touchedCount = _clearOne(cycleId, token, id, amount, touched, touchedCount);
            gross += amount;
        }
    }

    function _clearOne(
        uint256 cycleId,
        address token,
        uint256 id,
        uint256 amount,
        address[] memory touched,
        uint256 touchedCount
    ) private returns (uint256) {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen(id);
        if (inv.token != token) revert TokenMismatch(id);
        // Due dates are calendar dates, so a few seconds of validator clock drift do not matter.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < inv.dueDate) revert InvoiceNotDue(id);
        uint256 outstanding = inv.outstanding;
        if (amount == 0 || amount > outstanding) revert ClearExceedsOutstanding(id);

        uint256 remaining = outstanding - amount;
        // casting to 'uint96' is safe because remaining <= outstanding, which was read from a uint96
        // forge-lint: disable-next-line(unsafe-typecast)
        inv.outstanding = uint96(remaining);
        if (remaining == 0) inv.status = Status.Paid;

        // casting to 'int256' is safe because amount <= outstanding < 2^96 is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        touchedCount = _addNet(inv.creditor, int256(amount), touched, touchedCount);
        // casting to 'int256' is safe because amount <= outstanding < 2^96 is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        touchedCount = _addNet(inv.debtor, -int256(amount), touched, touchedCount);
        // No external call precedes this in settle(): the blocklist views run later, in _settleNets.
        // forge-lint: disable-next-line(reentrancy-events)
        emit InvoiceCleared(cycleId, id, amount, remaining);
        return touchedCount;
    }

    /// @dev Moves each member's net position against its deposit. Reverts unless every touched member is clear of the
    ///      blocklists and every net payer both consents to msg.sender (_mayDraw) and can cover its payment.
    function _settleNets(uint256 cycleId, address token, address[] memory touched, uint256 touchedCount)
        private
        returns (uint256 cash)
    {
        for (uint256 j; j < touchedCount; ++j) {
            address member = touched[j];
            int256 net = _takeNet(member);
            _requireNotBlocked(token, member);
            if (net < 0) {
                if (!_mayDraw(member, msg.sender)) revert PayerNotConsenting(member);
                // casting to 'uint256' is safe because net < 0 here and |net| <= gross < 2^104, so -net cannot overflow
                // forge-lint: disable-next-line(unsafe-typecast)
                uint256 owed = uint256(-net);
                uint256 available = _balances[member][token];
                if (available < owed) revert InsufficientLiquidity(member, owed, available);
                _balances[member][token] = available - owed;
                cash += owed;
            } else if (net > 0) {
                // casting to 'uint256' is safe because net > 0 here
                // forge-lint: disable-next-line(unsafe-typecast)
                _balances[member][token] += uint256(net);
            }
            // The only external calls before this are isBlacklisted views (STATICCALL), which cannot re-enter.
            // forge-lint: disable-next-line(reentrancy-events)
            emit MemberNetted(cycleId, member, net);
        }
    }

    /// @dev Whether `solver` may draw `member`'s net payment: the member itself, a solver it approved, or anyone once
    ///      the member approved address(0).
    function _mayDraw(address member, address solver) private view returns (bool) {
        return member == solver || isSolverFor[member][solver] || isSolverFor[member][address(0)];
    }

    /// @dev Reverts if `member` is on `token`'s blocklist, or on USDC's (Arc's chain-level list) for any other token.
    ///      settle() calls this once per touched member, at most 512 times; the targets are the constructor-fixed
    ///      tokens and the calls are views.
    function _requireNotBlocked(address token, address member) private view {
        // One view call per member and token is the blocklist rule itself (see above).
        // forge-lint: disable-next-line(calls-loop)
        if (IFiatToken(token).isBlacklisted(member)) revert MemberBlocked(member);
        // forge-lint: disable-next-line(calls-loop)
        if (token != usdc && IFiatToken(usdc).isBlacklisted(member)) revert MemberBlocked(member);
    }

    /// @dev Accumulates a member's net position for the current settlement in transient storage.
    function _addNet(address member, int256 delta, address[] memory touched, uint256 count) private returns (uint256) {
        bytes32 netSlot = keccak256(abi.encode(member, _NET_SEED));
        bytes32 seenSlot = keccak256(abi.encode(member, _SEEN_SEED));
        uint256 seen;
        assembly ("memory-safe") {
            seen := tload(seenSlot)
            tstore(netSlot, add(tload(netSlot), delta))
        }
        if (seen == 0) {
            assembly ("memory-safe") {
                tstore(seenSlot, 1)
            }
            touched[count++] = member;
        }
        return count;
    }

    /// @dev Reads a member's accumulated net position and clears its transient slots.
    function _takeNet(address member) private returns (int256 net) {
        bytes32 netSlot = keccak256(abi.encode(member, _NET_SEED));
        bytes32 seenSlot = keccak256(abi.encode(member, _SEEN_SEED));
        assembly ("memory-safe") {
            net := tload(netSlot)
            tstore(netSlot, 0)
            tstore(seenSlot, 0)
        }
    }
}

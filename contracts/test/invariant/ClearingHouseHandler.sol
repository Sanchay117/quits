// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {ClearingHouse} from "../../src/ClearingHouse.sol";
import {MockFiatToken} from "../../src/mocks/MockFiatToken.sol";
import {IBlocklist} from "../utils/ClearingHouseFixture.sol";
import {NativeUSDCHarness} from "../mocks/NativeUSDCHarness.sol";

/// @notice Drives the clearing house through random sequences of member actions for the invariant suite.
///
/// The handler keeps two independent records:
///  - a model (ghost ledger, invoice statuses and outstanding amounts, and every member's solver approvals) updated
///    only from what each action should do, plus a prediction of whether each call should succeed and, for settle(),
///    of the exact error it should revert with;
///  - observations of the contract after every action, used to check that statuses only move along legal edges, that
///    outstanding amounts only fall, and only inside settle(), and that a deposit falls in settle() only when its
///    owner sent the cycle or approved the sender.
/// Cycles are sent by members and by strangers (addresses that never hold a deposit), and members keep changing whom
/// they approve, so the consent rule decides real calls in both directions.
/// Assertions here would be swallowed (the suite tolerates handler reverts), so every check increments a counter that
/// the invariant functions require to stay at zero.
contract ClearingHouseHandler is CommonBase, StdCheats, StdUtils {
    uint256 private constant NATIVE_SCALE = 1e12;
    uint256 private constant ACTOR_COUNT = 5;
    uint256 private constant STRANGER_COUNT = 2;
    uint256 private constant MAX_INVOICES = 48;
    uint256 private constant MAX_CLEARS = 10;
    uint256 private constant MAX_DEPOSIT = 500e6;
    uint256 private constant MAX_INVOICE_AMOUNT = 300e6;

    struct InvoiceTerms {
        address creditor;
        address debtor;
        address token;
        uint64 dueDate;
        uint256 amount;
    }

    struct Solution {
        address token;
        uint256[] ids;
        uint256[] amounts;
        uint256[] received;
        uint256[] paid;
        uint256 gross;
    }

    ClearingHouse public immutable house;
    address public immutable usdc;
    MockFiatToken public immutable eurc;
    address[] private _actors;
    address[] private _strangers;
    /// @dev Every address setSolver is called with: address(0) (anyone), then the actors, then the strangers.
    address[] private _solverCandidates;
    address private immutable _payee;

    // Model.
    mapping(address token => uint256) public ghostDeposited;
    mapping(address token => uint256) public ghostWithdrawn;
    mapping(uint256 id => uint256) public ghostOutstanding;
    mapping(uint256 id => ClearingHouse.Status) public ghostStatus;
    mapping(uint256 id => InvoiceTerms) private _terms;
    uint256 public ghostInvoiceCount;
    /// @notice member => solver => approved, from the member's own setSolver calls. address(0) means anyone.
    mapping(address member => mapping(address solver => bool)) public ghostApproved;

    // Observations.
    mapping(uint256 id => ClearingHouse.Status) private _seenStatus;
    mapping(uint256 id => uint256) private _seenOutstanding;

    // Violations: each must stay zero.
    uint256 public modelMismatches;
    uint256 public illegalTransitions;
    uint256 public outstandingIncreases;
    uint256 public outstandingChangedOutsideSettle;
    uint256 public settleNetMismatches;
    uint256 public settleCashMismatches;
    uint256 public settleSumChanges;
    uint256 public drawsWithoutConsent;
    uint256 public approvalMismatches;

    // Coverage, to show the campaign does real work.
    uint256 public settlesSucceeded;
    uint256 public settlesRejected;
    uint256 public invoicesPaid;
    uint256 public settlesByStrangers;
    uint256 public settlesRefusedForConsent;
    uint256 public drawsBySelf;
    uint256 public drawsByApprovedSender;
    uint256 public approvalChanges;

    // Blocklist: at most one (actor, token) pair is blocked at a time, so most cycles can still settle.
    address private _blockedActor;
    address private _blockedOn;

    constructor(ClearingHouse house_, MockFiatToken eurc_) {
        house = house_;
        usdc = house_.usdc();
        eurc = eurc_;
        _solverCandidates.push(address(0));
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            address actor = makeAddr(string.concat("actor", vm.toString(i)));
            _actors.push(actor);
            _solverCandidates.push(actor);
        }
        for (uint256 i; i < STRANGER_COUNT; ++i) {
            address stranger = makeAddr(string.concat("stranger", vm.toString(i)));
            _strangers.push(stranger);
            _solverCandidates.push(stranger);
        }
        _payee = makeAddr("payee");

        // Every run starts from mixed consent, which setSolver() then keeps changing: three actors allow anyone (as
        // the demo companies do), actor3 trusts only actor0, and actor4 approves no one.
        for (uint256 i; i < 3; ++i) {
            _approveAtStart(house_, _actors[i], address(0));
        }
        _approveAtStart(house_, _actors[3], _actors[0]);
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Solver consent
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice A random actor allows or stops allowing a random solver: anyone (address(0)) a third of the time,
    ///         otherwise an actor (possibly itself) or a stranger.
    function setSolver(uint256 actorSeed, uint256 solverSeed, uint256 allowSeed) external {
        uint256 r = _mix(solverSeed);
        address target = r % 3 == 0 ? address(0) : _solverCandidates[1 + (r >> 2) % (_solverCandidates.length - 1)];
        address actor = _actor(actorSeed);
        bool allowed = _mix(allowSeed) % 2 == 0;

        vm.prank(actor);
        try house.setSolver(target, allowed) {
            ghostApproved[actor][target] = allowed;
            ++approvalChanges;
        } catch {
            _expect(false);
        }
        _checkApprovals();
        _observe(false);
    }

    /// @dev The contract's isSolverFor agrees with the model for every actor and every address the suite approves.
    ///      Run after setSolver(), which must change exactly one pair, and after settle(), which must change none.
    function _checkApprovals() private {
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            for (uint256 j; j < _solverCandidates.length; ++j) {
                address member = _actors[i];
                address solver = _solverCandidates[j];
                if (house.isSolverFor(member, solver) != ghostApproved[member][solver]) ++approvalMismatches;
            }
        }
    }

    /// @dev Constructor only: `house` is immutable and cannot be read from a function while the handler is built.
    function _approveAtStart(ClearingHouse house_, address member, address solver) private {
        vm.prank(member);
        house_.setSolver(solver, true);
        ghostApproved[member][solver] = true;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Members and invoices
    // ---------------------------------------------------------------------------------------------------------------

    function register(uint256 actorSeed, uint256 nameLength) external {
        address actor = _actor(actorSeed);
        uint256 length = _bound(nameLength, 0, house.MAX_NAME() + 2);
        bool expectOk = length != 0 && length <= house.MAX_NAME();

        vm.prank(actor);
        try house.register(string(new bytes(length))) {
            _expect(expectOk);
        } catch {
            _expect(!expectOk);
        }
        _observe(false);
    }

    /// @dev Half the invoices are due at once, the rest within a day. One in eight bills the creditor itself, which
    ///      must be refused.
    function issue(uint256 creditorSeed, uint256 debtorSeed, uint256 tokenSeed, uint256 amountSeed, uint256 dueSeed)
        external
    {
        if (ghostInvoiceCount >= MAX_INVOICES) return;
        uint256 creditorIndex = _mix(creditorSeed) % ACTOR_COUNT;
        uint256 d = _mix(debtorSeed);
        uint256 debtorIndex =
            d % 8 == 0 ? creditorIndex : (creditorIndex + 1 + (d >> 3) % (ACTOR_COUNT - 1)) % ACTOR_COUNT;
        uint256 due = _mix(dueSeed);
        InvoiceTerms memory terms = InvoiceTerms({
            creditor: _actors[creditorIndex],
            debtor: _actors[debtorIndex],
            token: _token(tokenSeed),
            dueDate: due % 2 == 0 ? 0 : _dueWithinADay(due >> 1),
            amount: _bound(amountSeed, 1, MAX_INVOICE_AMOUNT)
        });
        bool expectOk = terms.creditor != terms.debtor;

        vm.prank(terms.creditor);
        try house.issueInvoice(terms.debtor, terms.token, terms.amount, terms.dueDate, bytes32(0), "") returns (
            uint256 id
        ) {
            _expect(expectOk && id == ghostInvoiceCount + 1);
            ghostInvoiceCount = id;
            _terms[id] = terms;
            ghostStatus[id] = ClearingHouse.Status.Pending;
            ghostOutstanding[id] = terms.amount;
        } catch {
            _expect(!expectOk);
        }
        _observe(false);
    }

    function accept(uint256 idSeed, uint256 callerSeed) external {
        _respond(idSeed, callerSeed, ClearingHouse.Status.Open);
    }

    /// @notice The debtor rejects or the creditor cancels, at random.
    function decline(uint256 idSeed, uint256 callerSeed, uint256 choiceSeed) external {
        _respond(
            idSeed,
            callerSeed,
            _mix(choiceSeed) % 2 == 0 ? ClearingHouse.Status.Rejected : ClearingHouse.Status.Cancelled
        );
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Deposits and withdrawals
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Deposit USDC as native value or through its ERC-20 interface, which on Arc moves the same balance.
    function depositUsdc(uint256 actorSeed, uint256 amountSeed, uint256 pathSeed) external {
        address actor = _actor(actorSeed);
        uint256 amount = _bound(amountSeed, 1, MAX_DEPOSIT);
        if (_mix(pathSeed) % 2 == 0) {
            _depositNative(actor, amount);
        } else {
            bool expectOk = !_isBlocked(usdc, actor);
            vm.deal(actor, actor.balance + amount * NATIVE_SCALE);
            if (expectOk) {
                vm.prank(actor);
                NativeUSDCHarness(usdc).approve(address(house), amount);
            }
            _depositToken(actor, usdc, amount, expectOk);
        }
        _observe(false);
    }

    function depositEurc(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 amount = _bound(amountSeed, 1, MAX_DEPOSIT);
        bool expectOk = !_isBlocked(address(eurc), actor);
        if (expectOk) _fundEurc(actor, amount);
        _depositToken(actor, address(eurc), amount, expectOk);
        _observe(false);
    }

    function withdraw(uint256 actorSeed, uint256 tokenSeed, uint256 amountSeed, uint256 recipientSeed) external {
        address actor = _actor(actorSeed);
        address token = _token(tokenSeed);
        uint256 available = house.balanceOf(actor, token);
        if (available == 0) return;
        uint256 amount = _bound(amountSeed, 1, available);
        address to = _mix(recipientSeed) % 4 == 0 ? _payee : _actor(recipientSeed);

        // A member on the token's or USDC's blocklist can never withdraw (test/Regressions.t.sol). The recipient is
        // screened only by the token: EURC's transfer refuses an EURC-blocklisted recipient, while the native USDC send
        // here cannot model Arc's chain-level refusal, so a USDC withdrawal to a blocked recipient succeeds in this
        // suite (on Arc it reverts TransferFailed).
        bool expectOk = !_isBlockedAnywhere(token, actor) && !(token == address(eurc) && _isBlocked(token, to));

        vm.prank(actor);
        try house.withdraw(token, amount, to) {
            _expect(expectOk);
            ghostWithdrawn[token] += amount;
        } catch {
            _expect(!expectOk);
        }
        _observe(false);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Settlement, time and the blocklist
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Settle a random selection of open invoices, sent by a random actor or, one time in four, by a stranger.
    ///         Short payers usually top up first (as a member would after seeing the plan), so that accepted cycles are
    ///         common and rejected ones still happen.
    function settle(uint256 tokenSeed, uint256 pickSeed, uint256 senderSeed) external {
        Solution memory s = _pickSolution(_token(tokenSeed), pickSeed);
        if (s.ids.length == 0) return;
        if (_mix(pickSeed) % 4 != 0) _topUpShortPayers(s);

        address sender = _sender(senderSeed);
        bytes memory expectedError = _expectedSettleError(s, sender);
        uint256[] memory before = house.balancesOf(_actors, s.token);
        uint256[] memory otherBefore = house.balancesOf(_actors, _otherToken(s.token));

        vm.prank(sender);
        try house.settle(s.token, s.ids, s.amounts) returns (uint256 cycleId) {
            _expect(expectedError.length == 0);
            ++settlesSucceeded;
            if (_isStranger(sender)) ++settlesByStrangers;
            _checkSettlement(s, cycleId, before);
            _applyClears(s);
        } catch (bytes memory reason) {
            _expect(expectedError.length != 0 && keccak256(reason) == keccak256(expectedError));
            ++settlesRejected;
            if (bytes4(reason) == ClearingHouse.PayerNotConsenting.selector) ++settlesRefusedForConsent;
        }
        _checkConsent(s.token, sender, before, otherBefore);
        _checkApprovals();
        _observe(true);
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + _bound(secondsSeed, 1, 2 days));
        vm.roll(block.number + 1);
        _observe(false);
    }

    /// @dev Unblocks the blocked pair if there is one; otherwise blocks a random pair one time in three.
    function toggleBlock(uint256 actorSeed, uint256 tokenSeed) external {
        if (_blockedActor != address(0)) {
            IBlocklist(_blockedOn).setBlacklisted(_blockedActor, false);
            _blockedActor = address(0);
        } else if (_mix(actorSeed) % 3 == 0) {
            _blockedActor = _actor(actorSeed);
            _blockedOn = _token(tokenSeed);
            IBlocklist(_blockedOn).setBlacklisted(_blockedActor, true);
        }
        _observe(false);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Settlement model
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Walks invoices in ascending id order and includes roughly two thirds of the open ones of `token`, now and
    ///      then one that is not due yet (which the contract must reject).
    function _pickSolution(address token, uint256 seed) private view returns (Solution memory s) {
        s.token = token;
        s.received = new uint256[](ACTOR_COUNT);
        s.paid = new uint256[](ACTOR_COUNT);
        uint256[] memory ids = new uint256[](MAX_CLEARS);
        uint256[] memory amounts = new uint256[](MAX_CLEARS);
        uint256 n;
        for (uint256 id = 1; id <= ghostInvoiceCount && n < MAX_CLEARS; ++id) {
            InvoiceTerms storage terms = _terms[id];
            if (terms.token != token || ghostStatus[id] != ClearingHouse.Status.Open) continue;
            uint256 r = uint256(keccak256(abi.encode(seed, id)));
            if (r % 3 == 0) continue;
            if (block.timestamp < terms.dueDate && (r >> 8) % 8 != 0) continue;
            uint256 outstanding = ghostOutstanding[id];
            uint256 amount = (r >> 16) % 2 == 0 ? outstanding : 1 + (r >> 24) % outstanding;
            ids[n] = id;
            amounts[n] = amount;
            s.received[_indexOf(terms.creditor)] += amount;
            s.paid[_indexOf(terms.debtor)] += amount;
            s.gross += amount;
            ++n;
        }
        s.ids = _truncate(ids, n);
        s.amounts = _truncate(amounts, n);
    }

    function _topUpShortPayers(Solution memory s) private {
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            address actor = _actors[i];
            uint256 owed = _netPayment(s, i);
            uint256 available = house.balanceOf(actor, s.token);
            if (owed <= available) continue;
            if (s.token == usdc) {
                _depositNative(actor, owed - available);
            } else if (!_isBlocked(s.token, actor)) {
                _fundEurc(actor, owed - available);
                _depositToken(actor, s.token, owed - available, true);
            }
        }
    }

    /// @dev The exact error settle() must revert with when `sender` submits `s`, or empty if it must succeed. Follows the
    ///      contract's order: invoices by ascending id first (the picks are open invoices of the right token within
    ///      their outstanding, so only maturity can fail), then members in the order first touched (creditor before
    ///      debtor), each checked against the blocklists and, if it pays, for consent and then liquidity.
    function _expectedSettleError(Solution memory s, address sender) private view returns (bytes memory) {
        for (uint256 i; i < s.ids.length; ++i) {
            if (block.timestamp < _terms[s.ids[i]].dueDate) {
                return abi.encodeWithSelector(ClearingHouse.InvoiceNotDue.selector, s.ids[i]);
            }
        }
        (address[] memory touched, uint256 count) = _touchOrder(s);
        for (uint256 k; k < count; ++k) {
            address actor = touched[k];
            if (_isBlockedAnywhere(s.token, actor)) {
                return abi.encodeWithSelector(ClearingHouse.MemberBlocked.selector, actor);
            }
            uint256 owed = _netPayment(s, _indexOf(actor));
            if (owed == 0) continue;
            if (!_approves(actor, sender)) {
                return abi.encodeWithSelector(ClearingHouse.PayerNotConsenting.selector, actor);
            }
            uint256 available = house.balanceOf(actor, s.token);
            if (available < owed) {
                return abi.encodeWithSelector(ClearingHouse.InsufficientLiquidity.selector, actor, owed, available);
            }
        }
        return "";
    }

    /// @dev Members in the order settle() first touches them: invoice by invoice in id order, creditor then debtor.
    function _touchOrder(Solution memory s) private view returns (address[] memory touched, uint256 count) {
        touched = new address[](ACTOR_COUNT);
        for (uint256 i; i < s.ids.length; ++i) {
            InvoiceTerms storage terms = _terms[s.ids[i]];
            count = _touch(touched, count, terms.creditor);
            count = _touch(touched, count, terms.debtor);
        }
    }

    function _touch(address[] memory touched, uint256 count, address member) private pure returns (uint256) {
        for (uint256 j; j < count; ++j) {
            if (touched[j] == member) return count;
        }
        touched[count] = member;
        return count + 1;
    }

    /// @dev SPEC invariant 7, checked against ghost state: a deposit (in either token) falls in settle() only if its
    ///      owner sent the cycle or, by the model's record of its setSolver calls, approved the sender or anyone. Runs
    ///      after refused cycles too, which must leave every deposit as it was.
    function _checkConsent(address token, address sender, uint256[] memory before, uint256[] memory otherBefore)
        private
    {
        uint256[] memory afterwards = house.balancesOf(_actors, token);
        uint256[] memory otherAfterwards = house.balancesOf(_actors, _otherToken(token));
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            if (afterwards[i] >= before[i] && otherAfterwards[i] >= otherBefore[i]) continue;
            address actor = _actors[i];
            if (actor == sender) ++drawsBySelf;
            else if (_approves(actor, sender)) ++drawsByApprovedSender;
            else ++drawsWithoutConsent;
        }
    }

    /// @dev The consent rule, from the model's own record of setSolver calls.
    function _approves(address member, address sender) private view returns (bool) {
        return member == sender || ghostApproved[member][sender] || ghostApproved[member][address(0)];
    }

    /// @dev SPEC invariant 4 (and the settle half of invariant 1), checked on every accepted cycle.
    function _checkSettlement(Solution memory s, uint256 cycleId, uint256[] memory before) private {
        uint256[] memory afterwards = house.balancesOf(_actors, s.token);
        uint256 payments;
        uint256 receipts;
        uint256 sumBefore;
        uint256 sumAfter;
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            if (afterwards[i] + s.paid[i] != before[i] + s.received[i]) ++settleNetMismatches;
            payments += _netPayment(s, i);
            receipts += _netReceipt(s, i);
            sumBefore += before[i];
            sumAfter += afterwards[i];
        }
        ClearingHouse.Cycle memory cycle = house.getCycle(cycleId);
        if (cycle.cashMoved != payments || payments != receipts || cycle.grossCleared != s.gross) {
            ++settleCashMismatches;
        }
        if (sumAfter != sumBefore) ++settleSumChanges;
    }

    function _applyClears(Solution memory s) private {
        for (uint256 i; i < s.ids.length; ++i) {
            uint256 id = s.ids[i];
            ghostOutstanding[id] -= s.amounts[i];
            if (ghostOutstanding[id] == 0) {
                ghostStatus[id] = ClearingHouse.Status.Paid;
                ++invoicesPaid;
            }
        }
    }

    function _netPayment(Solution memory s, uint256 i) private pure returns (uint256) {
        return s.paid[i] > s.received[i] ? s.paid[i] - s.received[i] : 0;
    }

    function _netReceipt(Solution memory s, uint256 i) private pure returns (uint256) {
        return s.received[i] > s.paid[i] ? s.received[i] - s.paid[i] : 0;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Observation
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev SPEC invariants 3 and 5 as observed facts: compares every invoice with how it looked after the previous
    ///      action, independently of the model.
    function _observe(bool duringSettle) private {
        ClearingHouse.Invoice[] memory invoices = house.getInvoices(1, house.invoiceCount());
        for (uint256 i; i < invoices.length; ++i) {
            uint256 id = i + 1;
            ClearingHouse.Status previous = _seenStatus[id];
            ClearingHouse.Status current = invoices[i].status;
            if (current != previous && !_isLegalTransition(previous, current)) ++illegalTransitions;

            uint256 outstanding = invoices[i].outstanding;
            if (previous != ClearingHouse.Status.None) {
                if (outstanding > _seenOutstanding[id]) ++outstandingIncreases;
                if (outstanding < _seenOutstanding[id] && !duringSettle) ++outstandingChangedOutsideSettle;
            }
            _seenStatus[id] = current;
            _seenOutstanding[id] = outstanding;
        }
    }

    function _isLegalTransition(ClearingHouse.Status from, ClearingHouse.Status to) private pure returns (bool) {
        if (from == ClearingHouse.Status.None) return to == ClearingHouse.Status.Pending;
        if (from == ClearingHouse.Status.Pending) {
            return to == ClearingHouse.Status.Open || to == ClearingHouse.Status.Rejected
                || to == ClearingHouse.Status.Cancelled;
        }
        if (from == ClearingHouse.Status.Open) return to == ClearingHouse.Status.Paid;
        return false;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Shared steps
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Accept, reject or cancel, called by the right party three times out of four. Accepts usually target a
    ///      pending invoice; rejects and cancels do so only half the time, so that plenty of invoices end up open.
    function _respond(uint256 idSeed, uint256 callerSeed, ClearingHouse.Status outcome) private {
        if (ghostInvoiceCount == 0) return;
        uint256 r = _mix(idSeed);
        bool preferPending = outcome == ClearingHouse.Status.Open ? r % 8 != 0 : r % 2 == 0;
        uint256 id = _pickInvoice(r >> 3, preferPending);
        InvoiceTerms storage terms = _terms[id];
        address rightParty = outcome == ClearingHouse.Status.Cancelled ? terms.creditor : terms.debtor;
        address caller = _mix(callerSeed) % 4 == 0 ? _actor(callerSeed) : rightParty;
        bool expectOk = ghostStatus[id] == ClearingHouse.Status.Pending && caller == rightParty;

        bytes memory call;
        if (outcome == ClearingHouse.Status.Open) call = abi.encodeCall(ClearingHouse.acceptInvoice, (id));
        else if (outcome == ClearingHouse.Status.Rejected) call = abi.encodeCall(ClearingHouse.rejectInvoice, (id));
        else call = abi.encodeCall(ClearingHouse.cancelInvoice, (id));

        vm.prank(caller);
        (bool ok,) = address(house).call(call);
        _expect(ok == expectOk);
        if (ok) ghostStatus[id] = outcome;
        _observe(false);
    }

    /// @dev A random invoice id, or with `preferPending` the first pending one from a random starting point.
    function _pickInvoice(uint256 seed, bool preferPending) private view returns (uint256) {
        uint256 start = seed % ghostInvoiceCount;
        if (!preferPending) return 1 + start;
        for (uint256 i; i < ghostInvoiceCount; ++i) {
            uint256 id = 1 + (start + i) % ghostInvoiceCount;
            if (ghostStatus[id] == ClearingHouse.Status.Pending) return id;
        }
        return 1 + start;
    }

    function _depositNative(address actor, uint256 amount) private {
        uint256 value = amount * NATIVE_SCALE;
        vm.deal(actor, actor.balance + value);
        vm.prank(actor);
        try house.deposit{value: value}() {
            _expect(true);
            ghostDeposited[usdc] += amount;
        } catch {
            _expect(false);
        }
    }

    function _depositToken(address actor, address token, uint256 amount, bool expectOk) private {
        vm.prank(actor);
        try house.depositToken(token, amount) {
            _expect(expectOk);
            ghostDeposited[token] += amount;
        } catch {
            _expect(!expectOk);
        }
    }

    function _fundEurc(address actor, uint256 amount) private {
        eurc.mint(actor, amount);
        vm.prank(actor);
        eurc.approve(address(house), amount);
    }

    function _expect(bool asPredicted) private {
        if (!asPredicted) ++modelMismatches;
    }

    function _isBlocked(address token, address account) private view returns (bool) {
        return IBlocklist(token).isBlacklisted(account);
    }

    /// @dev On `token`'s own blocklist or on USDC's, which is Arc's chain-level blocklist.
    function _isBlockedAnywhere(address token, address account) private view returns (bool) {
        return _isBlocked(token, account) || _isBlocked(usdc, account);
    }

    /// @dev The fuzzer favours edge values such as 0 and type(uint256).max; hashing a seed before taking choices from
    ///      it keeps every branch at its intended frequency.
    function _mix(uint256 seed) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed)));
    }

    function _actor(uint256 seed) private view returns (address) {
        return _actors[_mix(seed) % ACTOR_COUNT];
    }

    /// @dev The sender of a cycle: a stranger one time in four, otherwise an actor.
    function _sender(uint256 seed) private view returns (address) {
        uint256 r = _mix(seed);
        return r % 4 == 0 ? _strangers[(r >> 2) % STRANGER_COUNT] : _actors[(r >> 4) % ACTOR_COUNT];
    }

    function _isStranger(address account) private view returns (bool) {
        for (uint256 i; i < STRANGER_COUNT; ++i) {
            if (_strangers[i] == account) return true;
        }
        return false;
    }

    function _token(uint256 seed) private view returns (address) {
        return _mix(seed) % 2 == 0 ? usdc : address(eurc);
    }

    function _otherToken(address token) private view returns (address) {
        return token == usdc ? address(eurc) : usdc;
    }

    function _dueWithinADay(uint256 seed) private view returns (uint64) {
        // casting to 'uint64' is safe because test timestamps stay many orders of magnitude below 2^64
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp + seed % 1 days);
    }

    function _indexOf(address actor) private view returns (uint256) {
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            if (_actors[i] == actor) return i;
        }
        revert("ClearingHouseHandler: unknown actor");
    }

    function _truncate(uint256[] memory values, uint256 length) private pure returns (uint256[] memory out) {
        out = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            out[i] = values[i];
        }
    }
}

# Quits: security notes

Scope: `contracts/src/ClearingHouse.sol` (Solidity 0.8.30, EVM Prague), the only contract Quits deploys. It has no
owner, no admin, no upgrade path and no fees; the supported tokens (USDC and EURC) are fixed in the constructor.
The tests and gas figures below can be reproduced from `contracts/` with the commands in [Reproduce](#reproduce).

## Threat model

**What is at stake.** Members' deposits, held by the contract one to one (native USDC and EURC), and the state of
accepted invoices, which are debts the contract will clear against those deposits.

**Who can do what.**

| Actor | Can |
| --- | --- |
| Creditor | Issue invoices to anyone (no registration needed); cancel them while pending. |
| Debtor | Accept or reject pending invoices. Accepting turns an invoice into a debt that netting may clear once due. |
| Member | Deposit, withdraw its own balance, approve solvers (`setSolver`), submit its own cycles. |
| Solver (any address) | Submit `settle()` cycles. It can only clear accepted, matured invoices, and can only draw cash from members that approved it. |
| Stranger | Everything above that needs no counterparty: issue spam invoices, register names, submit cash-free cycles. |
| Circle | Blocklist addresses on USDC (Arc's chain-level list) and EURC, pause or upgrade those token contracts. |

**Trusted.** Circle's FiatToken contracts for USDC (`0x3600...0000`) and EURC, and Arc itself (deterministic finality,
the chain-level USDC blocklist, non-decreasing block timestamps). The contract enforces Circle's blocklists on
purpose, so it inherits Circle's power over these tokens: anyone holding USDC or EURC already trusts Circle fully.

**Not trusted.** Solvers, counterparties, strangers, the offchain solver's output and the web app. The contract
re-checks every rule on every `settle()`; a solver only chooses which valid cycle to submit.

**Out of scope.** Credit risk: an accepted invoice larger than the debtor's deposit is unsecured credit, exactly as
an unpaid invoice is today. Disputes about goods or services. Privacy (every invoice, memo and balance is public).
Availability of the web app (the contract stays usable directly).

## Rules enforced on chain

- An invoice clears only if it is Open (accepted), in the cycle's token, matured (`block.timestamp >= dueDate`), and
  by `0 < amount <= outstanding`. Ids in a cycle are strictly ascending (no duplicates), 1 to 256 of them.
- A member pays cash only for its net position over the cycle (what it is owed minus what it owes on the cleared
  amounts), and only from its own deposit in that token.
- **Solver consent.** Every member whose net is negative must be the submitter, or have approved the submitter (or
  anyone, `address(0)`) with `setSolver`, else `PayerNotConsenting(member)`. Members with zero or positive net need no
  consent, so a pure loop of debt can be submitted by anyone.
- Every touched member must be off the token's blocklist and off USDC's (Arc's chain-level list), else
  `MemberBlocked(member)`; a blocklisted member cannot withdraw either, not even to a clean address.
- Every net payer's deposit must cover its payment, else `InsufficientLiquidity(member, needed, available)`.
- Any failure reverts the whole cycle; nothing settles half-way.
- Deposits are credited only through `deposit()` (native USDC, whole 6-decimal units), `depositToken()` and
  `depositWithPermit()`. Withdrawals pay exactly `amount * 1e12` wei for USDC or `amount` EURC.
- `deposit`, `depositToken`, `depositWithPermit`, `withdraw` and `settle` share a transient reentrancy lock;
  `withdraw` debits the balance before the external call.

## Invariants and how they are tested

The suite has **171 tests, all passing**: 165 unit tests, 5 fuzz tests (2,000 runs each) and 1 stateful invariant
suite that checks 6 invariants. Of the unit tests, 19 test the token mocks, 5 the deploy script and 2 are gas
measurements with budgets.

The invariant suite (`test/invariant/`) drives a handler through 128 random sequences of 250 calls each (32,000 calls):
register, issue, accept, reject, cancel, deposit (native USDC, USDC through its ERC-20 interface, EURC), withdraw,
settle (random subsets, partial amounts), time warps and blocklist changes. USDC runs on a harness whose ERC-20 view
moves native balance, as on Arc. The handler keeps an independent model of balances, statuses and outstanding amounts,
predicts whether every call should succeed, and counts any disagreement; the invariants require every counter to stay
at zero. Its actors approve any solver, so consent is covered by its own suite instead.

| Invariant (SPEC numbering) | Stateful invariant suite | Fuzz | Unit |
| --- | --- | --- | --- |
| 1. Ledger sum per token == deposits minus withdrawals; `settle` never changes it | `invariant_1_depositsEqualInflowsMinusOutflows` | `testFuzz_settleMovesEachMemberByItsExactNet` | `Deposits.t.sol` |
| 2. Holdings cover the ledger (native wei >= USDC sum * 1e12, EURC balance >= EURC sum) | `invariant_2_holdingsCoverTheLedger` | `testFuzz_mixedDepositPathsKeepNativeBackingExact`, `testFuzz_settleMovesEachMemberByItsExactNet` | `NativeUsdcModel.t.sol` |
| 3. `outstanding <= amount`, only falls, only in `settle` | `invariant_3_outstandingOnlyFallsThroughSettle` | `testFuzz_settleMovesEachMemberByItsExactNet` | `Settle.t.sol`, `Bounds.t.sol` |
| 4. Each member moves by exactly its net; cashMoved == net payments == net receipts | `invariant_4_settlementsMoveExactNets` | `testFuzz_settleMovesEachMemberByItsExactNet` | `Settle.t.sol` |
| 5. Status transitions only Pending to Open, Rejected or Cancelled; Open to Paid | `invariant_5_statusesFollowLegalTransitions` | | `Invoices.t.sol` |
| 6. A pure cycle settles with zero deposits, whoever submits it | | `testFuzz_pureCycleSettlesWithoutDeposits` (rings of 2 to 6, any uint96 amount) | `test_settle_pureThreeCycleNeedsNoDeposits`, `test_pureLoopNeedsNoConsent` |
| 7. Cash leaves a deposit only with the payer's consent | | `testFuzz_strangerNeverMovesCash` | `SolverConsent.t.sol` (10 tests) |
| All or nothing: a failed cycle changes nothing | `invariant_contractAgreesWithModel` | `testFuzz_settleRevertsUnlessEveryPayerIsCovered` | `test_settle_revertedAttemptLeavesNoNetsBehind`, `test_settle_twiceInOneTransactionStartsFromCleanNets` |
| Blocklist: blocked members cannot settle or withdraw | `invariant_contractAgreesWithModel` (predicts every withdraw and settle by blocked members) | | `Settle.t.sol` (5 tests), `Regressions.t.sol` (3 tests) |
| Narrowing casts never truncate | | `testFuzz_pureCycleSettlesWithoutDeposits` | `Bounds.t.sol`: 256 invoices of `type(uint96).max`, the largest single net payment and its withdrawal |

Static checks: `forge lint` reports nothing on `src/` and `script/`. One lint is excluded project-wide with its
reason in `foundry.toml` (`require-revert-in-loop`: settle is all-or-nothing by design); every other warning is
annotated on its line with the reason it is safe (for example why each narrowing cast cannot truncate). The
annotations are comments only: the compiled bytecode is byte-for-byte the same as before them.

## Findings

### Found by our own test suite during development

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| T-1 | A member blocklisted after depositing could withdraw its EURC to a fresh address: FiatToken's `transfer` checks only its caller (the clearing house) and the recipient. | Medium | Fixed: `withdraw` applies the same blocklist rule as `settle` (token's list and USDC's). Tests: `test_blockedMemberCannotWithdrawEurcToCleanAddress`, `test_usdcBlockedMemberCannotWithdraw`, `test_usdcBlockedMemberCannotWithdrawEurc`; the invariant suite now predicts these withdrawals too. |
| T-2 | `getInvoices` / `getCycles` with a huge `count` (for example `type(uint256).max`, "give me everything") overflowed and reverted instead of clipping. | Low | Fixed: the end index is clipped before any addition. Tests: `test_getInvoicesWithHugeCountReturnsAll`, `test_getCyclesWithHugeCountReturnsAll`. |
| T-3 | `depositWithPermit` tried `permit()` before checking the token, so an unsupported token address failed without the `UnsupportedToken` error. | Low | Fixed: the token is checked first. Test: `test_depositWithPermitReportsUnsupportedToken`. |

### Independent adversarial audit

An independent review attacked the contract through three lenses: economics, Arc integration, and gas and limits.
Each reported finding came with a proof-of-concept test and was then re-checked by a separate verifier that tried to
refute it, ran the PoC and set the final severity used below. The gas and limits lens did not complete; measured gas
figures are given in [Gas and limits](#gas-and-limits) instead. The audit ran against the contract **before** solver
consent was added (that change is its fix for E-1). Its PoC tests were run against that version and are not part of
this repository's suite; the fixes and their tests are.

Severity is the verifier's. E = economics lens, A = Arc lens.

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| E-1 | Whoever submits a cycle picks which debts are netted, so a counterparty could settle only the leg a member owes, leave out the leg owed back, and take the member's deposit as cash ("cherry-picking"). | Medium | **Fixed** by solver consent. Tests: `SolverConsent.t.sol`, notably `test_counterpartyCannotCherryPickTheLegItIsOwed`, `test_strangerCannotSettleOneLegOfARing`, `testFuzz_strangerNeverMovesCash`. |
| E-2 | A cycle must match current outstandings exactly and reverts as a whole, so a 1-unit clear landed first (or a net payer withdrawing 1 unit) makes a solver's cycle revert. | Low | Acknowledged (liveness only). Narrowed by consent. |
| E-3 | Two throwaway addresses can invoice each other and settle with zero cash, inflating `totalCleared` and becoming the latest cycle. | Low | Acknowledged (display only). |
| E-4 | Cheap zero-cash wash invoices push the optimal solution past `MAX_BATCH`, and the tooling has no batch splitting. | Low | Acknowledged (tooling). |
| E-5 | An accepted invoice is a permanent claim with no creditor release or debtor dispute; partial clears can sweep later deposits and receivables; "Accept all" has no extra confirmation. | Low | Acknowledged. Narrowed by consent. |
| E-6 | `members()` returns the whole list and registration is free, so mass registration can push the app's state load over an RPC's call gas cap. | Low | Acknowledged (app availability). |
| E-7 | An accepted invoice with a far-future due date can never clear, and neither party can close it. | Info | Acknowledged. |
| E-8 | Value sent outside the deposit functions is stuck forever (USDC through the ERC-20 view, EURC withdrawn to the house itself, forced wei). | Info | Acknowledged (no admin by design). |
| A-1 | `settle()` keeps clearing EURC invoices while EURC is paused or the house is blocklisted on EURC, leaving creditors a balance they cannot withdraw. | Low | Acknowledged. |
| A-2 | USDC sent to the house through the `0x3600` ERC-20 interface (or EURC sent directly) is accepted by the chain and lost. | Low | Acknowledged (same root as E-8). |
| A-3 | A zero-capital front-run (a 1-unit clear of every edge of a loop is itself a valid cash-free cycle) makes a solver's settle revert. | Low | Acknowledged (same as E-2). |
| A-4 | EURC can be withdrawn to an address on USDC's chain-level blocklist, while `settle()` refuses such an address as a member. | Info | Acknowledged. |
| A-5 | Every EURC exit also depends on USDC's `isBlacklisted` view, an upgradeable Circle proxy, with no admin escape. | Info | Acknowledged (deliberate). |
| A-6 | Integration notes: USDC is paid out only as native value; the reentrancy lock blocks re-deposit from a receive hook; Multicall3From and Memo cannot carry value. | Info | Acknowledged (documented). |

#### Notes on each finding

**E-1, fixed.** The fix is the audit's own recommendation: `setSolver(solver, allowed)`, `isSolverFor`, and a check in
`settle()` that every net payer is the submitter or approved it (`address(0)` meaning anyone). Pure loops stay
permissionless. What remains, by design: a solver a member approved still chooses which of the member's matured debts
its cash pays, and a member that approves `address(0)` opts back into the old behaviour. When a debtor's deposit
cannot cover all its matured debts, which creditor is paid first is now decided by the debtor or its chosen solver
rather than by whichever creditor submits first. A stronger variant (each payer signs a per-cycle EIP-712
authorization) was considered and not adopted: it would remove the trust in the solver at about 5,000 to 8,000 gas per
payer, but needs a signature round trip for every cycle. The consent check costs up to two cold storage reads per net
payer.

**E-2 and A-3, acknowledged.** No funds move wrongly: every griefing clear is itself a valid payment of an accepted,
matured debt, and the victim cycle reverts without changing anything. Consent narrows the attack: a stranger can no
longer clear 1 unit of a debt paid from a deposit unless that debtor approved anyone, but it can still clear 1 unit
of every edge of a pure loop (a valid cash-free cycle), and a net payer can still withdraw. The auditors measured a
grief at about 216,000 execution gas, about 0.005 USDC at Arc's 20 gwei floor, paid again for every attempt. A
tolerant `settle` that clamps amounts was considered and rejected: the verifier showed a griefer defeats it by
clipping a single edge (or a debt outside the cycle that shares a binding payer), and it would settle something other
than the plan the user reviewed. Mitigation offchain: `scripts/cycle.ts` loads fresh state and simulates the exact
call with `eth_estimateGas` immediately before sending and refuses to send if that fails, and the app simulates
before asking the wallet to sign. Automatic re-solve and retry is not implemented.

**E-3, acknowledged.** The contract cannot tell a wash cycle from a real one, and any onchain gate (minimum cash,
registration, a deposit) either breaks invariant 6 or is free for a Sybil to meet. The auditors measured a whole wash
(two invoices of `type(uint96).max` issued, accepted and settled) at about 593,000 gas, about 0.012 USDC. Consent does not help here because no cash
moves. Funds are never at risk; the harm is to the headline numbers. The fix belongs in the app: compute headline
totals and pick the hero cycle only from cycles whose members are all known demo members, and label anything
contract-wide as unfiltered. The app does not do this yet.

**E-4, acknowledged.** `MAX_BATCH = 256` bounds the gas of one `settle()` (the largest cycle measures 16.6M gas; see
below). The auditors measured 256 unbatched wash invoices at about 51.9M gas, about 1.04 USDC. Anyone can sweep wash
pairs with separate zero-cash cycles, but the tooling does not split solutions: `scripts/cycle.ts` refuses to send a
solution larger than `MAX_BATCH` and says so, and the app disables its settle button. An honest network with more
than 256 eligible clears hits the same limit, so batch planning (split by connected component, largest gross first)
is the real fix and is not implemented yet.

**E-5, acknowledged.** Every outcome needs the debtor's own onchain acceptance, which is the contract's security
model, and no third party can create a debt the debtor never accepted. Consent narrows the damage of a mistaken
accept: the creditor can no longer draw the debtor's deposit for it unless the debtor approved that creditor or
anyone. Netting the debt against the debtor's receivables needs no consent from the debtor (its net is zero), but the
receivable's own debtor then pays cash and must consent. There is no creditor release (for example after an offchain
payment) in this version; a creditor-only `releaseInvoice` with a new `Released` status is the recommended addition.
A debtor dispute window was rejected because it would let debtors back out of debts they accepted; the due date is
the review window. In the app, the inbox lists each pending invoice with its creditor, amount, due date and memo, and
"Accept all" accepts exactly the listed ids, without a separate confirmation for large amounts or unknown creditors.

**E-6, acknowledged.** Measured: `members()` costs 4,942,394 gas at 2,000 members, and a registration about 118,000
gas, so pushing it past a 50M-gas `eth_call` cap would take roughly 20,000 registrations, about 47 USDC. No funds or
invariants are affected and `settle`, `deposit` and `withdraw` never read the list. The contract stays usable directly,
and members can be enumerated from `memberCount()` and `MemberProfile` logs. The app still loads `members()` in one
call; paging and log-based loading are not implemented yet.

**E-7, acknowledged.** Both parties must agree to the due date (the creditor sets it, the debtor accepts it after it is
public). Such an invoice never debits anyone and does not block netting of other invoices, because `settle` takes an
explicit list of ids. The creditor release recommended under E-5 would cover it.

**E-8 and A-2, acknowledged.** On Arc, a USDC `transfer` through the `0x3600` ERC-20 interface moves native value
without running the recipient's code, so the house cannot refuse it; `withdraw(EURC, x, house)` moves EURC from the
house to itself. Either way the value is credited to no one. Accounting stays correct (holdings only exceed the
ledger, invariant 2 uses >=) and only the sender's own mistake is at stake. There is no sweep because there is no
admin, and nobody can prove who owns stray funds. A plain native send to the house reverts (it has no `receive`),
and a USDC withdrawal to the house reverts too. The NatSpec states that only the deposit functions credit a deposit.
`scripts/fund.ts` only sends to the demo company wallets, and the app only withdraws to the connected wallet, but
neither has an explicit guard that refuses the house as a transfer recipient.

**A-1, acknowledged.** It needs an issuer action (a global EURC pause, or Circle blocklisting this contract). Nothing
is stolen and no invariant breaks; the freeze moves from the debtor's deposit to the creditor's balance and the
invoice shows Paid. USDC is not affected: the arc lens showed native `deposit()` and `withdraw()` keep working while
the `0x3600` ERC-20 view is paused. A guard (probe `paused()` and `isBlacklisted(address(this))`, revert
`TokenFrozen`) was proposed and not added in this version; the app and scripts do not check for a paused token either.

**A-4, acknowledged.** The recipient of a withdrawal is screened only by the token: Arc refuses native sends to
USDC-blocklisted addresses, and EURC's `transfer` refuses EURC-blocklisted recipients, but EURC can reach an address
that is only on USDC's list. This gives a clean member nothing new, since it could withdraw to itself and transfer the
EURC on. The NatSpec of `withdraw` now says exactly this.

**A-5, acknowledged.** Deliberate: enforcing Circle's list is the point, and Circle can already pause or upgrade USDC
and EURC themselves. The view exists and works on Arc mainnet and testnet today (checked by `eth_call`). A fail-open
fallback was rejected because it would let a blocklisted member withdraw whenever the view breaks.

**A-6, acknowledged.** Documented for app and script authors: a USDC withdrawal recipient must accept native value
(the app always withdraws to the connected wallet); a recipient that tries to re-enter any money function from its
`receive` hook gets `Reentrancy`; batched or Memo deposits must use `approve` on `0x3600` plus `depositToken(USDC)`,
because Multicall3From and Memo cannot forward value to `deposit()`.

#### What the audit checked and found sound

Conservation of nets in every cycle; that the order of ids or members cannot be gamed (all nets are summed before any
balance moves); inclusive due dates and no early payment; every narrowing cast at its limit; the 18 vs 6 decimal
boundary on every deposit and withdrawal path; that transient net slots are cleared for every touched member and
rolled back on revert, including several settles in one transaction; token isolation per (member, token); reentrancy
on every money path; `depositWithPermit` surviving a front-run permit without letting anyone pull someone else's
tokens; `_callToken` failing closed on revert, `false`, short data and empty code. The arc lens also ran read-only
`eth_call` probes with state overrides against Arc testnet and mainnet: the house deploys and settles against the real
USDC and EURC, both USDC deposit paths credit the same ledger, Multicall3From batches keep the transient lock and net
slots correct, and the predeploys are live at the documented addresses. Nothing was signed or broadcast.

## Gas and limits

The gas and limits lens did not complete, so these are our own measurements from `test/GasReport.t.sol`
(`forge test --match-contract GasReport -vv`): whole-transaction gas with forge's call isolation, priced at Arc's
20 gwei base fee floor, where 1 gas costs 0.00000002 USDC. They run on the local token mocks.

| Operation | Gas | Cost on Arc |
| --- | ---: | ---: |
| Deploy | 2,952,015 | 0.0590 USDC |
| `issueInvoice` (with a 20-byte memo) | 185,869 | 0.0037 USDC |
| `acceptInvoice` | 30,105 | 0.0006 USDC |
| `deposit` (native USDC) | 46,221 | 0.0009 USDC |
| `settle`: 15 invoices, 6 members (810 USDC cleared by moving 50 USDC) | 550,989 | 0.0110 USDC |
| `settle`: the largest cycle accepted, 256 EURC invoices between 512 distinct members | 16,642,412 | 0.3328 USDC |

The largest cycle is the worst case for one call: every member is touched once, needs two blocklist reads (EURC and
USDC, 1,024 view calls), every payer passes the consent check, and every receiver's balance is written from zero.
The test asserts it stays under a 25M budget and under Arc's 30M block gas limit. On Arc the blocklist reads cost
more than on the mocks (the arc lens measured 4,247 gas for USDC and 3,918 for EURC against 3,269 locally), which
adds about 0.83M gas, so the largest settle is about 17.5M gas on Arc: under 60% of a block and about 0.35 USDC.

## Reproduce

From `contracts/`:

```sh
forge test                                   # 171 tests: unit, fuzz (2,000 runs) and the invariant suite
forge test --match-contract GasReport -vv    # the gas figures above
forge test --match-path test/SolverConsent.t.sol
forge lint src script                        # no findings
forge fmt --check
```

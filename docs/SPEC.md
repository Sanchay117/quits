# Quits: build spec

Quits is a clearing house for invoices on Arc (Circle's L1). Businesses invoice each other, debtors accept, and a
netting cycle cancels out circular debts so only the leftover differences move as money. DTCC's NSCC nets away about
98% of US equity trade payments every day ($1.7T of trades settle with about $38B); Quits brings that idea to anyone on
Arc, settled atomically and with deterministic finality.

Built for the Arc Microgrants program (Circle, DoraHacks): the project must be live on Arc **mainnet**. Reviewers score
"relevance to Arc, technical credibility, quality, worth taking further". Deadline 2026-10-15 09:29 IST.

## Repo layout

```
contracts/            Foundry project (solc 0.8.30, evm prague). src/ClearingHouse.sol is the source of truth.
core/                 Shared TypeScript (no build step; explicit .ts import extensions)
  abi.ts              Generated ABI (scripts/export-abi.ts). Do not edit.
  chains.ts           Arc network constants (mainnet 5042, testnet 5042002, local 31337)
  deployments.ts      Deployed addresses per network (written by deploy tooling)
  state.ts            loadState()/loadCycleDetail(): batched reads of the whole contract state
  solver.ts           The netting solver (to build)
scripts/              Node 24 scripts run as `node scripts/<name>.ts` (native type stripping), using viem
app/                  Vite + React 19 + TypeScript web app (to build)
docs/                 Docs
```

Rules for everyone:
- Do not install packages. Everything needed is installed (root: viem, vitest, typescript, javascript-lp-solver;
  app: react, react-dom, viem, d3-force, qrcode, vite, vitest). If something is truly missing, say so in your report.
- Do not run git commands (no commits). The user commits.
- Do not touch files outside your assigned area unless told.
- User-facing text (UI copy, READMEs, script output) must not contain em dashes or en dashes. Use commas, colons,
  parentheses, or "to" for ranges.
- Amounts are bigint in 6-decimal token units everywhere in TS. Never use floating point for money.
- Nothing may move real money on mainnet automatically. Scripts that broadcast on mainnet must print a plan with the
  estimated cost and require an explicit `--yes` flag.

## Arc facts that matter

- USDC is Arc's native coin and gas token. `msg.value` is USDC with **18 decimals**. The FiatToken ERC-20 view at
  `0x3600000000000000000000000000000000000000` shows the same balance with **6 decimals**. 1 unit (6-dec) = 1e12 wei.
- Fees: base fee floor is 20 gwei (in 18-decimal USDC), so 1 gas = 0.00000002 USDC. A transfer is about $0.0004,
  a 3M-gas deploy about $0.06. Transactions with maxFeePerGas < 20 gwei are silently dropped: always set fees >= 20 gwei.
- Deterministic finality: a transaction is final once included (sub-second). No reorgs.
- USDC and EURC are Circle FiatTokens: ERC-20, EIP-2612 permit, EIP-3009, and `isBlacklisted(address) view`.
  Arc's chain-level blocklist is USDC's blocklist (blocked senders are rejected before the mempool; transfers to or
  from blocked addresses revert). Testnet has a known blocklisted address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`.
- `PREVRANDAO` is always 0. Block timestamps are non-decreasing (not strictly increasing).
- Predeploys (same address on mainnet and testnet):
  - Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`:
    `function memo(address target, bytes data, bytes32 memoId, bytes memoData)`. Runs `target.call(data)` as the
    calling EOA (via the CallFrom precompile), then emits `Memo(sender indexed, target indexed, callDataHash,
    memoId indexed, memo, memoIndex)`. EOA callers only. Not payable.
  - Multicall3From `0x522fAf9A91c41c443c66765030741e4AaCe147D0`:
    `struct Call3 { address target; bool allowFailure; bytes callData; }`
    `struct Result { bool success; bytes returnData; }`
    `function aggregate3(Call3[] calldata calls) external returns (Result[] memory)`.
    Each call runs with the EOA as msg.sender. EOA callers only. Cannot forward value.
  - Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` (normal read batching).
- Mainnet: RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`, EURC
  `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`. Testnet: RPC `https://rpc.testnet.arc.io`, explorer
  `https://explorer.testnet.arc.io`, EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.

## Contract: `contracts/src/ClearingHouse.sol`

Read the source; it is short and documented. Summary:

- `register(name)`: optional display name (1 to 48 bytes). Adds the caller to `members()`. Nothing else requires it.
- `issueInvoice(debtor, token, amount, dueDate, ref, memo) -> id`: creditor bills a debtor. ids start at 1.
  Status `Pending`. memo up to 140 bytes, stored on chain. `ref` is a bytes32 reference (Arc Memo compatible).
- `acceptInvoice(id)` (debtor): Pending -> Open. `rejectInvoice(id)` (debtor): Pending -> Rejected.
  `cancelInvoice(id)` (creditor): Pending -> Cancelled. An Open invoice has no exit other than being cleared.
- Deposits per (member, token), 6-dec units: `deposit()` payable native USDC (msg.value must be a multiple of 1e12);
  `depositToken(token, amount)` (ERC-20 allowance); `depositWithPermit(...)`; `withdraw(token, amount, to)`
  (USDC leaves as native value, other tokens via ERC-20 transfer). A member on `token`'s or USDC's blocklist cannot
  withdraw (`MemberBlocked`), not even to a clean address. Only these three deposit functions credit a deposit: value
  sent to the contract any other way (e.g. a USDC `transfer` through the 0x3600 ERC-20 interface) is credited to no
  one and cannot be recovered.
- `setSolver(solver, allowed)`: the caller allows (or stops allowing) `solver` to submit cycles in which the caller
  pays cash from its deposit. `solver = address(0)` means anyone. Emits `SolverSet(member, solver, allowed)`.
  `isSolverFor(member, solver)` reads it. An approved solver chooses which of the member's matured debts its cash
  pays, so approval is trust in that solver.
- `settle(token, ids[], amounts[]) -> cycleId`: anyone may call, subject to the consent rule below. 1 to 256
  (`MAX_BATCH`) entries, `ids` strictly ascending. For each, the invoice must be Open, of `token`, matured
  (`block.timestamp >= dueDate`), and `0 < amount <= outstanding`. Each member's net (received minus paid) is
  accumulated in transient storage; then, for every touched member in the order first touched: it must not be
  blocklisted on `token` or on USDC (`MemberBlocked(member)`); if its net is negative it must consent, i.e.
  `member == msg.sender || isSolverFor[member][msg.sender] || isSolverFor[member][address(0)]`
  (`PayerNotConsenting(member)`), and its deposit must cover the payment
  (`InsufficientLiquidity(member, needed, available)`). Members with zero or positive net need no consent, so a pure
  loop of debt can be submitted by anyone. Any failure reverts the whole call. Payers are debited and receivers
  credited. Invoices that reach 0 outstanding become Paid. Emits `InvoiceCleared(cycleId, id, amount, remaining)` per
  invoice, `MemberNetted(cycleId, member, net)` per touched member (net can be 0), and
  `CycleSettled(cycleId, token, solver, invoiceCount, memberCount, grossCleared, cashMoved)`. Stores a `Cycle`
  summary (token, counts, solver, timestamp, blockNumber, grossCleared, cashMoved).
- Views: `balanceOf`, `balancesOf(members[], token)`, `getInvoice`, `getInvoices(fromId, count)`, `members()`,
  `memberCount()`, `supportedTokens()`, `cycleCount()`, `getCycle`, `getCycles(fromId, count)`, `totalCleared(token)`,
  `totalCashMoved(token)`, `nameOf`, `isMember`, `isSolverFor`, `isSupported`, `usdc`, constants.
- No owner, no admin, no upgrades, no fees. Supported tokens fixed in the constructor (USDC + EURC).

Why the consent rule: without it, a counterparty could submit only the debt a member owes and leave out the debt owed
back to it, turning a position that nets to zero into a full cash payment from the member's deposit
("cherry-picking"). See `docs/SECURITY.md`.

Invariants (must always hold):
1. Per token: sum of all members' deposit balances == total deposited - total withdrawn. `settle` never changes the sum.
2. The contract's real holdings cover the ledger: native balance >= sum(USDC balances) * 1e12; ERC-20 balance of each
   other token >= sum of its balances.
3. `outstanding <= amount` always; `outstanding` only decreases, and only through `settle`.
4. In every settle, each member's balance changes by exactly (sum cleared on invoices where it is creditor) minus
   (sum cleared where it is debtor); cashMoved == sum of positive net payments == sum of negative nets' magnitudes.
5. Status transitions only: Pending -> Open | Rejected | Cancelled; Open -> Paid. Nothing else.
6. A pure cycle of debts (A->B->C->A, equal amounts) settles with zero deposits, whoever submits it.
7. Cash leaves a member's deposit in `settle` only when the member submitted the cycle or approved the submitter (or
   anyone) with `setSolver`.

## Solver: `core/solver.ts`

Pure TypeScript, zero dependencies, bigint money. API (exact names):

```ts
export interface Obligation { id: bigint; debtor: string; creditor: string; amount: bigint } // amount = outstanding
export interface SolveInput {
  obligations: Obligation[];              // eligible only: Open, matured, this token, outstanding > 0
  liquidity: Record<string, bigint>;      // lowercase address -> deposit available for this token
  blocked?: Iterable<string>;             // lowercase addresses that must not take part
}
export interface Clear { id: bigint; amount: bigint }
export interface SolveResult {
  clears: Clear[];                        // ascending id, amount > 0 (ready for settle())
  gross: bigint;                          // sum of clears
  cash: bigint;                           // sum of net payments (money that actually moves)
  nets: Record<string, bigint>;           // lowercase address -> net (positive receives, negative pays); only touched members
  totalOutstanding: bigint;               // sum of input obligation amounts (after excluding blocked)
  uncleared: bigint;                      // totalOutstanding - gross
}
export function solve(input: SolveInput): SolveResult;
export function checkSolution(input: SolveInput, clears: Clear[]): { ok: boolean; errors: string[]; gross: bigint; cash: bigint; nets: Record<string, bigint> };
export function eligibleObligations(invoices: Invoice[], token: string, nowSec: bigint): Obligation[]; // from core/state.ts Invoice
export function solverInputFromState(state: ChainState, token: string, nowSec?: bigint): SolveInput;   // uses members' balances and blocked flags
```

Objective (lexicographic): (1) maximize gross cleared; (2) among those, minimize cash moved. Constraint per member:
net payment <= liquidity. Obligations touching a blocked member are dropped before solving.

Recommended algorithm: model as min-cost circulation. Nodes = members + a cash node S. Obligation edge
debtor->creditor (cap = amount). Cash edges S->v (cap = liquidity(v), cost 1) and v->S (cap = infinity, cost 0).
Saturate every obligation edge (clear everything), compute each node's imbalance, then run successive shortest paths
(Dijkstra with potentials, or Bellman-Ford) from excess nodes to deficit nodes over the residual graph where
"un-clearing" an obligation (its reverse edge) costs BIG (e.g. 1_000_000) and paying cash costs 1. The final cleared
amount per obligation = amount - flow on its reverse edge. Any exact algorithm is fine if it is optimal and terminates
fast for 300 obligations / 100 members. Determinism: same input, same output (sort inputs by id/address).

`checkSolution` mirrors `settle()` exactly (ascending unique ids, 0 < amount <= outstanding, liquidity, blocked) so the
app can validate before sending a transaction.

Also export `grossSettlementCash(obligations)` (cash needed with no netting = sum of amounts) for comparisons.

## Scripts: `scripts/`

Node 24 runs `.ts` directly. Shared helpers in `scripts/lib/`. Network chosen by `--network mainnet|testnet|local`
(default local). Keys live in `.secrets/` (gitignored): `.secrets/<network>-deployer.json` `{ "privateKey": "0x..." }`
and `.secrets/<network>-companies.json` (array of `{ name, privateKey, address }`).

- `export-abi.ts` (exists): forge artifact -> core/abi.ts.
- `local-chain.ts`: prepares a running anvil (started separately with `anvil --chain-id 31337`) for Arc semantics:
  set code at 0x3600... to a mock FiatToken that only implements `isBlacklisted` (+ owner-settable blocklist),
  etch Multicall3 bytecode at 0xcA11... (copy from Arc mainnet via eth_getCode), deploy a mock EURC
  (ERC-20, 6 decimals, mint, permit optional, isBlacklisted), deploy ClearingHouse(usdc, [eurc]), and write the
  addresses + deploy block into core/deployments.ts (local entry only).
- `wallets.ts`: create the demo company wallets file (6 to 8 named companies, realistic names, e.g. a small supply
  chain: freight, packaging, a roaster, a cafe chain, a design studio, a print shop). Never overwrite an existing file.
- `fund.ts`: deployer sends each company a small amount of USDC for gas + deposit (configurable, default 0.30 USDC).
  On Arc networks batch the transfers through Multicall3From using the USDC ERC-20 interface
  (`transfer(address,uint256)` with 6-dec amounts); on local, plain native sends.
- `seed.ts`: register company names, deposit (native USDC via `deposit()`), issue a realistic invoice network with
  memos and refs (mostly loops so netting shines; amounts like $12 to $90 even though deposits are cents), accept them.
  On Arc networks, a company issuing several invoices batches them through Multicall3From in one transaction; the
  first invoice of the seed is issued through the Memo predeploy so the deployment demonstrates both predeploys.
  Idempotent where practical (skip names already registered, etc.).
- `cycle.ts`: load state (core/state.ts), build the solver input for a token, solve, print a readable plan
  (gross, cash, savings, per-member nets), verify with `checkSolution`, then call `settle` (needs `--yes` on mainnet).
  Any key may submit (default: deployer).
- `status.ts`: print members, balances, open invoices, cycles, totals.
- `recover.ts`: withdraw every company's deposit and sweep each company wallet's USDC back to the deployer, leaving
  only what gas needs (mainnet requires `--yes`).
- Mainnet deploy is done with Foundry (`contracts/script/Deploy.s.sol`), then `scripts/record-deployment.ts`
  reads the broadcast JSON and updates core/deployments.ts.

Gas: always pass `maxFeePerGas >= 20 gwei` and a sane `maxPriorityFeePerGas` (e.g. 1 gwei) on Arc. Print every tx
hash with an explorer link. Print total gas spent in USDC at the end.

## App: `app/`

Vite + React 19 + TS, static (GitHub Pages under `/quits/`, so `base: "/quits/"` in production; hash routing).
Reads state with `core/state.ts` through a viem public client (no backend). Wallet: injected EIP-1193 (MetaMask),
with "add/switch to Arc" (`wallet_addEthereumChain` with chainId 5042, USDC 18 decimals, RPC, explorer).
Network selectable via `?network=testnet|local` (default mainnet). Polls state every ~8 seconds.

Pages:
1. **Home**: the pitch in one screen. Headline idea: "Call it quits on circular debt." Live totals from chain
   (invoices cleared, value cleared, cash actually moved, % of payments netted away). The hero is the signature
   visual: the latest real cycle's debt graph (members as nodes, invoices as arrows) animating into the handful of net
   transfers that actually settled it. Short sections: the problem (circular B2B debt ties up cash), how Quits works
   (issue, accept, deposit, net, settle), why Arc (deterministic finality for settlement finality, native USDC
   deposits in one transaction, sanctions blocklist enforced in the clearing rules, sub-cent cycles, EURC), the DTCC
   comparison, and links to the verified contract.
2. **Network**: live graph of members and open invoices (edge thickness ~ amount, color by status). A solver panel:
   "Compute netting" runs `solve()` in the browser and previews the result on the graph (which invoices clear, net
   transfers, gross vs cash, savings), then "Settle on Arc" sends `settle()` from the connected wallet (anyone can).
3. **Account** (connected wallet): register a name; deposit/withdraw USDC (native) and EURC; issue an invoice (to
   address or member picker, token, amount, due date, reference, memo), sent through the Memo predeploy when
   available (fallback: direct call); inbox of pending invoices to accept/reject, with "accept all" batched through
   Multicall3From; my receivables and payables; CSV export of my invoices and clearing history.
4. **Cycles**: every settled cycle (time, token, invoices, members, gross, cash, saving, solver, tx link) with a detail
   view that replays its collapse animation (data from `loadCycleDetail`).
5. **Playground**: offline, no wallet: generate a random invoice network (sliders: companies, invoices, liquidity),
   run the same solver, watch it collapse. Shows the algorithm is real without spending anything.
6. **How it works**: the rules (from the contract), invariants, the solver's math (min-cost circulation),
   limitations stated honestly (demo network members are our own simulated companies; Arc privacy not live yet; no
   credit risk handling: deposits are pre-funded), contract address and verification link, source on GitHub.

Design direction: clean, confident fintech, not crypto-casino. Light and dark themes. One strong accent color.
Tabular numerals for money. The graph animation is the star: smooth, legible, labelled with names and amounts.
Format money as `$12.40` (USDC) and `EUR 12.40`/`€12.40` (EURC). Show addresses short (`0x1234…abcd`) with names
when registered. Mobile friendly. Accessible contrast. No em dashes in copy.

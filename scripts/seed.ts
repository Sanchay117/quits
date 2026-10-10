// Seeds the demo invoice network (scripts/lib/demo.ts) from the company wallets:
//   1. each company registers its name, allows any solver to draw on its deposit (setSolver(address(0), true), so
//      anyone can settle the demo network from the app), and issues its invoices (on Arc: one Multicall3From
//      transaction per company, and the seed's very first invoice goes through the Memo predeploy),
//   2. each company tops its USDC deposit up to the round's level (native USDC, deposit()),
//   3. each company accepts the invoices it owes (on Arc: one Multicall3From transaction per company).
// Resumable: invoices already on chain (same creditor and reference) are not issued again, accepted ones are not
// accepted again, and deposits are only topped up. Round 2 adds the next week's invoices for a second cycle.
import { encodeFunctionData, parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { NATIVE_SCALE } from "../core/chains.ts";
import { solve, solverInputFromState } from "../core/solver.ts";
import { ANY_SOLVER, InvoiceStatus, statusLabel } from "../core/state.ts";
import { NETWORK_OPTIONS, SEND_OPTIONS, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { sendCalls, viaMemo, type Call } from "./lib/arc.ts";
import { DEMO_ROUNDS, parseScale } from "./lib/demo.ts";
import { date, heading, pct, section, table, usd } from "./lib/format.ts";
import { loadCompanies } from "./lib/keys.ts";
import { connect, readState, requireClearingHouse, type Context } from "./lib/network.ts";
import { confirmPlan } from "./lib/plan.ts";
import { demoCompanies, planRound, workCost, type SeedInvoice } from "./lib/seedplan.ts";
import { runScript, sendTx } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "seed.ts",
  summary: "Register the demo companies, issue and accept a round of demo invoices, and top up their deposits.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "round", type: "string", placeholder: DEMO_ROUNDS.join("|"), default: "1", description: "Which round of invoices to seed" },
    { name: "scale", type: "string", placeholder: "x", default: "1", description: "Multiply every invoice amount and deposit, e.g. 0.1" },
    ...SEND_OPTIONS,
  ],
  examples: ["node scripts/seed.ts", "node scripts/seed.ts --round 2", "node scripts/seed.ts --network mainnet --yes"],
};

const DAY = 86_400n;

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const house = requireClearingHouse(ctx);
  const round = args.int("round") ?? 1;
  const scale = parseScale(args.get("scale"));
  const companies = demoCompanies(loadCompanies(ctx.net.name));
  const name = (address: string) => companies.find((c) => c.address.toLowerCase() === address.toLowerCase())?.name ?? address;

  heading(`Seeding round ${round} on ${ctx.net.label}`);
  let state = await readState(ctx);
  const plan = planRound(state, companies, ctx.net, round, scale);

  section(`Round ${round} invoices`);
  console.log(
    table(
      ["Ref", "Creditor", "Debtor", "Amount", "Memo", "On chain"],
      plan.invoices.map((i) => [
        i.ref,
        i.creditor,
        i.debtor,
        usd(i.units),
        i.memo,
        i.onChain ? `#${i.onChain.id} ${statusLabel[i.onChain.status]}` : "to issue",
      ]),
      ["left", "left", "left", "right"],
    ),
  );

  section("Work per company");
  console.log(
    table(
      ["Company", "Register", "Any solver", "Issue", "Deposit", "Accept", "Txs"],
      plan.work.map((w) => [
        w.company.name,
        w.register ? "yes" : "",
        w.consent ? "allow" : "",
        String(w.issue.length + (w.memoIssue ? 1 : 0) || ""),
        w.deposit > 0n ? usd(w.deposit) : "",
        String(w.accept.length || ""),
        String(workCost(ctx.net, w).txs || ""),
      ]),
      ["left", "left", "left", "right", "right", "right", "right"],
    ),
  );
  if (plan.settled) console.log("  A cycle has already cleared some of this round's invoices: deposits are not topped up again.");

  const costs = plan.work.map((w) => workCost(ctx.net, w));
  const deposits = plan.work.reduce((sum, w) => sum + w.deposit, 0n);
  const notes: string[] = [];
  if (plan.work.some((w) => w.consent)) {
    notes.push(
      "Any solver: the company calls setSolver(address(0), true), so anyone (e.g. a reviewer in the app) may submit " +
        "cycles that draw on its deposit.",
    );
  }
  if (ctx.net.multicall3From) notes.push("Each company's calls go out as one Multicall3From transaction per step.");
  else notes.push("No Multicall3From or Memo on this chain: one transaction per call.");
  if (plan.work.some((w) => w.memoIssue)) notes.push("The first invoice is issued through Arc's Memo predeploy.");
  const go = confirmPlan(ctx, {
    title: `seed round ${round} (${plan.invoices.length} invoices, ${usd(plan.invoices.reduce((s, i) => s + i.units, 0n))})`,
    txCount: costs.reduce((sum, c) => sum + c.txs, 0),
    gas: costs.reduce((sum, c) => sum + c.gas, 0n),
    moves: deposits > 0n ? [{ what: "USDC deposited (recover.ts withdraws it)", units: deposits }] : [],
    notes,
  });
  if (!go) return;

  const head = await ctx.client.getBlock();
  const dueDate = head.timestamp - (head.timestamp % DAY); // due today: matured, so the next cycle can clear it

  // 1. Register, allow any solver, and issue.
  if (plan.work.some((w) => w.register || w.consent || w.memoIssue || w.issue.length)) section("Registering and issuing invoices");
  for (const w of plan.work) {
    if (w.memoIssue) {
      const call = viaMemo(ctx.net, issueCall(ctx, house, w.memoIssue, dueDate), w.memoIssue.refHex, w.memoIssue.memo);
      reportIssued(await sendTx(ctx, { from: w.company, to: call.to, data: call.data, label: `${w.company.name}: ${call.label}` }));
    }
    const calls: Call[] = [];
    if (w.register) {
      calls.push({ to: house, data: encodeFunctionData({ abi: clearingHouseAbi, functionName: "register", args: [w.company.name] }), label: "register name" });
    }
    if (w.consent) {
      calls.push({
        to: house,
        data: encodeFunctionData({ abi: clearingHouseAbi, functionName: "setSolver", args: [ANY_SOLVER, true] }),
        label: "allow any solver (setSolver)",
      });
    }
    for (const invoice of w.issue) calls.push(issueCall(ctx, house, invoice, dueDate));
    await sendCalls(ctx, w.company, calls, w.company.name, reportIssued);
  }

  // 2. Deposits.
  if (deposits > 0n) section("Deposits (native USDC)");
  for (const w of plan.work) {
    if (w.deposit === 0n) continue;
    await sendTx(ctx, {
      from: w.company,
      to: house,
      data: encodeFunctionData({ abi: clearingHouseAbi, functionName: "deposit" }),
      value: w.deposit * NATIVE_SCALE,
      label: `${w.company.name}: deposit ${usd(w.deposit)}`,
    });
  }

  // 3. Accept, with the ids the invoices actually got.
  state = await readState(ctx);
  const refs = new Set(plan.invoices.map((i) => `${i.creditorCo.address.toLowerCase()}:${i.refHex.toLowerCase()}`));
  const pending = state.invoices.filter(
    (i) => i.status === InvoiceStatus.Pending && refs.has(`${i.creditor.toLowerCase()}:${i.ref.toLowerCase()}`),
  );
  if (pending.length) section("Accepting invoices");
  for (const company of companies) {
    const mine = pending.filter((i) => i.debtor.toLowerCase() === company.address.toLowerCase());
    const calls: Call[] = mine.map((i) => ({
      to: house,
      data: encodeFunctionData({ abi: clearingHouseAbi, functionName: "acceptInvoice", args: [i.id] }),
      label: `accept #${i.id}`,
    }));
    await sendCalls(ctx, company, calls, company.name);
  }

  // Result.
  state = await readState(ctx);
  const seeded = plan.invoices.map((i) => ({
    seed: i,
    chain: state.invoices.find(
      (c) => c.creditor.toLowerCase() === i.creditorCo.address.toLowerCase() && c.ref.toLowerCase() === i.refHex.toLowerCase(),
    ),
  }));
  section(`Round ${round} on chain`);
  console.log(
    table(
      ["Id", "Ref", "Debtor owes creditor", "Amount", "Due", "Status"],
      seeded.map(({ seed, chain }) => [
        chain ? `#${chain.id}` : "-",
        seed.ref,
        `${name(seed.debtorCo.address)} owes ${name(seed.creditorCo.address)}`,
        usd(seed.units),
        chain ? date(chain.dueDate) : "",
        chain ? statusLabel[chain.status] : "missing",
      ]),
      ["right", "left", "left", "right"],
    ),
  );
  previewNetting(ctx, state);
  ctx.ledger.print(ctx);
  console.log(`\nNext: node scripts/cycle.ts --network ${ctx.net.name}`);

  function reportIssued(receipt: TransactionReceipt): void {
    const events = parseEventLogs({ abi: clearingHouseAbi, logs: receipt.logs, eventName: "InvoiceIssued" });
    if (events.length) console.log(`    issued ${events.map((e) => `#${e.args.id}`).join(", ")}`);
  }
});

function issueCall(ctx: Context, house: Hex, invoice: SeedInvoice, dueDate: bigint): Call {
  return {
    to: house,
    data: encodeFunctionData({
      abi: clearingHouseAbi,
      functionName: "issueInvoice",
      args: [invoice.debtorCo.address, ctx.net.usdc, invoice.units, dueDate, invoice.refHex, invoice.memo],
    }),
    label: `issue ${invoice.ref} to ${invoice.debtor} ${usd(invoice.units)}`,
  };
}

/** What a cycle sent by anyone would do right now (state read without a submitter: only "any solver" deposits count). */
function previewNetting(ctx: Context, state: Awaited<ReturnType<typeof readState>>): void {
  const result = solve(solverInputFromState(state, ctx.net.usdc));
  section("Netting preview (USDC, cycle sent by anyone)");
  if (result.gross === 0n) {
    console.log("  Nothing can clear yet.");
    return;
  }
  console.log(
    `  A cycle now would clear ${usd(result.gross)} of ${usd(result.totalOutstanding)} outstanding with ${usd(result.cash)} ` +
      `of cash: ${pct(result.gross - result.cash, result.gross)} of the cleared value never moves.`,
  );
  const holdouts = Object.values(state.members).filter(
    (m) => !m.allowsAnySolver && (m.balances[ctx.net.usdc.toLowerCase()] ?? 0n) > 0n,
  );
  if (holdouts.length) {
    console.log(`  Not counted: the deposits of ${holdouts.map((m) => m.name || m.address).join(", ")} (no setSolver for anyone).`);
  }
}

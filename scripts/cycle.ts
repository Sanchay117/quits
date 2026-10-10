// Runs one netting cycle: reads the whole contract state, solves for the largest amount that can clear with the
// least cash (core/solver.ts), prints the plan, checks it against settle()'s rules, and calls settle(). Anyone may
// submit a cycle; by default the deployer does.
import { encodeFunctionData, parseEventLogs } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { MAX_BATCH, checkSolution, grossSettlementCash, solve, solverInputFromState } from "../core/solver.ts";
import { NETWORK_OPTIONS, SEND_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { refToText } from "./lib/demo.ts";
import { heading, int, money, pct, section, short, table } from "./lib/format.ts";
import { hasCompanies, loadCompanies, loadDeployer, type Signer } from "./lib/keys.ts";
import { connect, readState, requireClearingHouse, resolveToken, tokenSymbol } from "./lib/network.ts";
import { confirmPlan } from "./lib/plan.ts";
import { describeError, runScript, sendTx } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "cycle.ts",
  summary: "Compute the best netting cycle for a token, print it, and settle it on chain.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "token", type: "string", placeholder: "usdc|eurc|address", default: "usdc", description: "Token to net" },
    { name: "from", type: "string", placeholder: "deployer|company name", default: "deployer", description: "Who submits settle()" },
    ...SEND_OPTIONS,
  ],
  examples: ["node scripts/cycle.ts", "node scripts/cycle.ts --network mainnet          # plan only", "node scripts/cycle.ts --network mainnet --yes"],
};

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const house = requireClearingHouse(ctx);
  const token = resolveToken(ctx, args.get("token"));
  const symbol = tokenSymbol(ctx, token);
  const fmt = (units: bigint) => money(units, symbol);
  const submitter = pickSubmitter(ctx.net.name, args.get("from") ?? "deployer");

  heading(`Netting cycle for ${symbol} on ${ctx.net.label}`);
  const state = await readState(ctx);
  const label = (address: string) => {
    const member = state.members[address.toLowerCase()];
    return member?.name || short(address);
  };
  const input = solverInputFromState(state, token);
  const result = solve(input);
  const byId = new Map(state.invoices.map((i) => [i.id, i]));

  console.log(`  State at block ${state.blockNumber}: ${Object.keys(state.members).length} members, ${state.invoices.length} invoices, ${state.cycles.length} cycles so far`);
  console.log(`  Eligible now (open, due, ${symbol}): ${input.obligations.length} invoices, ${fmt(grossSettlementCash(input.obligations))} outstanding`);

  if (result.clears.length > MAX_BATCH) {
    fail(
      `The best cycle clears ${result.clears.length} invoices, but settle() accepts at most ${MAX_BATCH} per call. ` +
        "Not sending: split the network or settle part of it from the app.",
    );
  }
  const check = checkSolution(input, result.clears);
  if (!check.ok) {
    if (check.errors[0]?.startsWith("EmptySolution")) {
      section("Nothing to settle");
      console.log(`  ${check.errors[0]}`);
      console.log("  (No accepted, matured invoice can clear with the deposits members hold.)");
      return;
    }
    fail(`The solution breaks settle()'s rules, not sending:\n  ${check.errors.join("\n  ")}`);
  }

  section("Invoices to clear");
  console.log(
    table(
      ["Id", "Ref", "Debtor pays creditor", "Outstanding", "Clear", "Left"],
      result.clears.map((c) => {
        const inv = byId.get(c.id)!;
        const left = inv.outstanding - c.amount;
        return [`#${c.id}`, refToText(inv.ref), `${label(inv.debtor)} -> ${label(inv.creditor)}`, fmt(inv.outstanding), fmt(c.amount), left > 0n ? fmt(left) : "paid"];
      }),
      ["right", "left", "left", "right", "right", "right"],
    ),
  );
  const skipped = input.obligations.filter((o) => !result.clears.some((c) => c.id === o.id));
  if (skipped.length) console.log(`  Left open: ${skipped.map((o) => `#${o.id}`).join(", ")} (no room in the payers' deposits)`);

  section("Net positions (what actually moves)");
  const nets = Object.entries(result.nets).sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  console.log(
    table(
      ["Member", "Deposit", "Net", "Deposit after"],
      nets.map(([member, net]) => {
        const deposit = input.liquidity[member] ?? 0n;
        const sign = net > 0n ? "+" : "";
        return [label(member), fmt(deposit), net === 0n ? fmt(0n) : `${sign}${fmt(net)}`, fmt(deposit + net)];
      }),
      ["left", "right", "right", "right"],
    ),
  );

  section("Summary");
  const saved = result.gross - result.cash;
  console.log(`  Gross cleared:  ${fmt(result.gross)} across ${result.clears.length} invoices and ${nets.length} members`);
  console.log(`  Cash moved:     ${fmt(result.cash)}`);
  console.log(`  Saved:          ${fmt(saved)} (${pct(saved, result.gross)} of the cleared value never moves)`);
  if (result.uncleared > 0n) console.log(`  Still open after this cycle: ${fmt(result.uncleared)}`);

  const data = encodeFunctionData({
    abi: clearingHouseAbi,
    functionName: "settle",
    args: [token, result.clears.map((c) => c.id), result.clears.map((c) => c.amount)],
  });
  let gas: bigint;
  try {
    gas = await ctx.client.estimateGas({ account: submitter.account, to: house, data });
  } catch (err) {
    fail(`settle() would fail on chain: ${describeError(err)}`);
  }
  const go = confirmPlan(ctx, {
    title: `settle ${result.clears.length} invoices from ${submitter.label}`,
    txCount: 1,
    gas,
    notes: ["Gas estimated by the node for this exact call. Deposits move inside the contract; no USDC leaves it."],
  });
  if (!go) return;

  const receipt = await sendTx(ctx, { from: submitter, to: house, data, label: `settle(): ${result.clears.length} invoices, ${fmt(result.gross)}` });
  const [settled] = parseEventLogs({ abi: clearingHouseAbi, logs: receipt.logs, eventName: "CycleSettled" });
  if (!settled) fail("settle() succeeded but emitted no CycleSettled event");
  const { cycleId, grossCleared, cashMoved, invoiceCount, memberCount } = settled.args;
  section(`Cycle #${cycleId} settled`);
  console.log(`  ${int(invoiceCount)} invoices, ${int(memberCount)} members`);
  console.log(`  Gross cleared ${fmt(grossCleared)}, cash moved ${fmt(cashMoved)}, saved ${fmt(grossCleared - cashMoved)} (${pct(grossCleared - cashMoved, grossCleared)})`);
  if (grossCleared !== result.gross || cashMoved !== result.cash) fail("On-chain totals differ from the plan");
  ctx.ledger.print(ctx);
});

function pickSubmitter(network: Parameters<typeof loadDeployer>[0], from: string): Signer & { label: string } {
  if (from === "deployer") {
    const deployer = loadDeployer(network);
    return { ...deployer, label: `the deployer ${short(deployer.address)}` };
  }
  if (!hasCompanies(network)) fail(`--from "${from}": there is no company wallets file for ${network}`);
  const company = loadCompanies(network).find((c) => c.name.toLowerCase() === from.toLowerCase());
  if (!company) fail(`--from "${from}" is not "deployer" or a company in the wallets file`);
  return { ...company, label: company.name };
}

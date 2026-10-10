// The deployer sends each demo company the USDC it needs: by default just enough for the gas of its remaining seed
// work (both rounds) and of recover.ts, plus its deposits, with a margin. Only shortfalls are sent, so re-running is
// safe. On Arc the transfers go out as one Multicall3From transaction through USDC's ERC-20 interface (6-decimal
// amounts); on a local chain as plain native sends.
import { parseUnits } from "viem";
import { NATIVE_SCALE } from "../core/chains.ts";
import { NETWORK_OPTIONS, SEND_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { aggregate3Data, sendCalls, usdcTransferCall, type Call } from "./lib/arc.ts";
import { DEMO_ROUNDS, parseScale } from "./lib/demo.ts";
import { heading, nativeUsdc, section, table, usd, weiToUnitsCeil } from "./lib/format.ts";
import { loadCompanies, loadDeployer } from "./lib/keys.ts";
import { connect, readState } from "./lib/network.ts";
import { GAS, batchGas, confirmPlan } from "./lib/plan.ts";
import { demoCompanies, planRound, workCost } from "./lib/seedplan.ts";
import { currentFees, describeError, runScript, sendTx, withMargin } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "fund.ts",
  summary:
    "Send each demo company the USDC it needs for gas and deposits (only what it lacks). Default budget: its remaining " +
    "seed work for the chosen rounds plus recover.ts, priced at the current fee cap with a 25% margin.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "amount", type: "string", placeholder: "usdc", description: "Fixed wallet balance per company instead of the computed budget, e.g. 0.30" },
    { name: "scale", type: "string", placeholder: "x", default: "1", description: "Demo amount scale (as given to seed.ts)" },
    { name: "rounds", type: "string", placeholder: "list", default: DEMO_ROUNDS.join(","), description: "Seed rounds to budget for" },
    ...SEND_OPTIONS,
  ],
  examples: ["node scripts/fund.ts", "node scripts/fund.ts --network mainnet            # plan only", "node scripts/fund.ts --network mainnet --yes      # send"],
};

/** Round sends up to a tenth of a cent so the amounts read cleanly. */
const ROUND_TO = 1_000n;

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const deployer = loadDeployer(ctx.net.name);
  const companies = demoCompanies(loadCompanies(ctx.net.name));
  const scale = parseScale(args.get("scale"));
  const rounds = (args.get("rounds") ?? "").split(",").map((r) => Number(r.trim()));
  if (rounds.some((r) => !DEMO_ROUNDS.includes(r))) fail(`--rounds must list rounds from ${DEMO_ROUNDS.join(", ")}`);
  const fixed = args.get("amount");
  if (fixed !== undefined && !/^\d+(\.\d{1,6})?$/.test(fixed)) fail(`--amount must be a USDC amount like 0.30, got "${fixed}"`);

  heading(`Funding ${companies.length} companies on ${ctx.net.label}`);
  const state = ctx.net.clearingHouse ? await readState(ctx) : null;
  if (!state) console.log("  No clearing house recorded yet: budgeting the full seed.");
  const fees = await currentFees(ctx);

  const budgets = companies.map((company) => {
    let gas = GAS.withdraw + GAS.nativeTransfer; // recover.ts: withdraw the deposit, sweep the wallet
    let deposits = 0n;
    let registerPlanned = false;
    let consentPlanned = false;
    for (const round of rounds) {
      const plan = planRound(state, companies, ctx.net, round, scale, { budget: true });
      const work = plan.work.find((w) => w.company === company)!;
      // Registering and setSolver happen once, in the first round that still needs them.
      if (registerPlanned) work.register = false;
      if (consentPlanned) work.consent = false;
      registerPlanned ||= work.register;
      consentPlanned ||= work.consent;
      gas += workCost(ctx.net, work).gas;
      deposits += work.deposit;
    }
    const gasWei = ((gas * 5n) / 4n) * fees.maxFeePerGas;
    const target = fixed !== undefined ? parseUnits(fixed, 6) * NATIVE_SCALE : gasWei + deposits * NATIVE_SCALE;
    return { company, gasWei, deposits, target };
  });

  const balances = await Promise.all(companies.map((c) => ctx.client.getBalance({ address: c.address })));
  const sends = budgets.map((b, i) => {
    const missing = b.target - balances[i];
    if (missing <= 0n) return 0n;
    const units = weiToUnitsCeil(missing);
    return ((units + ROUND_TO - 1n) / ROUND_TO) * ROUND_TO;
  });

  section(fixed !== undefined ? `Target: ${usd(parseUnits(fixed, 6))} per wallet` : `Budget at a fee cap of ${fees.maxFeePerGas / 1_000_000_000n} gwei`);
  console.log(
    table(
      ["Company", "Wallet now", "Gas budget", "Deposits", "Send"],
      budgets.map((b, i) => [
        b.company.name,
        nativeUsdc(balances[i]),
        fixed !== undefined ? "" : nativeUsdc(b.gasWei),
        fixed !== undefined ? "" : usd(b.deposits),
        sends[i] > 0n ? usd(sends[i]) : "-",
      ]),
      ["left", "right", "right", "right", "right"],
    ),
  );

  const recipients = budgets.map((b, i) => ({ company: b.company, units: sends[i] })).filter((r) => r.units > 0n);
  const total = recipients.reduce((sum, r) => sum + r.units, 0n);
  const batcher = ctx.net.multicall3From;
  const calls: Call[] = recipients.map((r) => usdcTransferCall(ctx.net, r.company.address, r.units, `${r.company.name} ${usd(r.units)}`));

  let gas = batcher ? batchGas(recipients.map(() => GAS.usdcTransfer)) : GAS.nativeTransfer * BigInt(recipients.length);
  const notes: string[] = [];
  const deployerBalance = await ctx.client.getBalance({ address: deployer.address });
  notes.push(`Deployer ${deployer.address} (${deployer.source}) holds ${nativeUsdc(deployerBalance)}`);
  if (batcher && recipients.length > 1) {
    // Simulate the real batch on chain when the deployer can pay for it: a cheap check before spending anything.
    try {
      const data = aggregate3Data(calls);
      gas = await ctx.client.estimateGas({ account: deployer.account, to: batcher, data });
      notes.push(`Simulated the Multicall3From batch on ${ctx.net.label}: ok`);
    } catch (err) {
      notes.push(`Could not simulate the batch yet: ${describeError(err)}`);
    }
  }
  const needed = total * NATIVE_SCALE + withMargin(gas) * fees.maxFeePerGas;
  if (recipients.length > 0 && deployerBalance < needed) {
    notes.push(`The deployer needs ${nativeUsdc(needed)}: send it at least ${nativeUsdc(needed - deployerBalance)} more first`);
  }

  const go = confirmPlan(ctx, {
    title: batcher
      ? `fund ${recipients.length} companies in one Multicall3From transaction (USDC ERC-20 transfers)`
      : `fund ${recipients.length} companies with native USDC sends`,
    txCount: recipients.length === 0 ? 0 : batcher ? 1 : recipients.length,
    gas,
    moves: [{ what: "USDC sent to the companies (unused gas money and deposits come back with recover.ts)", units: total }],
    notes,
  });
  if (!go) return;
  if (deployerBalance < needed) fail(`The deployer holds ${nativeUsdc(deployerBalance)} but needs ${nativeUsdc(needed)}`);

  if (batcher) {
    await sendCalls(ctx, deployer, calls, "Fund companies");
  } else {
    for (const r of recipients) {
      await sendTx(ctx, { from: deployer, to: r.company.address, value: r.units * NATIVE_SCALE, label: `Send ${usd(r.units)} to ${r.company.name}` });
    }
  }

  const after = await Promise.all(companies.map((c) => ctx.client.getBalance({ address: c.address })));
  section("Company wallets");
  console.log(table(["Company", "Address", "USDC"], companies.map((c, i) => [c.name, c.address, nativeUsdc(after[i])]), ["left", "left", "right"]));
  ctx.ledger.print(ctx);
  console.log(`\nNext: node scripts/seed.ts --network ${ctx.net.name}${ctx.mainnet ? " (plan first, then --yes)" : ""}`);
});

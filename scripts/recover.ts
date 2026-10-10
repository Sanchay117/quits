// Returns the demo's USDC: every company withdraws its deposits straight to the deployer (or --to), then sends the
// rest of its wallet there too, keeping only the gas for that last send (plus --keep, if given).
import { encodeFunctionData, getAddress, isAddress, parseUnits, type Hex } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { NATIVE_SCALE } from "../core/chains.ts";
import type { ChainState } from "../core/state.ts";
import { NETWORK_OPTIONS, SEND_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { heading, money, nativeUsdc, section, short, table, usd } from "./lib/format.ts";
import { loadCompanies, loadDeployer } from "./lib/keys.ts";
import { connect, readState, tokenSymbol } from "./lib/network.ts";
import { GAS, confirmPlan } from "./lib/plan.ts";
import { currentFees, runScript, sendTx } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "recover.ts",
  summary: "Withdraw every company's deposits and sweep its wallet's USDC back to the deployer.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "to", type: "string", placeholder: "address", description: "Where the USDC goes (default: the deployer)" },
    { name: "keep", type: "string", placeholder: "usdc", default: "0", description: "USDC to leave in each company wallet" },
    ...SEND_OPTIONS,
  ],
  examples: ["node scripts/recover.ts", "node scripts/recover.ts --network mainnet --yes"],
};

/** A plain native send to an EOA always costs exactly this. */
const SEND_GAS = 21_000n;

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const companies = loadCompanies(ctx.net.name);
  const deployer = loadDeployer(ctx.net.name);
  const toArg = args.get("to");
  if (toArg !== undefined && !isAddress(toArg)) fail(`--to must be an address, got "${toArg}"`);
  const to: Hex = toArg ? getAddress(toArg) : deployer.address;
  const keepRaw = args.get("keep") ?? "0";
  if (!/^\d+(\.\d{1,6})?$/.test(keepRaw)) fail(`--keep must be a USDC amount like 0.01, got "${keepRaw}"`);
  const keep = parseUnits(keepRaw, 6) * NATIVE_SCALE;

  heading(`Recovering USDC on ${ctx.net.label}`);
  console.log(`  Everything goes to ${to}${to === deployer.address ? " (the deployer)" : ""}`);
  if (to.toLowerCase() !== deployer.address.toLowerCase()) {
    const code = await ctx.client.getCode({ address: to });
    if (code && code !== "0x") fail("--to must be a plain wallet (EOA): sweeps are sent with exactly 21,000 gas");
  }
  const state: ChainState | null = ctx.net.clearingHouse ? await readState(ctx) : null;
  const house = ctx.net.clearingHouse;
  const fees = await currentFees(ctx);

  const rows = await Promise.all(
    companies.map(async (company) => {
      const member = state?.members[company.address.toLowerCase()];
      const deposits = (state?.tokens ?? [])
        .map((token) => ({ token, units: member?.balances[token.toLowerCase()] ?? 0n }))
        .filter((d) => d.units > 0n);
      const wallet = await ctx.client.getBalance({ address: company.address });
      return { company, deposits, wallet };
    }),
  );

  section("Per company");
  console.log(
    table(
      ["Company", "Address", "Deposits", "Wallet"],
      rows.map((r) => [
        r.company.name,
        short(r.company.address),
        r.deposits.map((d) => money(d.units, tokenSymbol(ctx, d.token))).join(" + ") || "-",
        nativeUsdc(r.wallet),
      ]),
      ["left", "left", "right", "right"],
    ),
  );

  const withdrawals = rows.reduce((n, r) => n + r.deposits.length, 0);
  const sweepCost = SEND_GAS * fees.maxFeePerGas;
  // Withdrawals pay out to `to` directly, so a wallet is worth sweeping if it still covers the send after their gas.
  const sweepers = rows.filter(
    (r) => r.wallet - GAS.withdraw * BigInt(r.deposits.length) * fees.maxFeePerGas > sweepCost + keep,
  );
  const usdcDeposits = rows.reduce((sum, r) => sum + depositUsdc(ctx.net.usdc, r.deposits), 0n);
  const walletTotal = rows.reduce((sum, r) => sum + r.wallet, 0n);
  const go = confirmPlan(ctx, {
    title: `recover ${companies.length} company wallets`,
    txCount: withdrawals + sweepers.length,
    gas: GAS.withdraw * BigInt(withdrawals) + SEND_GAS * BigInt(sweepers.length),
    moves: [
      { what: "USDC deposits withdrawn", units: usdcDeposits },
      { what: "USDC in company wallets (the gas for these transactions comes out of it)", units: walletTotal / NATIVE_SCALE },
    ],
    notes: keep > 0n ? [`Each wallet keeps ${nativeUsdc(keep)}`] : [],
  });
  if (!go) return;

  const before = await ctx.client.getBalance({ address: to });
  for (const r of rows) {
    if (r.deposits.length && house) {
      for (const d of r.deposits) {
        await sendTx(ctx, {
          from: r.company,
          to: house,
          data: encodeFunctionData({ abi: clearingHouseAbi, functionName: "withdraw", args: [d.token, d.units, to] }),
          label: `${r.company.name}: withdraw ${money(d.units, tokenSymbol(ctx, d.token))} to ${short(to)}`,
        });
      }
    }
    const sendFees = await currentFees(ctx);
    const balance = await ctx.client.getBalance({ address: r.company.address });
    const value = balance - SEND_GAS * sendFees.maxFeePerGas - keep;
    if (value <= 0n) {
      console.log(`  ${r.company.name}: wallet holds ${nativeUsdc(balance)}, not worth a sweep`);
      continue;
    }
    await sendTx(ctx, {
      from: r.company,
      to,
      value,
      gasLimit: SEND_GAS,
      fees: sendFees,
      label: `${r.company.name}: sweep ${nativeUsdc(value)} to ${short(to)}`,
    });
  }

  const after = await ctx.client.getBalance({ address: to });
  const left = await Promise.all(companies.map((c) => ctx.client.getBalance({ address: c.address })));
  section("Result");
  console.log(table(["Company", "Wallet left"], companies.map((c, i) => [c.name, nativeUsdc(left[i])]), ["left", "right"]));
  console.log(`  ${short(to)} received ${nativeUsdc(after - before)} (now holds ${nativeUsdc(after)})`);
  if (usdcDeposits > 0n) console.log(`  of which deposits: ${usd(usdcDeposits)}`);
  ctx.ledger.print(ctx);
});

function depositUsdc(usdc: Hex, deposits: { token: Hex; units: bigint }[]): bigint {
  return deposits.filter((d) => d.token.toLowerCase() === usdc.toLowerCase()).reduce((sum, d) => sum + d.units, 0n);
}

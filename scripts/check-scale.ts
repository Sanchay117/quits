// Offline check of the demo at a given --scale: runs both seed rounds through the solver with the scaled deposits and
// reports what each cycle clears, the cash it needs, and the deposits fund.ts would budget. Sends nothing.
// Usage: node scripts/check-scale.ts --scale 0.4
import { solve, checkSolution, type Obligation } from "../core/solver.ts";
import { DEMO_DEPOSITS, DEMO_INVOICES, parseScale, scaledAmount, scaledDeposit } from "./lib/demo.ts";

const i = process.argv.indexOf("--scale");
const scale = parseScale(i > 0 ? process.argv[i + 1] : undefined);
const usd = (units: bigint) => `$${(Number(units) / 1e6).toFixed(2)}`;

const balances: Record<string, bigint> = {};
const open: Obligation[] = [];
let nextId = 1n;
let budgeted = 0n;

for (const round of [1, 2]) {
  for (const [name, level] of Object.entries(DEMO_DEPOSITS[round] ?? {})) {
    const target = scaledDeposit(level, scale);
    budgeted += target; // fund.ts budgets each round's full deposit level
    if ((balances[name] ?? 0n) < target) balances[name] = target;
  }
  for (const inv of DEMO_INVOICES.filter((x) => x.round === round)) {
    open.push({ id: nextId++, debtor: inv.debtor, creditor: inv.creditor, amount: scaledAmount(inv.amount, scale) });
  }
  const input = { obligations: open.map((o) => ({ ...o })), liquidity: { ...balances } };
  const result = solve(input);
  const check = checkSolution(input, result.clears);
  if (!check.ok) throw new Error(`round ${round}: ${check.errors.join("; ")}`);
  console.log(
    `cycle ${round}: clears ${usd(result.gross)} of ${usd(result.totalOutstanding)} with ${usd(result.cash)} cash ` +
      `(${(100 - (Number(result.cash) * 100) / Number(result.gross)).toFixed(1)}% netted)`,
  );
  for (const [name, net] of Object.entries(result.nets)) balances[name] = (balances[name] ?? 0n) + net;
  for (const c of result.clears) {
    const o = open.find((x) => x.id === c.id)!;
    o.amount -= c.amount;
  }
  open.splice(0, open.length, ...open.filter((o) => o.amount > 0n));
}
console.log(`deposits budgeted by fund.ts: ${usd(budgeted)}`);

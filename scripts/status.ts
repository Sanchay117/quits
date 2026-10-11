// Prints the clearing house's state: members and deposits, open invoices, settled cycles, lifetime totals, and what
// a netting cycle would do right now. Read-only.
import { getAddress, isAddress } from "viem";
import { explorerAddress, type Hex, type NetworkName } from "../core/chains.ts";
import { solve, solverInputFromState } from "../core/solver.ts";
import { InvoiceStatus, statusLabel, type Invoice, type Member } from "../core/state.ts";
import { NETWORK_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { refToText } from "./lib/demo.ts";
import { date, dateTime, heading, money, nativeUsdc, pct, section, short, table } from "./lib/format.ts";
import { hasCompanies, loadCompanies } from "./lib/keys.ts";
import { connect, readState, tokenSymbol } from "./lib/network.ts";
import { runScript } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "status.ts",
  summary: "Print members, deposits, solver consent, open invoices, cycles and totals.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "all", type: "boolean", description: "List every invoice, not only pending and open ones" },
    {
      name: "submitter",
      type: "string",
      placeholder: "address|company name",
      description: "Show consent and the netting preview for cycles sent by this account (default: sent by anyone)",
    },
  ],
  examples: ["node scripts/status.ts", 'node scripts/status.ts --submitter "Fernway Cafes"'],
};

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const submitter = resolveSubmitter(ctx.net.name, args.get("submitter"));
  const state = await readState(ctx, { submitter });
  const symbol = (token: string) => tokenSymbol(ctx, token);
  const fmt = (units: bigint, token: string) => money(units, symbol(token));
  const label = (address: string) => state.members[address.toLowerCase()]?.name || short(address);
  const sender = submitter ? label(submitter) : "anyone";

  heading(`Quits on ${ctx.net.label}`);
  const link = explorerAddress(ctx.net, state.clearingHouse);
  console.log(`  Clearing house ${state.clearingHouse}${link ? `  ${link}` : ""}`);
  console.log(`  Block ${state.blockNumber}, ${dateTime(state.timestamp)}`);
  console.log(`  Tokens: ${state.tokens.map((t) => `${symbol(t)} ${t}`).join(", ")}`);

  const members = Object.values(state.members);
  const wallets = await Promise.all(members.map((m) => ctx.client.getBalance({ address: m.address })));
  const consent = (m: Member): string => {
    if (m.allowsAnySolver) return "anyone";
    if (!submitter || !m.drawableBySubmitter) return "none";
    return m.address.toLowerCase() === submitter.toLowerCase() ? "self" : "submitter";
  };
  section(`Members (${members.filter((m) => m.registered).length} registered)`);
  console.log(
    table(
      ["Name", "Address", ...state.tokens.map((t) => `${symbol(t)} deposit`), "Wallet", "Solvers", "Notes"],
      members.map((m, i) => [
        m.name || "(no name)",
        m.address,
        ...state.tokens.map((t) => fmt(m.balances[t.toLowerCase()] ?? 0n, t)),
        nativeUsdc(wallets[i]),
        consent(m),
        [m.registered ? "" : "not registered", Object.values(m.blocked).some(Boolean) ? "BLOCKED" : ""].filter(Boolean).join(", "),
      ]),
      ["left", "left", ...state.tokens.map(() => "right" as const), "right"],
    ),
  );
  console.log(
    `  Solvers: who may submit cycles that draw cash from the member's deposit ("anyone" after setSolver(address(0), true)` +
      `${submitter ? `; "submitter" when it approved ${short(submitter)}` : ""}). Cash-free loops need no approval.`,
  );
  if (hasCompanies(ctx.net.name)) {
    const missing = loadCompanies(ctx.net.name).filter((c) => !state.members[c.address.toLowerCase()]);
    if (missing.length) console.log(`  Demo companies not on chain yet: ${missing.map((c) => c.name).join(", ")}`);
  }

  const counts = new Map<number, number>();
  for (const inv of state.invoices) counts.set(inv.status, (counts.get(inv.status) ?? 0) + 1);
  section(`Invoices (${state.invoices.length})`);
  console.log(`  ${[...counts.entries()].sort(([a], [b]) => a - b).map(([s, n]) => `${statusLabel[s as InvoiceStatus]} ${n}`).join(", ") || "none"}`);
  for (const token of state.tokens) {
    const open = state.invoices.filter((i) => i.status === InvoiceStatus.Open && i.token.toLowerCase() === token.toLowerCase());
    if (open.length) console.log(`  Open ${symbol(token)}: ${open.length} invoices, ${fmt(open.reduce((s, i) => s + i.outstanding, 0n), token)} outstanding`);
  }
  const listed = args.flag("all")
    ? state.invoices
    : state.invoices.filter((i) => i.status === InvoiceStatus.Pending || i.status === InvoiceStatus.Open);
  if (listed.length) {
    console.log("");
    console.log(
      table(
        ["Id", "Ref", "Debtor owes creditor", "Amount", "Outstanding", "Due", "Status", "Memo"],
        listed.map((i: Invoice) => [
          `#${i.id}`,
          refToText(i.ref),
          `${label(i.debtor)} -> ${label(i.creditor)}`,
          fmt(i.amount, i.token),
          fmt(i.outstanding, i.token),
          i.dueDate === 0n ? "now" : date(i.dueDate),
          statusLabel[i.status],
          i.memo,
        ]),
        ["right", "left", "left", "right", "right"],
      ),
    );
  }

  section(`Cycles (${state.cycles.length})`);
  if (state.cycles.length) {
    console.log(
      table(
        ["Cycle", "Time", "Token", "Invoices", "Members", "Gross", "Cash", "Netted", "Solver"],
        state.cycles.map((c) => [
          `#${c.id}`,
          dateTime(c.timestamp),
          symbol(c.token),
          String(c.invoiceCount),
          String(c.memberCount),
          fmt(c.grossCleared, c.token),
          fmt(c.cashMoved, c.token),
          pct(c.grossCleared - c.cashMoved, c.grossCleared),
          label(c.solver),
        ]),
        ["right", "left", "left", "right", "right", "right", "right", "right"],
      ),
    );
  } else console.log("  None yet.");

  section("Totals");
  for (const t of state.totals) {
    if (t.totalCleared === 0n && t.token.toLowerCase() !== ctx.net.usdc.toLowerCase()) continue;
    const saved = t.totalCleared - t.totalCashMoved;
    console.log(
      `  ${symbol(t.token)}: cleared ${fmt(t.totalCleared, t.token)}, cash moved ${fmt(t.totalCashMoved, t.token)}` +
        (t.totalCleared > 0n ? `, ${pct(saved, t.totalCleared)} of payments netted away` : ""),
    );
  }

  section(`Netting now (cycle sent by ${sender})`);
  let eligible = false;
  for (const token of state.tokens) {
    const result = solve(solverInputFromState(state, token));
    if (result.totalOutstanding === 0n) continue;
    eligible = true;
    console.log(
      `  ${symbol(token)}: would clear ${fmt(result.gross, token)} of ${fmt(result.totalOutstanding, token)} eligible ` +
        `with ${fmt(result.cash, token)} of cash` + (result.gross > 0n ? ` (${pct(result.gross - result.cash, result.gross)} netted)` : ""),
    );
  }
  if (!eligible) console.log("  No accepted, matured invoices are waiting: nothing to net.");
});

/** --submitter as an address: given directly, or a company from the wallets file (only its address is used). */
function resolveSubmitter(network: NetworkName, value: string | undefined): Hex | null {
  if (value === undefined) return null;
  if (isAddress(value)) return getAddress(value);
  const company = hasCompanies(network)
    ? loadCompanies(network).find((c) => c.name.toLowerCase() === value.toLowerCase())
    : undefined;
  if (!company) fail(`--submitter must be an address or a company in the ${network} wallets file, got "${value}"`);
  return company.address;
}

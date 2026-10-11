// Reads the live Arc Mainnet demo (read-only) into video/src/data.json for the demo video: the settled cycle's graph,
// the open round previewed through the real solver, totals, and the transaction hashes from mainnet-run.log.
// Usage: node scripts/video-snapshot.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { networks } from "../core/chains.ts";
import { solve, solverInputFromState } from "../core/solver.ts";
import { lc, loadCycleDetail, loadState, type ChainState } from "../core/state.ts";
import { decomposeNets } from "../app/src/lib/flows.ts";

const net = networks.mainnet;
const client = createPublicClient({ transport: http(net.rpcUrl) });
const state: ChainState = await loadState(client as never, net);
const usdc = lc(net.usdc);
const nameOf = (a: string) => state.members[lc(a)]?.name || a;
const invoices = new Map(state.invoices.map((inv) => [inv.id, inv]));

// The settled cycle, with each member's deposit just before it.
const cycle = state.cycles[0];
const detail = await loadCycleDetail(client as never, net, cycle);
const members = detail.nets.map((n) => n.member);
const before = (await client.readContract({
  address: net.clearingHouse!,
  abi: clearingHouseAbi,
  functionName: "balancesOf",
  args: [members, net.usdc],
  blockNumber: cycle.blockNumber - 1n,
})) as readonly bigint[];
const settled = {
  nodes: detail.nets.map(({ member, net: n }, i) => ({
    id: lc(member),
    label: nameOf(member),
    deposit: before[i],
    depositAfter: before[i] + n,
    net: n,
  })),
  edges: detail.clears.map((c) => {
    const inv = invoices.get(c.id)!;
    return {
      id: c.id.toString(),
      from: lc(inv.debtor),
      to: lc(inv.creditor),
      amount: c.amount + c.remaining,
      cleared: c.amount,
      tone: "debt",
      title: inv.memo,
    };
  }),
  flows: decomposeNets(Object.fromEntries(detail.nets.map((n) => [lc(n.member), n.net]))),
  gross: cycle.grossCleared,
  cash: cycle.cashMoved,
  symbol: "USDC",
};

// The open round as the solver would settle it now.
const input = solverInputFromState(state, usdc);
const plan = solve(input);
const clearedBy = new Map(plan.clears.map((c) => [c.id, c.amount]));
const touched = Object.keys(plan.nets);
const open = {
  nodes: touched.map((id) => ({
    id,
    label: nameOf(id),
    deposit: state.members[id]?.balances[usdc] ?? 0n,
    depositAfter: (state.members[id]?.balances[usdc] ?? 0n) + plan.nets[id],
    net: plan.nets[id],
  })),
  edges: input.obligations.map((o) => ({
    id: o.id.toString(),
    from: lc(o.debtor),
    to: lc(o.creditor),
    amount: o.amount,
    cleared: clearedBy.get(o.id) ?? 0n,
    tone: "debt",
    title: invoices.get(o.id)?.memo ?? "",
  })),
  flows: decomposeNets(plan.nets),
  gross: plan.gross,
  cash: plan.cash,
  symbol: "USDC",
};

// Transaction hashes and highlights from the run log.
const log = readFileSync(new URL("../mainnet-run.log", import.meta.url), "utf8");
const txAfter = (marker: string) => {
  const at = log.indexOf(marker);
  return at < 0 ? null : (log.slice(at).match(/0x[0-9a-fA-F]{64}/)?.[0] ?? null);
};
const totals = state.totals.find((t) => lc(t.token) === usdc)!;

const data = {
  takenAt: new Date().toISOString(),
  block: state.blockNumber,
  contract: net.clearingHouse,
  explorer: net.explorer,
  chainId: net.chainId,
  companies: Object.values(state.members).filter((m) => m.registered).length,
  invoiceCount: state.invoices.length,
  totals: { cleared: totals.totalCleared, cash: totals.totalCashMoved },
  tx: {
    deploy: txAfter("Plan: deploy ClearingHouse"),
    fund: txAfter("Plan: fund 7 companies"),
    memo: txAfter("(through the Memo predeploy)"),
    settle: txAfter("settle(): "),
  },
  settled,
  open,
};

const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v), 2);
writeFileSync(new URL("../video/src/data.json", import.meta.url), json + "\n");
console.log(
  `video/src/data.json: cycle #0 ${settled.edges.length} invoices, ${settled.nodes.length} members, ` +
    `${settled.flows.length} transfers; open round ${open.edges.length} invoices clearing ${plan.gross} with ${plan.cash} cash`,
);
console.log(data.tx);

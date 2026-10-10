// Settled cycles: lazily loaded event details (cached; a settled cycle never changes) and their graph models.
import { useEffect } from "react";
import { clearingHouseAbi } from "../../../core/abi.ts";
import type { Hex } from "../../../core/chains.ts";
import { lc, loadCycleDetail, type ChainState, type Cycle, type CycleDetail } from "../../../core/state.ts";
import type { GraphEdge, GraphModel, GraphNode } from "../graph/model.ts";
import { decomposeNets } from "./flows.ts";
import { displayName } from "./format.ts";
import { debtTitle } from "./netting.ts";
import { activeNetwork, publicClient } from "./network.ts";
import { createStore, useStore } from "./store.ts";
import { symbolOf } from "./tokens.ts";

export type DetailEntry =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      detail: CycleDetail;
      /** Members' deposits just before the cycle, when the node could serve that historical state. */
      before?: Record<string, bigint>;
      depositsTried: boolean;
    };

const detailStore = createStore<{ byId: Record<string, DetailEntry> }>({ byId: {} });

function setEntry(id: bigint, entry: DetailEntry): void {
  detailStore.set((current) => ({ byId: { ...current.byId, [id.toString()]: entry } }));
}

/**
 * Deposits of the cycle's members at the block before it, so the graph can show deposits moving. This needs a node
 * that serves historical state; when it cannot, the graph simply draws no deposit rings.
 */
async function depositsBefore(cycle: Cycle, members: Hex[]): Promise<Record<string, bigint> | undefined> {
  if (!activeNetwork.clearingHouse || cycle.blockNumber === 0n || members.length === 0) return undefined;
  try {
    const balances = await publicClient.readContract({
      address: activeNetwork.clearingHouse,
      abi: clearingHouseAbi,
      functionName: "balancesOf",
      args: [members, cycle.token],
      blockNumber: cycle.blockNumber - 1n,
    });
    return Object.fromEntries(members.map((member, i) => [lc(member), balances[i]]));
  } catch {
    return undefined;
  }
}

async function loadEntry(cycle: Cycle, withDeposits: boolean): Promise<void> {
  const cached = detailStore.get().byId[cycle.id.toString()];
  try {
    const detail =
      cached?.status === "ready" ? cached.detail : await loadCycleDetail(publicClient, activeNetwork, cycle);
    if (cached?.status !== "ready") setEntry(cycle.id, { status: "ready", detail, depositsTried: false });
    if (!withDeposits) return;
    const before = await depositsBefore(cycle, detail.nets.map((n) => n.member));
    setEntry(cycle.id, { status: "ready", detail, before, depositsTried: true });
  } catch (err) {
    setEntry(cycle.id, { status: "error", message: err instanceof Error ? err.message.split("\n")[0] : String(err) });
  }
}

function needsLoad(entry: DetailEntry | undefined, withDeposits: boolean): boolean {
  if (!entry) return true;
  return withDeposits && entry.status === "ready" && !entry.depositsTried;
}

/**
 * Details of the given cycles, fetched one at a time on first use. `withDeposits` also tries to read pre-cycle
 * deposits (graphs want them; tables do not).
 */
export function useCycleDetails(cycles: Cycle[], withDeposits = false): Record<string, DetailEntry> {
  const { byId } = useStore(detailStore);
  const wanted = cycles.map((c) => c.id.toString()).join(",");
  useEffect(() => {
    let cancelled = false;
    const pending = cycles.filter((c) => needsLoad(detailStore.get().byId[c.id.toString()], withDeposits));
    pending.forEach((c) => {
      if (!detailStore.get().byId[c.id.toString()]) setEntry(c.id, { status: "loading" });
    });
    (async () => {
      for (const cycle of pending) {
        if (cancelled) return;
        await loadEntry(cycle, withDeposits);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `wanted` stands in for `cycles`: the effect reruns only when the set of cycle ids changes.
  }, [wanted, withDeposits]);
  return byId;
}

/** The debt graph of a settled cycle: the invoices it cleared (at their pre-cycle outstanding) and its nets. */
export function cycleModel(
  state: ChainState,
  cycle: Cycle,
  detail: CycleDetail,
  before?: Record<string, bigint>,
): GraphModel {
  const symbol = symbolOf(activeNetwork, cycle.token);
  const nameOf = (address: string) => displayName(address, state.members[lc(address)]?.name);
  const invoices = new Map(state.invoices.map((inv) => [inv.id, inv]));

  const edges: GraphEdge[] = detail.clears.flatMap((clear) => {
    const invoice = invoices.get(clear.id);
    if (!invoice) return [];
    const debt = {
      id: clear.id,
      debtor: lc(invoice.debtor),
      creditor: lc(invoice.creditor),
      amount: clear.amount + clear.remaining,
      memo: invoice.memo,
    };
    return [
      {
        id: clear.id.toString(),
        from: debt.debtor,
        to: debt.creditor,
        amount: debt.amount,
        cleared: clear.amount,
        tone: "debt" as const,
        title: debtTitle(debt, nameOf, symbol),
      },
    ];
  });

  const nodes: GraphNode[] = detail.nets.map(({ member, net }) => {
    const deposit = before?.[lc(member)];
    return {
      id: lc(member),
      label: nameOf(member),
      deposit,
      depositAfter: deposit === undefined ? undefined : deposit + net,
      net,
    };
  });

  const nets = Object.fromEntries(detail.nets.map((n) => [lc(n.member), n.net]));
  return { nodes, edges, flows: decomposeNets(nets), gross: cycle.grossCleared, cash: cycle.cashMoved, symbol };
}

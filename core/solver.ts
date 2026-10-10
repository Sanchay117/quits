// The Quits netting solver: how much of each matured invoice to clear in one settle() call.
// Pure TypeScript, bigint money, no runtime imports, so the app (in the browser) and the scripts share it.
//
// PROBLEM
// Obligation e says debtor d owes creditor c an outstanding a_e. A solution clears x_e in [0, a_e] on each one. A
// member's net is what it is owed minus what it owes over the clears; a member with a negative net pays that amount
// from its deposit, so it may not exceed its liquidity. Objective, in order: (1) maximise gross = sum of x_e;
// (2) among those, minimise cash = sum of net payments.
//
// MODEL
// Add a node S for the deposits. Cleared money flows debtor -> creditor along each obligation edge (cost -2 per unit).
// A net payer v draws the difference from its deposit along S -> v (capacity liquidity(v), cost 1 per unit: this is
// cash moved); a net receiver is credited along v -> S (no limit, cost 0). The valid clear vectors are exactly the
// obligation flows of this network's circulations, and a circulation costs -2 * gross + cash. (An optimal one never
// both draws and credits the same member: undoing a unit of each is a residual cycle of cost -1.)
//
// WHY A WEIGHT OF 2 GIVES THE LEXICOGRAPHIC OPTIMUM
// A circulation has minimum cost iff its residual network has no negative cycle. A simple residual cycle passes S at
// most once, so its cash part is -1, 0 or +1, while its clearing part is -2k for an integer k (units it clears minus
// units it un-clears). Its cost is negative exactly when k > 0 (it clears more), or k = 0 and it saves cash. The
// difference between our circulation and any lexicographically better one splits into simple residual cycles, and at
// least one of them would have to be such an improving cycle. So minimum cost and lexicographic optimality coincide,
// with no big-M constant, and every cost stays a small integer whatever the amounts.
//
// ALGORITHM
// Start with every obligation fully cleared and no cash. The residual edges are then un-clear (+2), draw (+1) and
// credit (0), all non-negative, so there is no negative cycle, but each member is out of balance by its full net.
// Route every surplus (net receivers) to the deficits (net payers) along cheapest residual paths with primal-dual
// successive shortest paths: Dijkstra with potentials finds the cheapest path cost, then a Dinic max flow saturates
// every path of that cost. Augmenting along cheapest paths never creates a negative cycle, so the balanced result is
// optimal. Routing always completes, because un-clearing everything is one valid route. The amount left cleared on an
// obligation is the remaining capacity of its un-clear edge.
//
// TERMINATION AND SPEED
// Each phase raises the cheapest path cost by at least 1, from at least 0 to less than 2 per member (a simple path),
// so there are at most 2 * members phases. A phase is one linear-time Dijkstra (small integer costs allow a bucket
// queue) and one Dinic max flow. Amounts only ever appear as bigint capacities, so invoices of 2^96 take no longer
// than small ones. Obligations are sorted by id and members by address, so the output depends only on the input set,
// not on its order.

// state.ts is imported for its types only: at runtime it pulls in the ABI, and the solver must stay standalone.
import type { ChainState, Invoice } from "./state.ts";

export interface Obligation {
  id: bigint;
  debtor: string;
  creditor: string;
  /** Outstanding amount, 6-decimal units. */
  amount: bigint;
}

export interface SolveInput {
  /** Eligible only: Open, matured, this token, outstanding > 0. */
  obligations: Obligation[];
  /** Lowercase address -> deposit available for this token. */
  liquidity: Record<string, bigint>;
  /** Lowercase addresses that must not take part. */
  blocked?: Iterable<string>;
}

export interface Clear {
  id: bigint;
  amount: bigint;
}

export interface SolveResult {
  /** Ascending id, amount > 0 (ready for settle()). */
  clears: Clear[];
  /** Sum of clears. */
  gross: bigint;
  /** Sum of net payments (money that actually moves). */
  cash: bigint;
  /** Lowercase address -> net (positive receives, negative pays); only touched members. */
  nets: Record<string, bigint>;
  /** Sum of input obligation amounts (after excluding blocked). */
  totalOutstanding: bigint;
  /** totalOutstanding - gross. */
  uncleared: bigint;
}

export interface SolutionCheck {
  /** True when settle() would accept these clears. */
  ok: boolean;
  /** Every rule broken, in settle()'s order, so errors[0] is the error settle() would revert with. */
  errors: string[];
  gross: bigint;
  cash: bigint;
  nets: Record<string, bigint>;
}

/** settle() rejects larger batches (ClearingHouse.MAX_BATCH). */
export const MAX_BATCH = 256;

/** InvoiceStatus.Open from state.ts, restated because state.ts is a type-only import here. */
const OPEN: Invoice["status"] = 2;

/** Cost per unit left uncleared. Any value above the cash part of a simple cycle (at most 1) works; see above. */
const UNCLEAR_COST = 2;
/** Cost per unit a member draws from its deposit. */
const CASH_COST = 1;

/**
 * The netting solution with the largest gross cleared and, among those, the least cash moved.
 * Obligations touching a blocked member are dropped first. Throws on malformed obligations (duplicate ids,
 * non-positive amounts, debtor equal to creditor). On a network with more than MAX_BATCH obligations the result can
 * exceed what one settle() call accepts; checkSolution() reports that.
 */
export function solve(input: SolveInput): SolveResult {
  const blocked = lowercaseSet(input.blocked);
  const obligations = normalizeObligations(input.obligations).filter(
    (o) => !blocked.has(o.debtor) && !blocked.has(o.creditor),
  );
  const cleared = optimalClearAmounts(obligations, lowercaseMap(input.liquidity));
  const applied = obligations
    .map((obligation, i) => ({ obligation, amount: cleared[i] }))
    .filter((clear) => clear.amount > 0n);
  const { gross, cash, nets } = summarize(applied);
  const totalOutstanding = grossSettlementCash(obligations);
  return {
    clears: applied.map(({ obligation, amount }) => ({ id: obligation.id, amount })),
    gross,
    cash,
    nets,
    totalOutstanding,
    uncleared: totalOutstanding - gross,
  };
}

/**
 * Validates clears against the rules ClearingHouse.settle() enforces, in the same order: a batch of 1 to MAX_BATCH
 * clears, strictly ascending ids, each id an eligible obligation, 0 < amount <= outstanding, then for every touched
 * member: not blocked, and its net payment covered by its liquidity. Error names follow the contract's custom errors,
 * except NotEligible: an id missing from the obligations, which settle() reports as InvoiceNotOpen, TokenMismatch or
 * InvoiceNotDue. gross, cash and nets are what settle() would compute from the clears with known ids, as given; they
 * are meaningful only when ok.
 */
export function checkSolution(input: SolveInput, clears: Clear[]): SolutionCheck {
  const byId = new Map(normalizeObligations(input.obligations).map((o) => [o.id, o]));
  const errors = batchSizeErrors(clears.length);
  const applied: AppliedClear[] = [];
  let lastId = 0n; // settle() starts from 0 too, so an id of 0 fails as not ascending
  clears.forEach(({ id, amount }, index) => {
    if (id <= lastId) errors.push(`IdsNotAscending: id ${id} at index ${index} must be greater than ${lastId}`);
    lastId = id;
    const obligation = byId.get(id);
    if (!obligation) {
      errors.push(`NotEligible: id ${id} is not an eligible obligation`);
      return;
    }
    if (amount <= 0n || amount > obligation.amount) {
      errors.push(`ClearExceedsOutstanding: id ${id} clears ${amount}, allowed 1 to ${obligation.amount}`);
    }
    applied.push({ obligation, amount });
  });
  const summary = summarize(applied);
  errors.push(...memberErrors(summary.nets, lowercaseSet(input.blocked), lowercaseMap(input.liquidity)));
  return { ok: errors.length === 0, errors, ...summary };
}

/** Open invoices of `token` that have matured by `nowSec` and still have something outstanding, by ascending id. */
export function eligibleObligations(invoices: Invoice[], token: string, nowSec: bigint): Obligation[] {
  const wanted = token.toLowerCase();
  return invoices
    .filter(
      (inv) =>
        inv.status === OPEN && inv.token.toLowerCase() === wanted && inv.dueDate <= nowSec && inv.outstanding > 0n,
    )
    .map((inv) => ({
      id: inv.id,
      debtor: inv.debtor.toLowerCase(),
      creditor: inv.creditor.toLowerCase(),
      amount: inv.outstanding,
    }))
    .sort(byId);
}

/**
 * Solver input for one token: eligible obligations, the deposits of that token a cycle from the state's submitter
 * may draw on, and the members blocked on it.
 *
 * settle() reverts with PayerNotConsenting when a member that pays net cash has not approved the sender (setSolver),
 * so a member's deposit counts as liquidity only when it is drawableBySubmitter; every other member gets 0. A liquidity
 * of 0 holds that member's net at zero or above, which is exactly when settle() needs no approval: the member still
 * takes part in cash-free netting (a loop of debts through it clears in full), but nothing is ever drawn from its
 * deposit, so no cycle can turn its netted position into a cash payment.
 *
 * `nowSec` defaults to the state's block time; settle() lands in a later block whose timestamp is not smaller
 * (Arc timestamps never decrease), so an invoice matured at that block is still matured when settle() runs.
 */
export function solverInputFromState(state: ChainState, token: string, nowSec: bigint = state.timestamp): SolveInput {
  const key = token.toLowerCase();
  const liquidity: Record<string, bigint> = {};
  const blocked: string[] = [];
  for (const [address, member] of Object.entries(state.members)) {
    const lower = address.toLowerCase();
    liquidity[lower] = member.drawableBySubmitter ? (member.balances[key] ?? 0n) : 0n;
    if (member.blocked[key]) blocked.push(lower);
  }
  return { obligations: eligibleObligations(state.invoices, token, nowSec), liquidity, blocked: blocked.sort() };
}

/** Cash needed to settle every obligation one by one, without netting: the sum of the amounts. */
export function grossSettlementCash(obligations: Obligation[]): bigint {
  return obligations.reduce((sum, o) => sum + o.amount, 0n);
}

// ---------------------------------------------------------------------------------------------------------------
// Optimisation
// ---------------------------------------------------------------------------------------------------------------

/** Amount to clear on each obligation (same order): maximum gross, then minimum cash. See the proof at the top. */
function optimalClearAmounts(obligations: Obligation[], liquidity: Map<string, bigint>): bigint[] {
  const members = [...new Set(obligations.flatMap((o) => [o.debtor, o.creditor]))].sort();
  const nodeOf = new Map(members.map((member, i) => [member, i]));
  const deposits = members.length;
  const source = deposits + 1;
  const sink = deposits + 2;
  const network = new FlowNetwork(members.length + 3);

  // Everything starts cleared, so each obligation enters the residual network as its un-clear edge.
  const surplus = members.map(() => 0n);
  const unclearEdges = obligations.map((o) => {
    const debtor = nodeOf.get(o.debtor)!;
    const creditor = nodeOf.get(o.creditor)!;
    surplus[creditor] += o.amount;
    surplus[debtor] -= o.amount;
    return network.addEdge(creditor, debtor, o.amount, UNCLEAR_COST);
  });

  // No member can be credited more than everything owed, so that bound stands in for an unlimited credit edge.
  const creditLimit = grossSettlementCash(obligations);
  let required = 0n;
  members.forEach((member, v) => {
    const deposit = liquidity.get(member) ?? 0n;
    if (deposit > 0n) network.addEdge(deposits, v, deposit, CASH_COST);
    network.addEdge(v, deposits, creditLimit, 0);
    if (surplus[v] > 0n) {
      network.addEdge(source, v, surplus[v], 0);
      required += surplus[v];
    } else if (surplus[v] < 0n) {
      network.addEdge(v, sink, -surplus[v], 0);
    }
  });

  const routed = minCostFlow(network, source, sink);
  if (routed !== required) throw new Error(`Solver invariant broken: routed ${routed} of ${required}`);
  return unclearEdges.map((e) => network.capacity[e]);
}

/** Residual network with paired edges: edge e and its reverse e ^ 1. Capacities are bigint, costs small integers. */
class FlowNetwork {
  readonly size: number;
  readonly edgesFrom: number[][];
  readonly to: number[] = [];
  readonly capacity: bigint[] = [];
  readonly cost: number[] = [];

  constructor(size: number) {
    this.size = size;
    this.edgesFrom = Array.from({ length: size }, () => []);
  }

  /** Adds from -> to and its empty reverse edge; returns the forward edge. */
  addEdge(from: number, to: number, capacity: bigint, cost: number): number {
    const e = this.to.length;
    this.to.push(to, from);
    this.capacity.push(capacity, 0n);
    this.cost.push(cost, -cost);
    this.edgesFrom[from].push(e);
    this.edgesFrom[to].push(e + 1);
    return e;
  }

  push(e: number, amount: bigint): void {
    this.capacity[e] -= amount;
    this.capacity[e ^ 1] += amount;
  }

  reducedCost(e: number, potential: number[]): number {
    return this.cost[e] + potential[this.to[e ^ 1]] - potential[this.to[e]];
  }
}

/**
 * Primal-dual min-cost flow; returns the amount routed from source to sink. Requires every residual edge to have a
 * non-negative cost at the start, which the fully cleared starting point guarantees.
 */
function minCostFlow(network: FlowNetwork, source: number, sink: number): bigint {
  const potential: number[] = new Array(network.size).fill(0);
  let routed = 0n;
  for (;;) {
    const dist = reducedDistances(network, source, potential);
    if (dist[sink] === Infinity) return routed;
    // A node the search cannot reach never becomes reachable (augmenting only changes edges between reached nodes),
    // so its potential no longer matters and stays as it is.
    for (let v = 0; v < network.size; v++) {
      if (dist[v] < Infinity) potential[v] += dist[v];
    }
    routed += maxFlowOnTightEdges(network, source, sink, potential);
  }
}

/**
 * Dijkstra over reduced costs. These are small non-negative integers, so a bucket queue (Dial's algorithm) stands in
 * for a heap: bucket d holds the nodes found at distance d, and buckets are settled in increasing order.
 */
function reducedDistances(network: FlowNetwork, source: number, potential: number[]): number[] {
  const dist: number[] = new Array(network.size).fill(Infinity);
  const buckets: number[][] = [[source]];
  dist[source] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d] ?? [];
    // Zero-cost edges append to the bucket being scanned, hence the index loop.
    for (let i = 0; i < bucket.length; i++) {
      const u = bucket[i];
      if (dist[u] !== d) continue; // a stale entry: u was later found closer
      for (const e of network.edgesFrom[u]) {
        if (network.capacity[e] === 0n) continue;
        const v = network.to[e];
        const candidate = d + network.reducedCost(e, potential);
        if (candidate < dist[v]) {
          dist[v] = candidate;
          (buckets[candidate] ??= []).push(v);
        }
      }
    }
  }
  return dist;
}

/** Dinic max flow restricted to tight edges (zero reduced cost), which are exactly the edges of cheapest paths. */
function maxFlowOnTightEdges(network: FlowNetwork, source: number, sink: number, potential: number[]): bigint {
  const isTight = (e: number) => network.capacity[e] > 0n && network.reducedCost(e, potential) === 0;
  let routed = 0n;
  for (;;) {
    const level = bfsLevels(network, source, isTight);
    if (level[sink] < 0) return routed;
    const inLevelGraph = (e: number, from: number) => isTight(e) && level[network.to[e]] === level[from] + 1;
    routed += blockingFlow(network, source, sink, inLevelGraph);
  }
}

function bfsLevels(network: FlowNetwork, source: number, usable: (e: number) => boolean): number[] {
  const level: number[] = new Array(network.size).fill(-1);
  level[source] = 0;
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const e of network.edgesFrom[u]) {
      const v = network.to[e];
      if (level[v] < 0 && usable(e)) {
        level[v] = level[u] + 1;
        queue.push(v);
      }
    }
  }
  return level;
}

/** Pushes augmenting paths through the level graph until none is left. */
function blockingFlow(
  network: FlowNetwork,
  source: number,
  sink: number,
  inLevelGraph: (e: number, from: number) => boolean,
): bigint {
  // Index of the next edge worth trying at each node; edges that led to a dead end are never retried.
  const nextEdge: number[] = new Array(network.size).fill(0);
  const augment = (u: number, limit: bigint): bigint => {
    if (u === sink) return limit;
    const edges = network.edgesFrom[u];
    for (; nextEdge[u] < edges.length; nextEdge[u]++) {
      const e = edges[nextEdge[u]];
      if (!inLevelGraph(e, u)) continue;
      const pushed = augment(network.to[e], minBigint(limit, network.capacity[e]));
      if (pushed > 0n) {
        network.push(e, pushed);
        return pushed;
      }
    }
    return 0n;
  };
  const sourceCapacity = network.edgesFrom[source].reduce((sum, e) => sum + network.capacity[e], 0n);
  let routed = 0n;
  for (let pushed = augment(source, sourceCapacity); pushed > 0n; pushed = augment(source, sourceCapacity)) {
    routed += pushed;
  }
  return routed;
}

// ---------------------------------------------------------------------------------------------------------------
// Netting arithmetic and validation, shared by solve() and checkSolution()
// ---------------------------------------------------------------------------------------------------------------

interface AppliedClear {
  obligation: Obligation;
  amount: bigint;
}

/** Gross, cash and each touched member's net, with members in the order settle() first touches them. */
function summarize(clears: AppliedClear[]): Pick<SolutionCheck, "gross" | "cash" | "nets"> {
  const nets: Record<string, bigint> = {};
  let gross = 0n;
  for (const { obligation, amount } of clears) {
    nets[obligation.creditor] = (nets[obligation.creditor] ?? 0n) + amount;
    nets[obligation.debtor] = (nets[obligation.debtor] ?? 0n) - amount;
    gross += amount;
  }
  const cash = Object.values(nets).reduce((sum, net) => (net < 0n ? sum - net : sum), 0n);
  return { gross, cash, nets };
}

function batchSizeErrors(count: number): string[] {
  if (count === 0) return ["EmptySolution: there is nothing to clear"];
  if (count > MAX_BATCH) return [`BatchTooLarge: ${count} clears, settle() accepts at most ${MAX_BATCH}`];
  return [];
}

/** settle() checks every touched member: first that it is not blocked, then that its deposit covers its net payment. */
function memberErrors(nets: Record<string, bigint>, blocked: Set<string>, liquidity: Map<string, bigint>): string[] {
  const errors: string[] = [];
  for (const [member, net] of Object.entries(nets)) {
    if (blocked.has(member)) errors.push(`MemberBlocked: ${member}`);
    const available = liquidity.get(member) ?? 0n;
    if (net < 0n && -net > available) {
      errors.push(`InsufficientLiquidity: ${member} pays ${-net} net but has ${available}`);
    }
  }
  return errors;
}

/** Lowercases addresses, sorts by id and rejects obligations the contract could never hold. */
function normalizeObligations(obligations: Obligation[]): Obligation[] {
  const seen = new Set<bigint>();
  return obligations
    .map((o) => {
      const debtor = o.debtor.toLowerCase();
      const creditor = o.creditor.toLowerCase();
      if (seen.has(o.id)) throw new Error(`Obligation ${o.id} appears more than once`);
      if (o.amount <= 0n) throw new Error(`Obligation ${o.id} has a non-positive amount (${o.amount})`);
      if (debtor === creditor) throw new Error(`Obligation ${o.id} has the same debtor and creditor`);
      seen.add(o.id);
      return { id: o.id, debtor, creditor, amount: o.amount };
    })
    .sort(byId);
}

function byId(a: { id: bigint }, b: { id: bigint }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function lowercaseSet(addresses: Iterable<string> | undefined): Set<string> {
  return new Set([...(addresses ?? [])].map((a) => a.toLowerCase()));
}

function lowercaseMap(amounts: Record<string, bigint>): Map<string, bigint> {
  return new Map(Object.entries(amounts).map(([address, amount]) => [address.toLowerCase(), amount]));
}

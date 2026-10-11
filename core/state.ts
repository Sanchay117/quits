// Reads the whole clearing-house state in a handful of batched calls. Shared by the app and the scripts.
import type { PublicClient } from "viem";
import { clearingHouseAbi } from "./abi.ts";
import type { ArcNetwork, Hex } from "./chains.ts";

export const InvoiceStatus = {
  None: 0,
  Pending: 1,
  Open: 2,
  Paid: 3,
  Rejected: 4,
  Cancelled: 5,
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const statusLabel: Record<InvoiceStatus, string> = {
  0: "None",
  1: "Pending",
  2: "Open",
  3: "Paid",
  4: "Rejected",
  5: "Cancelled",
};

export interface Invoice {
  id: bigint;
  creditor: Hex;
  debtor: Hex;
  token: Hex;
  amount: bigint;
  outstanding: bigint;
  dueDate: bigint;
  status: InvoiceStatus;
  ref: Hex;
  issuedAt: bigint;
  memo: string;
}

export interface Member {
  address: Hex;
  /** Display name from register(); empty for addresses that only appear on invoices. */
  name: string;
  registered: boolean;
  /** Deposit per token address (lowercase key), 6-decimal units. */
  balances: Record<string, bigint>;
  /** On the blocklist of this token (lowercase key) or of USDC. Blocked members cannot take part in a cycle. */
  blocked: Record<string, boolean>;
  /** isSolverFor(member, address(0)): the member lets anyone submit cycles that draw cash from its deposit. */
  allowsAnySolver: boolean;
  /**
   * settle() sent by the state's submitter may draw cash from this member's deposit: allowsAnySolver, or the member
   * is the submitter, or isSolverFor(member, submitter). Without a submitter it equals allowsAnySolver. When false,
   * the member can still take part in cycles that leave its net at zero or above (loops of debt need no cash).
   */
  drawableBySubmitter: boolean;
}

export interface Cycle {
  id: bigint;
  token: Hex;
  invoiceCount: number;
  memberCount: number;
  solver: Hex;
  timestamp: bigint;
  blockNumber: bigint;
  grossCleared: bigint;
  cashMoved: bigint;
}

export interface TokenTotals {
  token: Hex;
  totalCleared: bigint;
  totalCashMoved: bigint;
}

export interface ChainState {
  network: ArcNetwork["name"];
  clearingHouse: Hex;
  /** The block every read in this state was made at, and its timestamp. */
  blockNumber: bigint;
  timestamp: bigint;
  tokens: Hex[];
  /** Keyed by lowercase address. Includes registered members and every invoice counterparty. */
  members: Record<string, Member>;
  invoices: Invoice[];
  cycles: Cycle[];
  totals: TokenTotals[];
  /** The account Member.drawableBySubmitter was read for (loadState's opts.submitter), or null. */
  submitter: Hex | null;
}

export interface LoadStateOptions {
  /** The account that would send settle(), e.g. the connected wallet. Decides Member.drawableBySubmitter. */
  submitter?: Hex | null;
}

export interface CycleDetail {
  clears: { id: bigint; amount: bigint; remaining: bigint }[];
  nets: { member: Hex; net: bigint }[];
  transactionHash: Hex | null;
}

const PAGE = 150n;

const blocklistAbi = [
  {
    type: "function",
    name: "isBlacklisted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const lc = (a: string) => a.toLowerCase();

/** setSolver(ANY_SOLVER, true) lets anyone submit cycles that draw cash from the caller's deposit. */
export const ANY_SOLVER: Hex = "0x0000000000000000000000000000000000000000";

/**
 * The whole clearing-house state. Pass `opts.submitter` (the account that would send settle()) to learn whose
 * deposits a cycle it sends may draw on (Member.drawableBySubmitter); without it, only members that allow any solver
 * count as drawable.
 *
 * One consistent snapshot: the latest block is fetched first and every read is pinned to it, so invoices, deposits,
 * blocklist and consent flags, cycles, totals, `blockNumber` and `timestamp` all describe the same block even when
 * new blocks arrive (Arc makes one in well under a second) while the reads are in flight.
 */
export async function loadState(client: PublicClient, net: ArcNetwork, opts: LoadStateOptions = {}): Promise<ChainState> {
  const address = net.clearingHouse;
  if (!address) throw new Error(`No clearing house deployed on ${net.label}`);
  const submitter = opts.submitter ?? null;
  if (submitter !== null && !/^0x[0-9a-fA-F]{40}$/.test(submitter)) {
    throw new Error(`Submitter must be a 20-byte hex address, got "${submitter}"`);
  }
  const contract = { address, abi: clearingHouseAbi } as const;
  const multicallAddress = net.multicall3;

  const block = await client.getBlock();
  const blockNumber = block.number;

  const head = await client.multicall({
    allowFailure: false,
    multicallAddress,
    blockNumber,
    contracts: [
      { ...contract, functionName: "invoiceCount" },
      { ...contract, functionName: "cycleCount" },
      { ...contract, functionName: "members" },
      { ...contract, functionName: "supportedTokens" },
    ],
  });
  const [invoiceCount, cycleCount, registered, tokens] = head as [bigint, bigint, readonly Hex[], readonly Hex[]];

  const invoicePages: Promise<readonly unknown[]>[] = [];
  for (let from = 1n; from <= invoiceCount; from += PAGE) {
    invoicePages.push(
      client.readContract({ ...contract, functionName: "getInvoices", args: [from, PAGE], blockNumber }),
    );
  }
  const cyclePages: Promise<readonly unknown[]>[] = [];
  for (let from = 0n; from < cycleCount; from += PAGE) {
    cyclePages.push(client.readContract({ ...contract, functionName: "getCycles", args: [from, PAGE], blockNumber }));
  }
  const [invoiceChunks, cycleChunks] = await Promise.all([Promise.all(invoicePages), Promise.all(cyclePages)]);

  const invoices: Invoice[] = invoiceChunks.flat().map((raw, i) => {
    const r = raw as {
      creditor: Hex;
      dueDate: bigint;
      status: number;
      debtor: Hex;
      amount: bigint;
      token: Hex;
      outstanding: bigint;
      ref: Hex;
      issuedAt: bigint;
      memo: string;
    };
    return {
      id: BigInt(i + 1),
      creditor: r.creditor,
      debtor: r.debtor,
      token: r.token,
      amount: r.amount,
      outstanding: r.outstanding,
      dueDate: r.dueDate,
      status: r.status as InvoiceStatus,
      ref: r.ref,
      issuedAt: r.issuedAt,
      memo: r.memo,
    };
  });

  const cycles: Cycle[] = cycleChunks.flat().map((raw, i) => {
    const r = raw as {
      token: Hex;
      invoiceCount: number;
      memberCount: number;
      solver: Hex;
      timestamp: number;
      blockNumber: number;
      grossCleared: bigint;
      cashMoved: bigint;
    };
    return {
      id: BigInt(i),
      token: r.token,
      invoiceCount: Number(r.invoiceCount),
      memberCount: Number(r.memberCount),
      solver: r.solver,
      timestamp: BigInt(r.timestamp),
      blockNumber: BigInt(r.blockNumber),
      grossCleared: r.grossCleared,
      cashMoved: r.cashMoved,
    };
  });

  // Every address that is a member or appears on an invoice.
  const addresses: Hex[] = [];
  const seen = new Set<string>();
  const add = (a: Hex) => {
    if (!seen.has(lc(a))) {
      seen.add(lc(a));
      addresses.push(a);
    }
  };
  registered.forEach(add);
  invoices.forEach((inv) => {
    add(inv.creditor);
    add(inv.debtor);
  });
  const registeredSet = new Set(registered.map(lc));

  const perMember = addresses.length
    ? await client.multicall({
        allowFailure: false,
        multicallAddress,
        blockNumber,
        contracts: [
          ...addresses.map((a) => ({ ...contract, functionName: "nameOf" as const, args: [a] as const })),
          ...tokens.map((t) => ({ ...contract, functionName: "balancesOf" as const, args: [addresses, t] as const })),
          ...tokens.flatMap((t) =>
            addresses.map((a) => ({ address: t, abi: blocklistAbi, functionName: "isBlacklisted" as const, args: [a] as const })),
          ),
          ...addresses.map((a) => ({ ...contract, functionName: "isSolverFor" as const, args: [a, ANY_SOLVER] as const })),
          ...(submitter
            ? addresses.map((a) => ({ ...contract, functionName: "isSolverFor" as const, args: [a, submitter] as const }))
            : []),
        ],
      })
    : [];
  // Results come back in call order: take each group in turn.
  let read = 0;
  const next = (count: number) => {
    const group = perMember.slice(read, read + count);
    read += count;
    return group;
  };
  const names = next(addresses.length) as string[];
  const balanceLists = next(tokens.length) as (readonly bigint[])[];
  const blockFlags = next(tokens.length * addresses.length) as boolean[];
  const anySolverFlags = next(addresses.length) as boolean[];
  const submitterFlags = submitter ? (next(addresses.length) as boolean[]) : [];

  const usdcIndex = tokens.findIndex((t) => lc(t) === lc(net.usdc));
  const submitterKey = submitter ? lc(submitter) : null;
  const members: Record<string, Member> = {};
  addresses.forEach((a, i) => {
    const balances: Record<string, bigint> = {};
    const blocked: Record<string, boolean> = {};
    tokens.forEach((t, ti) => {
      balances[lc(t)] = balanceLists[ti][i];
      const onToken = blockFlags[ti * addresses.length + i];
      const onUsdc = usdcIndex >= 0 ? blockFlags[usdcIndex * addresses.length + i] : false;
      blocked[lc(t)] = onToken || onUsdc;
    });
    // The same test as ClearingHouse._mayDraw(member, msg.sender).
    const allowsAnySolver = anySolverFlags[i];
    const drawableBySubmitter =
      allowsAnySolver || (submitterKey !== null && (lc(a) === submitterKey || submitterFlags[i]));
    members[lc(a)] = {
      address: a,
      name: names[i],
      registered: registeredSet.has(lc(a)),
      balances,
      blocked,
      allowsAnySolver,
      drawableBySubmitter,
    };
  });

  const totalsRaw = tokens.length
    ? ((await client.multicall({
        allowFailure: false,
        multicallAddress,
        blockNumber,
        contracts: tokens.flatMap((t) => [
          { ...contract, functionName: "totalCleared" as const, args: [t] as const },
          { ...contract, functionName: "totalCashMoved" as const, args: [t] as const },
        ]),
      })) as bigint[])
    : [];
  const totals: TokenTotals[] = tokens.map((t, i) => ({
    token: t,
    totalCleared: totalsRaw[2 * i],
    totalCashMoved: totalsRaw[2 * i + 1],
  }));

  return {
    network: net.name,
    clearingHouse: address,
    blockNumber,
    timestamp: block.timestamp,
    tokens: [...tokens],
    members,
    invoices,
    cycles,
    totals,
    submitter,
  };
}

/** The invoices a cycle cleared and each member's net, read from the cycle's own block. */
export async function loadCycleDetail(client: PublicClient, net: ArcNetwork, cycle: Cycle): Promise<CycleDetail> {
  const address = net.clearingHouse;
  if (!address) throw new Error(`No clearing house deployed on ${net.label}`);
  const range = { fromBlock: cycle.blockNumber, toBlock: cycle.blockNumber };
  const [cleared, netted] = await Promise.all([
    client.getContractEvents({
      address,
      abi: clearingHouseAbi,
      eventName: "InvoiceCleared",
      args: { cycleId: cycle.id },
      ...range,
    }),
    client.getContractEvents({
      address,
      abi: clearingHouseAbi,
      eventName: "MemberNetted",
      args: { cycleId: cycle.id },
      ...range,
    }),
  ]);
  return {
    clears: cleared.map((e) => ({ id: e.args.id!, amount: e.args.amount!, remaining: e.args.remaining! })),
    nets: netted.map((e) => ({ member: e.args.member as Hex, net: e.args.net! })),
    transactionHash: (cleared[0]?.transactionHash ?? netted[0]?.transactionHash ?? null) as Hex | null,
  };
}

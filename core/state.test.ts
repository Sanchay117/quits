// Tests for loadState against an in-memory fake of the contract and the tokens: how its batched reads map back onto
// members (names, balances, blocklist flags, solver consent), that every read is pinned to one block, and that
// solverInputFromState consumes the result.
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import type { ArcNetwork, Hex } from "./chains.ts";
import { solverInputFromState } from "./solver.ts";
import { ANY_SOLVER, InvoiceStatus, lc, loadState, type ChainState, type Member } from "./state.ts";

/** A lowercase 20-byte address ending in the hex digits of `n`. */
function address(n: number): Hex {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

/** The same address with its hex digits upper-cased, as a checksummed address might arrive. */
function mixedCase(a: string): Hex {
  return `0x${a.slice(2).toUpperCase()}`;
}

const HOUSE = address(0x99);
const USDC: Hex = "0x3600000000000000000000000000000000000000";
const EURC: Hex = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const [A, B, C, D] = [0xa, 0xb, 0xc, 0xd].map(address);
/** Registered, owes nothing, and is the submitter in most tests. */
const S = address(0x5e);
/** A solver that is not a member. */
const X = address(0x77);

const net: ArcNetwork = {
  name: "local",
  label: "Fake chain",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:0",
  explorer: null,
  usdc: USDC,
  eurc: EURC,
  memo: null,
  multicall3From: null,
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  clearingHouse: HOUSE,
  deployBlock: 0n,
};

interface Call {
  address: Hex;
  functionName: string;
  args?: readonly unknown[];
}

// Registered: A, B, S (in that order). C and D only appear on invoices. Approvals: A lets anyone draw, B lets S,
// C lets X, D and S let nobody. Every balance is distinct so a misplaced read shows up. C is blocked on EURC and D on
// USDC, which Arc treats as a block on every token.
const registered = [A, B, S];
const names: Record<string, string> = { [A]: "Atlas Freight", [B]: "Bluebird Packaging", [S]: "Solver Co" };
const invoices = [
  { creditor: B, debtor: A, token: EURC, amount: 10n, outstanding: 10n },
  { creditor: C, debtor: B, token: USDC, amount: 20n, outstanding: 20n },
  { creditor: A, debtor: D, token: USDC, amount: 30n, outstanding: 5n },
].map((inv, i) => ({
  ...inv,
  dueDate: 0n,
  status: InvoiceStatus.Open as InvoiceStatus,
  ref: `0x${(i + 1).toString(16).padStart(64, "0")}`,
  issuedAt: 1n,
  memo: `invoice ${i + 1}`,
}));
type FakeInvoice = (typeof invoices)[number];
const balances: Record<string, Record<string, bigint>> = {
  [USDC]: { [A]: 11n, [B]: 21n, [C]: 31n, [D]: 41n, [S]: 51n },
  [lc(EURC)]: { [A]: 12n, [B]: 22n, [C]: 32n, [D]: 42n, [S]: 52n },
};
const blacklisted: Record<string, string[]> = { [USDC]: [D], [lc(EURC)]: [C] };
const approvals: [member: Hex, solver: Hex][] = [
  [A, ANY_SOLVER],
  [B, S],
  [C, X],
];

/** A settled cycle as getCycles returns it. */
function fakeCycle(i: number) {
  return {
    token: USDC,
    invoiceCount: 2,
    memberCount: 3,
    solver: S,
    timestamp: 900 + i,
    blockNumber: 30 + i,
    grossCleared: 50n,
    cashMoved: 1n,
  };
}

/** What the fake contract holds at one block. */
interface FakeChain {
  invoices: FakeInvoice[];
  cycles: ReturnType<typeof fakeCycle>[];
}

/** One RPC request the fake answered, with the block it was pinned to (undefined: "latest"). */
interface Request {
  method: "getBlock" | "readContract" | "multicall";
  /** readContract: `name(arg, ...)`; multicall: the distinct function names, in order. */
  what?: string;
  blockNumber?: bigint;
}

/** The block getBlock reports as latest. */
const SNAPSHOT = { number: 42n, timestamp: 1_000n };

/**
 * Answers every read loadState makes, and records each request and each multicall's calls. With `next`, a new block
 * (43) holding `next` arrives right after getBlock reports block 42: reads pinned to 42 still see `chain`, reads
 * at "latest" see `next`, and reads at any other block fail.
 */
function fakeClient(chain: FakeChain = { invoices, cycles: [] }, next?: FakeChain) {
  const multicalls: Call[][] = [];
  const requests: Request[] = [];
  let head = SNAPSHOT.number;
  const chainAt = (blockNumber: bigint | undefined): FakeChain => {
    const at = blockNumber ?? head;
    if (at === SNAPSHOT.number) return chain;
    if (next && at === SNAPSHOT.number + 1n) return next;
    throw new Error(`Read at unknown block ${at}`);
  };
  const onHouse = (call: Call) => {
    if (lc(call.address) !== lc(HOUSE)) throw new Error(`${call.functionName} sent to ${call.address}`);
  };
  const read = (call: Call, state: FakeChain): unknown => {
    const args = call.args ?? [];
    const arg = (i: number) => lc(args[i] as string);
    if (call.functionName === "isBlacklisted") {
      if (!(lc(call.address) in blacklisted)) throw new Error(`isBlacklisted sent to ${call.address}`);
      return blacklisted[lc(call.address)].includes(arg(0));
    }
    onHouse(call);
    switch (call.functionName) {
      case "invoiceCount":
        return BigInt(state.invoices.length);
      case "cycleCount":
        return BigInt(state.cycles.length);
      case "members":
        return registered.map(mixedCase);
      case "supportedTokens":
        return [USDC, EURC];
      case "getInvoices":
        return state.invoices.slice(Number(args[0]) - 1, Number(args[0]) - 1 + Number(args[1]));
      case "getCycles":
        return state.cycles.slice(Number(args[0]), Number(args[0]) + Number(args[1]));
      case "nameOf":
        return names[arg(0)] ?? "";
      case "balancesOf":
        return (args[0] as Hex[]).map((member) => balances[arg(1)][lc(member)] ?? 0n);
      case "isSolverFor":
        return approvals.some(([member, solver]) => member === arg(0) && solver === arg(1));
      case "totalCleared":
        return 1000n;
      case "totalCashMoved":
        return 30n;
    }
    throw new Error(`Unexpected read ${call.functionName}`);
  };
  const client = {
    getBlock: async () => {
      requests.push({ method: "getBlock" });
      const block = { ...SNAPSHOT };
      if (next) head = SNAPSHOT.number + 1n;
      return block;
    },
    readContract: async (call: Call & { blockNumber?: bigint }) => {
      const what = `${call.functionName}(${(call.args ?? []).join(", ")})`;
      requests.push({ method: "readContract", what, blockNumber: call.blockNumber });
      return read(call, chainAt(call.blockNumber));
    },
    multicall: async ({ contracts, blockNumber }: { contracts: Call[]; blockNumber?: bigint }) => {
      const what = [...new Set(contracts.map((c) => c.functionName))].join(", ");
      requests.push({ method: "multicall", what, blockNumber });
      multicalls.push(contracts);
      const state = chainAt(blockNumber);
      return contracts.map((c) => read(c, state));
    },
  };
  return { client: client as unknown as PublicClient, multicalls, requests };
}

/** The same client with every block pin dropped, as loadState read before it pinned its reads. */
function unpinned(client: PublicClient): PublicClient {
  const c = client as unknown as Record<"getBlock" | "readContract" | "multicall", (p?: object) => Promise<unknown>>;
  return {
    getBlock: () => c.getBlock(),
    readContract: (p: object) => c.readContract({ ...p, blockNumber: undefined }),
    multicall: (p: object) => c.multicall({ ...p, blockNumber: undefined }),
  } as unknown as PublicClient;
}

function consentOf(state: ChainState) {
  return Object.fromEntries(
    Object.entries(state.members).map(([key, m]) => [key, { any: m.allowsAnySolver, drawable: m.drawableBySubmitter }]),
  );
}

/** The solvers asked about in isSolverFor reads, in order. */
function solverReads(calls: Call[]): string[] {
  return calls.filter((c) => c.functionName === "isSolverFor").map((c) => lc(c.args![1] as string));
}

describe("loadState", () => {
  it("still works with two arguments and reads every member's balances and blocklist flags", async () => {
    const { client } = fakeClient();
    const state = await loadState(client, net);
    expect(state.submitter).toBeNull();
    expect(Object.keys(state.members)).toEqual([A, B, S, C, D]);
    expect(state.members[A]).toEqual({
      address: mixedCase(A),
      name: "Atlas Freight",
      registered: true,
      balances: { [USDC]: 11n, [lc(EURC)]: 12n },
      blocked: { [USDC]: false, [lc(EURC)]: false },
      allowsAnySolver: true,
      drawableBySubmitter: true,
    });
    expect(state.members[C]).toMatchObject({
      name: "",
      registered: false,
      balances: { [USDC]: 31n, [lc(EURC)]: 32n },
      blocked: { [USDC]: false, [lc(EURC)]: true },
    });
    expect(state.members[D]).toMatchObject({
      balances: { [USDC]: 41n, [lc(EURC)]: 42n },
      blocked: { [USDC]: true, [lc(EURC)]: true },
    });
    expect(state.invoices.map((inv) => [inv.id, inv.memo])).toEqual([
      [1n, "invoice 1"],
      [2n, "invoice 2"],
      [3n, "invoice 3"],
    ]);
    expect(state.totals).toEqual([
      { token: USDC, totalCleared: 1000n, totalCashMoved: 30n },
      { token: EURC, totalCleared: 1000n, totalCashMoved: 30n },
    ]);
  });

  it("without a submitter counts only members that allow any solver as drawable", async () => {
    const { client, multicalls } = fakeClient();
    const state = await loadState(client, net);
    expect(consentOf(state)).toEqual({
      [A]: { any: true, drawable: true },
      [B]: { any: false, drawable: false },
      [S]: { any: false, drawable: false },
      [C]: { any: false, drawable: false },
      [D]: { any: false, drawable: false },
    });
    // One isSolverFor(member, address(0)) per member, in the per-member multicall; no extra round trips.
    expect(multicalls).toHaveLength(3);
    expect(solverReads(multicalls[1])).toEqual(Array(5).fill(ANY_SOLVER));
  });

  it("with a submitter adds the submitter itself and the members that approved it", async () => {
    const { client, multicalls } = fakeClient();
    const submitter = mixedCase(S);
    const state = await loadState(client, net, { submitter });
    expect(state.submitter).toBe(submitter);
    expect(consentOf(state)).toEqual({
      [A]: { any: true, drawable: true },
      [B]: { any: false, drawable: true },
      [S]: { any: false, drawable: true },
      [C]: { any: false, drawable: false },
      [D]: { any: false, drawable: false },
    });
    expect(multicalls).toHaveLength(3);
    expect(multicalls[1].some((c) => c.functionName === "nameOf")).toBe(true);
    expect(solverReads(multicalls[1])).toEqual([...Array(5).fill(ANY_SOLVER), ...Array(5).fill(S)]);
    // The consent reads come after the others, so names, balances and blocklist flags are unchanged.
    const plain = await loadState(fakeClient().client, net);
    const withoutConsent = (m: Member) => ({ ...m, allowsAnySolver: null, drawableBySubmitter: null });
    for (const [key, member] of Object.entries(state.members)) {
      expect(withoutConsent(member)).toEqual(withoutConsent(plain.members[key]));
    }
  });

  it("with a submitter that is not a member counts the members that approved it", async () => {
    const state = await loadState(fakeClient().client, net, { submitter: X });
    expect(consentOf(state)).toEqual({
      [A]: { any: true, drawable: true },
      [B]: { any: false, drawable: false },
      [S]: { any: false, drawable: false },
      [C]: { any: false, drawable: true },
      [D]: { any: false, drawable: false },
    });
  });

  it("treats a null or missing submitter as none", async () => {
    for (const opts of [{}, { submitter: null }, { submitter: undefined }]) {
      const { client, multicalls } = fakeClient();
      const state = await loadState(client, net, opts);
      expect(state.submitter).toBeNull();
      expect(state.members[B].drawableBySubmitter).toBe(false);
      expect(solverReads(multicalls[1])).toHaveLength(5);
    }
  });

  it("rejects a submitter that is not an address before reading anything", async () => {
    const { client, multicalls, requests } = fakeClient();
    await expect(loadState(client, net, { submitter: "0x1234" })).rejects.toThrow(
      'Submitter must be a 20-byte hex address, got "0x1234"',
    );
    expect(multicalls).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("fetches the block first and pins every read to it, across several pages of invoices and cycles", async () => {
    const bulk = Array.from({ length: 160 }, (_, i) => ({
      ...invoices[1],
      ref: `0x${(i + 4).toString(16).padStart(64, "0")}`,
      memo: `invoice ${i + 4}`,
    }));
    const cycles = Array.from({ length: 151 }, (_, i) => fakeCycle(i));
    for (const submitter of [undefined, S]) {
      const { client, requests } = fakeClient({ invoices: [...invoices, ...bulk], cycles });
      const state = await loadState(client, net, { submitter });
      expect(state.blockNumber).toBe(SNAPSHOT.number);
      expect(state.timestamp).toBe(SNAPSHOT.timestamp);
      expect(state.invoices).toHaveLength(163);
      expect(state.invoices[162]).toMatchObject({ id: 163n, memo: "invoice 163" });
      expect(state.cycles).toHaveLength(151);
      expect(state.cycles[150]).toMatchObject({ id: 150n, timestamp: 1050n, blockNumber: 180n, grossCleared: 50n });

      const head = "invoiceCount, cycleCount, members, supportedTokens";
      const perMember = "nameOf, balancesOf, isBlacklisted, isSolverFor";
      expect(requests).toEqual([
        { method: "getBlock" },
        { method: "multicall", what: head, blockNumber: 42n },
        { method: "readContract", what: "getInvoices(1, 150)", blockNumber: 42n },
        { method: "readContract", what: "getInvoices(151, 150)", blockNumber: 42n },
        { method: "readContract", what: "getCycles(0, 150)", blockNumber: 42n },
        { method: "readContract", what: "getCycles(150, 150)", blockNumber: 42n },
        { method: "multicall", what: perMember, blockNumber: 42n },
        { method: "multicall", what: "totalCleared, totalCashMoved", blockNumber: 42n },
      ]);
    }
  });

  it("keeps a cycle that settles while it reads out of the state", async () => {
    // Block 43 arrives right after loadState learns of block 42: a cycle paid invoice 3 and moved deposits.
    const settled: FakeChain = {
      invoices: invoices.map((inv, i) => (i === 2 ? { ...inv, status: InvoiceStatus.Paid, outstanding: 0n } : inv)),
      cycles: [fakeCycle(0)],
    };
    const before: FakeChain = { invoices, cycles: [] };

    const state = await loadState(fakeClient(before, settled).client, net);
    expect(state.blockNumber).toBe(42n);
    expect(state.cycles).toEqual([]);
    expect(state.invoices[2]).toMatchObject({ status: InvoiceStatus.Open, outstanding: 5n });

    // Control: the same load without the pins would label block 43's invoices and cycles as block 42.
    const loose = await loadState(unpinned(fakeClient(before, settled).client), net);
    expect(loose.blockNumber).toBe(42n);
    expect(loose.cycles).toHaveLength(1);
    expect(loose.invoices[2]).toMatchObject({ status: InvoiceStatus.Paid, outstanding: 0n });
  });

  it("feeds solverInputFromState the deposits the submitter may draw on", async () => {
    const state = await loadState(fakeClient().client, net, { submitter: S });
    expect(solverInputFromState(state, EURC)).toEqual({
      obligations: [{ id: 1n, debtor: A, creditor: B, amount: 10n }],
      liquidity: { [A]: 12n, [B]: 22n, [S]: 52n, [C]: 0n, [D]: 0n },
      blocked: [C, D],
    });
    const anyone = await loadState(fakeClient().client, net);
    expect(solverInputFromState(anyone, USDC)).toEqual({
      obligations: [
        { id: 2n, debtor: B, creditor: C, amount: 20n },
        { id: 3n, debtor: D, creditor: A, amount: 5n },
      ],
      liquidity: { [A]: 11n, [B]: 0n, [S]: 0n, [C]: 0n, [D]: 0n },
      blocked: [D],
    });
  });
});

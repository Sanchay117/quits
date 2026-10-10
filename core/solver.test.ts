// Tests for the netting solver: hand-made networks with known answers, checkSolution as a mirror of settle(), the
// chain state adapters, and properties over seeded random networks checked against an LP solver and brute force.
// Amounts are raw 6-decimal token units throughout.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Hex } from "./chains.ts";
import {
  checkSolution,
  eligibleObligations,
  grossSettlementCash,
  MAX_BATCH,
  solve,
  solverInputFromState,
  type Clear,
  type Obligation,
  type SolveInput,
  type SolveResult,
} from "./solver.ts";
import { InvoiceStatus, type ChainState, type Invoice, type Member } from "./state.ts";

// ---------------------------------------------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------------------------------------------

/** A lowercase 20-byte address ending in the hex digits of `n`. */
function address(n: number): Hex {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

const [A, B, C, D, E] = [0xa, 0xb, 0xc, 0xd, 0xe].map(address);

function owes(id: number, debtor: string, creditor: string, amount: bigint): Obligation {
  return { id: BigInt(id), debtor, creditor, amount };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** The same address with its hex digits upper-cased, as a checksummed address might arrive. */
function mixedCase(a: string): Hex {
  return `0x${a.slice(2).toUpperCase()}`;
}

/**
 * settle() would accept the solution, and checkSolution derives the same totals from it. Batch size limits are about
 * the call rather than the netting: they apply exactly when there is nothing to clear or more than MAX_BATCH clears.
 */
function expectSettleable(input: SolveInput, result: SolveResult): void {
  const check = checkSolution(input, result.clears);
  expect(check.errors.filter((e) => !/^(EmptySolution|BatchTooLarge):/.test(e))).toEqual([]);
  expect(check.ok).toBe(result.clears.length > 0 && result.clears.length <= MAX_BATCH);
  expect({ gross: check.gross, cash: check.cash, nets: check.nets }).toEqual({
    gross: result.gross,
    cash: result.cash,
    nets: result.nets,
  });
}

function withoutBlocked(input: SolveInput): Obligation[] {
  const blocked = new Set(input.blocked ?? []);
  return input.obligations.filter((o) => !blocked.has(o.debtor) && !blocked.has(o.creditor));
}

/** mulberry32: a tiny seeded PRNG, so every random network can be rebuilt from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NetworkShape {
  members: [min: number, max: number];
  obligations: [min: number, max: number];
  /** Largest invoice, in `unit`s. */
  maxAmount: number;
  /** Largest deposit, in `unit`s. */
  maxLiquidity: number;
  unit: bigint;
}

/**
 * A reproducible random invoice network. Pairs repeat freely (parallel invoices), about 40% of members have no
 * deposit at all, and about 5% are blocked.
 */
function randomNetwork(seed: number, shape: NetworkShape): SolveInput {
  const random = prng(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const members = Array.from({ length: int(...shape.members) }, (_, i) => address(i + 1));
  const obligations = Array.from({ length: int(...shape.obligations) }, (_, i) => {
    const debtor = int(0, members.length - 1);
    const creditor = (debtor + int(1, members.length - 1)) % members.length;
    return owes(i + 1, members[debtor], members[creditor], BigInt(int(1, shape.maxAmount)) * shape.unit);
  });
  const liquidity: Record<string, bigint> = {};
  for (const member of members) {
    if (random() < 0.6) liquidity[member] = BigInt(int(0, shape.maxLiquidity)) * shape.unit;
  }
  const blocked = members.filter(() => random() < 0.05);
  return { obligations, liquidity, blocked };
}

function seeds(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

// ---------------------------------------------------------------------------------------------------------------
// Independent oracles: a floating point LP and brute force. Neither shares code with the solver.
// ---------------------------------------------------------------------------------------------------------------

interface LpModel {
  optimize: string;
  opType: "max" | "min";
  constraints: Record<string, { min?: number; max?: number }>;
  variables: Record<string, Record<string, number>>;
}

// javascript-lp-solver is CommonJS without type declarations; this is the slice of its API used here.
const lpSolver = createRequire(import.meta.url)("javascript-lp-solver") as {
  Solve(model: LpModel): { feasible: boolean; result: number };
};

/**
 * The netting problem as an LP over amounts divided by `unit` (small integers, so floating point is accurate):
 * 0 <= x_e <= a_e; for each member, payments minus receipts <= liquidity; p_v >= that net payment and p_v >= 0.
 * Attribute "gross" sums the x_e and "cash" sums the p_v.
 */
function lpModel(input: SolveInput, unit: bigint): Pick<LpModel, "constraints" | "variables"> {
  const obligations = withoutBlocked(input);
  const toUnits = (amount: bigint) => Number(amount / unit);
  const constraints: LpModel["constraints"] = {};
  const variables: LpModel["variables"] = {};
  for (const member of new Set(obligations.flatMap((o) => [o.debtor, o.creditor]))) {
    constraints[`liquidity ${member}`] = { max: toUnits(input.liquidity[member] ?? 0n) };
    constraints[`payment ${member}`] = { max: 0 };
    variables[`p ${member}`] = { cash: 1, [`payment ${member}`]: -1 };
  }
  obligations.forEach((o, i) => {
    constraints[`outstanding ${i}`] = { max: toUnits(o.amount) };
    variables[`x ${i}`] = {
      gross: 1,
      [`outstanding ${i}`]: 1,
      [`liquidity ${o.debtor}`]: 1,
      [`liquidity ${o.creditor}`]: -1,
      [`payment ${o.debtor}`]: 1,
      [`payment ${o.creditor}`]: -1,
    };
  });
  return { constraints, variables };
}

/** Max gross by LP, then min cash by a second LP with gross held at that optimum; both in 6-decimal units. */
function lpOptimum(input: SolveInput, unit: bigint): { gross: number; cash: number } {
  const model = lpModel(input, unit);
  const maxGross = lpSolver.Solve({ optimize: "gross", opType: "max", ...model });
  const minCash = lpSolver.Solve({
    optimize: "cash",
    opType: "min",
    constraints: { ...model.constraints, gross: { min: maxGross.result } },
    variables: model.variables,
  });
  expect(maxGross.feasible && minCash.feasible).toBe(true);
  return { gross: maxGross.result * Number(unit), cash: minCash.result * Number(unit) };
}

/** Cash a clear vector moves, or null when some member's net payment exceeds its liquidity. */
function cashIfValid(obligations: Obligation[], amounts: bigint[], liquidity: Record<string, bigint>): bigint | null {
  const nets = new Map<string, bigint>();
  obligations.forEach((o, i) => {
    nets.set(o.creditor, (nets.get(o.creditor) ?? 0n) + amounts[i]);
    nets.set(o.debtor, (nets.get(o.debtor) ?? 0n) - amounts[i]);
  });
  let cash = 0n;
  for (const [member, net] of nets) {
    if (-net > (liquidity[member] ?? 0n)) return null;
    if (net < 0n) cash -= net;
  }
  return cash;
}

/** Tries every integer clear vector of a tiny network and keeps the best: most gross, then least cash. */
function bruteForceOptimum(input: SolveInput): { gross: bigint; cash: bigint } {
  const obligations = withoutBlocked(input);
  const amounts = obligations.map(() => 0n);
  let best = { gross: 0n, cash: 0n }; // clearing nothing is always valid
  const visit = (i: number): void => {
    if (i === obligations.length) {
      const cash = cashIfValid(obligations, amounts, input.liquidity);
      const gross = amounts.reduce((sum, x) => sum + x, 0n);
      if (cash !== null && (gross > best.gross || (gross === best.gross && cash < best.cash))) best = { gross, cash };
      return;
    }
    for (let x = 0n; x <= obligations[i].amount; x++) {
      amounts[i] = x;
      visit(i + 1);
    }
  };
  visit(0);
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// solve(): hand-made networks
// ---------------------------------------------------------------------------------------------------------------

describe("solve on hand-made networks", () => {
  it("clears a 3-cycle in full with no deposits and moves no cash", () => {
    const input = { obligations: [owes(1, A, B, 10n), owes(2, B, C, 10n), owes(3, C, A, 10n)], liquidity: {} };
    const result = solve(input);
    expect(result).toEqual({
      clears: [
        { id: 1n, amount: 10n },
        { id: 2n, amount: 10n },
        { id: 3n, amount: 10n },
      ],
      gross: 30n,
      cash: 0n,
      nets: { [A]: 0n, [B]: 0n, [C]: 0n },
      totalOutstanding: 30n,
      uncleared: 0n,
    });
    expectSettleable(input, result);
  });

  it("settles a chain A -> B -> C from A's deposit alone, passing through B", () => {
    const input = { obligations: [owes(1, A, B, 10n), owes(2, B, C, 10n)], liquidity: { [A]: 10n } };
    const result = solve(input);
    expect(result).toMatchObject({ gross: 20n, cash: 10n, uncleared: 0n, nets: { [A]: -10n, [B]: 0n, [C]: 10n } });
    expectSettleable(input, result);
  });

  it("clears a chain only as far as the payer's deposit reaches", () => {
    const input = { obligations: [owes(1, A, B, 10n), owes(2, B, C, 10n)], liquidity: { [A]: 4n } };
    const result = solve(input);
    expect(result.clears).toEqual([
      { id: 1n, amount: 4n },
      { id: 2n, amount: 4n },
    ]);
    expect(result).toMatchObject({ gross: 8n, cash: 4n, totalOutstanding: 20n, uncleared: 12n });
    expectSettleable(input, result);
  });

  it("clears two disjoint cycles independently, the uneven one up to its smaller side", () => {
    const input = {
      obligations: [owes(1, A, B, 10n), owes(2, B, A, 6n), owes(3, C, D, 5n), owes(4, D, E, 5n), owes(5, E, C, 5n)],
      liquidity: {},
    };
    const result = solve(input);
    expect(result.clears).toEqual([
      { id: 1n, amount: 6n },
      { id: 2n, amount: 6n },
      { id: 3n, amount: 5n },
      { id: 4n, amount: 5n },
      { id: 5n, amount: 5n },
    ]);
    expect(result).toMatchObject({ gross: 27n, cash: 0n, uncleared: 4n });
    expectSettleable(input, result);
  });

  it("clears part of an invoice when the debtor's deposit runs short", () => {
    const input = { obligations: [owes(1, A, B, 100n)], liquidity: { [A]: 30n } };
    const result = solve(input);
    expect(result.clears).toEqual([{ id: 1n, amount: 30n }]);
    expect(result).toMatchObject({ gross: 30n, cash: 30n, uncleared: 70n, nets: { [A]: -30n, [B]: 30n } });
    expectSettleable(input, result);
  });

  it("drops every obligation of a blocked member and never uses its deposit", () => {
    // Without the block this cycle would clear for free; C's large deposit must not help either.
    const input = {
      obligations: [owes(1, A, B, 10n), owes(2, B, C, 10n), owes(3, C, A, 10n)],
      liquidity: { [A]: 4n, [C]: 1000n },
      blocked: [C],
    };
    const result = solve(input);
    expect(result).toEqual({
      clears: [{ id: 1n, amount: 4n }],
      gross: 4n,
      cash: 4n,
      nets: { [A]: -4n, [B]: 4n },
      totalOutstanding: 10n,
      uncleared: 6n,
    });
    expectSettleable(input, result);
  });

  it("nets parallel invoices between the same pair", () => {
    const funded = { obligations: [owes(1, A, B, 5n), owes(2, A, B, 7n), owes(3, B, A, 9n)], liquidity: { [A]: 3n } };
    expect(solve(funded)).toMatchObject({ gross: 21n, cash: 3n, uncleared: 0n, nets: { [A]: -3n, [B]: 3n } });

    const unfunded = { ...funded, liquidity: {} };
    const result = solve(unfunded);
    expect(result).toMatchObject({ gross: 18n, cash: 0n, uncleared: 3n });
    const clearedAB = result.clears.filter((c) => c.id !== 3n).reduce((sum, c) => sum + c.amount, 0n);
    expect(clearedAB).toBe(9n);
    expectSettleable(unfunded, result);
  });

  it("moves the least cash among solutions that clear the same maximum gross", () => {
    // P (deposit 10) owes Q 10 and R 10; R (deposit 10) owes S 10. Gross 20 is the maximum, reached by any split
    // with P paying 10 in total and R paying S. Paying R lets R pass the money on to S (cash 10); paying Q makes R
    // draw on its own deposit for S (cash 20). Every assignment of addresses to the roles is tried, so the answer
    // cannot come from a lucky tie-break.
    for (const [P, Q, R, S] of permutations([A, B, C, D])) {
      const input = {
        obligations: [owes(1, P, Q, 10n), owes(2, P, R, 10n), owes(3, R, S, 10n)],
        liquidity: { [P]: 10n, [R]: 10n },
      };
      const result = solve(input);
      expect(result.clears).toEqual([
        { id: 2n, amount: 10n },
        { id: 3n, amount: 10n },
      ]);
      expect(result).toMatchObject({ gross: 20n, cash: 10n, nets: { [P]: -10n, [R]: 0n, [S]: 10n } });
      expectSettleable(input, result);

      const costlier = checkSolution(input, [
        { id: 1n, amount: 10n },
        { id: 3n, amount: 10n },
      ]);
      expect(costlier).toMatchObject({ ok: true, gross: 20n, cash: 20n });
    }
  });

  it("returns an empty solution when nothing can clear", () => {
    const input = { obligations: [owes(1, A, B, 10n)], liquidity: { [A]: 0n } };
    expect(solve(input)).toEqual({
      clears: [],
      gross: 0n,
      cash: 0n,
      nets: {},
      totalOutstanding: 10n,
      uncleared: 10n,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// solve(): input handling
// ---------------------------------------------------------------------------------------------------------------

describe("solve input handling", () => {
  const empty = { clears: [], gross: 0n, cash: 0n, nets: {}, totalOutstanding: 0n, uncleared: 0n };

  it("returns an empty solution for empty input", () => {
    expect(solve({ obligations: [], liquidity: {} })).toEqual(empty);
  });

  it("returns an empty solution when every member is blocked", () => {
    const input = {
      obligations: [owes(1, A, B, 10n), owes(2, B, A, 10n)],
      liquidity: { [A]: 50n, [B]: 50n },
      blocked: new Set([A, B]),
    };
    expect(solve(input)).toEqual(empty);
  });

  it("is exact for amounts at the uint96 limit", () => {
    const max = 2n ** 96n - 1n;
    const input = {
      obligations: [owes(1, A, B, max), owes(2, B, C, max), owes(3, C, A, max), owes(4, D, E, max)],
      liquidity: { [D]: 2n ** 95n },
    };
    const result = solve(input);
    expect(result.clears).toEqual([
      { id: 1n, amount: max },
      { id: 2n, amount: max },
      { id: 3n, amount: max },
      { id: 4n, amount: 2n ** 95n },
    ]);
    expect(result).toMatchObject({ gross: 3n * max + 2n ** 95n, cash: 2n ** 95n, uncleared: max - 2n ** 95n });
    expectSettleable(input, result);
  });

  it("treats addresses case-insensitively and reports them in lowercase", () => {
    const input = {
      obligations: [owes(1, mixedCase(A), B, 10n), owes(2, B, mixedCase(C), 10n)],
      liquidity: { [mixedCase(A)]: 10n },
      blocked: [mixedCase(D)],
    };
    expect(solve(input).nets).toEqual({ [A]: -10n, [B]: 0n, [C]: 10n });
  });

  it("rejects obligations the contract could never hold", () => {
    expect(() => solve({ obligations: [owes(1, A, B, 1n), owes(1, B, C, 1n)], liquidity: {} })).toThrow(
      "Obligation 1 appears more than once",
    );
    expect(() => solve({ obligations: [owes(2, A, mixedCase(A), 1n)], liquidity: {} })).toThrow(
      "Obligation 2 has the same debtor and creditor",
    );
    expect(() => solve({ obligations: [owes(3, A, B, 0n)], liquidity: {} })).toThrow(
      "Obligation 3 has a non-positive amount (0)",
    );
  });

  it("computes the cash needed without netting", () => {
    expect(grossSettlementCash([owes(1, A, B, 10n), owes(2, B, A, 15n)])).toBe(25n);
    expect(grossSettlementCash([])).toBe(0n);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// checkSolution(): the rules of ClearingHouse.settle()
// ---------------------------------------------------------------------------------------------------------------

describe("checkSolution mirrors settle()", () => {
  const input: SolveInput = {
    obligations: [owes(1, A, B, 10n), owes(2, B, C, 10n), owes(4, C, A, 5n), owes(5, D, A, 2n)],
    liquidity: { [A]: 3n, [D]: 100n },
    blocked: [D],
  };
  const errorsFor = (clears: Clear[]) => checkSolution(input, clears).errors;

  it("accepts a valid solution and reports nets in the order settle() touches members", () => {
    const check = checkSolution(input, [
      { id: 1n, amount: 8n },
      { id: 2n, amount: 5n },
      { id: 4n, amount: 5n },
    ]);
    expect(check).toEqual({ ok: true, errors: [], gross: 18n, cash: 3n, nets: { [B]: 3n, [A]: -3n, [C]: 0n } });
    expect(Object.keys(check.nets)).toEqual([B, A, C]);
  });

  it("rejects an empty solution", () => {
    expect(errorsFor([])).toEqual(["EmptySolution: there is nothing to clear"]);
  });

  it("rejects more clears than one settle() accepts", () => {
    const many: SolveInput = {
      obligations: seeds(1, MAX_BATCH + 1).map((id) => owes(id, A, B, 1n)),
      liquidity: { [A]: 1000n },
    };
    const clearAll = (count: number) => seeds(1, count).map((id) => ({ id: BigInt(id), amount: 1n }));
    expect(checkSolution(many, clearAll(MAX_BATCH)).ok).toBe(true);
    expect(checkSolution(many, clearAll(MAX_BATCH + 1)).errors).toEqual([
      "BatchTooLarge: 257 clears, settle() accepts at most 256",
    ]);
  });

  it("requires strictly ascending ids, starting above 0", () => {
    expect(
      errorsFor([
        { id: 2n, amount: 1n },
        { id: 1n, amount: 1n },
      ]),
    ).toEqual(["IdsNotAscending: id 1 at index 1 must be greater than 2"]);
    expect(
      errorsFor([
        { id: 1n, amount: 1n },
        { id: 1n, amount: 1n },
      ]),
    ).toEqual(["IdsNotAscending: id 1 at index 1 must be greater than 1"]);
    expect(errorsFor([{ id: 0n, amount: 1n }])).toEqual([
      "IdsNotAscending: id 0 at index 0 must be greater than 0",
      "NotEligible: id 0 is not an eligible obligation",
    ]);
  });

  it("requires every id to be an eligible obligation", () => {
    expect(errorsFor([{ id: 3n, amount: 1n }])).toEqual(["NotEligible: id 3 is not an eligible obligation"]);
  });

  it("requires 0 < amount <= outstanding", () => {
    expect(errorsFor([{ id: 1n, amount: 0n }])).toEqual(["ClearExceedsOutstanding: id 1 clears 0, allowed 1 to 10"]);
    expect(errorsFor([{ id: 4n, amount: -1n }])).toEqual([
      "ClearExceedsOutstanding: id 4 clears -1, allowed 1 to 5",
    ]);
  });

  it("requires each net payment to be covered by the payer's deposit", () => {
    expect(errorsFor([{ id: 1n, amount: 4n }])).toEqual([`InsufficientLiquidity: ${A} pays 4 net but has 3`]);
    expect(errorsFor([{ id: 2n, amount: 1n }])).toEqual([`InsufficientLiquidity: ${B} pays 1 net but has 0`]);
  });

  it("rejects any touched member that is blocked, even one that only receives", () => {
    expect(errorsFor([{ id: 5n, amount: 2n }])).toEqual([`MemberBlocked: ${D}`]);
    const receiverBlocked = { ...input, blocked: [B] };
    expect(checkSolution(receiverBlocked, [{ id: 1n, amount: 3n }]).errors).toEqual([`MemberBlocked: ${B}`]);
  });

  it("lists clear errors before member errors, so the first is the one settle() reverts with", () => {
    expect(errorsFor([{ id: 1n, amount: 11n }])).toEqual([
      "ClearExceedsOutstanding: id 1 clears 11, allowed 1 to 10",
      `InsufficientLiquidity: ${A} pays 11 net but has 3`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adapters from chain state
// ---------------------------------------------------------------------------------------------------------------

describe("eligibleObligations and solverInputFromState", () => {
  const USDC: Hex = "0x3600000000000000000000000000000000000000";
  const EURC: Hex = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
  const now = 150n;

  function invoice(id: number, fields: Partial<Invoice> = {}): Invoice {
    return {
      id: BigInt(id),
      creditor: mixedCase(B),
      debtor: mixedCase(A),
      token: EURC,
      amount: 10n,
      outstanding: 10n,
      dueDate: 100n,
      status: InvoiceStatus.Open,
      ref: `0x${"0".repeat(64)}`,
      issuedAt: 50n,
      memo: "",
      ...fields,
    };
  }

  // Listed out of order on purpose; only 1 and 7 are eligible at `now`.
  const invoices = [
    invoice(7, { dueDate: now, debtor: C, creditor: A }),
    invoice(1, { outstanding: 7n }),
    invoice(2, { status: InvoiceStatus.Pending }),
    invoice(3, { token: USDC }),
    invoice(4, { dueDate: now + 50n }),
    invoice(5, { status: InvoiceStatus.Paid, outstanding: 0n }),
    invoice(6, { status: InvoiceStatus.Rejected }),
    invoice(8, { status: InvoiceStatus.Cancelled }),
    invoice(9, { outstanding: 0n }),
  ];

  it("keeps Open, matured invoices of the token with something outstanding, by ascending id", () => {
    expect(eligibleObligations(invoices, EURC.toLowerCase(), now)).toEqual([
      { id: 1n, debtor: A, creditor: B, amount: 7n },
      { id: 7n, debtor: C, creditor: A, amount: 10n },
    ]);
    expect(eligibleObligations(invoices, EURC, now + 50n).map((o) => o.id)).toEqual([1n, 4n, 7n]);
    expect(eligibleObligations(invoices, USDC, now).map((o) => o.id)).toEqual([3n]);
  });

  // Every member here lets any solver draw on its deposit; core/consent.test.ts covers members that do not.
  function member(address: Hex, eurcBalance: bigint, eurcBlocked: boolean): Member {
    return {
      address,
      name: "",
      registered: true,
      balances: { [USDC]: 999n, [EURC.toLowerCase()]: eurcBalance },
      blocked: { [USDC]: false, [EURC.toLowerCase()]: eurcBlocked },
      allowsAnySolver: true,
      drawableBySubmitter: true,
    };
  }

  const state: ChainState = {
    network: "local",
    clearingHouse: address(0x99),
    blockNumber: 7n,
    timestamp: now,
    tokens: [USDC, EURC],
    members: {
      [A]: member(mixedCase(A), 40n, false),
      [B]: member(mixedCase(B), 0n, false),
      [C]: member(C, 5n, true),
    },
    invoices,
    cycles: [],
    totals: [],
    submitter: null,
  };

  it("builds the solver input for a token from members' deposits and blocklist flags", () => {
    expect(solverInputFromState(state, EURC)).toEqual({
      obligations: eligibleObligations(invoices, EURC, now),
      liquidity: { [A]: 40n, [B]: 0n, [C]: 5n },
      blocked: [C],
    });
    expect(solverInputFromState(state, USDC)).toEqual({
      obligations: [{ id: 3n, debtor: A, creditor: B, amount: 10n }],
      liquidity: { [A]: 999n, [B]: 999n, [C]: 999n },
      blocked: [],
    });
  });

  it("uses the state's block time unless given another clock", () => {
    expect(solverInputFromState(state, EURC, now + 50n).obligations.map((o) => o.id)).toEqual([1n, 4n, 7n]);
  });

  it("feeds solve() directly", () => {
    // C is blocked on EURC, so invoice 7 drops out and A pays invoice 1 (7) from its deposit of 40.
    const result = solve(solverInputFromState(state, EURC));
    expect(result).toMatchObject({ clears: [{ id: 1n, amount: 7n }], gross: 7n, cash: 7n, totalOutstanding: 7n });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Properties over seeded random networks
// ---------------------------------------------------------------------------------------------------------------

describe("solve on seeded random networks", () => {
  const smallUnits: NetworkShape = { members: [2, 12], obligations: [0, 30], maxAmount: 50, maxLiquidity: 40, unit: 1n };
  // Whole cents (1 cent = 10_000 units): realistic amounts that stay small integers once divided by the unit.
  const cents: NetworkShape = { members: [2, 10], obligations: [1, 24], maxAmount: 9000, maxLiquidity: 4000, unit: 10_000n };
  const tiny: NetworkShape = { members: [2, 4], obligations: [1, 4], maxAmount: 3, maxLiquidity: 3, unit: 1n };

  it("always returns a solution settle() accepts, with consistent totals", () => {
    for (const seed of seeds(1, 400)) {
      const input = randomNetwork(seed, smallUnits);
      const result = solve(input);
      expectSettleable(input, result);
      expect(result.totalOutstanding).toBe(grossSettlementCash(withoutBlocked(input)));
      expect(result.uncleared).toBe(result.totalOutstanding - result.gross);
    }
  });

  it("clears the LP's maximum gross, then moves the LP's minimum cash at that gross", () => {
    for (const seed of seeds(1001, 300)) {
      const input = randomNetwork(seed, cents);
      const result = solve(input);
      const lp = lpOptimum(input, cents.unit);
      expect(Math.abs(Number(result.gross) - lp.gross), `seed ${seed} gross`).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(result.cash) - lp.cash), `seed ${seed} cash`).toBeLessThanOrEqual(1);
    }
  });

  it("matches brute force over every clear vector of tiny networks", () => {
    for (const seed of seeds(2001, 3000)) {
      const input = randomNetwork(seed, tiny);
      const result = solve(input);
      expect({ gross: result.gross, cash: result.cash }, `seed ${seed}`).toEqual(bruteForceOptimum(input));

      const obligations = withoutBlocked(input);
      const amounts = obligations.map((o) => result.clears.find((c) => c.id === o.id)?.amount ?? 0n);
      expect(cashIfValid(obligations, amounts, input.liquidity), `seed ${seed} validity`).toBe(result.cash);
    }
  });

  it("scales exactly to amounts near 2^96", () => {
    const factor = 2n ** 90n; // 50 * 2^90 < 2^96
    for (const seed of seeds(3001, 100)) {
      const small = randomNetwork(seed, smallUnits);
      const large = randomNetwork(seed, { ...smallUnits, unit: factor });
      const [base, scaled] = [solve(small), solve(large)];
      expect(scaled.gross).toBe(base.gross * factor);
      expect(scaled.cash).toBe(base.cash * factor);
      expectSettleable(large, scaled);
    }
  });

  it("gives the same answer whatever the order and letter case of the input", () => {
    for (const seed of seeds(4001, 100)) {
      const input = randomNetwork(seed, smallUnits);
      const random = prng(seed);
      const shuffled = [...input.obligations];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const recased = shuffled.map((o) => ({ ...o, debtor: mixedCase(o.debtor) }));
      expect(solve({ ...input, obligations: recased })).toEqual(solve(input));
    }
  });
});

describe("solve performance", () => {
  it("solves 300 invoices among 100 members well within a second", () => {
    const shape: NetworkShape = {
      members: [100, 100],
      obligations: [300, 300],
      maxAmount: 9000,
      maxLiquidity: 2000,
      unit: 10_000n,
    };
    for (const seed of [1, 2, 3]) {
      const input = randomNetwork(seed, shape);
      const started = performance.now();
      const result = solve(input);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(1000);
      expect(result.gross).toBeGreaterThan(0n);
      expectSettleable(input, result);
    }
  });

  it("stays fast on a chain built to need one phase per member", () => {
    // Member i owes member i + 1 an amount of i + 1 and nobody has a deposit, so every member is short by 1 at a
    // different distance from the one surplus at the end, and each distance is its own phase. Nothing can clear.
    const members = Array.from({ length: 1000 }, (_, i) => address(i + 1));
    const obligations = members.slice(0, -1).map((m, i) => owes(i + 1, m, members[i + 1], BigInt(i + 1)));
    const started = performance.now();
    const result = solve({ obligations, liquidity: {} });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ gross: 0n, cash: 0n, uncleared: 499_500n });
  });
});

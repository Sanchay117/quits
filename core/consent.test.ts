// Solver consent: settle() may draw cash from a member's deposit only when that member sent the cycle or approved its
// sender (ClearingHouse.setSolver), else it reverts with PayerNotConsenting. solverInputFromState gives every other
// member a liquidity of 0. These tests check that this is exactly the contract's rule (against a mirror of settle()
// that reads raw approvals and deposits, not the Member flags), including the cherry-picking case the rule exists for.
// Amounts are raw 6-decimal token units throughout.
import { describe, expect, it } from "vitest";
import type { Hex } from "./chains.ts";
import { checkSolution, solve, solverInputFromState, type Clear, type SolveInput, type SolveResult } from "./solver.ts";
import { ANY_SOLVER, InvoiceStatus, type ChainState, type Invoice, type Member } from "./state.ts";

// ---------------------------------------------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------------------------------------------

const TOKEN: Hex = "0x3600000000000000000000000000000000000000";
const NOW = 1_000n;

/** A lowercase 20-byte address ending in the hex digits of `n`. */
function address(n: number): Hex {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

const [A, B, C, D, E] = [0xa, 0xb, 0xc, 0xd, 0xe].map(address);
/** The account that sends settle() in most scenarios. */
const S = address(0x5e);
/** A solver some members approve instead of S. */
const X = address(0x77);
/** Sends the cycle when the state was read without a submitter: nobody approved it by name. */
const STRANGER = address(0xdead);

interface Party {
  deposit?: bigint;
  /** Solvers this member approved with setSolver(solver, true); ANY_SOLVER means anyone. */
  approves?: Hex[];
  blocked?: boolean;
}

interface Scenario {
  /** Lowercase address -> deposit, approvals and blocklist flag. Debt counterparties not listed have none. */
  parties: Record<string, Party>;
  /** [debtor, creditor, amount] per invoice; ids 1, 2, ... in this order, all Open and matured. */
  debts: [debtor: Hex, creditor: Hex, amount: bigint][];
  /** The submitter the state was read for (loadState's opts.submitter). */
  submitter: Hex | null;
}

/** The ChainState loadState would return for the scenario, with every member's consent flags. */
function chainState({ parties, debts, submitter }: Scenario): ChainState {
  const everyone = new Set<string>([...Object.keys(parties), ...debts.flatMap(([debtor, creditor]) => [debtor, creditor])]);
  const members: Record<string, Member> = {};
  for (const member of everyone) {
    const party = parties[member] ?? {};
    const approves = party.approves ?? [];
    const allowsAnySolver = approves.includes(ANY_SOLVER);
    members[member] = {
      address: member as Hex,
      name: "",
      registered: true,
      balances: { [TOKEN]: party.deposit ?? 0n },
      blocked: { [TOKEN]: party.blocked ?? false },
      allowsAnySolver,
      drawableBySubmitter:
        allowsAnySolver || (submitter !== null && (member === submitter || approves.includes(submitter))),
    };
  }
  const invoices: Invoice[] = debts.map(([debtor, creditor, amount], i) => ({
    id: BigInt(i + 1),
    creditor,
    debtor,
    token: TOKEN,
    amount,
    outstanding: amount,
    dueDate: NOW,
    status: InvoiceStatus.Open,
    ref: `0x${"0".repeat(64)}`,
    issuedAt: 0n,
    memo: "",
  }));
  return {
    network: "local",
    clearingHouse: address(0x99),
    blockNumber: 1n,
    timestamp: NOW,
    tokens: [TOKEN],
    members,
    invoices,
    cycles: [],
    totals: [],
    submitter,
  };
}

function plan(scenario: Scenario): { input: SolveInput; result: SolveResult } {
  const input = solverInputFromState(chainState(scenario), TOKEN);
  return { input, result: solve(input) };
}

/** Each touched member's net over the clears, in the order settle() first touches them (creditor, then debtor). */
function netsOf(scenario: Scenario, clears: Clear[]): Map<string, bigint> {
  const nets = new Map<string, bigint>();
  for (const { id, amount } of clears) {
    const [debtor, creditor] = scenario.debts[Number(id) - 1];
    nets.set(creditor, (nets.get(creditor) ?? 0n) + amount);
    nets.set(debtor, (nets.get(debtor) ?? 0n) - amount);
  }
  return nets;
}

function cashOf(nets: Map<string, bigint>): bigint {
  return [...nets.values()].reduce((sum, net) => (net < 0n ? sum - net : sum), 0n);
}

/**
 * What ClearingHouse.settle() does when `sender` submits the clears: "ok", or the error it reverts with. Mirrors
 * _clearOne (ascending ids, 0 < amount <= outstanding) and _settleNets (blocklist, then _mayDraw consent, then
 * liquidity, member by member).
 */
function settleOutcome(scenario: Scenario, sender: Hex, clears: Clear[]): string {
  if (clears.length === 0) return "EmptySolution";
  let lastId = 0n;
  for (const { id, amount } of clears) {
    if (id <= lastId) return "IdsNotAscending";
    lastId = id;
    const debt = scenario.debts[Number(id) - 1];
    if (!debt) return `InvoiceNotOpen(${id})`;
    if (amount <= 0n || amount > debt[2]) return `ClearExceedsOutstanding(${id})`;
  }
  for (const [member, net] of netsOf(scenario, clears)) {
    const party = scenario.parties[member] ?? {};
    if (party.blocked) return `MemberBlocked(${member})`;
    if (net >= 0n) continue;
    const approves = party.approves ?? [];
    if (!(member === sender || approves.includes(sender) || approves.includes(ANY_SOLVER))) {
      return `PayerNotConsenting(${member})`;
    }
    if (-net > (party.deposit ?? 0n)) return `InsufficientLiquidity(${member})`;
  }
  return "ok";
}

/** Tries every integer clear vector and keeps the best that settle() accepts: most gross, then least cash. */
function bruteForceOptimum(scenario: Scenario, sender: Hex): { gross: bigint; cash: bigint } {
  const amounts = scenario.debts.map(() => 0n);
  let best = { gross: 0n, cash: 0n }; // clearing nothing is always possible
  const visit = (i: number): void => {
    if (i === scenario.debts.length) {
      const clears = amounts.map((amount, k) => ({ id: BigInt(k + 1), amount })).filter((c) => c.amount > 0n);
      if (clears.length === 0 || settleOutcome(scenario, sender, clears) !== "ok") return;
      const gross = clears.reduce((sum, c) => sum + c.amount, 0n);
      const cash = cashOf(netsOf(scenario, clears));
      if (gross > best.gross || (gross === best.gross && cash < best.cash)) best = { gross, cash };
      return;
    }
    for (let x = 0n; x <= scenario.debts[i][2]; x++) {
      amounts[i] = x;
      visit(i + 1);
    }
  };
  visit(0);
  return best;
}

/** mulberry32: a tiny seeded PRNG, so every random scenario can be rebuilt from its seed. */
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

/**
 * A reproducible tiny network (2 to 4 members, 1 to 4 invoices of 1 to 3 units) with random deposits, approvals
 * (anyone, S, X or nobody), an occasional blocked member, and a submitter that is S, X, one of the members or none.
 * S is itself a member in about half the scenarios.
 */
function randomScenario(seed: number): Scenario {
  const random = prng(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const members = [A, B, C, D].slice(0, int(2, 4));
  if (random() < 0.5) members[members.length - 1] = S;
  const debts = Array.from({ length: int(1, 4) }, (): Scenario["debts"][number] => {
    const debtor = int(0, members.length - 1);
    const creditor = (debtor + int(1, members.length - 1)) % members.length;
    return [members[debtor], members[creditor], BigInt(int(1, 3))];
  });
  const parties: Record<string, Party> = {};
  for (const member of members) {
    const roll = random();
    parties[member] = {
      deposit: random() < 0.6 ? BigInt(int(0, 3)) : 0n,
      approves: roll < 0.25 ? [ANY_SOLVER] : roll < 0.5 ? [S] : roll < 0.65 ? [X] : [],
      blocked: random() < 0.05,
    };
  }
  const roll = random();
  const submitter = roll < 0.3 ? null : roll < 0.6 ? S : roll < 0.75 ? X : members[int(0, members.length - 1)];
  return { parties, debts, submitter };
}

// ---------------------------------------------------------------------------------------------------------------
// solverInputFromState: whose deposits count
// ---------------------------------------------------------------------------------------------------------------

describe("solverInputFromState with solver consent", () => {
  const parties: Record<string, Party> = {
    [S]: { deposit: 50n },
    [A]: { deposit: 40n, approves: [ANY_SOLVER] },
    [B]: { deposit: 30n, approves: [S] },
    [D]: { deposit: 20n, approves: [X] },
    [E]: { deposit: 10n },
  };
  const liquidityFor = (submitter: Hex | null) =>
    solverInputFromState(chainState({ parties, debts: [], submitter }), TOKEN).liquidity;

  it("keeps the deposits of the submitter, of members that approved it and of members that allow anyone", () => {
    expect(liquidityFor(S)).toEqual({ [S]: 50n, [A]: 40n, [B]: 30n, [D]: 0n, [E]: 0n });
  });

  it("counts a deposit only for the solver its member approved", () => {
    expect(liquidityFor(X)).toEqual({ [S]: 0n, [A]: 40n, [B]: 0n, [D]: 20n, [E]: 0n });
  });

  it("without a submitter keeps only the deposits of members that allow anyone", () => {
    expect(liquidityFor(null)).toEqual({ [S]: 0n, [A]: 40n, [B]: 0n, [D]: 0n, [E]: 0n });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Netting with members that have not consented
// ---------------------------------------------------------------------------------------------------------------

describe("netting with solver consent", () => {
  it("clears a loop through members that have not consented in full, with zero cash", () => {
    // A and D hold deposits but neither approved S; the loop needs no cash, so it still clears.
    const scenario: Scenario = {
      parties: { [A]: { deposit: 100n }, [D]: { deposit: 100n, approves: [X] } },
      debts: [
        [A, D, 25n],
        [D, E, 25n],
        [E, A, 25n],
      ],
      submitter: S,
    };
    const { input, result } = plan(scenario);
    expect(input.liquidity).toEqual({ [A]: 0n, [D]: 0n, [E]: 0n });
    expect(result).toEqual({
      clears: [
        { id: 1n, amount: 25n },
        { id: 2n, amount: 25n },
        { id: 3n, amount: 25n },
      ],
      gross: 75n,
      cash: 0n,
      nets: { [A]: 0n, [D]: 0n, [E]: 0n },
      totalOutstanding: 75n,
      uncleared: 0n,
    });
    expect(settleOutcome(scenario, S, result.clears)).toBe("ok");
  });

  it("clears only the cash-free part of an uneven loop until the payer approves the submitter", () => {
    // A owes 30 into a loop that returns 25: the other 5 would come out of A's deposit, which S may not touch.
    const scenario: Scenario = {
      parties: { [A]: { deposit: 100n } },
      debts: [
        [A, D, 30n],
        [D, E, 25n],
        [E, A, 25n],
      ],
      submitter: S,
    };
    const { result } = plan(scenario);
    expect(result).toMatchObject({ gross: 75n, cash: 0n, uncleared: 5n, nets: { [A]: 0n, [D]: 0n, [E]: 0n } });
    expect(settleOutcome(scenario, S, result.clears)).toBe("ok");

    const approved: Scenario = { ...scenario, parties: { [A]: { deposit: 100n, approves: [S] } } };
    const paid = plan(approved).result;
    expect(paid).toMatchObject({ gross: 80n, cash: 5n, uncleared: 0n, nets: { [A]: -5n, [D]: 5n, [E]: 0n } });
    expect(settleOutcome(approved, S, paid.clears)).toBe("ok");
  });

  describe("a chain whose only funded payer has not consented", () => {
    // A owes B and B owes C; only A has a deposit, and C sends the cycle without A's approval.
    const chain: Scenario = {
      parties: { [A]: { deposit: 10n } },
      debts: [
        [A, B, 10n],
        [B, C, 10n],
      ],
      submitter: C,
    };

    it("clears nothing, since every clear would need A's cash", () => {
      expect(plan(chain).result).toEqual({
        clears: [],
        gross: 0n,
        cash: 0n,
        nets: {},
        totalOutstanding: 20n,
        uncleared: 20n,
      });
      expect(
        settleOutcome(chain, C, [
          { id: 1n, amount: 10n },
          { id: 2n, amount: 10n },
        ]),
      ).toBe(`PayerNotConsenting(${A})`);
    });

    it("clears in full once A approves the submitter, approves anyone, or sends the cycle itself", () => {
      const consenting: Scenario[] = [
        { ...chain, parties: { [A]: { deposit: 10n, approves: [C] } } },
        { ...chain, parties: { [A]: { deposit: 10n, approves: [ANY_SOLVER] } } },
        { ...chain, submitter: A },
      ];
      for (const scenario of consenting) {
        const { result } = plan(scenario);
        expect(result).toMatchObject({ gross: 20n, cash: 10n, nets: { [A]: -10n, [B]: 0n, [C]: 10n } });
        expect(settleOutcome(scenario, scenario.submitter!, result.clears)).toBe("ok");
      }
    });

    it("still clears a cash-free loop through A, leaving A's deposit untouched", () => {
      // C also owes A 4: the loop A -> B -> C -> A of 4 needs no cash; the rest of the chain would need A's.
      const withLoop: Scenario = { ...chain, debts: [...chain.debts, [C, A, 4n]] };
      const { result } = plan(withLoop);
      expect(result).toEqual({
        clears: [
          { id: 1n, amount: 4n },
          { id: 2n, amount: 4n },
          { id: 3n, amount: 4n },
        ],
        gross: 12n,
        cash: 0n,
        nets: { [A]: 0n, [B]: 0n, [C]: 0n },
        totalOutstanding: 24n,
        uncleared: 12n,
      });
      expect(settleOutcome(withLoop, C, result.clears)).toBe("ok");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The audit scenario
// ---------------------------------------------------------------------------------------------------------------

describe("the cherry-picking case from the audit", () => {
  // A owes B 100 (invoice 1) and B owes A 100 (invoice 2), so A's position nets to zero. A has 100 deposited and has
  // not approved B. Without solver consent, B could settle invoice 1 alone and turn A's deposit into a cash payment.
  const scenario: Scenario = {
    parties: { [A]: { deposit: 100n } },
    debts: [
      [A, B, 100n],
      [B, A, 100n],
    ],
    submitter: B,
  };

  it("clears both legs with zero cash, never A's leg alone", () => {
    const { input, result } = plan(scenario);
    expect(input.liquidity).toEqual({ [A]: 0n, [B]: 0n });
    expect(result).toEqual({
      clears: [
        { id: 1n, amount: 100n },
        { id: 2n, amount: 100n },
      ],
      gross: 200n,
      cash: 0n,
      nets: { [A]: 0n, [B]: 0n },
      totalOutstanding: 200n,
      uncleared: 0n,
    });
    expect(settleOutcome(scenario, B, result.clears)).toBe("ok");
  });

  it("refuses A's leg alone, whatever the amount, in settle() and in checkSolution", () => {
    const { input } = plan(scenario);
    for (const amount of [1n, 40n, 100n]) {
      const cherryPicked = [{ id: 1n, amount }];
      expect(settleOutcome(scenario, B, cherryPicked)).toBe(`PayerNotConsenting(${A})`);
      expect(checkSolution(input, cherryPicked)).toMatchObject({
        ok: false,
        errors: [`InsufficientLiquidity: ${A} pays ${amount} net but has 0`],
      });
    }
    // The same leg is A's own choice to make: from A, settle() accepts it.
    expect(settleOutcome(scenario, A, [{ id: 1n, amount: 100n }])).toBe("ok");
  });

  it("nets both legs the same way when B has a deposit of its own", () => {
    const fundedB: Scenario = { ...scenario, parties: { [A]: { deposit: 100n }, [B]: { deposit: 100n } } };
    const { result } = plan(fundedB);
    expect(result).toMatchObject({ gross: 200n, cash: 0n, nets: { [A]: 0n, [B]: 0n } });
    expect(settleOutcome(fundedB, B, result.clears)).toBe("ok");
  });

  it("leaves A's remaining debt outstanding instead of drawing on A's deposit when B owes back less", () => {
    const smaller: Scenario = {
      ...scenario,
      debts: [
        [A, B, 100n],
        [B, A, 40n],
      ],
    };
    const { result } = plan(smaller);
    expect(result).toMatchObject({
      clears: [
        { id: 1n, amount: 40n },
        { id: 2n, amount: 40n },
      ],
      gross: 80n,
      cash: 0n,
      uncleared: 60n,
      nets: { [A]: 0n, [B]: 0n },
    });
    expect(settleOutcome(smaller, B, result.clears)).toBe("ok");

    // When A sends the cycle itself, its deposit pays the other 60.
    const fromA: Scenario = { ...smaller, submitter: A };
    const paid = plan(fromA).result;
    expect(paid).toMatchObject({
      clears: [
        { id: 1n, amount: 100n },
        { id: 2n, amount: 40n },
      ],
      gross: 140n,
      cash: 60n,
      nets: { [A]: -60n, [B]: 60n },
    });
    expect(settleOutcome(fromA, A, paid.clears)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Properties over seeded random networks
// ---------------------------------------------------------------------------------------------------------------

describe("solver consent on seeded random networks", () => {
  it("matches brute force judged by a mirror of settle() with the consent rule, and settle() accepts the result", () => {
    let withPayers = 0;
    let withRefusedPayers = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const scenario = randomScenario(seed);
      const sender = scenario.submitter ?? STRANGER;
      const { input, result } = plan(scenario);
      expect({ gross: result.gross, cash: result.cash }, `seed ${seed}`).toEqual(bruteForceOptimum(scenario, sender));
      if (result.clears.length > 0) expect(settleOutcome(scenario, sender, result.clears), `seed ${seed}`).toBe("ok");

      // Every member the result makes pay is one the sender may draw on.
      const state = chainState(scenario);
      for (const [member, net] of Object.entries(result.nets)) {
        if (net < 0n) expect(state.members[member].drawableBySubmitter, `seed ${seed} payer ${member}`).toBe(true);
      }
      if (Object.values(result.nets).some((net) => net < 0n)) withPayers++;
      const refused = Object.entries(input.liquidity).some(
        ([member, liquidity]) => liquidity === 0n && (scenario.parties[member]?.deposit ?? 0n) > 0n,
      );
      if (refused) withRefusedPayers++;
    }
    // The seeds exercise both sides of the rule, not only empty or cash-free networks.
    expect(withPayers).toBeGreaterThan(300);
    expect(withRefusedPayers).toBeGreaterThan(300);
  });
});

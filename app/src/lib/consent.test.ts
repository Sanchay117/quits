import { describe, expect, it } from "vitest";
import { solve, solverInputFromState } from "../../../core/solver.ts";
import { ANY_SOLVER, InvoiceStatus } from "../../../core/state.ts";
import {
  approvalCandidates,
  approvedSolvers,
  depositsLeftOut,
  parseSolverAddress,
  sameAccount,
  SOLVER_ACCESS_LABEL,
  solverAccess,
} from "./consent.ts";
import { addr, chainState, invoice, member, USDC } from "./testState.ts";

const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

describe("sameAccount", () => {
  it("treats two absent accounts as the same and ignores letter case", () => {
    expect(sameAccount(null, null)).toBe(true);
    expect(sameAccount(null, undefined)).toBe(true);
    expect(sameAccount("0xAbCd000000000000000000000000000000000001", "0xabcd000000000000000000000000000000000001")).toBe(
      true,
    );
  });

  it("never matches an absent account with a present one, or two different addresses", () => {
    expect(sameAccount(null, addr(1))).toBe(false);
    expect(sameAccount(addr(1), undefined)).toBe(false);
    expect(sameAccount(addr(1), addr(2))).toBe(false);
  });
});

describe("depositsLeftOut", () => {
  const me = addr(0x5e);
  const approvedMe = member({ address: addr(1), deposit: USD(5), drawableBySubmitter: true });
  const notApproved = member({ address: addr(2), deposit: USD(3) });
  const onlyOwed = member({ address: addr(3), deposit: USD(4) });
  const emptyDeposit = member({ address: addr(4) });
  const blocked = member({ address: addr(5), deposit: USD(2), blocked: true });
  const owesBlocked = member({ address: addr(6), deposit: USD(6) });
  const anyone = member({ address: addr(7), deposit: USD(9), allowsAnySolver: true });
  const notDue = member({ address: addr(8), deposit: USD(1) });
  const members = [approvedMe, notApproved, onlyOwed, emptyDeposit, blocked, owesBlocked, anyone, notDue];
  const invoices = [
    invoice(approvedMe.address, onlyOwed.address, USD(10)),
    invoice(notApproved.address, onlyOwed.address, USD(10)),
    invoice(emptyDeposit.address, onlyOwed.address, USD(10)),
    invoice(blocked.address, onlyOwed.address, USD(10)),
    invoice(owesBlocked.address, blocked.address, USD(10)),
    invoice(anyone.address, onlyOwed.address, USD(10)),
    invoice(notDue.address, onlyOwed.address, USD(10), { dueDate: 5_000n }),
    invoice(notDue.address, onlyOwed.address, USD(10), { status: InvoiceStatus.Pending }),
  ];
  const state = chainState(members, invoices, me);
  const input = solverInputFromState(state, USDC);

  it("counts only unapproved deposits of members that owe on a due invoice between unblocked members", () => {
    expect(depositsLeftOut(state, USDC, input)).toEqual({ count: 1, total: USD(3) });
  });

  it("agrees with the liquidity the solver was given", () => {
    expect(input.liquidity[addr(1)]).toBe(USD(5));
    expect(input.liquidity[addr(2)]).toBe(0n);
    expect(input.liquidity[addr(7)]).toBe(USD(9));
    // The left-out deposit is exactly what keeps that debt open: the solver cannot draw on it.
    const result = solve(input);
    expect(result.nets[addr(2)] ?? 0n).toBe(0n);
  });

  it("reports nothing once every debtor's deposit is drawable", () => {
    const all = chainState(
      members.map((m) => ({ ...m, drawableBySubmitter: true })),
      invoices,
      me,
    );
    expect(depositsLeftOut(all, USDC, solverInputFromState(all, USDC))).toEqual({ count: 0, total: 0n });
  });
});

describe("solverAccess", () => {
  const me = addr(0x5e);

  it("says anyone when the member approved the zero address", () => {
    expect(solverAccess(member({ address: addr(1), allowsAnySolver: true }), me)).toBe("anyone");
    expect(solverAccess(member({ address: addr(1), allowsAnySolver: true }), null)).toBe("anyone");
  });

  it("marks members that approved the connected wallet", () => {
    expect(solverAccess(member({ address: addr(1), drawableBySubmitter: true }), me)).toBe("approved-you");
  });

  it("labels the wallet's own row You, not an approval of itself", () => {
    expect(solverAccess(member({ address: me, drawableBySubmitter: true }), me)).toBe("you");
    expect(solverAccess(member({ address: me.toUpperCase().replace("0X", "0x") as `0x${string}` }), me)).toBe("you");
    expect(SOLVER_ACCESS_LABEL.you).toBe("You");
  });

  it("still says anyone for the wallet's own row when it allows anyone", () => {
    expect(solverAccess(member({ address: me, allowsAnySolver: true }), me)).toBe("anyone");
  });

  it("falls back to approved only", () => {
    expect(solverAccess(member({ address: addr(1) }), me)).toBe("approved-only");
    expect(solverAccess(member({ address: addr(1) }), null)).toBe("approved-only");
  });
});

describe("parseSolverAddress", () => {
  const me = "0x00000000000000000000000000000000000000Ab";

  it("returns the checksummed address", () => {
    expect(parseSolverAddress("  0x70997970c51812dc3a010c7d01b50e0d17dc79c8 ", me)).toBe(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
  });

  it("explains what is wrong otherwise", () => {
    expect(parseSolverAddress("0x1234", me)).toMatch(/40 hex characters/);
    expect(parseSolverAddress("hello", me)).toMatch(/40 hex characters/);
    expect(parseSolverAddress(ANY_SOLVER, me)).toMatch(/switch/);
    expect(parseSolverAddress("0x00000000000000000000000000000000000000AB", me)).toMatch(/your own cycles/);
  });
});

describe("approvalCandidates", () => {
  const x = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const y = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const me = addr(0x5e);
  const members = [member({ address: addr(2), name: "Boxwell" }), member({ address: me }), member({ address: addr(1) })];

  it("covers every member and every account that sent a cycle, without me or the zero address", () => {
    const state = chainState(members, []);
    state.cycles = [
      { ...cycle(0n), solver: x.toLowerCase() as `0x${string}` },
      { ...cycle(1n), solver: ANY_SOLVER },
      { ...cycle(2n), solver: addr(1) },
    ];
    expect(approvalCandidates(state, me)).toEqual([addr(1), addr(2), x]);
  });

  it("adds extra addresses once each, checksummed, and skips anything that is not an address", () => {
    const state = chainState(members, []);
    const extra = [y.toLowerCase(), y, null, undefined, "", "0x1234", "not an address", me.toUpperCase().replace("0X", "0x")];
    expect(approvalCandidates(state, me, extra)).toEqual([addr(1), addr(2), y]);
  });

  it("is sorted by address, so the same state reads the same way every poll", () => {
    const state = chainState([...members].reverse(), []);
    expect(approvalCandidates(state, me, [y, x])).toEqual(approvalCandidates(chainState(members, []), me, [x, y]));
  });

  it("is empty for a network with only me in it", () => {
    expect(approvalCandidates(chainState([member({ address: me })], []), me)).toEqual([]);
  });
});

describe("approvedSolvers", () => {
  it("keeps the candidates whose isSolverFor read true, in order", () => {
    expect(approvedSolvers([addr(1), addr(2), addr(3)], [true, false, true])).toEqual([addr(1), addr(3)]);
    expect(approvedSolvers([], [])).toEqual([]);
  });

  it("refuses results that do not line up with the candidates", () => {
    expect(() => approvedSolvers([addr(1), addr(2)], [true])).toThrow(/one approval flag per candidate/i);
  });
});

function cycle(id: bigint) {
  return {
    id,
    token: USDC,
    invoiceCount: 1,
    memberCount: 2,
    solver: ANY_SOLVER,
    timestamp: 0n,
    blockNumber: 1n,
    grossCleared: 1n,
    cashMoved: 0n,
  };
}

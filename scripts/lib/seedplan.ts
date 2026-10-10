// What seeding a demo round still has to do, read from chain state, so seed.ts can resume after an interruption and
// fund.ts can budget each company's gas and deposits. An invoice counts as issued when one with the same creditor and
// reference exists on chain (in any status).
import type { Hex } from "viem";
import type { ArcNetwork } from "../../core/chains.ts";
import { InvoiceStatus, type ChainState, type Invoice } from "../../core/state.ts";
import { fail } from "./args.ts";
import {
  DEMO_COMPANIES,
  DEMO_DEPOSITS,
  DEMO_INVOICES,
  demoRound,
  refToBytes32,
  scaledAmount,
  scaledDeposit,
  type DemoInvoice,
} from "./demo.ts";
import type { Company } from "./keys.ts";
import { GAS, batchGas, issueGas } from "./plan.ts";

export interface SeedInvoice extends DemoInvoice {
  units: bigint;
  refHex: Hex;
  creditorCo: Company;
  debtorCo: Company;
  /** The invoice on chain, when already issued. */
  onChain: Invoice | undefined;
}

export interface CompanyWork {
  company: Company;
  register: boolean;
  /**
   * setSolver(address(0), true) is still needed: the company lets anyone submit cycles that draw on its deposit, so a
   * reviewer can settle the demo network from the app. Without it only cash-free loops through it could clear.
   */
  consent: boolean;
  /** The seed's very first invoice, issued alone through Arc's Memo predeploy (Arc networks only). */
  memoIssue: SeedInvoice | null;
  issue: SeedInvoice[];
  /** USDC to deposit, 6-decimal units. */
  deposit: bigint;
  /** Invoices this company owes in the round that still need accepting (pending, or not issued yet). */
  accept: SeedInvoice[];
}

export interface RoundPlan {
  round: number;
  invoices: SeedInvoice[];
  work: CompanyWork[];
  /** A cycle has already cleared some of this round's invoices: deposits are not topped up again. */
  settled: boolean;
}

/** Map the demo's company names onto the wallets file; every demo company must be there. */
export function demoCompanies(companies: Company[]): Company[] {
  return DEMO_COMPANIES.map((demo) => {
    const company = companies.find((c) => c.name === demo.name);
    if (!company) fail(`The wallets file has no company named "${demo.name}"; the demo network needs all of: ${DEMO_COMPANIES.map((d) => d.name).join(", ")}`);
    return company;
  });
}

function findOnChain(state: ChainState | null, creditor: Hex, ref: Hex): Invoice | undefined {
  if (!state) return undefined;
  const c = creditor.toLowerCase();
  const r = ref.toLowerCase();
  return state.invoices.find((i) => i.creditor.toLowerCase() === c && i.ref.toLowerCase() === r);
}

export interface PlanOptions {
  /** For budgeting before a round starts: assume its full deposit levels instead of topping up current balances. */
  budget?: boolean;
}

export function planRound(
  state: ChainState | null,
  companies: Company[],
  net: ArcNetwork,
  round: number,
  scale: bigint,
  options: PlanOptions = {},
): RoundPlan {
  const ordered = demoCompanies(companies);
  const byName = new Map(ordered.map((c) => [c.name, c]));
  const invoices: SeedInvoice[] = demoRound(round).map((d) => {
    const creditorCo = byName.get(d.creditor)!;
    const refHex = refToBytes32(d.ref);
    return {
      ...d,
      units: scaledAmount(d.amount, scale),
      refHex,
      creditorCo,
      debtorCo: byName.get(d.debtor)!,
      onChain: findOnChain(state, creditorCo.address, refHex),
    };
  });
  const settled = invoices.some((i) => i.onChain && i.onChain.outstanding < i.onChain.amount);
  const anyIssued = invoices.some((i) => i.onChain);
  const first = DEMO_INVOICES[0];
  const memoFirst = net.memo !== null && round === first.round ? invoices.find((i) => i.ref === first.ref && !i.onChain) : undefined;
  const usdc = net.usdc.toLowerCase();

  const work = ordered.map((company): CompanyWork => {
    const member = state?.members[company.address.toLowerCase()];
    const target = DEMO_DEPOSITS[round]?.[company.name];
    const balance = member?.balances[usdc] ?? 0n;
    let deposit = 0n;
    if (target !== undefined && !settled) {
      const level = scaledDeposit(target, scale);
      deposit = options.budget && !anyIssued ? level : level > balance ? level - balance : 0n;
    }
    const memoIssue = memoFirst && memoFirst.creditorCo === company ? memoFirst : null;
    return {
      company,
      register: !member?.registered,
      consent: !member?.allowsAnySolver,
      memoIssue,
      issue: invoices.filter((i) => i.creditorCo === company && !i.onChain && i !== memoIssue),
      deposit,
      accept: invoices.filter(
        (i) => i.debtorCo === company && (!i.onChain || i.onChain.status === InvoiceStatus.Pending),
      ),
    };
  });
  return { round, invoices, work, settled };
}

export interface WorkCost {
  txs: number;
  gas: bigint;
  /** The largest single transaction, which the wallet must cover up front at the fee cap. */
  largest: bigint;
}

/** Transactions and estimated gas for one company's share of a round. */
export function workCost(net: ArcNetwork, w: CompanyWork): WorkCost {
  const batched = net.multicall3From !== null;
  const txGas: bigint[] = [];
  if (w.memoIssue) txGas.push(issueGas(w.memoIssue.memo) + GAS.memoOverhead);
  const issueCalls = [
    ...(w.register ? [GAS.register] : []),
    ...(w.consent ? [GAS.setSolver] : []),
    ...w.issue.map((i) => issueGas(i.memo)),
  ];
  if (batched) {
    if (issueCalls.length) txGas.push(batchGas(issueCalls));
  } else txGas.push(...issueCalls);
  if (w.deposit > 0n) txGas.push(GAS.deposit);
  const acceptCalls = w.accept.map(() => GAS.acceptInvoice);
  if (batched) {
    if (acceptCalls.length) txGas.push(batchGas(acceptCalls));
  } else txGas.push(...acceptCalls);
  return {
    txs: txGas.length,
    gas: txGas.reduce((a, b) => a + b, 0n),
    largest: txGas.reduce((a, b) => (b > a ? b : a), 0n),
  };
}

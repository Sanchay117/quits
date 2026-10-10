// The member's clearing history (cycles it took part in) and CSV exports of invoices and history.
import type { Hex } from "viem";
import { lc, type ChainState, type Invoice } from "../../../../core/state.ts";
import { Empty, Spinner } from "../../components/common.tsx";
import { clearingCsv, downloadCsv, invoicesCsv, type ClearingEntry, type CsvContext } from "../../lib/csv.ts";
import { useCycleDetails, type DetailEntry } from "../../lib/cycles.ts";
import { formatDateTime } from "../../lib/format.ts";
import { nameResolver } from "../../lib/live.ts";
import { formatMoney } from "../../lib/money.ts";
import { activeNetwork } from "../../lib/network.ts";
import { symbolOf } from "../../lib/tokens.ts";

/** Cycles in which `me` had a net position, newest first. */
function myEntries(state: ChainState, details: Record<string, DetailEntry>, me: string): ClearingEntry[] {
  const entries: ClearingEntry[] = [];
  for (const cycle of state.cycles) {
    const entry = details[cycle.id.toString()];
    if (entry?.status !== "ready") continue;
    if (!entry.detail.nets.some((n) => lc(n.member) === me)) continue;
    entries.push({
      cycleId: cycle.id,
      timestamp: cycle.timestamp,
      token: cycle.token,
      transactionHash: entry.detail.transactionHash,
      detail: entry.detail,
    });
  }
  return entries.reverse();
}

/** How many of the cycle's clears were on invoices where `me` is creditor or debtor. */
function myClearCount(entry: ClearingEntry, invoices: Map<bigint, Invoice>, me: string): number {
  return entry.detail.clears.filter((clear) => {
    const invoice = invoices.get(clear.id);
    return invoice !== undefined && (lc(invoice.creditor) === me || lc(invoice.debtor) === me);
  }).length;
}

export function History({ state, me }: { state: ChainState; me: Hex }) {
  const details = useCycleDetails(state.cycles);
  const loading = state.cycles.some((c) => (details[c.id.toString()]?.status ?? "loading") === "loading");
  const entries = myEntries(state, details, lc(me));
  const invoices = new Map(state.invoices.map((inv) => [inv.id, inv]));
  const context: CsvContext = { me, nameOf: nameResolver(state), symbolOf: (token) => symbolOf(activeNetwork, token) };
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <section className="card">
      <div className="subsection-head">
        <h2>Clearing history</h2>
        <div className="button-row">
          <button
            type="button"
            className="button button--small button--ghost"
            onClick={() => downloadCsv(`quits-invoices-${stamp}.csv`, invoicesCsv(state.invoices, context))}
          >
            Invoices CSV
          </button>
          <button
            type="button"
            className="button button--small button--ghost"
            disabled={loading}
            onClick={() => downloadCsv(`quits-clearing-${stamp}.csv`, clearingCsv(entries, state.invoices, context))}
          >
            Clearing CSV
          </button>
        </div>
      </div>
      {loading && entries.length === 0 ? (
        <Spinner label="Reading settled cycles…" />
      ) : entries.length === 0 ? (
        <Empty>You have not been part of a settled cycle yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Settled</th>
                <th className="num">Invoices of yours</th>
                <th className="num">Your net</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const symbol = symbolOf(activeNetwork, entry.token);
                const net = entry.detail.nets.find((n) => lc(n.member) === lc(me))?.net ?? 0n;
                return (
                  <tr key={entry.cycleId.toString()}>
                    <td>
                      <a href={`#/cycles/${entry.cycleId}`}>#{entry.cycleId.toString()}</a>
                    </td>
                    <td>{formatDateTime(entry.timestamp)}</td>
                    <td className="num">{myClearCount(entry, invoices, lc(me))}</td>
                    <td className="num">{formatMoney(net, symbol, { sign: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

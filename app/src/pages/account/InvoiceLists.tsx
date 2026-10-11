// The member's invoices: an inbox to accept or reject, sent ones to cancel, and open receivables and payables.
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { InvoiceStatus, lc, type ChainState, type Invoice } from "../../../../core/state.ts";
import { Empty, Party } from "../../components/common.tsx";
import { TxStatus } from "../../components/TxStatus.tsx";
import { acceptShown, invoiceAction } from "../../lib/actions.ts";
import { formatDate, refToText } from "../../lib/format.ts";
import { arrivedSince, idList, skippedText, totalsText } from "../../lib/inbox.ts";
import { formatMoney } from "../../lib/money.ts";
import { activeNetwork } from "../../lib/network.ts";
import { symbolOf } from "../../lib/tokens.ts";
import { useTx, type TxHandle } from "../../lib/useTx.ts";

function dueText(invoice: Invoice, now: bigint): string {
  if (invoice.dueDate === 0n) return "Immediately";
  const date = formatDate(invoice.dueDate);
  return invoice.dueDate > now ? `${date}, not yet` : date;
}

function money(invoice: Invoice, field: "amount" | "outstanding" = "amount"): string {
  return formatMoney(invoice[field], symbolOf(activeNetwork, invoice.token));
}

interface InvoiceTableProps {
  invoices: Invoice[];
  state: ChainState;
  counterparty: "creditor" | "debtor";
  showOutstanding?: boolean;
  actions?: (invoice: Invoice) => ReactNode;
}

function InvoiceTable({ invoices, state, counterparty, showOutstanding, actions }: InvoiceTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>{counterparty === "creditor" ? "From" : "To"}</th>
            <th className="num">{showOutstanding ? "Outstanding" : "Amount"}</th>
            <th>Due</th>
            <th>Memo</th>
            {actions && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const other = inv[counterparty];
            const ref = refToText(inv.ref);
            return (
              <tr key={inv.id.toString()}>
                <td className="mono">{inv.id.toString()}</td>
                <td>
                  <Party address={other} name={state.members[lc(other)]?.name} />
                </td>
                <td className="num">
                  {money(inv, showOutstanding ? "outstanding" : "amount")}
                  {showOutstanding && inv.outstanding < inv.amount && <small className="muted"> of {money(inv)}</small>}
                </td>
                <td>{dueText(inv, state.timestamp)}</td>
                <td className="memo-cell">
                  {ref && <span className="ref">{ref}</span>} {inv.memo}
                </td>
                {actions && <td className="actions-cell">{actions(inv)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface AcceptAllConfirmProps {
  /** The invoices on screen when the member clicked Accept all: exactly these, and no others, may be accepted. */
  shown: Invoice[];
  /** The inbox as it is now, to point out invoices that arrived after the click. */
  inbox: Invoice[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AcceptAllConfirm({ shown, inbox, busy, onConfirm, onCancel }: AcceptAllConfirmProps) {
  const arrived = arrivedSince(shown, inbox);
  const totals = totalsText(shown, (token) => symbolOf(activeNetwork, token));
  return (
    <div className="confirm" role="group" aria-label="Confirm accepting all">
      <p>
        Accept {shown.length} invoices, {idList(shown.map((inv) => inv.id))}, for {totals}? Each becomes a debt that
        netting can clear once it is due. Each is checked again on chain just before you sign, and any that changed is
        left out.
      </p>
      {arrived.length > 0 && (
        <p className="small muted">
          Not included: {idList(arrived)}, which arrived after you clicked Accept all. Review {arrived.length === 1 ? "it" : "them"}{" "}
          in the list.
        </p>
      )}
      <div className="button-row">
        <button type="button" className="button button--small" disabled={busy} onClick={onConfirm}>
          Accept these {shown.length}
        </button>
        <button type="button" className="button button--small button--ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

function Inbox({ state, invoices, tx }: { state: ChainState; invoices: Invoice[]; tx: TxHandle }) {
  // A snapshot taken on click: later polls can change the inbox, but never what this confirmation accepts.
  const [confirming, setConfirming] = useState<Invoice[] | null>(null);
  const act = (action: "acceptInvoice" | "rejectInvoice", inv: Invoice) =>
    tx.run(`${action === "acceptInvoice" ? "Accept" : "Reject"} invoice #${inv.id}`, async (ctx, report) => {
      await invoiceAction(ctx, action, inv.id, report);
    });
  const acceptConfirmed = (shown: Invoice[]) =>
    tx.run(`Accept ${shown.length} invoices`, async (ctx, report) => {
      const { ids, skipped } = await acceptShown(ctx, shown, report);
      setConfirming(null);
      const how = activeNetwork.multicall3From && ids.length > 1 ? " in one transaction" : "";
      const accepted = `Accepted ${ids.length === 1 ? "1 invoice" : `${ids.length} invoices`}${how}.`;
      return skipped.length > 0 ? `${accepted} ${skippedText(skipped)}` : accepted;
    });

  return (
    <div className="subsection">
      <div className="subsection-head">
        <h3>Waiting for you</h3>
        {invoices.length > 1 && !confirming && (
          <button type="button" className="button button--small" disabled={tx.disabled} onClick={() => setConfirming(invoices)}>
            Accept all {invoices.length}
          </button>
        )}
      </div>
      {confirming && (
        <AcceptAllConfirm
          shown={confirming}
          inbox={invoices}
          busy={tx.disabled}
          onConfirm={() => void acceptConfirmed(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {invoices.length === 0 ? (
        <Empty>No invoices waiting for you.</Empty>
      ) : (
        <InvoiceTable
          invoices={invoices}
          state={state}
          counterparty="creditor"
          actions={(inv) => (
            <div className="button-row">
              <button type="button" className="button button--small" disabled={tx.disabled} onClick={() => void act("acceptInvoice", inv)}>
                Accept
              </button>
              <button type="button" className="button button--small button--ghost" disabled={tx.disabled} onClick={() => void act("rejectInvoice", inv)}>
                Reject
              </button>
            </div>
          )}
        />
      )}
      {invoices.length > 1 && activeNetwork.multicall3From && (
        <p className="small muted">Accept all is one transaction through Arc's Multicall3From predeploy.</p>
      )}
    </div>
  );
}

export function InvoiceLists({ state, me }: { state: ChainState; me: Hex }) {
  const tx = useTx();
  const mine = (inv: Invoice, side: "creditor" | "debtor") => lc(inv[side]) === lc(me);
  const pending = (inv: Invoice) => inv.status === InvoiceStatus.Pending;
  const open = (inv: Invoice) => inv.status === InvoiceStatus.Open && inv.outstanding > 0n;

  const inbox = state.invoices.filter((inv) => mine(inv, "debtor") && pending(inv));
  const sent = state.invoices.filter((inv) => mine(inv, "creditor") && pending(inv));
  const receivables = state.invoices.filter((inv) => mine(inv, "creditor") && open(inv));
  const payables = state.invoices.filter((inv) => mine(inv, "debtor") && open(inv));

  const cancel = (inv: Invoice) =>
    tx.run(`Cancel invoice #${inv.id}`, async (ctx, report) => {
      await invoiceAction(ctx, "cancelInvoice", inv.id, report);
    });

  return (
    <section className="card">
      <h2>Invoices</h2>
      <TxStatus progress={tx.progress} />
      <Inbox state={state} invoices={inbox} tx={tx} />
      <div className="subsection">
        <h3>Receivables</h3>
        {receivables.length === 0 ? (
          <Empty>Nobody owes you on an accepted invoice.</Empty>
        ) : (
          <InvoiceTable invoices={receivables} state={state} counterparty="debtor" showOutstanding />
        )}
      </div>
      <div className="subsection">
        <h3>Payables</h3>
        {payables.length === 0 ? (
          <Empty>You owe nothing on accepted invoices.</Empty>
        ) : (
          <InvoiceTable invoices={payables} state={state} counterparty="creditor" showOutstanding />
        )}
      </div>
      {sent.length > 0 && (
        <div className="subsection">
          <h3>Sent, awaiting acceptance</h3>
          <InvoiceTable
            invoices={sent}
            state={state}
            counterparty="debtor"
            actions={(inv) => (
              <button type="button" className="button button--small button--ghost" disabled={tx.disabled} onClick={() => void cancel(inv)}>
                Cancel
              </button>
            )}
          />
        </div>
      )}
    </section>
  );
}

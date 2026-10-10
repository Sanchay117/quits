// Issue an invoice. On Arc it goes through the Memo predeploy, so the reference is indexed on chain as well.
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, type Hex } from "viem";
import { lc, type ChainState } from "../../../../core/state.ts";
import { TxStatus } from "../../components/TxStatus.tsx";
import { issueInvoice, type NewInvoice } from "../../lib/actions.ts";
import { displayName, textToRef, utf8Length } from "../../lib/format.ts";
import { parseAmount, type TokenSymbol } from "../../lib/money.ts";
import { activeNetwork } from "../../lib/network.ts";
import { tokensOf } from "../../lib/tokens.ts";
import { useTx } from "../../lib/useTx.ts";

const MAX_MEMO_BYTES = 140;
const MAX_UINT96 = 2n ** 96n - 1n;

interface Draft {
  debtor: string;
  symbol: TokenSymbol;
  amount: string;
  due: string;
  reference: string;
  memo: string;
}

const EMPTY: Draft = { debtor: "", symbol: "USDC", amount: "", due: "", reference: "", memo: "" };

/** Local midnight of a yyyy-mm-dd date input as unix seconds; an empty date means "due immediately" (0). */
function dueDateSeconds(value: string): bigint {
  if (!value) return 0n;
  return BigInt(Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000));
}

/** The invoice to send, or the first problem with the draft. */
function validate(draft: Draft, me: Hex): NewInvoice | string {
  const debtor = draft.debtor.trim();
  if (!isAddress(debtor)) return "Enter the debtor's address or pick a member.";
  if (lc(debtor) === lc(me)) return "You cannot invoice yourself.";
  const amount = parseAmount(draft.amount);
  if (amount === null || amount === 0n) return "Enter an amount above zero, up to 6 decimals.";
  if (amount > MAX_UINT96) return "That amount is too large.";
  const ref = textToRef(draft.reference);
  if (ref === null) return "The reference must fit in 32 bytes.";
  if (utf8Length(draft.memo) > MAX_MEMO_BYTES) return `The memo must be at most ${MAX_MEMO_BYTES} bytes.`;
  const token = tokensOf(activeNetwork).find((t) => t.symbol === draft.symbol);
  if (!token) return "Pick a token.";
  return {
    debtor: getAddress(debtor),
    token: token.address,
    amount,
    dueDate: dueDateSeconds(draft.due),
    ref,
    memo: draft.memo,
  };
}

export function IssueInvoice({ state, me }: { state: ChainState; me: Hex }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const tx = useTx();
  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));
  const checked = validate(draft, me);
  const counterparties = Object.values(state.members).filter((m) => lc(m.address) !== lc(me));
  const debtorName = isAddress(draft.debtor.trim()) ? state.members[lc(draft.debtor.trim())]?.name : undefined;
  const touched = draft.debtor !== "" || draft.amount !== "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typeof checked === "string") return;
    void tx.run("Issue invoice", async (ctx, report) => {
      const id = await issueInvoice(ctx, checked, report);
      setDraft(EMPTY);
      return id === null ? "Invoice issued." : `Invoice #${id} issued. The debtor can now accept it.`;
    });
  };

  return (
    <section className="card">
      <h2>Issue an invoice</h2>
      <p className="muted small">
        {activeNetwork.memo
          ? "Sent through Arc's Memo predeploy: your reference is indexed in a Memo event next to the invoice."
          : "Sent directly to the clearing house (this network has no Memo predeploy)."}
      </p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field field--wide">
          <span>Debtor</span>
          <input
            list="member-options"
            value={draft.debtor}
            onChange={set("debtor")}
            placeholder="0x… or pick a member"
            spellCheck={false}
            autoComplete="off"
          />
          <datalist id="member-options">
            {counterparties.map((m) => (
              <option key={m.address} value={m.address}>
                {displayName(m.address, m.name)}
              </option>
            ))}
          </datalist>
          {debtorName && <small>{debtorName}</small>}
        </label>
        <label className="field">
          <span>Token</span>
          <select value={draft.symbol} onChange={set("symbol")}>
            {tokensOf(activeNetwork).map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Amount</span>
          <input inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={set("amount")} />
        </label>
        <label className="field">
          <span>Due date</span>
          <input type="date" value={draft.due} onChange={set("due")} />
          <small>Empty: due immediately.</small>
        </label>
        <label className="field">
          <span>Reference</span>
          <input placeholder="INV-2041" value={draft.reference} onChange={set("reference")} maxLength={64} />
          <small>Up to 32 bytes, stored as bytes32.</small>
        </label>
        <label className="field field--wide">
          <span>Memo</span>
          <input placeholder="What it is for" value={draft.memo} onChange={set("memo")} />
          <small className={utf8Length(draft.memo) > MAX_MEMO_BYTES ? "field-error" : undefined}>
            {utf8Length(draft.memo)}/{MAX_MEMO_BYTES} bytes, public and stored on chain.
          </small>
        </label>
        <div className="form-actions field--wide">
          <button type="submit" className="button" disabled={typeof checked === "string" || tx.busy}>
            Issue invoice
          </button>
          {touched && typeof checked === "string" && <span className="field-error">{checked}</span>}
        </div>
      </form>
      <TxStatus progress={tx.progress} />
    </section>
  );
}

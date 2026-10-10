// The member's public name: register() adds the address to the member list and sets its display name.
import { useState, type FormEvent } from "react";
import type { Hex } from "viem";
import { explorerAddress } from "../../../../core/chains.ts";
import { lc, type ChainState } from "../../../../core/state.ts";
import { Badge } from "../../components/common.tsx";
import { TxStatus } from "../../components/TxStatus.tsx";
import { register } from "../../lib/actions.ts";
import { utf8Length } from "../../lib/format.ts";
import { activeNetwork } from "../../lib/network.ts";
import { useTx } from "../../lib/useTx.ts";

const MAX_NAME_BYTES = 48;

export function Profile({ state, me }: { state: ChainState; me: Hex }) {
  const member = state.members[lc(me)];
  const registered = member?.registered ?? false;
  const [name, setName] = useState(member?.name ?? "");
  const tx = useTx();
  const bytes = utf8Length(name.trim());
  const valid = bytes > 0 && bytes <= MAX_NAME_BYTES && name.trim() !== member?.name;
  const link = explorerAddress(activeNetwork, me);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void tx.run(registered ? "Rename" : "Register", async (ctx, report) => {
      await register(ctx, name.trim(), report);
      return "Name saved on chain.";
    });
  };

  return (
    <section className="card account-profile">
      <div className="profile-head">
        <div>
          <h2>{member?.name || "Unnamed member"}</h2>
          <p className="mono small">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {me}
              </a>
            ) : (
              me
            )}
          </p>
        </div>
        {registered ? <Badge tone="good">Registered</Badge> : <Badge>Not registered</Badge>}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <label className="field">
          <span>{registered ? "Display name" : "Register a display name"}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ember Roasters"
            maxLength={64}
            autoComplete="organization"
          />
          <small className={bytes > MAX_NAME_BYTES ? "field-error" : undefined}>
            {bytes}/{MAX_NAME_BYTES} bytes. Public, shown to counterparties.
          </small>
        </label>
        <button type="submit" className="button" disabled={!valid || tx.busy}>
          {registered ? "Rename" : "Register"}
        </button>
      </form>
      <TxStatus progress={tx.progress} />
    </section>
  );
}

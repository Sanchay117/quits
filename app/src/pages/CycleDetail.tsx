// One settled cycle: its collapse replayed from the chain's events, and the exact clears and nets.
import { useMemo } from "react";
import { explorerTx } from "../../../core/chains.ts";
import { lc, type ChainState, type Cycle, type CycleDetail } from "../../../core/state.ts";
import { Badge, ExternalLink, Notice, NotDeployed, PageHeader, Party, Spinner, Stat } from "../components/common.tsx";
import { CollapseView } from "../graph/CollapseView.tsx";
import { useChain } from "../lib/chainState.ts";
import { cycleModel, useCycleDetails } from "../lib/cycles.ts";
import { formatDateTime } from "../lib/format.ts";
import { formatMoney, nettedAway } from "../lib/money.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { symbolOf } from "../lib/tokens.ts";

export function CycleDetailPage({ id }: { id: bigint }) {
  const { state, error } = useChain();
  const cycle = state?.cycles.find((c) => c.id === id);
  return (
    <>
      <PageHeader title={`Cycle #${id}`} lead={<a href="#/cycles">All cycles</a>} />
      {!isDeployed ? (
        <NotDeployed what="The cycle view" />
      ) : !state ? (
        error ? <Notice tone="bad">{error}</Notice> : <Spinner label="Loading the cycle…" />
      ) : !cycle ? (
        <Notice>There is no cycle #{id.toString()} on {activeNetwork.label}.</Notice>
      ) : (
        <CycleBody state={state} cycle={cycle} />
      )}
    </>
  );
}

function CycleBody({ state, cycle }: { state: ChainState; cycle: Cycle }) {
  const details = useCycleDetails([cycle], true);
  const entry = details[cycle.id.toString()];
  const symbol = symbolOf(activeNetwork, cycle.token);
  const model = useMemo(
    () => (entry?.status === "ready" ? cycleModel(state, cycle, entry.detail, entry.before) : null),
    [state, cycle, entry],
  );

  return (
    <>
      <div className="stats">
        <Stat label="Cleared" value={formatMoney(cycle.grossCleared, symbol)} note={`${cycle.invoiceCount} invoices`} />
        <Stat label="Cash moved" value={formatMoney(cycle.cashMoved, symbol)} note={`${cycle.memberCount} members`} />
        <Stat label="Netted away" value={nettedAway(cycle.grossCleared, cycle.cashMoved)} />
        <Stat label="Settled" value={formatDateTime(cycle.timestamp)} note={`Block ${cycle.blockNumber}`} />
      </div>
      {entry?.status === "error" && <Notice tone="bad">Could not read the cycle's events: {entry.message}</Notice>}
      <div className="card card--graph">
        {model ? (
          <CollapseView
            model={model}
            playKey={`cycle-${cycle.id}`}
            autoplay
            header={
              <div className="collapse-header">
                <Badge tone="accent">Replay</Badge>
                <span>Rebuilt from the cycle's InvoiceCleared and MemberNetted events.</span>
              </div>
            }
            ariaLabel={`Cycle ${cycle.id}: invoices collapsing into net transfers`}
          />
        ) : (
          <div className="graph-placeholder">Reading the cycle's events…</div>
        )}
      </div>
      {entry?.status === "ready" && <CycleTables state={state} cycle={cycle} detail={entry.detail} />}
    </>
  );
}

function CycleTables({ state, cycle, detail }: { state: ChainState; cycle: Cycle; detail: CycleDetail }) {
  const symbol = symbolOf(activeNetwork, cycle.token);
  const invoices = new Map(state.invoices.map((inv) => [inv.id, inv]));
  const link = detail.transactionHash ? explorerTx(activeNetwork, detail.transactionHash) : null;
  const nameOf = (address: string) => state.members[lc(address)]?.name;

  return (
    <div className="split split--even">
      <section>
        <h2 className="section-title">Invoices cleared</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Debtor</th>
                <th>Creditor</th>
                <th className="num">Cleared</th>
                <th className="num">Left</th>
              </tr>
            </thead>
            <tbody>
              {detail.clears.map((clear) => {
                const inv = invoices.get(clear.id);
                return (
                  <tr key={clear.id.toString()}>
                    <td className="mono">{clear.id.toString()}</td>
                    <td>{inv && <Party address={inv.debtor} name={nameOf(inv.debtor)} />}</td>
                    <td>{inv && <Party address={inv.creditor} name={nameOf(inv.creditor)} />}</td>
                    <td className="num">{formatMoney(clear.amount, symbol)}</td>
                    <td className="num">{formatMoney(clear.remaining, symbol)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2 className="section-title">Net positions</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {detail.nets.map((n) => (
                <tr key={n.member}>
                  <td>
                    <Party address={n.member} name={nameOf(n.member)} />
                  </td>
                  <td className="num">{formatMoney(n.net, symbol, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Positive nets were credited to deposits, negative ones debited. Solver:{" "}
          <Party address={cycle.solver} name={nameOf(cycle.solver)} />.{" "}
          {link && <ExternalLink href={link}>View the transaction</ExternalLink>}
        </p>
      </section>
    </div>
  );
}

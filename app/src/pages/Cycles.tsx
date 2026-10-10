// Cycles: every settled netting cycle, newest first.
import { explorerTx } from "../../../core/chains.ts";
import type { ChainState, Cycle } from "../../../core/state.ts";
import { Empty, Notice, NotDeployed, PageHeader, Party, Spinner } from "../components/common.tsx";
import { useChain } from "../lib/chainState.ts";
import { useCycleDetails, type DetailEntry } from "../lib/cycles.ts";
import { formatDateTime } from "../lib/format.ts";
import { formatMoney, nettedAway } from "../lib/money.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { symbolOf } from "../lib/tokens.ts";

const SHOWN = 100;

export function CyclesPage() {
  return (
    <>
      <PageHeader
        title="Cycles"
        lead="Every netting cycle settled on chain: how much debt it cleared and how little cash it took."
      />
      <CycleList />
    </>
  );
}

function CycleList() {
  const { state, error } = useChain();
  const cycles = state ? state.cycles.slice(-SHOWN).reverse() : [];
  const details = useCycleDetails(cycles);
  if (!isDeployed) return <NotDeployed what="The cycle history" />;
  if (!state) return error ? <Notice tone="bad">{error}</Notice> : <Spinner label="Loading cycles…" />;
  if (cycles.length === 0) {
    return (
      <Empty>
        No cycles settled on {activeNetwork.label} yet. Anyone can settle one from the{" "}
        <a href="#/network">Network</a> page once accepted invoices are due.
      </Empty>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Cycle</th>
            <th>Settled</th>
            <th className="num">Invoices</th>
            <th className="num">Members</th>
            <th className="num">Cleared</th>
            <th className="num">Cash moved</th>
            <th className="num">Netted away</th>
            <th>Solver</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => (
            <CycleRow
              key={cycle.id.toString()}
              cycle={cycle}
              entry={details[cycle.id.toString()]}
              members={state.members}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TxCell({ entry }: { entry: DetailEntry | undefined }) {
  if (!entry || entry.status === "loading") return <span className="muted">…</span>;
  if (entry.status === "error" || !entry.detail.transactionHash) return <span className="muted">Unavailable</span>;
  const hash = entry.detail.transactionHash;
  const link = explorerTx(activeNetwork, hash);
  return link ? (
    <a href={link} target="_blank" rel="noreferrer" className="mono">
      {hash.slice(0, 10)}…
    </a>
  ) : (
    <span className="mono">{hash.slice(0, 10)}…</span>
  );
}

interface CycleRowProps {
  cycle: Cycle;
  entry?: DetailEntry;
  members: ChainState["members"];
}

function CycleRow({ cycle, entry, members }: CycleRowProps) {
  const symbol = symbolOf(activeNetwork, cycle.token);
  return (
    <tr>
      <td>
        <a href={`#/cycles/${cycle.id}`}>#{cycle.id.toString()}</a> <span className="muted small">{symbol}</span>
      </td>
      <td>{formatDateTime(cycle.timestamp)}</td>
      <td className="num">{cycle.invoiceCount}</td>
      <td className="num">{cycle.memberCount}</td>
      <td className="num">{formatMoney(cycle.grossCleared, symbol)}</td>
      <td className="num">{formatMoney(cycle.cashMoved, symbol)}</td>
      <td className="num">{nettedAway(cycle.grossCleared, cycle.cashMoved)}</td>
      <td>
        <Party address={cycle.solver} name={members[cycle.solver.toLowerCase()]?.name} />
      </td>
      <td>
        <TxCell entry={entry} />
      </td>
    </tr>
  );
}

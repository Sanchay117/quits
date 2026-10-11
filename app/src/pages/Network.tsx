// Network: the live graph of members and open invoices, and a solver panel that previews and settles a cycle.
// The preview is computed for the connected wallet as sender: settle() takes cash only from members who approved it.
import { useMemo, useState } from "react";
import { MAX_BATCH, solverInputFromState, type SolveInput } from "../../../core/solver.ts";
import { lc, type ChainState } from "../../../core/state.ts";
import { Badge, Empty, Notice, NotDeployed, PageHeader, Party, Spinner, Stat } from "../components/common.tsx";
import { TxStatus } from "../components/TxStatus.tsx";
import { CollapseView } from "../graph/CollapseView.tsx";
import { settle } from "../lib/actions.ts";
import { useChain } from "../lib/chainState.ts";
import { depositsLeftOut, sameAccount, SOLVER_ACCESS_LABEL, solverAccess, type SolverAccess } from "../lib/consent.ts";
import { decomposeNets } from "../lib/flows.ts";
import { debtsFromState, nameResolver, openPositions, partiesFromState } from "../lib/live.ts";
import { formatMoney, nettedAway, type TokenSymbol } from "../lib/money.ts";
import { exceedsBatch, limitToBatch, nettingModel, runSolver, type Netting } from "../lib/netting.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { viewAsHref } from "../lib/router.ts";
import { tokensOf, type TokenInfo } from "../lib/tokens.ts";
import { useTx } from "../lib/useTx.ts";
import { connectWallet, ignoreRejection, useWallet } from "../lib/wallet.ts";

const TOKENS = tokensOf(activeNetwork);

export function NetworkPage() {
  const { state, error, loading } = useChain();
  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const token = TOKENS.find((t) => t.symbol === symbol) ?? TOKENS[0];

  return (
    <>
      <PageHeader
        title="Network"
        lead={
          `Members and open invoices on ${activeNetwork.label}. Anyone can compute and send a netting cycle; ` +
          "it takes cash only from members who approved the sender."
        }
      >
        {TOKENS.length > 1 && <TokenSwitch value={symbol} onChange={setSymbol} />}
      </PageHeader>
      {!isDeployed ? (
        <NotDeployed what="The network view" />
      ) : !state ? (
        loading ? <Spinner label={`Loading ${activeNetwork.label}…`} /> : <Notice tone="bad">{error}</Notice>
      ) : (
        <>
          {error && <Notice tone="warn">{error}. Showing the last state we loaded.</Notice>}
          <LiveNetwork key={symbol} state={state} token={token} />
        </>
      )}
    </>
  );
}

function TokenSwitch({ value, onChange }: { value: TokenSymbol; onChange: (symbol: TokenSymbol) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Token">
      {TOKENS.map((t) => (
        <button key={t.symbol} type="button" aria-pressed={t.symbol === value} onClick={() => onChange(t.symbol)}>
          {t.symbol}
        </button>
      ))}
    </div>
  );
}

/** Identifies a solution, so the animation replays only when what would clear actually changes. */
function clearsKey(netting: Netting | null): string {
  return netting ? netting.result.clears.map((c) => `${c.id}:${c.amount}`).join(",") : "idle";
}

function LiveNetwork({ state, token }: { state: ChainState; token: TokenInfo }) {
  const [previewing, setPreviewing] = useState(false);
  const [batchOnly, setBatchOnly] = useState(false);
  // Deposits count as liquidity only for members that let this wallet (state.submitter) draw on them.
  const input = useMemo(() => solverInputFromState(state, token.address), [state, token.address]);
  const solved = useMemo(() => (batchOnly ? limitToBatch(input) : input), [batchOnly, input]);
  const netting = useMemo(() => (previewing ? runSolver(solved) : null), [previewing, solved]);
  const model = useMemo(() => {
    const parties = partiesFromState(state, token.address);
    const debts = debtsFromState(state, token.address);
    return nettingModel(parties, debts, netting?.result ?? null, token.symbol);
  }, [state, token.address, token.symbol, netting]);

  return (
    <>
      <div className="network-layout">
        <div className="card card--graph">
          {model.edges.length === 0 ? (
            <Empty>No open {token.symbol} invoices right now.</Empty>
          ) : (
            <CollapseView
              model={model}
              playKey={`${token.symbol}-${clearsKey(netting)}`}
              autoplay={previewing}
              header={<GraphNote previewing={previewing} />}
              ariaLabel={`Open ${token.symbol} invoices between members`}
            />
          )}
        </div>
        <SolverPanel
          state={state}
          token={token}
          eligible={input.obligations.length}
          input={solved}
          netting={netting}
          batchOnly={batchOnly}
          onCompute={() => setPreviewing(true)}
          onBatch={() => setBatchOnly(true)}
        />
      </div>
      <MembersTable state={state} token={token} />
    </>
  );
}

function GraphNote({ previewing }: { previewing: boolean }) {
  return (
    <div className="collapse-header">
      <Badge tone={previewing ? "accent" : "neutral"}>{previewing ? "Preview" : "Live"}</Badge>
      <span>
        {previewing
          ? "What settling now would do. Nothing has moved yet."
          : "Solid: accepted and due. Faint: not due yet. Dashed: waiting for the debtor."}
      </span>
    </div>
  );
}

interface SolverPanelProps {
  state: ChainState;
  token: TokenInfo;
  /** Accepted, due invoices of this token. */
  eligible: number;
  /** What the solver ran on: every eligible invoice, or the MAX_BATCH oldest when batchOnly. */
  input: SolveInput;
  netting: Netting | null;
  batchOnly: boolean;
  onCompute: () => void;
  onBatch: () => void;
}

function SolverPanel({ eligible, netting, onCompute, ...rest }: SolverPanelProps) {
  if (!netting) return <ComputePrompt eligible={eligible} symbol={rest.token.symbol} onCompute={onCompute} />;
  return <NettingPreview {...rest} netting={netting} />;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function ComputePrompt({ eligible, symbol, onCompute }: { eligible: number; symbol: TokenSymbol; onCompute: () => void }) {
  const due = eligible === 1 ? "invoice is" : "invoices are";
  return (
    <aside className="card solver">
      <h2>Netting</h2>
      <p>
        {eligible === 0
          ? `No accepted ${symbol} invoices are due yet, so there is nothing to clear.`
          : `${eligible} accepted ${symbol} ${due} due. Run the solver in your browser to see how much clears ` +
            "and how little cash it takes."}
      </p>
      <button type="button" className="button" onClick={onCompute} disabled={eligible === 0}>
        Compute netting
      </button>
    </aside>
  );
}

export interface NettingPreviewProps {
  state: ChainState;
  token: TokenInfo;
  input: SolveInput;
  netting: Netting;
  batchOnly: boolean;
  onBatch: () => void;
}

export function NettingPreview({ state, token, input, netting, batchOnly, onBatch }: NettingPreviewProps) {
  const tx = useTx();
  const wallet = useWallet();
  const { result, verified, errors, millis } = netting;
  const money = (units: bigint) => formatMoney(units, token.symbol);
  const tooLarge = exceedsBatch(result);
  const leftOut = depositsLeftOut(state, token.address, input);
  // The preview counts the deposits this wallet may draw on; until the state is read for it, it is not the wallet's.
  const forThisWallet = sameAccount(state.submitter, wallet.address);
  // Right after a cycle settles, this preview is still the one it just sent until the state from its block arrives.
  const catchingUp = tx.progress.blockNumber !== undefined && state.blockNumber < tx.progress.blockNumber;
  const sendSettle = () =>
    tx.run("Settle cycle", async (ctx, report) => {
      if (!sameAccount(state.submitter, ctx.account)) {
        throw new Error("Your wallet account changed after this preview was computed. Wait for it to update, then settle.");
      }
      const cycleId = await settle(ctx, token.address, result.clears, report);
      return cycleId === null ? undefined : `Cycle #${cycleId} settled and final.`;
    });

  return (
    <aside className="card solver">
      <h2>Netting preview</h2>
      <div className="stats stats--compact">
        <Stat label="Clears" value={money(result.gross)} note={`of ${money(result.totalOutstanding)} due`} />
        <Stat
          label="Cash moved"
          value={money(result.cash)}
          note={`${nettedAway(result.gross, result.cash)} netted away`}
        />
      </div>
      {batchOnly && (
        <p className="small muted">
          Limited to the {MAX_BATCH} oldest due invoices. The rest can clear in the next cycle.
        </p>
      )}
      {result.uncleared > 0n && (
        <p className="small muted">
          {money(result.uncleared)} stays open: the deposits this cycle may draw on do not cover more.
        </p>
      )}
      {leftOut.count > 0 && (
        <p className="small muted">
          Left out: {money(leftOut.total)} in deposits of {leftOut.count} {plural(leftOut.count, "member", "members")}{" "}
          {state.submitter
            ? `who ${plural(leftOut.count, "has", "have")} not approved your wallet.`
            : `who ${plural(leftOut.count, "allows", "allow")} only approved solvers.`}{" "}
          <a href="#/how">Why</a>
        </p>
      )}
      <Transfers netting={netting} symbol={token.symbol} nameOf={nameResolver(state)} />
      {tooLarge ? (
        <Notice tone="warn">
          <p className="notice-title">Too many invoices for one transaction</p>
          <p>
            This cycle would clear {result.clears.length} invoices, but settle() takes at most {MAX_BATCH}, so
            sending it would revert. Settle it in parts, starting with the {MAX_BATCH} oldest due invoices.
          </p>
          <button type="button" className="button button--small" onClick={onBatch}>
            Compute a {MAX_BATCH}-invoice cycle
          </button>
        </Notice>
      ) : (
        <p className={`check ${verified ? "check--ok" : "check--bad"}`}>
          {verified ? `Checked against settle()'s rules. Solved in ${millis.toFixed(1)} ms.` : errors[0]}
        </p>
      )}
      {!wallet.available ? (
        <p className="small muted">Install a browser wallet such as MetaMask to settle this cycle.</p>
      ) : !wallet.address ? (
        <button type="button" className="button" onClick={ignoreRejection(connectWallet)} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect wallet to settle"}
        </button>
      ) : (
        <button
          type="button"
          className="button"
          onClick={() => void sendSettle()}
          disabled={tx.busy || catchingUp || !forThisWallet || !verified || tooLarge || result.clears.length === 0}
        >
          Settle on Arc
        </button>
      )}
      <p className="small muted">
        {catchingUp
          ? "Reading the network as it stands after your cycle…"
          : wallet.address && !forThisWallet
            ? "Updating the preview for your wallet…"
            : "The contract re-checks every rule, including that each member who pays cash approved the sender. " +
              "A cycle settles fully or not at all."}
      </p>
      <TxStatus progress={tx.progress} />
      {tx.progress.phase === "success" && (
        <a className="small" href="#/cycles">
          See it in Cycles
        </a>
      )}
    </aside>
  );
}

interface TransfersProps {
  netting: Netting;
  symbol: TokenSymbol;
  nameOf: (address: string) => string;
}

function Transfers({ netting, symbol, nameOf }: TransfersProps) {
  const flows = decomposeNets(netting.result.nets);
  if (flows.length === 0) {
    const text = netting.result.gross > 0n ? "No cash moves at all: pure loops." : "Nothing to clear.";
    return <p className="small muted">{text}</p>;
  }
  return (
    <ul className="transfers">
      {flows.map((flow) => (
        <li key={`${flow.from}>${flow.to}`}>
          <span>{nameOf(flow.from)}</span>
          <span className="transfer-arrow" aria-label="pays">
            →
          </span>
          <span>{nameOf(flow.to)}</span>
          <strong>{formatMoney(flow.amount, symbol)}</strong>
        </li>
      ))}
    </ul>
  );
}

function MemberStatus({ blocked, registered }: { blocked: boolean; registered: boolean }) {
  if (blocked) return <Badge tone="bad">Blocklisted</Badge>;
  return registered ? <Badge tone="good">Member</Badge> : <Badge>Unregistered</Badge>;
}

const ACCESS_TONE: Record<SolverAccess, "accent" | "good" | "neutral"> = {
  anyone: "accent",
  you: "good",
  "approved-you": "good",
  "approved-only": "neutral",
};

export function MembersTable({ state, token }: { state: ChainState; token: TokenInfo }) {
  const positions = openPositions(state, token.address);
  const members = Object.values(state.members);
  const key = lc(token.address);
  const money = (units: bigint, sign = false) => formatMoney(units, token.symbol, { sign });
  if (members.length === 0) return <Empty>No members yet.</Empty>;
  return (
    <section className="section">
      <h2 className="section-title">Members</h2>
      <p className="muted small">
        Solvers: who may send cycles that pay this member's net debts from its deposit. Cycles that take no cash from
        it need no approval. View opens a member's Account page read-only, with no wallet needed.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th className="num">Deposit</th>
              <th className="num">Owed to them</th>
              <th className="num">They owe</th>
              <th className="num">Net</th>
              <th>Solvers</th>
              <th>Status</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const { receivable, payable } = positions.get(lc(m.address)) ?? { receivable: 0n, payable: 0n };
              const access = solverAccess(m, state.submitter);
              const who = m.name || m.address;
              return (
                <tr key={m.address}>
                  <td>
                    <Party address={m.address} name={m.name} />
                  </td>
                  <td className="num">{money(m.balances[key] ?? 0n)}</td>
                  <td className="num">{money(receivable)}</td>
                  <td className="num">{money(payable)}</td>
                  <td className="num">{money(receivable - payable, true)}</td>
                  <td>
                    <Badge tone={ACCESS_TONE[access]}>{SOLVER_ACCESS_LABEL[access]}</Badge>
                  </td>
                  <td>
                    <MemberStatus blocked={m.blocked[key] ?? false} registered={m.registered} />
                  </td>
                  <td>
                    <a href={viewAsHref(m.address)} aria-label={`View the account of ${who}, read-only`}>
                      View
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

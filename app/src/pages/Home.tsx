// Home: the pitch in one screen, with the latest real cycle (or a labelled simulation) collapsing in the hero.
import { useMemo, type ReactNode } from "react";
import { explorerAddress } from "../../../core/chains.ts";
import { InvoiceStatus, lc, type ChainState } from "../../../core/state.ts";
import { Badge, ExternalLink, Stat } from "../components/common.tsx";
import { CollapseView } from "../graph/CollapseView.tsx";
import type { GraphModel } from "../graph/model.ts";
import { useChain } from "../lib/chainState.ts";
import { cycleModel, useCycleDetails } from "../lib/cycles.ts";
import { sampleNetwork } from "../lib/demo.ts";
import { formatDateTime } from "../lib/format.ts";
import { formatMoney, nettedAway } from "../lib/money.ts";
import { nettingModel, runSolver, simulatedInput } from "../lib/netting.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { sourcifyUrl } from "../lib/site.ts";
import { tokenBySymbol } from "../lib/tokens.ts";

function sampleModel(): GraphModel {
  const { parties, debts } = sampleNetwork();
  const { result } = runSolver(simulatedInput(parties, debts));
  return nettingModel(parties, debts, result, "USDC");
}

interface HeroGraph {
  model: GraphModel;
  key: string;
  header: ReactNode;
}

function useHeroGraph(): HeroGraph | null {
  const { state, loading } = useChain();
  const sample = useMemo(sampleModel, []);
  const latest = state?.cycles.at(-1);
  const details = useCycleDetails(latest ? [latest] : [], true);
  const entry = latest ? details[latest.id.toString()] : undefined;

  if (state && latest && entry?.status === "ready") {
    return {
      model: cycleModel(state, latest, entry.detail, entry.before),
      key: `cycle-${latest.id}`,
      header: (
        <div className="collapse-header">
          <Badge tone="accent">Live</Badge>
          <span>
            Cycle #{latest.id.toString()} on {activeNetwork.label}, settled {formatDateTime(latest.timestamp)}
          </span>
          <a href={`#/cycles/${latest.id}`}>Details</a>
        </div>
      ),
    };
  }
  const waitingForLive = isDeployed && (loading || (latest !== undefined && entry?.status !== "error"));
  if (waitingForLive) return null;
  return {
    model: sample,
    key: "sample",
    header: (
      <div className="collapse-header">
        <Badge tone="warn">Simulation</Badge>
        <span>
          Seven simulated companies of our own, not live data. Same solver as the live network.
        </span>
      </div>
    ),
  };
}

function Hero() {
  const graph = useHeroGraph();
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">A clearing house for invoices on Arc</p>
        <h1>Call it quits on circular debt.</h1>
        <p className="lead">
          Businesses owe each other in loops. Quits finds the debts that cancel out and settles only what is left, in
          one atomic transaction on Arc.
        </p>
        <div className="hero-actions">
          <a className="button" href="#/playground">
            Try the playground
          </a>
          <a className="button button--ghost" href="#/network">
            See the live network
          </a>
        </div>
      </div>
      <div className="card card--graph hero-graph">
        {graph ? (
          <CollapseView
            model={graph.model}
            playKey={graph.key}
            autoplay
            header={graph.header}
            ariaLabel="Debt graph: invoices between companies collapse into a few net transfers"
          />
        ) : (
          <div className="graph-placeholder" aria-busy="true">
            Loading the latest cycle from {activeNetwork.label}…
          </div>
        )}
      </div>
    </section>
  );
}

function clearedInvoiceCount(state: ChainState): number {
  return state.invoices.filter((inv) => inv.outstanding < inv.amount || inv.status === InvoiceStatus.Paid).length;
}

function LiveTotals() {
  const { state } = useChain();
  if (!isDeployed) {
    return (
      <p className="muted">Live totals appear here once the contract is deployed on {activeNetwork.label}.</p>
    );
  }
  if (!state) return <p className="muted">Loading totals from {activeNetwork.label}…</p>;
  const usdc = state.totals.find((t) => lc(t.token) === lc(activeNetwork.usdc));
  const eurcToken = tokenBySymbol(activeNetwork, "EURC");
  const eurc = eurcToken && state.totals.find((t) => lc(t.token) === lc(eurcToken.address));
  const gross = usdc?.totalCleared ?? 0n;
  const cash = usdc?.totalCashMoved ?? 0n;
  const eurcCleared = eurc?.totalCleared ?? 0n;
  const eurcNote = eurcCleared > 0n ? `plus ${formatMoney(eurcCleared, "EURC")} in EURC` : undefined;
  return (
    <div className="stats">
      <Stat label="Invoices cleared" value={clearedInvoiceCount(state).toLocaleString("en-US")} />
      <Stat label="Value cleared" value={formatMoney(gross)} note={eurcNote} />
      <Stat label="Cash actually moved" value={formatMoney(cash)} />
      <Stat label="Payments netted away" value={gross > 0n ? nettedAway(gross, cash) : "None yet"} />
    </div>
  );
}

const STEPS = [
  ["Issue", "A creditor bills a debtor on chain, with its own reference and a memo."],
  ["Accept", "The debtor accepts. Only accepted invoices that are due can ever clear."],
  ["Deposit", "Members keep a small deposit in USDC or EURC. It only ever pays net positions."],
  ["Net", "Anyone runs the solver: clear as much debt as possible while moving as little cash as possible."],
  ["Settle", "settle() re-checks every rule on chain and moves only the differences, all or nothing."],
] as const;

const WHY_ARC = [
  [
    "Settlement finality, literally",
    "Arc has deterministic finality: once a cycle is in a block it is settled, with no reorgs and no confirmation counts.",
  ],
  [
    "USDC is the native coin",
    "A USDC deposit is one plain transaction with no approval step, and withdrawals are native sends.",
  ],
  [
    "Compliance in the clearing rules",
    "Members on Circle's blocklist, which is Arc's chain-level blocklist, cannot take part: settle() checks every member it touches, and a blocked member's deposit stays frozen.",
  ],
  [
    "A cycle costs about a cent",
    "Gas is priced in USDC: settling 15 invoices between 6 companies costs about $0.01, so cycles can run every few minutes instead of once a day.",
  ],
  [
    "EURC supported",
    "EURC invoices clear in their own cycles; deposits use an EIP-2612 permit. The demo network runs in USDC.",
  ],
] as const;

/** DTCC's own figures, as cited in the README. */
const DTCC_2020 =
  "https://www.dtcc.com/dtcc-connection/articles/2021/april/19/ask-the-expert-same-day-every-day-how-same-day-settlement-works-at-dtcc";
const DTCC_EQUITIES = "https://www.dtcc.com/products-and-services/clearing-settlement-services/equities-clearing";

function ContractLink() {
  const contract = activeNetwork.clearingHouse;
  if (!contract) return <p className="muted">The contract is not deployed on {activeNetwork.label} yet.</p>;
  const verified = sourcifyUrl(activeNetwork, contract);
  const explorer = explorerAddress(activeNetwork, contract);
  return (
    <>
      <p>
        Contract on {activeNetwork.label}: <code className="break">{contract}</code>
      </p>
      {(verified || explorer) && (
        <p className="link-row">
          {verified && <ExternalLink href={verified}>Verified source on Sourcify</ExternalLink>}
          {explorer && <ExternalLink href={explorer}>Transactions on Arc Explorer</ExternalLink>}
        </p>
      )}
    </>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />

      <section className="section">
        <h2 className="section-title">On {activeNetwork.label} so far</h2>
        <LiveTotals />
      </section>

      <section className="section split">
        <div>
          <h2 className="section-title">Circular debt ties up cash</h2>
          <p>
            A roaster owes a packaging supplier, who owes a freight firm, who owes the cafe chain that buys the
            roaster's beans. Each invoice is paid in full, so every business needs cash for everything it owes, even
            though most of that money comes straight back around.
          </p>
          <p>
            Markets solved this long ago. In US equities, DTCC's NSCC nets every member's trades so that only the
            differences are paid: on an average day in 2020, $1.77 trillion of trades netted down to just under $38
            billion, about 98% (<ExternalLink href={DTCC_2020}>DTCC</ExternalLink>). Small businesses still pay every
            invoice in full.
          </p>
        </div>
        <aside className="callout">
          <span className="callout-figure">98%</span>
          <span>
            average reduction in US equities payment obligations from DTCC's netting (
            <ExternalLink href={DTCC_EQUITIES}>dtcc.com</ExternalLink>)
          </span>
          <span className="callout-small">An average day in 2020: $1.77 trillion netted to just under $38 billion</span>
        </aside>
      </section>

      <section className="section">
        <h2 className="section-title">How Quits works</h2>
        <ol className="steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="step-number">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <h2 className="section-title">Why Arc</h2>
        <div className="features">
          {WHY_ARC.map(([title, text]) => (
            <div className="feature" key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section card cta">
        <div>
          <h2>No owner, no admin, no upgrades, no fees.</h2>
          <p>
            The rules live in one short contract. Anyone can submit a netting cycle; the contract checks it, and takes
            cash only from members who approved the sender.
          </p>
          <ContractLink />
        </div>
        <div className="cta-actions">
          <a className="button" href="#/how">
            Read the rules
          </a>
          <a className="button button--ghost" href="#/cycles">
            Settled cycles
          </a>
        </div>
      </section>
    </>
  );
}

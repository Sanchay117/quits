// Playground: random invoice networks through the real solver, entirely offline.
import { useMemo, useState } from "react";
import { Badge, PageHeader, Stat } from "../components/common.tsx";
import { CollapseView } from "../graph/CollapseView.tsx";
import { decomposeNets } from "../lib/flows.ts";
import { formatMoney, nettedAway } from "../lib/money.ts";
import { nettingModel, runSolver, simulatedInput } from "../lib/netting.ts";
import { LIMITS, randomNetwork, type RandomNetworkOptions } from "../lib/random.ts";

const INITIAL: RandomNetworkOptions = { companies: 7, invoices: 18, liquidityPercent: 10, seed: 20261015 };

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, suffix = "", onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function PlaygroundPage() {
  const [options, setOptions] = useState(INITIAL);
  const set = (field: keyof RandomNetworkOptions) => (value: number) => setOptions((o) => ({ ...o, [field]: value }));
  const reshuffle = () => set("seed")(Math.floor(Math.random() * 2 ** 31));

  const run = useMemo(() => {
    const network = randomNetwork(options);
    const netting = runSolver(simulatedInput(network.parties, network.debts));
    const model = nettingModel(network.parties, network.debts, netting.result, "USDC");
    return { network, netting, model };
  }, [options]);

  const { result, verified, errors, millis } = run.netting;
  const names = new Map(run.network.parties.map((p) => [p.id, p.name]));
  const flows = decomposeNets(result.nets);

  return (
    <>
      <PageHeader
        title="Playground"
        lead={
          "Generate a random invoice network and watch the same solver the live network uses collapse it. " +
          "No wallet, no chain, nothing spent."
        }
      />
      <div className="playground">
        <aside className="card controls">
          <Slider label="Companies" {...LIMITS.companies} value={options.companies} onChange={set("companies")} />
          <Slider label="Invoices" {...LIMITS.invoices} value={options.invoices} onChange={set("invoices")} />
          <Slider
            label="Deposits"
            {...LIMITS.liquidityPercent}
            value={options.liquidityPercent}
            suffix="% of what each owes"
            onChange={set("liquidityPercent")}
          />
          <button type="button" className="button button--ghost" onClick={reshuffle}>
            New random network
          </button>
          <p className="small muted">
            At 0% only perfect loops can clear. Raise deposits and more debt clears, while the cash that moves stays
            small next to it.
          </p>
        </aside>
        <div className="card card--graph">
          <CollapseView
            model={run.model}
            playKey={JSON.stringify(options)}
            autoplay
            header={
              <div className="collapse-header">
                <Badge tone="warn">Simulation</Badge>
                <span>Random invoices of $5 to $95 between simulated companies.</span>
              </div>
            }
            ariaLabel="Random invoice network collapsing into net transfers"
          />
        </div>
      </div>
      <div className="stats">
        <Stat label="Owed in total" value={formatMoney(result.totalOutstanding)} note="Cash needed without netting" />
        <Stat label="Cleared" value={formatMoney(result.gross)} note={`${formatMoney(result.uncleared)} left open`} />
        <Stat label="Cash moved" value={formatMoney(result.cash)} note={`${flows.length} transfers`} />
        <Stat label="Netted away" value={result.gross > 0n ? nettedAway(result.gross, result.cash) : "0%"} />
      </div>
      <p className={`check ${verified ? "check--ok" : "check--bad"}`}>
        {verified
          ? `Solved in ${millis.toFixed(1)} ms and checked against the same rules settle() enforces on chain.`
          : `Check failed: ${errors[0]}`}
      </p>
      {flows.length > 0 && (
        <section className="section">
          <h2 className="section-title">Net transfers</h2>
          <ul className="transfers transfers--wide">
            {flows.map((flow) => (
              <li key={`${flow.from}>${flow.to}`}>
                <span>{names.get(flow.from)}</span>
                <span className="transfer-arrow" aria-label="pays">
                  →
                </span>
                <span>{names.get(flow.to)}</span>
                <strong>{formatMoney(flow.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

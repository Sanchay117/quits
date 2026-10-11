// Small presentational pieces shared by the pages.
import type { ReactNode } from "react";
import { explorerAddress } from "../../../core/chains.ts";
import { displayName, shortAddress } from "../lib/format.ts";
import { activeNetwork, networkHref, shownNetworks } from "../lib/network.ts";

export function Party({ address, name }: { address: string; name?: string }) {
  const link = explorerAddress(activeNetwork, address);
  const label = displayName(address, name);
  const content = (
    <>
      <span className="party-name">{label}</span>
      {name && <span className="party-address">{shortAddress(address)}</span>}
    </>
  );
  return link ? (
    <a className="party" href={link} target="_blank" rel="noreferrer" title={address}>
      {content}
    </a>
  ) : (
    <span className="party" title={address}>
      {content}
    </span>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

export function PageHeader({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="page-header-aside">{children}</div>}
    </header>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "bad"; children: ReactNode }) {
  return <div className={`notice notice--${tone}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Shown wherever live data is needed but the contract has no address on this network yet. */
export function NotDeployed({ what }: { what: string }) {
  const elsewhere = shownNetworks.filter((net) => net.clearingHouse && net.name !== activeNetwork.name);
  return (
    <div className="card not-deployed">
      <h2>Not deployed on {activeNetwork.label} yet</h2>
      <p>
        {what} reads the Quits contract on {activeNetwork.label}, which has no address in this build yet.
        Meanwhile, the <a href="#/playground">Playground</a> runs the same solver on simulated networks, with no
        wallet needed.
      </p>
      {elsewhere.length > 0 && (
        <p>
          Live on:{" "}
          {elsewhere.map((net, i) => (
            <span key={net.name}>
              {i > 0 && ", "}
              <a href={networkHref(net.name)}>{net.label}</a>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

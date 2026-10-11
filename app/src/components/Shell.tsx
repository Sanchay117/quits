// Page chrome: header with navigation, network picker and wallet button; footer.
import type { ReactNode } from "react";
import { explorerAddress } from "../../../core/chains.ts";
import { displayName, shortAddress } from "../lib/format.ts";
import { useChain } from "../lib/chainState.ts";
import { activeNetwork, isDeployed, isNetworkName, networkHref, shownNetworks } from "../lib/network.ts";
import type { Route } from "../lib/router.ts";
import { connectWallet, ignoreRejection, isOnActiveChain, switchToActiveNetwork, useWallet } from "../lib/wallet.ts";

const NAV: { href: string; label: string; pages: Route["page"][] }[] = [
  { href: "#/network", label: "Network", pages: ["network"] },
  { href: "#/account", label: "Account", pages: ["account"] },
  { href: "#/cycles", label: "Cycles", pages: ["cycles", "cycle"] },
  { href: "#/playground", label: "Playground", pages: ["playground"] },
  { href: "#/how", label: "How it works", pages: ["how"] },
];

export function Logo() {
  return (
    <svg className="logo-mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <path d="M16.5 16.5 L23 23" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.6" className="logo-dot" />
    </svg>
  );
}

function NetworkPicker() {
  return (
    <label className="network-picker">
      <span className="visually-hidden">Network</span>
      <span className={`network-dot${isDeployed ? " is-live" : ""}`} aria-hidden="true" />
      <select
        value={activeNetwork.name}
        onChange={(event) => {
          if (isNetworkName(event.target.value)) window.location.href = networkHref(event.target.value);
        }}
      >
        {shownNetworks.map((net) => (
          <option key={net.name} value={net.name}>
            {net.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const WALLET_DOWNLOAD = "https://metamask.io/download/";

function WalletButton() {
  const wallet = useWallet();
  const { state } = useChain();
  if (!wallet.available) {
    return (
      <a className="button button--ghost button--small" href={WALLET_DOWNLOAD} target="_blank" rel="noreferrer">
        Get a wallet
      </a>
    );
  }
  if (!wallet.address) {
    return (
      <button type="button" className="button button--small" onClick={ignoreRejection(connectWallet)} disabled={wallet.connecting}>
        {wallet.connecting ? "Connecting…" : <>Connect<span className="hide-narrow"> wallet</span></>}
      </button>
    );
  }
  if (!isOnActiveChain(wallet)) {
    return (
      <button type="button" className="button button--warn button--small" onClick={ignoreRejection(switchToActiveNetwork)}>
        Switch<span className="hide-narrow"> to {activeNetwork.label}</span>
      </button>
    );
  }
  const name = state?.members[wallet.address.toLowerCase()]?.name;
  return (
    <a className="wallet-chip" href="#/account" title={wallet.address}>
      <span className="wallet-dot" aria-hidden="true" />
      {displayName(wallet.address, name)}
    </a>
  );
}

export function Header({ route }: { route: Route }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" href="#/" aria-label="Quits home">
          <Logo />
          <span>Quits</span>
        </a>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} aria-current={item.pages.includes(route.page) ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="site-tools">
          <NetworkPicker />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const contract = activeNetwork.clearingHouse;
  const link = contract ? explorerAddress(activeNetwork, contract) : null;
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>
          <strong>Quits</strong> is a clearing house for invoices on Arc. No owner, no admin, no upgrades, no fees.
        </p>
        <p className="muted">
          {contract ? (
            <>
              Contract on {activeNetwork.label}:{" "}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer">
                  {shortAddress(contract)}
                </a>
              ) : (
                <code>{shortAddress(contract)}</code>
              )}
            </>
          ) : (
            <>Not deployed on {activeNetwork.label} yet.</>
          )}{" "}
          Simulated data is always labelled as such.
        </p>
      </div>
    </footer>
  );
}

export function Main({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="site-main" tabIndex={-1}>
      {children}
    </main>
  );
}

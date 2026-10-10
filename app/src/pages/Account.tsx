// Account: everything a member does with a connected wallet.
import type { Hex } from "viem";
import type { ChainState } from "../../../core/state.ts";
import { Notice, NotDeployed, PageHeader, Spinner } from "../components/common.tsx";
import { useChain } from "../lib/chainState.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { connectWallet, ignoreRejection, isOnActiveChain, switchToActiveNetwork, useWallet } from "../lib/wallet.ts";
import { Funds } from "./account/Funds.tsx";
import { History } from "./account/History.tsx";
import { InvoiceLists } from "./account/InvoiceLists.tsx";
import { IssueInvoice } from "./account/IssueInvoice.tsx";
import { Profile } from "./account/Profile.tsx";

export function AccountPage() {
  return (
    <>
      <PageHeader
        title="Account"
        lead="Register a name, keep a deposit, issue and accept invoices, and export your records."
      />
      <AccountGate />
    </>
  );
}

function AccountGate() {
  const wallet = useWallet();
  const { state, error } = useChain();
  if (!isDeployed) return <NotDeployed what="Your account" />;
  if (!wallet.available) {
    return (
      <div className="card gate">
        <h2>No browser wallet found</h2>
        <p>
          Install MetaMask or another EIP-1193 wallet to issue and accept invoices. Browsing the network and the
          playground needs no wallet.
        </p>
      </div>
    );
  }
  if (!wallet.address) {
    return (
      <div className="card gate">
        <h2>Connect a wallet</h2>
        <p>Your address is your account. Quits never holds keys; every action is a transaction you sign.</p>
        <button type="button" className="button" onClick={ignoreRejection(connectWallet)} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }
  if (!isOnActiveChain(wallet)) {
    return (
      <div className="card gate">
        <h2>Switch to {activeNetwork.label}</h2>
        <p>
          Your wallet is on another network. Quits adds {activeNetwork.label} with USDC as its native coin if needed.
        </p>
        <button type="button" className="button" onClick={ignoreRejection(switchToActiveNetwork)}>
          Switch network
        </button>
      </div>
    );
  }
  if (!state) return error ? <Notice tone="bad">{error}</Notice> : <Spinner label="Loading your account…" />;
  return <AccountBody state={state} me={wallet.address} />;
}

function AccountBody({ state, me }: { state: ChainState; me: Hex }) {
  return (
    <div className="account">
      <Profile state={state} me={me} />
      <Funds state={state} me={me} />
      <InvoiceLists state={state} me={me} />
      <IssueInvoice state={state} me={me} />
      <History state={state} me={me} />
    </div>
  );
}

// Account: everything a member does with a connected wallet. With ?as=0x... it shows any address's account
// read-only, so reviewers without a wallet can see a demo company's inbox, positions, permissions and exports.
import { getAddress, isAddress, type Hex } from "viem";
import { lc, type ChainState } from "../../../core/state.ts";
import { Notice, NotDeployed, PageHeader, Spinner } from "../components/common.tsx";
import { useChain } from "../lib/chainState.ts";
import { displayName } from "../lib/format.ts";
import { activeNetwork, isDeployed } from "../lib/network.ts";
import { ReadOnlyContext } from "../lib/readOnly.ts";
import { connectWallet, ignoreRejection, isOnActiveChain, switchToActiveNetwork, useWallet } from "../lib/wallet.ts";
import { Funds } from "./account/Funds.tsx";
import { History } from "./account/History.tsx";
import { InvoiceLists } from "./account/InvoiceLists.tsx";
import { IssueInvoice } from "./account/IssueInvoice.tsx";
import { Permissions } from "./account/Permissions.tsx";
import { Profile } from "./account/Profile.tsx";

/** `viewAs`: the address from #/account?as=..., shown read-only. Without it, the connected wallet's account. */
export function AccountPage({ viewAs }: { viewAs?: string }) {
  return (
    <>
      <PageHeader
        title="Account"
        lead="Register a name, keep a deposit, choose who may net it, issue and accept invoices, and export your records."
      />
      {viewAs === undefined ? <AccountGate /> : <ViewAs address={viewAs} />}
    </>
  );
}

function NoWalletNote() {
  return (
    <p>
      To look around without one, open any member's account read-only from the members table on the{" "}
      <a href="#/network">Network</a> page.
    </p>
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
        <NoWalletNote />
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
  // Keyed by address: forms and drafts belong to one account and must not carry over to the next.
  return <AccountBody key={wallet.address} state={state} me={wallet.address} />;
}

/** Any address's account, read-only: no wallet needed, and every write control is off (see ReadOnlyContext). */
function ViewAs({ address }: { address: string }) {
  const { state, error } = useChain();
  if (!isDeployed) return <NotDeployed what="This account view" />;
  if (!isAddress(address, { strict: false })) {
    return (
      <Notice tone="bad">
        "{address}" is not an address. Pick a member to view from the <a href="#/network">Network</a> page.
      </Notice>
    );
  }
  if (!state) return error ? <Notice tone="bad">{error}</Notice> : <Spinner label="Loading the account…" />;
  const me = getAddress(address);
  return (
    <ReadOnlyContext.Provider value={true}>
      <ViewAsBanner state={state} me={me} />
      <AccountBody key={me} state={state} me={me} />
    </ReadOnlyContext.Provider>
  );
}

export function ViewAsBanner({ state, me }: { state: ChainState; me: Hex }) {
  const member = state.members[lc(me)];
  const who = displayName(me, member?.name);
  return (
    <Notice tone="accent">
      <p className="notice-title">Viewing as {who}, read-only</p>
      <p>
        This is the Account page {who} sees with its wallet connected. Every action is disabled and nothing here can
        send a transaction; the CSV exports work. <a href="#/account">Open your own account</a> or pick another member
        on the <a href="#/network">Network</a> page.
      </p>
      {!member && <p>This address has no invoices or deposits on {activeNetwork.label} yet.</p>}
    </Notice>
  );
}

function AccountBody({ state, me }: { state: ChainState; me: Hex }) {
  return (
    <div className="account">
      <Profile state={state} me={me} />
      <Funds state={state} me={me} />
      <Permissions state={state} me={me} />
      <InvoiceLists state={state} me={me} />
      <IssueInvoice state={state} me={me} />
      <History state={state} me={me} />
    </div>
  );
}

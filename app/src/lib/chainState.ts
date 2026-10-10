// Polls the clearing house state of the active network and shares it with every page. The state is read for the
// connected account as the would-be submitter of settle(), so each member's drawableBySubmitter flag says whether a
// cycle sent from this wallet may draw on its deposit. It is reloaded as soon as the account changes.
import { loadState, type ChainState } from "../../../core/state.ts";
import { sameAccount } from "./consent.ts";
import { latestLoader } from "./loader.ts";
import { activeNetwork, isDeployed, publicClient } from "./network.ts";
import { createStore, useStore } from "./store.ts";
import { connectedAccount, onAccountChange } from "./wallet.ts";

export const POLL_INTERVAL_MS = 8_000;

export interface ChainSnapshot {
  /** state.submitter is the account it was read for; it can lag the wallet for a moment after a switch. */
  state: ChainState | null;
  /** Message of the last failed load. The previous state stays visible while this is set. */
  error: string | null;
  loading: boolean;
}

const chainStore = createStore<ChainSnapshot>({ state: null, error: null, loading: isDeployed });

/** Loads for the connected account (none when disconnected); a result for an account that is no longer current is dropped. */
const load = latestLoader({
  currentKey: connectedAccount,
  same: sameAccount,
  load: (submitter) => loadState(publicClient, activeNetwork, { submitter }),
  onResult: (state: ChainState) => chainStore.set({ state, error: null, loading: false }),
  onError: (err) => chainStore.set({ error: errorText(err), loading: false }),
});

/** Loads the state now. Concurrent calls for the same account share one request. */
export function refreshChain(): Promise<void> {
  if (!isDeployed) return Promise.resolve();
  return load();
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  return `Could not reach ${activeNetwork.label}: ${message.split("\n")[0]}`;
}

/** Starts polling while the tab is visible, and reloads whenever the wallet account changes. Returns a stop function. */
export function startPolling(): () => void {
  void refreshChain();
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshChain();
  }, POLL_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void refreshChain();
  };
  document.addEventListener("visibilitychange", onVisible);
  const unwatch = onAccountChange(() => void refreshChain());
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    unwatch();
  };
}

export function useChain(): ChainSnapshot {
  return useStore(chainStore);
}

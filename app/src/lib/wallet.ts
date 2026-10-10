// Injected EIP-1193 wallet (MetaMask and compatible): connection, account and chain tracking, Arc chain setup.
import { createWalletClient, custom, getAddress, toHex, type EIP1193Provider, type Hex, type WalletClient } from "viem";
import { activeChain, activeNetwork } from "./network.ts";
import { createStore, useStore } from "./store.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface WalletSnapshot {
  available: boolean;
  address: Hex | null;
  chainId: number | null;
  connecting: boolean;
}

const walletStore = createStore<WalletSnapshot>({
  available: typeof window !== "undefined" && Boolean(window.ethereum),
  address: null,
  chainId: null,
  connecting: false,
});

export function useWallet(): WalletSnapshot {
  return useStore(walletStore);
}

/** The connected account (checksummed), or null, for code outside React. */
export function connectedAccount(): Hex | null {
  return walletStore.get().address;
}

/** Calls `listener` whenever the connected account changes (connect, disconnect, switch). Returns an unsubscribe. */
export function onAccountChange(listener: (account: Hex | null) => void): () => void {
  let last = walletStore.get().address;
  return walletStore.subscribe(() => {
    const next = walletStore.get().address;
    if (next === last) return;
    last = next;
    listener(next);
  });
}

export function isOnActiveChain(wallet: WalletSnapshot): boolean {
  return wallet.chainId === activeNetwork.chainId;
}

function provider(): EIP1193Provider {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
  return window.ethereum;
}

function setAccounts(accounts: readonly string[]): void {
  walletStore.set({ address: accounts[0] ? getAddress(accounts[0]) : null });
}

function setChain(chainIdHex: string): void {
  walletStore.set({ chainId: Number.parseInt(chainIdHex, 16) });
}

/** Restores an existing connection without prompting and follows account and chain changes. */
export function initWallet(): () => void {
  const eth = window.ethereum;
  if (!eth) return () => {};
  eth.request({ method: "eth_accounts" }).then(setAccounts, () => {});
  eth.request({ method: "eth_chainId" }).then(setChain, () => {});
  eth.on("accountsChanged", setAccounts);
  eth.on("chainChanged", setChain);
  return () => {
    eth.removeListener("accountsChanged", setAccounts);
    eth.removeListener("chainChanged", setChain);
  };
}

export async function connectWallet(): Promise<Hex> {
  walletStore.set({ connecting: true });
  try {
    const accounts = await provider().request({ method: "eth_requestAccounts" });
    setAccounts(accounts);
    setChain(await provider().request({ method: "eth_chainId" }));
    const address = walletStore.get().address;
    if (!address) throw new Error("The wallet did not share an account.");
    return address;
  } finally {
    walletStore.set({ connecting: false });
  }
}

function errorCode(err: unknown): number | undefined {
  const direct = (err as { code?: number })?.code;
  const nested = (err as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
  return direct ?? nested;
}

/** Switches the wallet to the active Arc network, adding it first (USDC as the 18-decimal native coin) if needed. */
export async function switchToActiveNetwork(): Promise<void> {
  const eth = provider();
  const chainId = toHex(activeNetwork.chainId);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    if (errorCode(err) !== 4902) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: activeNetwork.label,
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: [activeNetwork.rpcUrl],
          blockExplorerUrls: activeNetwork.explorer ? [activeNetwork.explorer] : undefined,
        },
      ],
    });
  }
  setChain(await eth.request({ method: "eth_chainId" }));
}

/** For buttons that only open a wallet prompt: a dismissed prompt leaves the button as it was. */
export function ignoreRejection(action: () => Promise<unknown>): () => void {
  return () => void action().catch(() => {});
}

export interface WalletSession {
  account: Hex;
  client: WalletClient;
}

/** Connects if needed and makes sure the wallet is on the active network, then returns a wallet client. */
export async function walletSession(): Promise<WalletSession> {
  const account = walletStore.get().address ?? (await connectWallet());
  if (!isOnActiveChain(walletStore.get())) await switchToActiveNetwork();
  if (!isOnActiveChain(walletStore.get())) throw new Error(`Switch your wallet to ${activeNetwork.label} to continue.`);
  const client = createWalletClient({ account, chain: activeChain, transport: custom(provider()) });
  return { account, client };
}

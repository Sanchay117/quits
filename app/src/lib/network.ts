// The network this page talks to (chosen with ?network=), its viem chain and its public client.
import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { networks, type ArcNetwork, type NetworkName } from "../../../core/chains.ts";

const NETWORK_NAMES = Object.keys(networks) as NetworkName[];

export function isNetworkName(value: string | null): value is NetworkName {
  return value !== null && (NETWORK_NAMES as string[]).includes(value);
}

/** Mainnet unless the query string asks for another known network. */
export function networkFromSearch(search: string): ArcNetwork {
  const name = new URLSearchParams(search).get("network");
  return isNetworkName(name) ? networks[name] : networks.mainnet;
}

/** USDC is Arc's native coin; as msg.value it carries 18 decimals. */
export function viemChain(net: ArcNetwork): Chain {
  return defineChain({
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: net.explorer ? { default: { name: "Arc Explorer", url: net.explorer } } : undefined,
    contracts: { multicall3: { address: net.multicall3 } },
  });
}

/** Same page, another network. The hash route is kept. */
export function networkHref(name: NetworkName): string {
  const params = new URLSearchParams(window.location.search);
  if (name === "mainnet") params.delete("network");
  else params.set("network", name);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

export const activeNetwork: ArcNetwork = networkFromSearch(window.location.search);
export const activeChain: Chain = viemChain(activeNetwork);
export const isDeployed = activeNetwork.clearingHouse !== null;
export const allNetworks: ArcNetwork[] = NETWORK_NAMES.map((name) => networks[name]);

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(activeNetwork.rpcUrl, { retryCount: 2 }),
}) as PublicClient;

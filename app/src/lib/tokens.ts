// Maps token addresses to display symbols for the active network.
import type { ArcNetwork, Hex } from "../../../core/chains.ts";
import type { TokenSymbol } from "./money.ts";

export interface TokenInfo {
  address: Hex;
  symbol: TokenSymbol;
  /** True for USDC, Arc's native coin (deposits are plain value transfers). */
  native: boolean;
}

export function tokensOf(net: ArcNetwork): TokenInfo[] {
  const list: TokenInfo[] = [{ address: net.usdc, symbol: "USDC", native: true }];
  if (net.eurc) list.push({ address: net.eurc, symbol: "EURC", native: false });
  return list;
}

export function symbolOf(net: ArcNetwork, token: string): TokenSymbol {
  return net.eurc && token.toLowerCase() === net.eurc.toLowerCase() ? "EURC" : "USDC";
}

export function tokenBySymbol(net: ArcNetwork, symbol: TokenSymbol): TokenInfo | undefined {
  return tokensOf(net).find((token) => token.symbol === symbol);
}

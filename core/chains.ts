// Arc network constants shared by the app and the scripts. Plain data, no dependencies.
// Addresses verified against docs.arc.io/arc/references/contract-addresses and live RPC calls (2026-10-10).
import { deployments } from "./deployments.ts";

export type Hex = `0x${string}`;
export type NetworkName = "mainnet" | "testnet" | "local";

export interface ArcNetwork {
  name: NetworkName;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
  /** USDC: Arc's native coin, with a 6-decimal FiatToken ERC-20 view at this address. */
  usdc: Hex;
  /** EURC (FiatToken, 6 decimals). On local networks the deploy script fills in a mock. */
  eurc: Hex | null;
  /** Arc's Memo predeploy (wraps a call and indexes a reference). Not available on local anvil. */
  memo: Hex | null;
  /** Arc's Multicall3From predeploy (batch calls that each run as the sending EOA). Not available on local anvil. */
  multicall3From: Hex | null;
  /** Standard Multicall3, used for batched reads. */
  multicall3: Hex;
  clearingHouse: Hex | null;
  deployBlock: bigint;
}

const USDC: Hex = "0x3600000000000000000000000000000000000000";
const MEMO: Hex = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const MULTICALL3_FROM: Hex = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";
const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const networks: Record<NetworkName, ArcNetwork> = {
  mainnet: {
    name: "mainnet",
    label: "Arc Mainnet",
    chainId: 5042,
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    usdc: USDC,
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    memo: MEMO,
    multicall3From: MULTICALL3_FROM,
    multicall3: MULTICALL3,
    clearingHouse: deployments.mainnet.clearingHouse,
    deployBlock: BigInt(deployments.mainnet.deployBlock),
  },
  testnet: {
    name: "testnet",
    label: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    usdc: USDC,
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    memo: MEMO,
    multicall3From: MULTICALL3_FROM,
    multicall3: MULTICALL3,
    clearingHouse: deployments.testnet.clearingHouse,
    deployBlock: BigInt(deployments.testnet.deployBlock),
  },
  local: {
    name: "local",
    label: "Local (anvil)",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    explorer: null,
    usdc: USDC,
    eurc: deployments.local.eurc,
    memo: null,
    multicall3From: null,
    multicall3: MULTICALL3,
    clearingHouse: deployments.local.clearingHouse,
    deployBlock: BigInt(deployments.local.deployBlock),
  },
};

/** Native USDC has 18 decimals; contract accounting and the ERC-20 view use 6. */
export const NATIVE_SCALE = 10n ** 12n;
export const TOKEN_DECIMALS = 6;
/** Arc drops transactions priced under its 20 gwei minimum base fee without a receipt. */
export const MIN_FEE_PER_GAS = 20_000_000_000n;

export function explorerTx(net: ArcNetwork, hash: string): string | null {
  return net.explorer ? `${net.explorer}/tx/${hash}` : null;
}

export function explorerAddress(net: ArcNetwork, address: string): string | null {
  return net.explorer ? `${net.explorer}/address/${address}` : null;
}

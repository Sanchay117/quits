// Writes deployment records into core/deployments.ts (one network's entry at a time, keeping the file's format) and
// reads Foundry broadcast files.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import type { NetworkName } from "../../core/chains.ts";
import { fail } from "./args.ts";
import { ROOT } from "./keys.ts";

export const DEPLOYMENTS_FILE = `${ROOT}core/deployments.ts`;
export const CONTRACTS_DIR = `${ROOT}contracts`;

export interface DeploymentRecord {
  clearingHouse: Hex;
  /** Only set on local networks, where a mock EURC is deployed too. */
  eurc: Hex | null;
  deployBlock: number;
}

function entryText(network: NetworkName, d: DeploymentRecord): string {
  const value = (v: Hex | null) => (v ? `"${getAddress(v)}"` : "null");
  const oneLine = `  ${network}: { clearingHouse: ${value(d.clearingHouse)}, eurc: ${value(d.eurc)}, deployBlock: ${d.deployBlock} },`;
  if (oneLine.length <= 120) return oneLine;
  return [
    `  ${network}: {`,
    `    clearingHouse: ${value(d.clearingHouse)},`,
    `    eurc: ${value(d.eurc)},`,
    `    deployBlock: ${d.deployBlock},`,
    "  },",
  ].join("\n");
}

/** Replace `network`'s entry in core/deployments.ts, leaving the rest of the file as it is. */
export function writeDeployment(network: NetworkName, d: DeploymentRecord): void {
  const source = readFileSync(DEPLOYMENTS_FILE, "utf8");
  const pattern = new RegExp(`^  ${network}: \\{[\\s\\S]*?\\},$`, "m");
  if (!pattern.test(source)) fail(`Could not find the ${network} entry in core/deployments.ts`);
  writeFileSync(DEPLOYMENTS_FILE, source.replace(pattern, entryText(network, d)));
}

export interface BroadcastDeployment {
  file: string;
  chainId: number;
  address: Hex;
  hash: Hex;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  /** Constructor arguments as forge recorded them. */
  arguments: string[];
}

export function broadcastFile(chainId: number, script = "Deploy.s.sol"): string {
  return `${CONTRACTS_DIR}/broadcast/${script}/${chainId}/run-latest.json`;
}

interface BroadcastJson {
  chain?: number;
  transactions?: {
    hash: Hex;
    transactionType?: string;
    contractName?: string;
    contractAddress?: Hex;
    arguments?: string[] | null;
  }[];
  receipts?: {
    transactionHash: Hex;
    blockNumber: string;
    status?: string;
    contractAddress?: Hex | null;
    gasUsed?: string;
    effectiveGasPrice?: string;
  }[];
}

/** The ClearingHouse creation recorded in a forge broadcast file (the last one, if the run deployed several). */
export function readBroadcast(file: string): BroadcastDeployment {
  if (!existsSync(file)) fail(`No broadcast file at ${file.startsWith(ROOT) ? file.slice(ROOT.length) : file}`);
  const json = JSON.parse(readFileSync(file, "utf8")) as BroadcastJson;
  const creates = (json.transactions ?? []).filter(
    (t) => t.transactionType === "CREATE" && t.contractName === "ClearingHouse" && t.contractAddress,
  );
  const tx = creates.at(-1);
  if (!tx) fail(`${file} has no ClearingHouse deployment`);
  const receipt = (json.receipts ?? []).find((r) => r.transactionHash.toLowerCase() === tx.hash.toLowerCase());
  if (!receipt) fail(`${file} has no receipt for ${tx.hash}: the broadcast may not have completed`);
  if (receipt.status !== undefined && BigInt(receipt.status) !== 1n) fail(`The deployment transaction ${tx.hash} reverted`);
  return {
    file,
    chainId: Number(json.chain ?? 0),
    address: getAddress(receipt.contractAddress ?? tx.contractAddress!),
    hash: tx.hash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    gasUsed: BigInt(receipt.gasUsed ?? 0),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice ?? 0),
    arguments: tx.arguments ?? [],
  };
}

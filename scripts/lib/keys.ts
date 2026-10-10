// Key files in .secrets/ (gitignored). Private keys are only ever handed to viem signers or to forge; never printed.
//   .secrets/<network>-deployer.json   { "address": "0x...", "privateKey": "0x..." }   (scripts/new-key.ts)
//   .secrets/<network>-companies.json  [{ "name": "...", "address": "0x...", "privateKey": "0x..." }]   (scripts/wallets.ts)
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, isHex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex, NetworkName } from "../../core/chains.ts";
import { fail } from "./args.ts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SECRETS_DIR = `${ROOT}.secrets/`;

/** Anvil's first default account. Public knowledge, funded only on a local dev chain; used when no local key file exists. */
const ANVIL_ACCOUNT_0: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export interface Signer {
  account: PrivateKeyAccount;
  address: Hex;
  /** Where the key came from, for messages (never the key itself). */
  source: string;
}

export interface Company extends Signer {
  name: string;
}

export function deployerFile(network: NetworkName): string {
  return `${SECRETS_DIR}${network}-deployer.json`;
}

export function companiesFile(network: NetworkName): string {
  return `${SECRETS_DIR}${network}-companies.json`;
}

function relative(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length) : path;
}

function checkKey(value: unknown, where: string): Hex {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) {
    fail(`${where}: "privateKey" must be a 0x-prefixed 32-byte hex string`);
  }
  return value as Hex;
}

/** The deployer key's raw value, for handing to forge. Callers must never print it. */
export function deployerPrivateKey(network: NetworkName): Hex {
  const file = deployerFile(network);
  if (!existsSync(file)) {
    if (network === "local") return ANVIL_ACCOUNT_0;
    fail(`No deployer key for ${network}: ${relative(file)} is missing. Create one with: node scripts/new-key.ts --network ${network}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { privateKey?: unknown; address?: unknown };
  const key = checkKey(parsed.privateKey, relative(file));
  if (typeof parsed.address === "string" && getAddress(parsed.address) !== privateKeyToAccount(key).address) {
    fail(`${relative(file)}: "address" does not match the private key`);
  }
  return key;
}

export function loadDeployer(network: NetworkName): Signer {
  const file = deployerFile(network);
  const account = privateKeyToAccount(deployerPrivateKey(network));
  const source = existsSync(file) ? relative(file) : "anvil default account 0";
  return { account, address: account.address, source };
}

export function hasCompanies(network: NetworkName): boolean {
  return existsSync(companiesFile(network));
}

export function loadCompanies(network: NetworkName): Company[] {
  const file = companiesFile(network);
  if (!existsSync(file)) {
    fail(`No company wallets for ${network}: ${relative(file)} is missing. Create them with: node scripts/wallets.ts --network ${network}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) fail(`${relative(file)} must be a non-empty JSON array`);
  return parsed.map((entry: { name?: unknown; privateKey?: unknown; address?: unknown }, i) => {
    const where = `${relative(file)} entry ${i}`;
    if (typeof entry.name !== "string" || entry.name.length === 0) fail(`${where}: "name" is missing`);
    const account = privateKeyToAccount(checkKey(entry.privateKey, where));
    if (typeof entry.address === "string" && getAddress(entry.address) !== account.address) {
      fail(`${where}: "address" does not match the private key`);
    }
    return { name: entry.name, account, address: account.address, source: relative(file) };
  });
}

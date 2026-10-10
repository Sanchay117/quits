// Creates a deployer key for a network in .secrets/ (gitignored) and prints its address. Never overwrites.
// Usage: node scripts/new-key.ts --network testnet|mainnet
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const i = process.argv.indexOf("--network");
const network = i > 0 ? process.argv[i + 1] : undefined;
if (network !== "testnet" && network !== "mainnet") {
  console.error("Usage: node scripts/new-key.ts --network testnet|mainnet");
  process.exit(1);
}
const file = new URL(`../.secrets/${network}-deployer.json`, import.meta.url);
if (existsSync(file)) {
  console.error(`${file.pathname} already exists, not overwriting.`);
  process.exit(1);
}
mkdirSync(new URL("../.secrets/", import.meta.url), { recursive: true });
const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);
writeFileSync(file, JSON.stringify({ address, privateKey }, null, 2) + "\n", { mode: 0o600 });
console.log(`${network} deployer: ${address}`);

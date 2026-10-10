// Creates the demo company wallets for a network in .secrets/<network>-companies.json (gitignored, mode 600).
// Never overwrites an existing file: if one exists it just lists the companies in it.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseArgs, type ScriptSpec } from "./lib/args.ts";
import { DEMO_COMPANIES } from "./lib/demo.ts";
import { heading, table } from "./lib/format.ts";
import { SECRETS_DIR, companiesFile, loadCompanies } from "./lib/keys.ts";

const spec: ScriptSpec = {
  name: "wallets.ts",
  summary: "Create the demo company wallets (seven small businesses) for a network. Never overwrites.",
  options: [{ name: "network", type: "string", placeholder: "mainnet|testnet|local", default: "local", description: "Network" }],
  examples: ["node scripts/wallets.ts --network mainnet"],
};

const args = parseArgs(spec);
const network = args.network();
const file = companiesFile(network);
const shown = `.secrets/${network}-companies.json`;

if (existsSync(file)) {
  heading(`Company wallets for ${network} (existing ${shown}, not overwritten)`);
  const companies = loadCompanies(network);
  console.log(table(["Company", "Address"], companies.map((c) => [c.name, c.address])));
} else {
  mkdirSync(SECRETS_DIR, { recursive: true });
  const companies = DEMO_COMPANIES.map((demo) => {
    const privateKey = generatePrivateKey();
    return { name: demo.name, trade: demo.trade, address: privateKeyToAccount(privateKey).address, privateKey };
  });
  const records = companies.map(({ name, address, privateKey }) => ({ name, address, privateKey }));
  writeFileSync(file, JSON.stringify(records, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  heading(`Created ${companies.length} company wallets for ${network} in ${shown}`);
  console.log(table(["Company", "Business", "Address"], companies.map((c) => [c.name, c.trade, c.address])));
  if (network !== "local") {
    console.log(`\n  ${shown} holds these wallets' private keys: keep it, and back it up before funding them.`);
    console.log("  scripts/recover.ts returns their USDC to the deployer when the demo is over.");
  }
  console.log(`\nNext: node scripts/fund.ts --network ${network}`);
}

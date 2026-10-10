// Records a ClearingHouse deployment in core/deployments.ts from a forge broadcast file alone (no RPC needed), e.g.
// after running contracts/script/Deploy.s.sol by hand. Default file:
// contracts/broadcast/Deploy.s.sol/<chain id>/run-latest.json
import { getAddress, type Hex } from "viem";
import { explorerAddress, networks } from "../core/chains.ts";
import { NETWORK_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { broadcastFile, readBroadcast, writeDeployment } from "./lib/deployments.ts";
import { heading, int, nativeUsdc } from "./lib/format.ts";
import { ROOT } from "./lib/keys.ts";

const spec: ScriptSpec = {
  name: "record-deployment.ts",
  summary: "Record the ClearingHouse address and deploy block from a forge broadcast file into core/deployments.ts.",
  options: [
    NETWORK_OPTIONS[0],
    { name: "file", type: "string", placeholder: "path", description: "Broadcast JSON (default: the network's run-latest.json)" },
  ],
  examples: ["node scripts/record-deployment.ts --network mainnet"],
};

const args = parseArgs(spec);
const net = networks[args.network()];
const file = args.get("file") ?? broadcastFile(net.chainId);
const deployed = readBroadcast(file);
if (deployed.chainId && deployed.chainId !== net.chainId) {
  fail(`${file} is for chain id ${deployed.chainId}, not ${net.label} (${net.chainId})`);
}

// Only local entries carry an EURC address (the mock); read it from the constructor arguments forge recorded.
let eurc: Hex | null = null;
if (net.name === "local") {
  const found = deployed.arguments[1]?.match(/0x[0-9a-fA-F]{40}/);
  eurc = found ? getAddress(found[0]) : net.eurc;
}
writeDeployment(net.name, { clearingHouse: deployed.address, eurc, deployBlock: deployed.blockNumber });

heading(`Recorded the ${net.label} deployment`);
console.log(`  From          ${file.startsWith(ROOT) ? file.slice(ROOT.length) : file}`);
console.log(`  ClearingHouse ${deployed.address}`);
console.log(`  Deploy block  ${deployed.blockNumber}`);
console.log(`  Transaction   ${deployed.hash}`);
if (eurc) console.log(`  EURC (mock)   ${eurc}`);
if (deployed.gasUsed) console.log(`  Gas           ${int(deployed.gasUsed)}, ${nativeUsdc(deployed.gasUsed * deployed.effectiveGasPrice)}`);
const link = explorerAddress(net, deployed.address);
if (link) console.log(`  ${link}`);
console.log("  core/deployments.ts updated");

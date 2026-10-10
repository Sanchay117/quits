// Deploys ClearingHouse with Foundry (contracts/script/Deploy.s.sol) and records it in core/deployments.ts.
// The deployer key comes from .secrets/<network>-deployer.json and reaches forge only through --private-key; it is
// never printed (forge's output is redacted too). On Arc Mainnet the script prints the plan, simulates the deploy
// without a key and stops, unless --yes is given; with --yes it sets CONFIRM_MAINNET=yes for the forge script.
import { getAddress, isAddress, type Hex } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { explorerAddress, explorerTx } from "../core/chains.ts";
import { NETWORK_OPTIONS, SEND_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { broadcastFile, readBroadcast, writeDeployment } from "./lib/deployments.ts";
import { runForge } from "./lib/forge.ts";
import { heading, int, nativeUsdc, section } from "./lib/format.ts";
import { deployerPrivateKey, loadDeployer } from "./lib/keys.ts";
import { connect } from "./lib/network.ts";
import { GAS, confirmPlan } from "./lib/plan.ts";
import { GWEI, currentFees, runScript } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "deploy.ts",
  summary: "Deploy ClearingHouse with forge (Deploy.s.sol) and record its address and deploy block.",
  options: [
    ...NETWORK_OPTIONS,
    { name: "eurc", type: "string", placeholder: "address", description: "EURC on a local chain (default: the mock from local-chain.ts)" },
    { name: "no-simulate", type: "boolean", description: "Skip the keyless forge simulation shown before a mainnet broadcast" },
    ...SEND_OPTIONS,
  ],
  examples: [
    "node scripts/deploy.ts --network testnet",
    "node scripts/deploy.ts --network mainnet          # plan and simulation only",
    "node scripts/deploy.ts --network mainnet --yes    # broadcast",
  ],
};

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  const deployer = loadDeployer(ctx.net.name);

  heading(`Deploying ClearingHouse on ${ctx.net.label}`);
  const env: Record<string, string> = {};
  let eurc: Hex | null = ctx.net.eurc;
  if (ctx.net.name === "local") {
    const given = args.get("eurc");
    if (given !== undefined && !isAddress(given)) fail(`--eurc must be an address, got "${given}"`);
    eurc = given ? getAddress(given) : ctx.net.eurc;
    if (!eurc) fail("No EURC for the local chain: run node scripts/local-chain.ts first, or pass --eurc");
    env.EURC = eurc;
  } else if (args.get("eurc")) {
    fail("--eurc only applies to a local chain: Deploy.s.sol uses Circle's EURC on Arc");
  }
  for (const [label, address] of [["USDC", ctx.net.usdc], ["EURC", eurc]] as const) {
    const code = address ? await ctx.client.getCode({ address }) : undefined;
    if (!code || code === "0x") fail(`${label} has no code at ${address} on ${ctx.net.label}`);
  }

  const fees = await currentFees(ctx);
  const balance = await ctx.client.getBalance({ address: deployer.address });
  // forge sets the gas limit to 130% of its estimate (which comes out near 2.86M) and wants that much at the fee cap.
  const upfront = ((GAS.deploy * 13n) / 10n) * fees.maxFeePerGas;
  console.log(`  Deployer ${deployer.address} (${deployer.source}) holds ${nativeUsdc(balance)}`);
  console.log(`  Constructor: ClearingHouse(${ctx.net.usdc}, [${eurc}])`);
  console.log(`  Fees: max ${fees.maxFeePerGas / GWEI} gwei, tip ${fees.maxPriorityFeePerGas / GWEI} gwei (current base fee ${fees.baseFee / GWEI} gwei)`);
  if (ctx.net.clearingHouse) console.log(`  Note: core/deployments.ts already records ${ctx.net.clearingHouse} for ${ctx.net.name}; a new deploy replaces it.`);

  const feeArgs = ["--with-gas-price", fees.maxFeePerGas.toString(), "--priority-gas-price", fees.maxPriorityFeePerGas.toString()];
  const scriptArgs = ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", ctx.net.rpcUrl, ...feeArgs];
  const planOnly = ctx.dryRun || (ctx.mainnet && !ctx.yes);
  if (planOnly && !args.flag("no-simulate")) {
    section("Simulation (no key, nothing sent)");
    const sim = await runForge([...scriptArgs, "--sender", deployer.address]);
    if (sim.code !== 0) fail("The forge simulation failed; see its output above");
  }

  const go = confirmPlan(ctx, {
    title: "deploy ClearingHouse",
    txCount: 1,
    gas: GAS.deploy,
    notes: [
      `Measured deploy gas ${int(GAS.deploy)}; the deployer needs up to ${nativeUsdc(upfront)} at the fee cap`,
      ...(balance < upfront ? [`The deployer holds only ${nativeUsdc(balance)}: fund ${deployer.address} first`] : []),
    ],
  });
  if (!go) return;
  if (balance < upfront) fail(`The deployer holds ${nativeUsdc(balance)} but needs up to ${nativeUsdc(upfront)}`);

  section("Broadcasting with forge");
  if (ctx.mainnet) env.CONFIRM_MAINNET = "yes";
  const key = deployerPrivateKey(ctx.net.name);
  const run = await runForge([...scriptArgs, "--private-key", key, "--broadcast"], { env, secrets: [key] });
  if (run.code !== 0) fail("forge script failed; see its output above");

  const deployed = readBroadcast(broadcastFile(ctx.net.chainId));
  const receipt = await ctx.client.getTransactionReceipt({ hash: deployed.hash });
  ctx.ledger.add("Deploy ClearingHouse", receipt);
  const usdc = await ctx.client.readContract({ address: deployed.address, abi: clearingHouseAbi, functionName: "usdc" });
  if (usdc.toLowerCase() !== ctx.net.usdc.toLowerCase()) fail(`The contract at ${deployed.address} does not report Arc's USDC`);
  writeDeployment(ctx.net.name, {
    clearingHouse: deployed.address,
    eurc: ctx.net.name === "local" ? eurc : null,
    deployBlock: Number(receipt.blockNumber),
  });

  section("Deployed");
  console.log(`  ClearingHouse ${deployed.address}`);
  console.log(`  Block ${receipt.blockNumber}, tx ${deployed.hash}`);
  const links = [explorerAddress(ctx.net, deployed.address), explorerTx(ctx.net, deployed.hash)].filter(Boolean);
  for (const link of links) console.log(`  ${link}`);
  console.log(`  Recorded in core/deployments.ts (${ctx.net.name})`);
  ctx.ledger.print(ctx);
  if (ctx.net.name !== "local") console.log(`\nNext: node scripts/verify.ts --network ${ctx.net.name}`);
});

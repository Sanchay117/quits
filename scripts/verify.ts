// Verifies the deployed ClearingHouse source on Sourcify (Arc Mainnet 5042 and Arc Testnet 5042002 are supported;
// no API key needed) with `forge verify-contract --verifier sourcify`. The constructor arguments are read back from
// the contract itself (usdc and supportedTokens), so they match what was deployed.
import { encodeAbiParameters, getAddress, isAddress, type Hex } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { explorerAddress } from "../core/chains.ts";
import { NETWORK_OPTIONS, fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { runForge } from "./lib/forge.ts";
import { heading, section } from "./lib/format.ts";
import { connect, requireClearingHouse } from "./lib/network.ts";
import { runScript } from "./lib/tx.ts";

const SOURCIFY_CHAINS = [5042, 5_042_002];

const spec: ScriptSpec = {
  name: "verify.ts",
  summary: "Verify the deployed ClearingHouse on Sourcify (Arc Mainnet or Testnet).",
  options: [
    ...NETWORK_OPTIONS,
    { name: "address", type: "string", placeholder: "address", description: "Contract to verify (default: the recorded deployment)" },
    { name: "dry-run", type: "boolean", description: "Print the forge command without running it" },
  ],
  examples: ["node scripts/verify.ts --network mainnet"],
};

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connect(args);
  if (!SOURCIFY_CHAINS.includes(ctx.net.chainId)) fail(`Sourcify verification is for Arc Mainnet or Testnet, not ${ctx.net.label}`);
  const given = args.get("address");
  if (given !== undefined && !isAddress(given)) fail(`--address must be an address, got "${given}"`);
  const address: Hex = given ? getAddress(given) : requireClearingHouse(ctx);

  heading(`Verifying ${address} on Sourcify (${ctx.net.label})`);
  const code = await ctx.client.getCode({ address });
  if (!code || code === "0x") fail(`No contract at ${address} on ${ctx.net.label}`);
  const contract = { address, abi: clearingHouseAbi } as const;
  const [usdc, tokens] = await Promise.all([
    ctx.client.readContract({ ...contract, functionName: "usdc" }),
    ctx.client.readContract({ ...contract, functionName: "supportedTokens" }),
  ]);
  // The constructor adds usdc first, then every other token in order, so supportedTokens() replays its arguments.
  if (tokens[0]?.toLowerCase() !== usdc.toLowerCase()) fail("Unexpected supportedTokens(): the first entry should be USDC");
  const others = tokens.slice(1);
  const constructorArgs = encodeAbiParameters([{ type: "address" }, { type: "address[]" }], [usdc, others]);
  console.log(`  Constructor: ClearingHouse(${usdc}, [${others.join(", ")}])`);

  const forgeArgs = [
    "verify-contract",
    address,
    "src/ClearingHouse.sol:ClearingHouse",
    "--chain",
    String(ctx.net.chainId),
    "--verifier",
    "sourcify",
    "--constructor-args",
    constructorArgs,
    "--watch",
  ];
  if (args.flag("dry-run")) {
    console.log(`\n  cd contracts && forge ${forgeArgs.join(" ")}`);
    console.log("\nDry run: nothing submitted.");
    return;
  }
  section("forge verify-contract");
  const run = await runForge(forgeArgs);
  if (run.code !== 0) fail("Verification failed; see forge's output above");

  section("Verified");
  console.log(`  Sourcify: https://repo.sourcify.dev/${ctx.net.chainId}/${address}`);
  const link = explorerAddress(ctx.net, address);
  if (link) console.log(`  Explorer: ${link}`);
});

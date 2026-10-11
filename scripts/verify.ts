// Verifies the deployed ClearingHouse source on Sourcify and on Arc's Blockscout explorer (Arc Mainnet 5042 and Testnet 5042002;
// no API key needed) with `forge verify-contract`. The constructor arguments are read back from
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
  summary: "Verify the deployed ClearingHouse on Sourcify and Arc Explorer (Arc Mainnet or Testnet).",
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

  // Sourcify first, then Arc's own explorer (Blockscout), so reviewers see the source wherever they click.
  const verifiers: { label: string; flags: string[] }[] = [
    { label: "Sourcify", flags: ["--verifier", "sourcify"] },
    ...(ctx.net.explorer
      ? [{ label: "Arc Explorer (Blockscout)", flags: ["--verifier", "blockscout", "--verifier-url", `${ctx.net.explorer}/api/`] }]
      : []),
  ];
  const commands = verifiers.map((v) => ({
    label: v.label,
    args: [
      "verify-contract",
      address,
      "src/ClearingHouse.sol:ClearingHouse",
      "--chain",
      String(ctx.net.chainId),
      ...v.flags,
      "--constructor-args",
      constructorArgs,
      "--watch",
    ],
  }));
  if (args.flag("dry-run")) {
    for (const c of commands) console.log(`\n  cd contracts && forge ${c.args.join(" ")}`);
    console.log("\nDry run: nothing submitted.");
    return;
  }
  for (const [i, c] of commands.entries()) {
    section(`forge verify-contract: ${c.label}`);
    const run = await runForge(c.args);
    if (run.code === 0) continue;
    // Sourcify is the source of truth. Arc's mainnet explorer API sits behind a Cloudflare challenge that blocks
    // scripts, but the explorer imports verified sources by itself, so its failure is only a warning.
    if (i === 0) fail(`${c.label} verification failed; see forge's output above`);
    console.log(`  ${c.label} did not accept the request (often a Cloudflare check); it picks up the Sourcify match by itself.`);
  }

  section("Verified");
  console.log(`  Sourcify: https://repo.sourcify.dev/${ctx.net.chainId}/${address}`);
  const link = explorerAddress(ctx.net, address);
  if (link) console.log(`  Explorer: ${link}`);
});

// Prepares a running anvil for Arc semantics and deploys a fresh clearing house on it:
//  - etches a mock of Arc's USDC ERC-20 view at 0x3600...0000 (blocklist, 6 decimals, balances mirror native USDC),
//  - etches Multicall3 at 0xcA11... (code copied from Arc mainnet, so loadState's batched reads work),
//  - deploys a mock EURC (6-decimal FiatToken with permit and a blocklist) and ClearingHouse(USDC, [EURC]),
//  - records the addresses and the deploy block in core/deployments.ts (local entry only).
// Start anvil first: anvil --chain-id 31337
import { createPublicClient, createTestClient, encodeDeployData, getAddress, http, type Hex } from "viem";
import { clearingHouseAbi } from "../core/abi.ts";
import { networks } from "../core/chains.ts";
import { ANY_SOLVER } from "../core/state.ts";
import { fail, parseArgs, type ScriptSpec } from "./lib/args.ts";
import { forgeBuild, readArtifact } from "./lib/artifacts.ts";
import { writeDeployment } from "./lib/deployments.ts";
import { heading, section, table } from "./lib/format.ts";
import { loadDeployer } from "./lib/keys.ts";
import { connectTo } from "./lib/network.ts";
import { runScript, sendTx } from "./lib/tx.ts";

const spec: ScriptSpec = {
  name: "local-chain.ts",
  summary: "Prepare a running anvil (chain id 31337) like Arc and deploy a fresh clearing house on it.",
  options: [
    { name: "rpc", type: "string", placeholder: "url", description: "anvil RPC URL", default: networks.local.rpcUrl },
    { name: "no-build", type: "boolean", description: "Skip forge build and use the existing artifacts" },
    {
      name: "artifacts",
      type: "string",
      placeholder: "dir",
      description: "Build contracts/src into this directory (own forge cache) and deploy from it, instead of contracts/out",
    },
  ],
  examples: ["anvil --chain-id 31337 &", "node scripts/local-chain.ts", "node scripts/local-chain.ts --artifacts /tmp/quits-out"],
};

runScript(async () => {
  const args = parseArgs(spec);
  const ctx = await connectTo("local", args.get("rpc"));
  heading(`Local chain at ${ctx.net.rpcUrl}`);
  const test = createTestClient({ mode: "anvil", chain: ctx.chain, transport: http(ctx.net.rpcUrl) });

  const outDir = args.get("artifacts");
  if (!args.flag("no-build")) {
    section(`Building contracts${outDir ? ` into ${outDir}` : ""}`);
    await forgeBuild(outDir);
  }
  const usdcMock = readArtifact("MockArcUSDC.sol", "MockArcUSDC", outDir);
  const fiatToken = readArtifact("MockFiatToken.sol", "MockFiatToken", outDir);
  const house = readArtifact("ClearingHouse.sol", "ClearingHouse", outDir);
  if (!house.abi.some((item) => item.type === "function" && item.name === "setSolver")) {
    fail("The ClearingHouse artifact predates solver consent (no setSolver): rebuild it, or drop --no-build");
  }
  if (JSON.stringify(house.abi) !== JSON.stringify(clearingHouseAbi)) {
    console.log("  Warning: core/abi.ts differs from this build's ABI. Regenerate it: node scripts/export-abi.ts");
  }

  section("Arc predeploys");
  await test.setCode({ address: ctx.net.usdc, bytecode: usdcMock.deployedBytecode });
  console.log(`  USDC view   ${ctx.net.usdc}  mock etched (blocklist, 6 decimals, balances mirror native USDC)`);
  const existing = await ctx.client.getCode({ address: ctx.net.multicall3 });
  if (existing && existing !== "0x") {
    console.log(`  Multicall3  ${ctx.net.multicall3}  already present`);
  } else {
    const code = await multicall3Code();
    await test.setCode({ address: ctx.net.multicall3, bytecode: code.bytecode });
    console.log(`  Multicall3  ${ctx.net.multicall3}  etched (code copied from ${code.from})`);
  }
  console.log("  Memo and Multicall3From do not exist here: scripts send one plain transaction per call instead.");

  const deployer = loadDeployer("local");
  section(`Deploying from ${deployer.address} (${deployer.source})`);
  const eurcReceipt = await sendTx(ctx, {
    from: deployer,
    data: encodeDeployData({ abi: fiatToken.abi, bytecode: fiatToken.bytecode, args: ["EURC", "EURC"] }),
    label: "Deploy mock EURC (MockFiatToken)",
  });
  const eurc = getAddress(eurcReceipt.contractAddress!);
  const houseReceipt = await sendTx(ctx, {
    from: deployer,
    data: encodeDeployData({ abi: house.abi, bytecode: house.bytecode, args: [ctx.net.usdc, [eurc]] }),
    label: "Deploy ClearingHouse(USDC, [EURC])",
  });
  const clearingHouse = getAddress(houseReceipt.contractAddress!);

  // The ABI in core/abi.ts must match what was deployed: these reads use it, including the consent view.
  const [usdc, tokens] = await Promise.all([
    ctx.client.readContract({ address: clearingHouse, abi: clearingHouseAbi, functionName: "usdc" }),
    ctx.client.readContract({ address: clearingHouse, abi: clearingHouseAbi, functionName: "supportedTokens" }),
    ctx.client.readContract({ address: clearingHouse, abi: clearingHouseAbi, functionName: "isSolverFor", args: [deployer.address, ANY_SOLVER] }),
  ]);
  if (usdc.toLowerCase() !== ctx.net.usdc.toLowerCase() || tokens.length !== 2) fail("The deployed clearing house does not report the expected tokens");

  const deployBlock = Number(houseReceipt.blockNumber);
  writeDeployment("local", { clearingHouse, eurc, deployBlock });

  section("Recorded in core/deployments.ts (local)");
  console.log(
    table(
      ["Contract", "Address"],
      [
        ["ClearingHouse", clearingHouse],
        ["EURC (mock)", eurc],
        ["USDC (mock view)", ctx.net.usdc],
        ["Multicall3", ctx.net.multicall3],
      ],
    ),
  );
  console.log(`  Deploy block: ${deployBlock}`);
  ctx.ledger.print(ctx);
  section("Next");
  console.log("  node scripts/wallets.ts && node scripts/fund.ts && node scripts/seed.ts && node scripts/cycle.ts");
});

/** Multicall3's runtime code, copied from Arc (mainnet first, then testnet). */
async function multicall3Code(): Promise<{ bytecode: Hex; from: string }> {
  for (const net of [networks.mainnet, networks.testnet]) {
    try {
      const client = createPublicClient({ transport: http(net.rpcUrl, { timeout: 15_000 }) });
      const bytecode = await client.getCode({ address: net.multicall3 });
      if (bytecode && bytecode !== "0x") return { bytecode, from: net.label };
    } catch {
      // try the next network
    }
  }
  fail("Could not copy Multicall3 from Arc (no network?). Without it loadState cannot batch reads on this chain.");
}

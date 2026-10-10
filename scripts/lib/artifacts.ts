// Foundry build artifacts (contracts/out by default), read after `forge build`.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi, Hex } from "viem";
import { fail } from "./args.ts";
import { CONTRACTS_DIR } from "./deployments.ts";
import { runForge } from "./forge.ts";

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
}

export const DEFAULT_OUT_DIR = `${CONTRACTS_DIR}/out`;

export function readArtifact(sourceFile: string, contract: string, outDir = DEFAULT_OUT_DIR): Artifact {
  const file = `${outDir}/${sourceFile}/${contract}.json`;
  if (!existsSync(file)) fail(`Missing build artifact ${file}: run forge build in contracts/ (or drop --no-build)`);
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: { object: Hex };
  };
  return { abi: json.abi, bytecode: json.bytecode.object, deployedBytecode: json.deployedBytecode.object };
}

/**
 * `forge build` (incremental, so cheap when nothing changed). With `outDir`, only contracts/src is compiled, into that
 * directory and with its own cache next to it, so contracts/out and contracts/cache are left alone.
 */
export async function forgeBuild(outDir?: string): Promise<void> {
  const args = outDir ? ["build", "src", "--out", resolve(outDir), "--cache-path", `${resolve(outDir)}-cache`] : ["build"];
  const result = await runForge(args, { quiet: true });
  if (result.code !== 0) {
    console.error(result.output);
    fail("forge build failed");
  }
}

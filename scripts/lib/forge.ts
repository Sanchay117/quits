// Runs Foundry in contracts/, streaming its output line by line with any secret (the deployer key) redacted, both
// in the echoed command and in whatever forge prints.
import { spawn } from "node:child_process";
import { CONTRACTS_DIR } from "./deployments.ts";

export interface ForgeResult {
  code: number;
  output: string;
}

export interface ForgeOptions {
  env?: Record<string, string>;
  /** Strings to replace with <redacted> wherever they appear. */
  secrets?: string[];
  /** Do not echo forge's output (it is still returned). */
  quiet?: boolean;
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const bare = secret.startsWith("0x") ? secret.slice(2) : secret;
    out = out.split(secret).join("<redacted>").split(bare).join("<redacted>");
  }
  return out;
}

export function runForge(args: string[], options: ForgeOptions = {}): Promise<ForgeResult> {
  const secrets = options.secrets ?? [];
  console.log(`  $ ${redact(["forge", ...args].join(" "), secrets)}   (in contracts/)`);
  return new Promise((resolve, reject) => {
    const child = spawn("forge", args, {
      cwd: CONTRACTS_DIR,
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const pending = { out: "", err: "" };
    const emit = (line: string, stream: "out" | "err") => {
      const clean = redact(line, secrets);
      output += clean + "\n";
      if (!options.quiet) (stream === "out" ? process.stdout : process.stderr).write(`    ${clean}\n`);
    };
    const onData = (stream: "out" | "err") => (chunk: Buffer) => {
      pending[stream] += chunk.toString("utf8");
      const lines = pending[stream].split(/\r?\n/);
      pending[stream] = lines.pop() ?? "";
      for (const line of lines) emit(line, stream);
    };
    child.stdout.on("data", onData("out"));
    child.stderr.on("data", onData("err"));
    child.on("error", (err) => reject(new Error(`Could not run forge (is Foundry installed?): ${err.message}`)));
    child.on("close", (code) => {
      if (pending.out) emit(pending.out, "out");
      if (pending.err) emit(pending.err, "err");
      resolve({ code: code ?? 1, output });
    });
  });
}

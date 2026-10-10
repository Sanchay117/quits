// Command-line parsing shared by every script: `--name value`, `--name=value` and boolean `--flag`.
// Each script declares its options; unknown options and missing values are errors, and `--help` prints usage.
import type { NetworkName } from "../../core/chains.ts";

export interface OptionSpec {
  name: string;
  /** Boolean options take no value. */
  type: "string" | "boolean";
  description: string;
  /** Shown in the usage text. */
  placeholder?: string;
  default?: string;
}

export interface ScriptSpec {
  /** Script file name, e.g. "seed.ts". */
  name: string;
  summary: string;
  options: OptionSpec[];
  /** Extra usage lines printed under the summary. */
  examples?: string[];
}

/** Options every network script understands. */
export const NETWORK_OPTIONS: OptionSpec[] = [
  { name: "network", type: "string", placeholder: "mainnet|testnet|local", default: "local", description: "Network to use" },
  { name: "rpc", type: "string", placeholder: "url", description: "Override the network's RPC URL" },
];

/** Options of scripts that send transactions. */
export const SEND_OPTIONS: OptionSpec[] = [
  { name: "yes", type: "boolean", description: "Required to broadcast on Arc Mainnet (after reading the printed plan)" },
  { name: "dry-run", type: "boolean", description: "Print the plan and the estimated cost, send nothing" },
];

export class Args {
  readonly spec: ScriptSpec;
  private readonly values: Map<string, string | boolean>;

  constructor(spec: ScriptSpec, values: Map<string, string | boolean>) {
    this.spec = spec;
    this.values = values;
  }

  /** A string option, or its default, or undefined. */
  get(name: string): string | undefined {
    this.known(name);
    const value = this.values.get(name);
    if (typeof value === "string") return value;
    return this.spec.options.find((o) => o.name === name)?.default;
  }

  flag(name: string): boolean {
    this.known(name);
    return this.values.get(name) === true;
  }

  network(): NetworkName {
    const value = this.get("network") ?? "local";
    if (value !== "mainnet" && value !== "testnet" && value !== "local") {
      fail(`Unknown network "${value}". Use mainnet, testnet or local.`);
    }
    return value;
  }

  /** A positive integer option. */
  int(name: string): number | undefined {
    const raw = this.get(name);
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw)) fail(`--${name} must be a whole number, got "${raw}"`);
    return Number(raw);
  }

  private known(name: string): void {
    if (!this.spec.options.some((o) => o.name === name)) throw new Error(`Script bug: option --${name} is not declared`);
  }
}

export function parseArgs(spec: ScriptSpec, argv: string[] = process.argv.slice(2)): Args {
  const values = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log(usage(spec));
      process.exit(0);
    }
    if (!token.startsWith("--")) fail(`Unexpected argument "${token}"\n\n${usage(spec)}`);
    const eq = token.indexOf("=");
    const name = eq > 0 ? token.slice(2, eq) : token.slice(2);
    const option = spec.options.find((o) => o.name === name);
    if (!option) fail(`Unknown option --${name}\n\n${usage(spec)}`);
    if (option.type === "boolean") {
      if (eq > 0) fail(`--${name} takes no value`);
      values.set(name, true);
      continue;
    }
    const value = eq > 0 ? token.slice(eq + 1) : argv[++i];
    if (value === undefined || (eq < 0 && value.startsWith("--"))) fail(`--${name} needs a value`);
    values.set(name, value);
  }
  return new Args(spec, values);
}

export function usage(spec: ScriptSpec): string {
  const lines = [`Usage: node scripts/${spec.name} [options]`, "", spec.summary, ""];
  const width = Math.max(...spec.options.map((o) => optionLabel(o).length), 6) + 2;
  for (const o of spec.options) {
    const def = o.default !== undefined ? ` (default ${o.default})` : "";
    lines.push(`  ${optionLabel(o).padEnd(width)}${o.description}${def}`);
  }
  lines.push(`  ${"--help".padEnd(width)}Show this help`);
  if (spec.examples?.length) lines.push("", "Examples:", ...spec.examples.map((e) => `  ${e}`));
  return lines.join("\n");
}

function optionLabel(o: OptionSpec): string {
  return o.type === "boolean" ? `--${o.name}` : `--${o.name} <${o.placeholder ?? "value"}>`;
}

/** Print a message and exit with status 1. */
export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

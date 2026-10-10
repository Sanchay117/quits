// Network selection and viem clients. The viem chain is built with defineChain from core/chains.ts, so the scripts,
// the app and the deploy tooling share one source of network constants.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import { networks, type ArcNetwork, type Hex, type NetworkName } from "../../core/chains.ts";
import { loadState, type ChainState, type LoadStateOptions } from "../../core/state.ts";
import { fail, type Args } from "./args.ts";
import { GasLedger, track } from "./tx.ts";
import type { Signer } from "./keys.ts";

export interface Context {
  net: ArcNetwork;
  chain: Chain;
  client: PublicClient;
  /** True on Arc mainnet: every broadcast needs --yes. */
  mainnet: boolean;
  /** --yes was given. */
  yes: boolean;
  /** --dry-run was given: plan only. */
  dryRun: boolean;
  ledger: GasLedger;
}

export function arcChain(net: ArcNetwork): Chain {
  return defineChain({
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: net.explorer ? { default: { name: "Arcscan", url: net.explorer } } : undefined,
    contracts: { multicall3: { address: net.multicall3 } },
  });
}

/** Resolve --network/--rpc (and --yes/--dry-run when the script declares them), connect, and check the chain id. */
export async function connect(args: Args): Promise<Context> {
  const declared = (o: string) => args.spec.options.some((opt) => opt.name === o);
  return connectTo(args.network(), args.get("rpc"), {
    yes: declared("yes") && args.flag("yes"),
    dryRun: declared("dry-run") && args.flag("dry-run"),
  });
}

export async function connectTo(
  name: NetworkName,
  rpc: string | undefined,
  flags: { yes: boolean; dryRun: boolean } = { yes: false, dryRun: false },
): Promise<Context> {
  const net: ArcNetwork = { ...networks[name], ...(rpc ? { rpcUrl: rpc } : {}) };
  const chain = arcChain(net);
  const client = createPublicClient({ chain, transport: http(net.rpcUrl, { retryCount: 2, timeout: 30_000 }) }) as PublicClient;
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    if (name === "local") fail(`No node at ${net.rpcUrl}. Start one with: anvil --chain-id 31337`);
    fail(`Cannot reach ${net.label} at ${net.rpcUrl}`);
  }
  if (chainId !== net.chainId) fail(`${net.rpcUrl} serves chain id ${chainId}, expected ${net.chainId} for ${net.label}`);
  return track({ net, chain, client, mainnet: name === "mainnet", ...flags, ledger: new GasLedger() });
}

export function walletFor(ctx: Context, signer: Signer): WalletClient<Transport, Chain, Account> {
  return createWalletClient({ account: signer.account, chain: ctx.chain, transport: http(ctx.net.rpcUrl, { timeout: 30_000 }) });
}

export function requireClearingHouse(ctx: Context): Hex {
  if (!ctx.net.clearingHouse) {
    const hint =
      ctx.net.name === "local"
        ? "Run: node scripts/local-chain.ts"
        : `Deploy it with: node scripts/deploy.ts --network ${ctx.net.name}`;
    fail(`No clearing house recorded for ${ctx.net.label} in core/deployments.ts. ${hint}`);
  }
  return ctx.net.clearingHouse;
}

/**
 * core/state.ts loadState, with a clear message when the recorded contract is missing (e.g. anvil was restarted).
 * Pass `opts.submitter` (the account that will send settle()) so Member.drawableBySubmitter, and with it the solver's
 * liquidity, reflects whose deposits that account may draw on.
 */
export async function readState(ctx: Context, opts: LoadStateOptions = {}): Promise<ChainState> {
  const address = requireClearingHouse(ctx);
  const code = await ctx.client.getCode({ address });
  if (!code || code === "0x") {
    const hint = ctx.net.name === "local" ? " (was anvil restarted? run node scripts/local-chain.ts again)" : "";
    fail(`No contract at ${address} on ${ctx.net.label}${hint}`);
  }
  try {
    return await loadState(ctx.client, ctx.net, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    fail(
      `Could not read the clearing house at ${address} on ${ctx.net.label}: ${message}\n` +
        "  If it was deployed from an older build (before setSolver), deploy the current contract again.",
    );
  }
}

export function tokenSymbol(ctx: Context, token: string): string {
  const t = token.toLowerCase();
  if (t === ctx.net.usdc.toLowerCase()) return "USDC";
  if (ctx.net.eurc && t === ctx.net.eurc.toLowerCase()) return "EURC";
  return token;
}

/** --token usdc|eurc|0x... to an address. */
export function resolveToken(ctx: Context, value: string | undefined): Hex {
  const v = (value ?? "usdc").toLowerCase();
  if (v === "usdc") return ctx.net.usdc;
  if (v === "eurc") {
    if (!ctx.net.eurc) fail(`No EURC address known for ${ctx.net.label}`);
    return ctx.net.eurc;
  }
  if (/^0x[0-9a-f]{40}$/.test(v)) return value as Hex;
  fail(`--token must be usdc, eurc or an address, got "${value}"`);
}

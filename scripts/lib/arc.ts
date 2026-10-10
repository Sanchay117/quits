// Arc predeploys used by the scripts: Multicall3From batches several calls from one EOA into one transaction (each
// call still runs with the EOA as msg.sender), and Memo wraps a call with an indexed reference. On a local anvil chain
// both are absent (null in core/chains.ts) and the helpers fall back to one plain transaction per call.
import { encodeFunctionData, erc20Abi, stringToHex, type Hex, type TransactionReceipt } from "viem";
import type { ArcNetwork } from "../../core/chains.ts";
import type { Signer } from "./keys.ts";
import type { Context } from "./network.ts";
import { sendTx } from "./tx.ts";

export const multicall3FromAbi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export const memoAbi = [
  {
    type: "function",
    name: "memo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "memoId", type: "bytes32" },
      { name: "memoData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** One contract call, with a short label for the console. */
export interface Call {
  to: Hex;
  data: Hex;
  label: string;
}

/** Calldata for Multicall3From.aggregate3 with every call required to succeed (the batch is all or nothing). */
export function aggregate3Data(calls: Call[]): Hex {
  return encodeFunctionData({
    abi: multicall3FromAbi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.to, allowFailure: false, callData: c.data }))],
  });
}

/**
 * Send `calls` from one EOA, in order. On Arc several calls go out as a single Multicall3From transaction; a single
 * call, or any call on a network without the predeploy, is sent directly.
 */
export async function sendCalls(
  ctx: Context,
  from: Signer,
  calls: Call[],
  label: string,
  onReceipt?: (receipt: TransactionReceipt) => void,
): Promise<TransactionReceipt[]> {
  if (calls.length === 0) return [];
  const batcher = ctx.net.multicall3From;
  if (batcher && calls.length > 1) {
    const receipt = await sendTx(ctx, {
      from,
      to: batcher,
      data: aggregate3Data(calls),
      label: `${label}: ${calls.map((c) => c.label).join(", ")} (${calls.length} calls, one Multicall3From transaction)`,
    });
    onReceipt?.(receipt);
    return [receipt];
  }
  const receipts: TransactionReceipt[] = [];
  for (const call of calls) {
    const receipt = await sendTx(ctx, { from, to: call.to, data: call.data, label: `${label}: ${call.label}` });
    onReceipt?.(receipt);
    receipts.push(receipt);
  }
  return receipts;
}

/** Wrap a call in Arc's Memo predeploy: the call runs as the sender and the memo is indexed under `memoId`. */
export function viaMemo(net: ArcNetwork, call: Call, memoId: Hex, memoText: string): Call {
  if (!net.memo) throw new Error(`${net.label} has no Memo predeploy`);
  return {
    to: net.memo,
    data: encodeFunctionData({ abi: memoAbi, functionName: "memo", args: [call.to, call.data, memoId, stringToHex(memoText)] }),
    label: `${call.label} (through the Memo predeploy)`,
  };
}

/** USDC moved through its ERC-20 interface (6-decimal units), as Multicall3From needs: it cannot forward value. */
export function usdcTransferCall(net: ArcNetwork, to: Hex, units: bigint, label: string): Call {
  return { to: net.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, units] }), label };
}

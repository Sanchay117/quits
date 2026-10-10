// One transaction flow per form: connect, switch chain, simulate, sign, wait, then refresh the chain state.
import { useCallback, useState } from "react";
import type { ActionContext } from "./actions.ts";
import { refreshChain } from "./chainState.ts";
import { activeNetwork, publicClient } from "./network.ts";
import { describeError, type Report, type TxProgress } from "./tx.ts";
import { walletSession } from "./wallet.ts";

/** An action returns an optional success message, e.g. "Invoice #12 issued.". */
export type TxAction = (ctx: ActionContext, report: Report) => Promise<string | void>;

export interface TxHandle {
  progress: TxProgress;
  busy: boolean;
  run: (label: string, action: TxAction) => Promise<boolean>;
  reset: () => void;
}

export function useTx(): TxHandle {
  const [progress, setProgress] = useState<TxProgress>({ phase: "idle" });

  const run = useCallback(async (label: string, action: TxAction) => {
    const report: Report = (update) => setProgress((current) => ({ ...current, ...update }));
    setProgress({ phase: "preparing", label });
    try {
      const { account, client } = await walletSession();
      const message = await action({ account, wallet: client, publicClient, net: activeNetwork }, report);
      setProgress((current) => ({ ...current, phase: "success", message: message || undefined }));
      void refreshChain();
      return true;
    } catch (err) {
      setProgress((current) => ({ ...current, phase: "error", message: describeError(err) }));
      return false;
    }
  }, []);

  const reset = useCallback(() => setProgress({ phase: "idle" }), []);
  const busy = progress.phase === "preparing" || progress.phase === "signing" || progress.phase === "pending";
  return { progress, busy, run, reset };
}

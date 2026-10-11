// One transaction flow per form: connect, switch chain, simulate, sign, wait, then refresh the chain state.
import { useCallback, useState } from "react";
import type { ActionContext } from "./actions.ts";
import { refreshChain } from "./chainState.ts";
import { activeNetwork, publicClient } from "./network.ts";
import { READ_ONLY_MESSAGE, useReadOnly } from "./readOnly.ts";
import { describeError, type Report, type TxProgress } from "./tx.ts";
import { walletSession } from "./wallet.ts";

/** An action returns an optional success message, e.g. "Invoice #12 issued.". */
export type TxAction = (ctx: ActionContext, report: Report) => Promise<string | void>;

export interface TxHandle {
  progress: TxProgress;
  /** A transaction of this form is being prepared, signed or mined. */
  busy: boolean;
  /** Write controls are off: busy, or the page is a read-only "view as" page. */
  disabled: boolean;
  run: (label: string, action: TxAction) => Promise<boolean>;
  reset: () => void;
}

export function useTx(): TxHandle {
  const readOnly = useReadOnly();
  const [progress, setProgress] = useState<TxProgress>({ phase: "idle" });

  const run = useCallback(
    async (label: string, action: TxAction) => {
      if (readOnly) {
        setProgress({ phase: "error", label, message: READ_ONLY_MESSAGE });
        return false;
      }
      // The newest block any of this action's transactions landed in: the state shown afterwards must include it.
      let minedIn: bigint | undefined;
      const report: Report = (update) => {
        if (update.blockNumber !== undefined && (minedIn === undefined || update.blockNumber > minedIn)) {
          minedIn = update.blockNumber;
        }
        setProgress((current) => ({ ...current, ...update }));
      };
      setProgress({ phase: "preparing", label });
      try {
        const { account, client } = await walletSession();
        const message = await action({ account, wallet: client, publicClient, net: activeNetwork }, report);
        setProgress((current) => ({ ...current, phase: "success", message: message || undefined }));
        // A new read, not one already running (it may have started before the transaction was mined).
        void refreshChain({ force: true, atLeastBlock: minedIn });
        return true;
      } catch (err) {
        setProgress((current) => ({ ...current, phase: "error", message: describeError(err) }));
        // A multi-step action can fail after an earlier step was mined (e.g. approve, then deposit).
        if (minedIn !== undefined) void refreshChain({ force: true, atLeastBlock: minedIn });
        return false;
      }
    },
    [readOnly],
  );

  const reset = useCallback(() => setProgress({ phase: "idle" }), []);
  const busy = progress.phase === "preparing" || progress.phase === "signing" || progress.phase === "pending";
  return { progress, busy, disabled: busy || readOnly, run, reset };
}

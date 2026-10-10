// Inline status of a transaction: simulating, waiting for the wallet, pending, final, or failed.
import { explorerTx } from "../../../core/chains.ts";
import { shortAddress } from "../lib/format.ts";
import { activeNetwork } from "../lib/network.ts";
import type { TxProgress } from "../lib/tx.ts";

function phaseText(progress: TxProgress): string {
  switch (progress.phase) {
    case "preparing":
      return "Simulating against the contract…";
    case "signing":
      return "Confirm in your wallet.";
    case "pending":
      return "Submitted. Waiting for the block…";
    case "success":
      return progress.message ?? (progress.blockNumber ? `Final in block ${progress.blockNumber}.` : "Done.");
    case "error":
      return progress.message ?? "Something went wrong.";
    default:
      return "";
  }
}

export function TxStatus({ progress }: { progress: TxProgress }) {
  if (progress.phase === "idle") return null;
  const link = progress.hash ? explorerTx(activeNetwork, progress.hash) : null;
  return (
    <div className={`tx tx--${progress.phase}`} role={progress.phase === "error" ? "alert" : "status"}>
      <span className="tx-dot" aria-hidden="true" />
      <div className="tx-body">
        {progress.label && <strong>{progress.label}</strong>}
        <span>{phaseText(progress)}</span>
        {progress.hash &&
          (link ? (
            <a href={link} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : (
            <code>{shortAddress(progress.hash)}</code>
          ))}
      </div>
    </div>
  );
}

// Netting permissions: who may send cycles that pay this member's net debts from its deposit (setSolver).
import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { clearingHouseAbi } from "../../../../core/abi.ts";
import { ANY_SOLVER, lc, type ChainState } from "../../../../core/state.ts";
import { Empty, Party, Spinner } from "../../components/common.tsx";
import { TxStatus } from "../../components/TxStatus.tsx";
import { setSolver } from "../../lib/actions.ts";
import { approvalCandidates, approvedSolvers, parseSolverAddress, sameAccount } from "../../lib/consent.ts";
import { displayName } from "../../lib/format.ts";
import { activeNetwork, publicClient } from "../../lib/network.ts";
import { useTx } from "../../lib/useTx.ts";

/** isSolverFor(me, solver) read straight from the contract: null while loading, "unknown" if the read failed. */
function useSolverFlag(me: Hex, solver: Hex | null, refreshKey: string): boolean | "unknown" | null {
  const [read, setRead] = useState<{ key: string; value: boolean | "unknown" } | null>(null);
  const key = solver ? `${lc(me)}:${lc(solver)}` : "";
  useEffect(() => {
    const house = activeNetwork.clearingHouse;
    if (!solver || !house) return;
    let cancelled = false;
    publicClient
      .readContract({ address: house, abi: clearingHouseAbi, functionName: "isSolverFor", args: [me, solver] })
      .then(
        (value) => !cancelled && setRead({ key, value }),
        () => !cancelled && setRead({ key, value: "unknown" }),
      );
    return () => {
      cancelled = true;
    };
    // `key` stands for me and solver; refreshKey re-reads after new blocks and after our own transactions.
  }, [key, refreshKey]);
  return read && read.key === key ? read.value : null;
}

type Approvals = { status: "loading" } | { status: "error" } | { status: "ready"; solvers: Hex[] };

/**
 * The candidates `me` has approved, from one multicall of isSolverFor(me, candidate). Re-read with every new block
 * and after our own transactions (refreshKey). The last good list stays visible while a re-read runs.
 */
function useApprovals(me: Hex, candidates: Hex[], refreshKey: string): Approvals {
  const [entry, setEntry] = useState<{ me: string; value: Approvals } | null>(null);
  const candidatesKey = candidates.join(",");
  useEffect(() => {
    const house = activeNetwork.clearingHouse;
    if (!house) return;
    if (candidates.length === 0) {
      setEntry({ me: lc(me), value: { status: "ready", solvers: [] } });
      return;
    }
    let cancelled = false;
    publicClient
      .multicall({
        allowFailure: false,
        multicallAddress: activeNetwork.multicall3,
        contracts: candidates.map((solver) => ({
          address: house,
          abi: clearingHouseAbi,
          functionName: "isSolverFor" as const,
          args: [me, solver] as const,
        })),
      })
      .then(
        (flags) => {
          if (cancelled) return;
          setEntry({ me: lc(me), value: { status: "ready", solvers: approvedSolvers(candidates, flags as boolean[]) } });
        },
        () => !cancelled && setEntry({ me: lc(me), value: { status: "error" } }),
      );
    return () => {
      cancelled = true;
    };
    // candidatesKey stands for `candidates`, which is rebuilt on every render.
  }, [me, candidatesKey, refreshKey]);
  return entry && entry.me === lc(me) ? entry.value : { status: "loading" };
}

const WHY =
  "A cycle can take cash from your deposit only if you send it or approved its sender, so a counterparty cannot " +
  "settle just the debts you owe it and leave out what it owes you.";

export function Permissions({ state, me }: { state: ChainState; me: Hex }) {
  const tx = useTx();
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  /** Solvers approved during this visit, listed even when they are not members. */
  const [approvedHere, setApprovedHere] = useState<Hex[]>([]);
  const refreshKey = `${state.blockNumber}:${version}`;
  const member = state.members[lc(me)];
  const anyFlag = useSolverFlag(me, ANY_SOLVER, refreshKey);
  const anyone = typeof anyFlag === "boolean" ? anyFlag : (member?.allowsAnySolver ?? null);
  const parsed = text.trim() ? parseSolverAddress(text, me) : null;
  const solver = typeof parsed === "string" ? null : parsed;
  const flag = useSolverFlag(me, solver, refreshKey);
  const candidates = useMemo(
    () => approvalCandidates(state, me, [...approvedHere, solver]),
    [state, me, approvedHere, solver],
  );
  const approvals = useApprovals(me, candidates, refreshKey);
  const nameOf = (address: string) => state.members[lc(address)]?.name;

  const change = (label: string, target: Hex, allowed: boolean, done: string) =>
    tx.run(label, async (ctx, report) => {
      if (!sameAccount(ctx.account, me)) throw new Error("Your wallet account changed. Check the page, then try again.");
      await setSolver(ctx, target, allowed, report);
      if (allowed && target !== ANY_SOLVER) setApprovedHere((list) => [...list, target]);
      setVersion((v) => v + 1);
      return done;
    });
  const setAnyone = (allowed: boolean) =>
    change(
      allowed ? "Let anyone settle" : "Stop letting anyone settle",
      ANY_SOLVER,
      allowed,
      allowed
        ? "Anyone may now send cycles that use your deposit."
        : "Only you and the solvers you approved may now send cycles that use your deposit.",
    );
  const approve = (target: Hex, allowed: boolean) => {
    const who = displayName(target, nameOf(target));
    return change(
      `${allowed ? "Approve" : "Revoke"} ${who}`,
      target,
      allowed,
      allowed ? `${who} may now send cycles that use your deposit.` : `${who} may no longer use your deposit.`,
    );
  };

  const fieldNote =
    parsed === null
      ? "Approve only a solver you trust to net your whole book: it picks which of your due debts a cycle includes."
      : typeof parsed === "string"
        ? parsed
        : flag === null
          ? "Checking…"
          : flag === "unknown"
            ? "Could not read its status. Approve or revoke still works."
            : flag
              ? "Approved: it may send cycles that use your deposit."
              : "Not approved.";

  return (
    <section className="card">
      <h2>Netting permissions</h2>
      <p className="muted small">{WHY}</p>

      <div className="permission">
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={anyone === true}
            disabled={anyone === null || tx.disabled}
            onChange={(e) => void setAnyone(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Let anyone settle cycles that use my deposit</span>
        </label>
        <p className="small muted">
          {anyone === null
            ? anyFlag === "unknown"
              ? "Could not read this setting from the node. It will retry with the next block."
              : "Checking…"
            : anyone
              ? "On: any account may send a cycle that pays your due debts from your deposit, and it picks which ones."
              : "Off: only you and the solvers you approve below. Cycles that take no cash from you, such as loops, " +
                "need no approval."}
        </p>
      </div>

      <div className="subsection">
        <h3>Approve a solver</h3>
        <div className="inline-form">
          <label className="field">
            <span>Solver address</span>
            <input
              list="solver-options"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
            />
            <datalist id="solver-options">
              {Object.values(state.members)
                .filter((m) => !sameAccount(m.address, me))
                .map((m) => (
                  <option key={m.address} value={m.address}>
                    {displayName(m.address, m.name)}
                  </option>
                ))}
            </datalist>
            <small className={typeof parsed === "string" ? "field-error" : undefined}>{fieldNote}</small>
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={!solver || flag === true || tx.disabled}
              onClick={() => solver && void approve(solver, true)}
            >
              Approve
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={!solver || flag === false || tx.disabled}
              onClick={() => solver && void approve(solver, false)}
            >
              Revoke
            </button>
          </div>
        </div>
      </div>

      <div className="subsection">
        <h3>Solvers you approved</h3>
        {approvals.status === "loading" ? (
          <Spinner label="Reading your approvals…" />
        ) : approvals.status === "error" ? (
          <p className="small muted">This node could not read your approvals. Check an address above instead.</p>
        ) : approvals.solvers.length === 0 ? (
          <Empty>None. Cycles you send yourself can always use your deposit.</Empty>
        ) : (
          <ul className="solver-list">
            {approvals.solvers.map((address) => (
              <li key={address}>
                <Party address={address} name={nameOf(address)} />
                <button
                  type="button"
                  className="button button--small button--ghost"
                  disabled={tx.disabled}
                  onClick={() => void approve(address, false)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted list-note">
          Checked against every member, every account that has sent a cycle, and any address entered above.
        </p>
      </div>
      <TxStatus progress={tx.progress} />
    </section>
  );
}

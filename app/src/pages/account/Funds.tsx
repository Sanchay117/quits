// Deposits and withdrawals per token. The deposit is what pays the member's net position in a cycle.
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { NATIVE_SCALE } from "../../../../core/chains.ts";
import { lc, type ChainState } from "../../../../core/state.ts";
import { TxStatus } from "../../components/TxStatus.tsx";
import { fiatTokenAbi } from "../../lib/abis.ts";
import { depositToken, depositUsdc, withdraw } from "../../lib/actions.ts";
import { formatMoney, parseAmount } from "../../lib/money.ts";
import { activeNetwork, publicClient } from "../../lib/network.ts";
import { tokensOf, type TokenInfo } from "../../lib/tokens.ts";
import { useTx } from "../../lib/useTx.ts";

/** Native balances carry 18 decimals; this converts to the contract's 6-decimal units, rounding down. */
async function walletBalance(token: TokenInfo, me: Hex): Promise<bigint> {
  if (token.native) return (await publicClient.getBalance({ address: me })) / NATIVE_SCALE;
  const contract = { address: token.address, abi: fiatTokenAbi } as const;
  return publicClient.readContract({ ...contract, functionName: "balanceOf", args: [me] });
}

/** Wallet balance of `token`, re-read whenever a new block's state arrives. */
function useWalletBalance(token: TokenInfo, me: Hex, blockNumber: bigint): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    let cancelled = false;
    walletBalance(token, me).then(
      (value) => !cancelled && setBalance(value),
      () => !cancelled && setBalance(null),
    );
    return () => {
      cancelled = true;
    };
    // A token is identified by its address; the object itself is rebuilt on every render of the parent.
  }, [token.address, me, blockNumber]);
  return balance;
}

export function Funds({ state, me }: { state: ChainState; me: Hex }) {
  return (
    <section className="card">
      <h2>Deposits</h2>
      <p className="muted small">
        A deposit is your consent to pay matured, accepted debts from it, and only ever your net position in a cycle.
        Withdraw what you do not need at any time.
      </p>
      <div className="funds">
        {tokensOf(activeNetwork).map((token) => (
          <TokenFunds key={token.symbol} token={token} state={state} me={me} />
        ))}
      </div>
    </section>
  );
}

function TokenFunds({ token, state, me }: { token: TokenInfo; state: ChainState; me: Hex }) {
  const deposited = state.members[lc(me)]?.balances[lc(token.address)] ?? 0n;
  const inWallet = useWalletBalance(token, me, state.blockNumber);
  const [text, setText] = useState("");
  const tx = useTx();
  const amount = parseAmount(text);
  const valid = amount !== null && amount > 0n;

  const onDeposit = () =>
    tx.run(`Deposit ${token.symbol}`, async (ctx, report) => {
      if (token.native) await depositUsdc(ctx, amount!, report);
      else await depositToken(ctx, token.address, amount!, report);
      setText("");
      return `Deposited ${formatMoney(amount!, token.symbol)}.`;
    });
  const onWithdraw = () =>
    tx.run(`Withdraw ${token.symbol}`, async (ctx, report) => {
      await withdraw(ctx, token.address, amount!, report);
      setText("");
      return `Withdrew ${formatMoney(amount!, token.symbol)} to your wallet.`;
    });

  return (
    <div className="token-funds">
      <div className="token-funds-head">
        <h3>{token.symbol}</h3>
        <dl>
          <div>
            <dt>Deposited</dt>
            <dd>{formatMoney(deposited, token.symbol, { precise: true })}</dd>
          </div>
          <div>
            <dt>In wallet</dt>
            <dd>{inWallet === null ? "…" : formatMoney(inWallet, token.symbol, { precise: true })}</dd>
          </div>
        </dl>
      </div>
      <label className="field">
        <span>Amount</span>
        <input inputMode="decimal" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
        {text && !valid && <small className="field-error">Up to 6 decimals, more than zero.</small>}
      </label>
      <div className="button-row">
        <button type="button" className="button" disabled={!valid || tx.busy} onClick={() => void onDeposit()}>
          Deposit
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={!valid || tx.busy || (amount ?? 0n) > deposited}
          onClick={() => void onWithdraw()}
        >
          Withdraw
        </button>
      </div>
      <p className="small muted">
        {token.native
          ? "USDC is Arc's native coin: one transaction, no approval step."
          : "Signs an EIP-2612 permit and deposits in one transaction " +
            "(approve + deposit if the wallet cannot sign permits)."}
      </p>
      <TxStatus progress={tx.progress} />
    </div>
  );
}

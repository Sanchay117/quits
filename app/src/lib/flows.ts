// Turns per-member net positions into a short list of payer -> receiver transfers for display.
// The contract never moves money between members directly (payers are debited, receivers credited), so this is
// purely a way to draw "who effectively paid whom".

export interface Flow {
  from: string;
  to: string;
  amount: bigint;
}

interface Position {
  member: string;
  left: bigint;
}

/** Larger positions first; ties broken by address so the output is deterministic. */
function byAmountThenAddress(a: Position, b: Position): number {
  if (a.left !== b.left) return a.left > b.left ? -1 : 1;
  return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
}

/**
 * Greedily matches the largest remaining payer with the largest remaining receiver. Positive nets receive, negative
 * nets pay. Produces at most (payers + receivers - 1) flows, and every member's flows add up to its net. If the nets
 * do not sum to zero, matching stops when one side runs out.
 */
export function decomposeNets(nets: Record<string, bigint>): Flow[] {
  const payers: Position[] = [];
  const receivers: Position[] = [];
  for (const [member, net] of Object.entries(nets)) {
    if (net < 0n) payers.push({ member, left: -net });
    else if (net > 0n) receivers.push({ member, left: net });
  }
  payers.sort(byAmountThenAddress);
  receivers.sort(byAmountThenAddress);

  const flows: Flow[] = [];
  let p = 0;
  let r = 0;
  while (p < payers.length && r < receivers.length) {
    const payer = payers[p];
    const receiver = receivers[r];
    const amount = payer.left < receiver.left ? payer.left : receiver.left;
    flows.push({ from: payer.member, to: receiver.member, amount });
    payer.left -= amount;
    receiver.left -= amount;
    if (payer.left === 0n) p++;
    if (receiver.left === 0n) r++;
  }
  return flows;
}

/** Sum of the amounts of a list of flows. */
export function totalFlow(flows: Flow[]): bigint {
  return flows.reduce((sum, flow) => sum + flow.amount, 0n);
}

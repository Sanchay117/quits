// How it works: the contract's rules, its invariants, the solver's math and the honest limitations.
import { explorerAddress } from "../../../core/chains.ts";
import { ExternalLink, PageHeader } from "../components/common.tsx";
import { activeNetwork } from "../lib/network.ts";
import { sourceRepoUrl } from "../lib/site.ts";

const RULES: [string, string][] = [
  ["Join", "register(name) sets a public display name of 1 to 48 bytes. Membership is otherwise permissionless."],
  [
    "Invoice",
    "The creditor calls issueInvoice(debtor, token, amount, dueDate, ref, memo). It stays Pending until the debtor accepts it (Open) or rejects it; the creditor can cancel it while it is Pending.",
  ],
  [
    "Deposit",
    "Deposits are kept per member and token. USDC arrives as native value (18 decimals on the wire, whole 6-decimal units in the ledger); EURC arrives by permit or allowance. Withdraw at any time, unless you are on the blocklist: then the deposit stays frozen, as it would in your own wallet.",
  ],
  [
    "Settle",
    "Anyone calls settle(token, ids, amounts). Ids must be strictly ascending, and each invoice Open, of that token, due, with 0 < amount <= outstanding. At most 256 invoices per cycle.",
  ],
  [
    "Net",
    "The contract sums each member's net (received minus paid) in transient storage. Every member touched must be off the token's and USDC's blocklist, and every net payer's deposit must cover its payment, or the whole call reverts.",
  ],
  ["Finish", "Payers are debited, receivers credited. Invoices that reach zero become Paid. The cycle is recorded with its totals."],
];

const INVARIANTS = [
  "Per token, the sum of all deposits equals total deposited minus total withdrawn. settle() never changes the sum.",
  "The contract's real holdings always cover its ledger, for native USDC and for every ERC-20.",
  "An invoice's outstanding amount never exceeds its amount and only decreases, and only through settle().",
  "In every cycle, each member's deposit changes by exactly what it was owed minus what it owed on the clears; cash moved equals the sum of net payments.",
  "Statuses only move Pending to Open, Rejected or Cancelled, and Open to Paid.",
  "A pure loop of equal debts (A owes B owes C owes A) settles with zero deposits.",
];

const LIMITATIONS = [
  "The sample network on the home page and the companies seeded on chain by our scripts are our own simulated businesses, not customers.",
  "Arc's privacy features are not live yet, so names, amounts, references and memos are public on chain.",
  "There is no credit: deposits are pre-funded, and a member pays only from its own deposit. Without one, it can only clear positions that offset exactly. There is no lending and no default process.",
  "Accepting an invoice is final for netting purposes; disputes are handled off chain, before acceptance.",
  "A cycle settles one token. USDC and EURC invoices net separately; there is no FX.",
  "The contract checks that a solution is valid, not that it is optimal. A weaker solution still settles correctly; it just clears less, and anyone can submit a better one in the next cycle.",
];

function ContractFacts() {
  const contract = activeNetwork.clearingHouse;
  const explorer = contract ? explorerAddress(activeNetwork, contract) : null;
  const source = sourceRepoUrl(window.location.hostname, window.location.pathname);
  return (
    <ul className="facts">
      <li>
        <span>Contract on {activeNetwork.label}</span>
        {contract ? <code className="break">{contract}</code> : <span className="muted">Not deployed yet</span>}
      </li>
      {explorer && (
        <li>
          <span>Verification</span>
          <ExternalLink href={explorer}>Source and transactions on Arc Explorer</ExternalLink>
        </li>
      )}
      <li>
        <span>Source code</span>
        {source ? <ExternalLink href={source}>{source.replace("https://", "")}</ExternalLink> : <span className="muted">In this repository: contracts/src/ClearingHouse.sol</span>}
      </li>
      <li>
        <span>Admin powers</span>
        <span>None. No owner, no upgrades, no fees. Supported tokens are fixed at deployment.</span>
      </li>
    </ul>
  );
}

export function HowPage() {
  return (
    <>
      <PageHeader
        title="How it works"
        lead="The rules are enforced on chain, so whoever computes a netting cycle needs no trust. The optimisation runs off chain, in your browser or a script."
      />

      <section className="section">
        <h2 className="section-title">The rules</h2>
        <ol className="rules">
          {RULES.map(([title, text]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section split">
        <div>
          <h2 className="section-title">The solver</h2>
          <p>
            Each accepted, due invoice is an edge from debtor to creditor with capacity equal to what is outstanding.
            A solution picks how much to clear on each, <var>x</var>, between 0 and the outstanding amount. A member
            whose clears leave it owing more than it is owed pays the difference from its deposit, which must cover it.
          </p>
          <p>
            The objective is lexicographic: first clear as much debt as possible, then, among those solutions, move
            the least cash. Quits models this as a minimum-cost circulation: add a cash node for deposits, charge 1 per
            unit drawn from a deposit and 2 per unit left uncleared. Any simple cycle in the residual network crosses the
            cash node at most once, so its cash cost is -1, 0 or +1, while its clearing cost is a multiple of 2. That
            weight of 2 is therefore enough for minimum cost to mean exactly "most cleared, then least cash", with no
            large constants.
          </p>
          <p>
            The solver starts with everything cleared and routes each member's imbalance back along the cheapest
            residual paths (successive shortest paths with potentials). It is exact, deterministic and uses integer
            arithmetic only. Before anything is sent, the app re-checks the result with the same rules settle()
            enforces.
          </p>
        </div>
        <aside className="callout callout--math">
          <span className="math-line">maximise Σ x</span>
          <span className="math-line">then minimise Σ max(0, −net)</span>
          <span className="math-line">s.t. 0 ≤ x ≤ outstanding</span>
          <span className="math-line">max(0, −net) ≤ deposit</span>
        </aside>
      </section>

      <section className="section">
        <h2 className="section-title">Invariants</h2>
        <p className="muted">
          Properties the contract keeps at all times. The Foundry test suite checks them, including with invariant
          fuzzing.
        </p>
        <ol className="plain-list">
          {INVARIANTS.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      </section>

      <section className="section">
        <h2 className="section-title">Limitations, stated plainly</h2>
        <ul className="plain-list">
          {LIMITATIONS.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2 className="section-title">Contract</h2>
        <ContractFacts />
      </section>
    </>
  );
}

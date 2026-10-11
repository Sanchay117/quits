// Narration, one clip per scene. `text` is the caption; `say` (when present) is what the voice reads.
// Every number comes from video/src/data.json (live Arc Mainnet) or the repo's test suite and docs.
export const SCENES = [
  {
    id: 'hook',
    text: 'Businesses owe each other in circles. A roaster owes its packaging supplier, who owes a freight firm, who owes the cafe that buys the roaster’s beans. Paid one by one, four hundred dollars moves. Yet the debts cancel out.',
  },
  {
    id: 'dtcc',
    text: 'Wall Street solved this long ago. On an average day in 2020, DTCC netted $1.77 trillion of trades down to $38 billion. About 98% never had to move.',
    say: 'Wall Street solved this long ago. On an average day in twenty twenty, D.T.C.C. netted one point seven seven trillion dollars of trades down to thirty-eight billion. About ninety-eight percent never had to move.',
  },
  {
    id: 'gap',
    text: 'Small businesses still pay every invoice in full.',
  },
  {
    id: 'brand',
    text: 'Quits is a clearing house for invoices, on Arc.',
  },
  {
    id: 'live',
    text: 'This is Arc mainnet. Seven companies, twenty invoices, $74.66 of debt. One netting cycle cleared all of it by moving fifteen cents.',
    say: 'This is Arc mainnet. Seven companies, twenty invoices, seventy-four dollars and sixty-six cents of debt. One netting cycle cleared all of it, by moving fifteen cents.',
  },
  {
    id: 'how',
    text: 'Companies issue invoices and debtors accept them. Each keeps a small USDC deposit. Anyone computes the netting in the browser, and one atomic transaction settles it, with every rule re-checked on chain.',
  },
  {
    id: 'arc',
    text: 'Arc makes it natural. USDC is the native coin, so a deposit is one transaction with no approval. Finality is deterministic: a settled cycle is final in under a second. Circle’s blocklist is enforced in the clearing rules. Invoices carry references through Arc’s Memo, batches go through Multicall3From, and a whole cycle costs about a cent.',
    say: 'Arc makes it natural. U.S.D.C. is the native coin, so a deposit is one transaction with no approval. Finality is deterministic: a settled cycle is final in under a second. Circle’s blocklist is enforced in the clearing rules. Invoices carry references through Arc’s Memo, batches go through Multicall three From, and a whole cycle costs about a cent.',
  },
  {
    id: 'consent',
    text: 'Netting is only fair if nobody can cherry-pick. Quits draws cash only from members who sent the cycle, or approved whoever did. Pure loops of debt clear for anyone.',
  },
  {
    id: 'proof',
    text: 'No owner, no admin, no fees. 176 tests and seven invariants stand behind the contract, and its source is verified on Sourcify and on Arc’s explorer.',
    say: 'No owner, no admin, no fees. A hundred and seventy-six tests and seven invariants stand behind the contract, and its source is verified on Sourcify, and on Arc’s explorer.',
  },
  {
    id: 'outro',
    text: 'Quits. Call it quits on circular debt.',
  },
]

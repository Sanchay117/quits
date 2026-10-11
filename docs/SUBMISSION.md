# Quits: DoraHacks submission

Ready-to-paste fields for the Arc Microgrants BUIDL page. Values marked `[PENDING: ...]` exist only after the mainnet
run (the runbook in [TESTNET.md](TESTNET.md#mainnet-runbook)); take them from `core/deployments.ts` and the scripts'
output, then search this file for `PENDING` before submitting.

## Project name

Quits

## Tagline

Call it quits on circular debt: invoices on Arc net out, and only the difference moves in USDC.

## Short description

Quits is a clearing house for invoices on Arc. Businesses that trade with each other owe each other in loops: a
roaster owes its packaging supplier, who owes a freight firm, who owes the cafe chain that buys the roaster's beans.
Paid one by one, every invoice moves its full amount in cash. With Quits, a creditor issues an invoice on chain, the
debtor accepts it, and each member keeps a small USDC or EURC deposit. An exact solver, running in the browser, finds
the cycle that clears the most debt with the least cash. One settle() call re-checks every rule on chain and moves
only each member's net difference, all or nothing. Members choose who may draw on their deposit, and Circle's
blocklist is enforced for every member a cycle touches. On Arc Testnet, the first cycle on our own network of seven
simulated companies cleared $746.55 of invoices with $1.50 of cash. Arc makes this practical: USDC is the native
coin, so a deposit is one transaction, deterministic finality makes a settled cycle final, and a 20-invoice cycle
costs about a cent of gas.

## How it uses Arc

- **Native USDC deposits.** `deposit()` is payable: a member sends USDC as `msg.value` (18 decimals) in one
  transaction with no approval, and the contract books it in the 6-decimal units of the USDC ERC-20 view. Withdrawals
  are native sends.
- **Deterministic finality as settlement finality.** A netting cycle is final in the block that includes it, with no
  reorgs and no confirmation counts.
- **Circle's blocklist in the clearing rules.** `settle()` calls `isBlacklisted` on USDC (`0x3600...0000`, Arc's
  chain-level list) and on the cycle's token for every member it touches, and `withdraw()` applies the same rule.
- **Memo predeploy.** The app issues invoices through Arc's Memo contract, so each invoice reference is indexed in a
  `Memo` event; the demo's first invoice went through it.
- **Multicall3From predeploy.** "Accept all" in the app is one transaction, and the scripts batch each company's
  registration, solver approval and invoices, with every call running as the sending wallet.
- **EURC.** Circle's EURC is the second supported token, fixed at deployment, with EIP-2612 permit deposits in one
  transaction.
- **Gas paid in USDC, measured.** The 20-invoice testnet cycle used 611,121 gas ($0.013 at 21 gwei); the whole
  38-transaction testnet demo, deploy included, cost $0.22.

## Links

| Field | Value |
|---|---|
| Live app | https://sanchay117.github.io/quits/ |
| Source code | https://github.com/Sanchay117/quits |
| ClearingHouse on Arc Mainnet | `0x3ac6634C02ae6428BcFE4C5024dA18Aaf598aac1` |
| Mainnet explorer | https://explorer.arc.io/address/0x3ac6634C02ae6428BcFE4C5024dA18Aaf598aac1 |
| Mainnet source verification | https://repo.sourcify.dev/5042/0x3ac6634C02ae6428BcFE4C5024dA18Aaf598aac1 |
| First mainnet netting cycle | https://explorer.arc.io/tx/0x49e714b491b771a1ae941ca93b201f5b8889f775d2b86f2673c07dd072453f01 |
| ClearingHouse on Arc Testnet | https://explorer.testnet.arc.io/address/0xcf711Fbbc8938F7740615a97dc9b66149cd5e704 |
| Testnet source verification | https://repo.sourcify.dev/5042002/0xcf711Fbbc8938F7740615a97dc9b66149cd5e704 |
| Testnet netting cycle | https://explorer.testnet.arc.io/tx/0xcf46664dc6084f901bd6b4d2cd02bb76b8465242b9b432000e62a9021066d207 |
| Testnet rehearsal (all 38 transactions) | https://github.com/Sanchay117/quits/blob/main/docs/TESTNET.md |
| Security notes | https://github.com/Sanchay117/quits/blob/main/docs/SECURITY.md |
| Demo video | https://sanchay117.github.io/quits/demo.mp4 (1:53, narrated; a YouTube link works too if you upload it) |

Built with: Solidity 0.8.30 and Foundry, TypeScript, viem, React 19 and Vite.

## X post

Businesses owe each other in loops. Quits nets them out on Arc: invoices go on chain, a solver finds the cycle, and
one settle() moves only the difference in USDC. First cycle on Arc Testnet: $746.55 of debt cleared with $1.50 of
cash. https://sanchay117.github.io/quits/

After the mainnet cycle, replace "Arc Testnet" with "Arc Mainnet" if its numbers match (the same scripts produce the
same cycle), and check the post is still within 280 characters.

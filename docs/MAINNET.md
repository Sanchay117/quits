# Mainnet runbook

The same steps that ran on Arc Testnet ([TESTNET.md](TESTNET.md)), at `--scale 0.2` to keep the float small. Every
command that sends a transaction prints its plan first and sends nothing without `--yes`.

## Budget

| | USDC |
|---|---:|
| Send to the deployer `0x06eCC1D567859fB115265740ECF78eBdFA1b6537` | **1.50** |
| Gas actually spent (deploy, fund, seed both rounds, first cycle) | about 0.22 |
| Returned by `recover.ts` at the end (deposits and unused gas money) | everything else |

At `--scale 0.2` the first cycle clears $149.31 of invoices with $0.30 of cash (99.8% netted), the same shape as the
testnet run at full scale ($746.55 with $1.50). Checked offline with `node scripts/check-scale.ts --scale 0.2`.

## 1. Fund the deployer

From MetaMask, on the **Arc** network, send **1.50 USDC** to `0x06eCC1D567859fB115265740ECF78eBdFA1b6537`.

## 2. Deploy and seed

From the repo root:

```sh
node scripts/deploy.ts --network mainnet          # plan: deployer, balance, simulated deploy
node scripts/deploy.ts --network mainnet --yes    # deploy, records core/deployments.ts
node scripts/verify.ts --network mainnet          # Sourcify + Arc Explorer, no transaction
node scripts/wallets.ts --network mainnet         # demo company keys in .secrets/ (back them up)
node scripts/fund.ts --network mainnet --scale 0.2
node scripts/fund.ts --network mainnet --scale 0.2 --yes
node scripts/seed.ts --network mainnet --scale 0.2
node scripts/seed.ts --network mainnet --scale 0.2 --yes
node scripts/cycle.ts --network mainnet
node scripts/cycle.ts --network mainnet --yes
node scripts/seed.ts --network mainnet --round 2 --scale 0.2
node scripts/seed.ts --network mainnet --round 2 --scale 0.2 --yes
node scripts/status.ts --network mainnet
```

If a step stops part way, run it again: fund.ts sends only shortfalls and seed.ts skips invoices already on chain.

## 3. Publish

1. Create the public repo `Sanchay117/quits` on GitHub (no README, .gitignore or license: the repo has them).
2. Commit (including `core/deployments.ts`, now holding the mainnet address) and push:
   `git remote add origin git@github.com:Sanchay117/quits.git` then `git push -u origin main`.
3. On GitHub: Settings, Pages, Source: **GitHub Actions**. The "Deploy site" workflow publishes
   https://sanchay117.github.io/quits/ with mainnet as the default network.

## 4. Check before submitting

- The site's Home shows live mainnet totals; Network's "Compute netting" previews round 2; Cycles replays cycle 0.
- Both verification links work (Sourcify and Arc Explorer).
- Fill the `[PENDING]` mainnet values in [SUBMISSION.md](SUBMISSION.md) and README.md.

## 5. After review (after 2026-10-21)

```sh
node scripts/recover.ts --network mainnet --to 0x75EcC1D69Ca9E7660B9aFC36b141F774a103C438
node scripts/recover.ts --network mainnet --to 0x75EcC1D69Ca9E7660B9aFC36b141F774a103C438 --yes
```

Every company withdraws its deposit and the wallets are swept straight back to your MetaMask, minus about 0.0001 USDC
of dust per wallet. The deployer's own leftover can be sent back from any wallet holding its key.

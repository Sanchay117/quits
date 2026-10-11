#!/usr/bin/env bash
# The whole mainnet demo from docs/MAINNET.md in one go: deploy, verify, fund, seed, first cycle, round 2.
# Every step prints its plan before sending. Stops at the first error; safe to re-run (it never deploys twice,
# fund.ts sends only shortfalls and seed.ts skips invoices already on chain).
set -euo pipefail
cd "$(dirname "$0")/.."
SCALE=0.1

if node -e 'import("./core/deployments.ts").then((m) => process.exit(m.deployments.mainnet.clearingHouse ? 0 : 1))'; then
  echo "ClearingHouse already deployed on Arc Mainnet: skipping deploy."
else
  node scripts/deploy.ts --network mainnet --yes
fi

node scripts/verify.ts --network mainnet || echo "Verification did not finish; re-run: node scripts/verify.ts --network mainnet"
node scripts/wallets.ts --network mainnet
node scripts/fund.ts --network mainnet --scale "$SCALE" --yes
node scripts/seed.ts --network mainnet --scale "$SCALE" --yes
node scripts/cycle.ts --network mainnet --yes
node scripts/seed.ts --network mainnet --round 2 --scale "$SCALE" --yes
node scripts/status.ts --network mainnet

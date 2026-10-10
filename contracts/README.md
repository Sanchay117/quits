# Quits contracts

Foundry project for the Quits clearing house on Arc (Solidity 0.8.30, EVM Prague).

| Path | What it is |
| --- | --- |
| `src/ClearingHouse.sol` | The clearing house, and the only contract Quits deploys. No owner, admin, upgrades or fees. |
| `src/mocks/MockArcUSDC.sol` | Stand-in for Arc's USDC ERC-20 view at `0x3600...0000` on a local anvil chain (blocklist and balance reads only). |
| `src/mocks/MockFiatToken.sol` | FiatToken test double (6 decimals, EIP-2612 permit, blocklist) used as EURC in tests and locally. Never deploy it anywhere that matters. |
| `script/Deploy.s.sol` | Deploys `ClearingHouse` for USDC and the network's EURC. |
| `test/` | Unit, fuzz and stateful invariant tests, gas report, regression tests. |

The rules the contract enforces, its invariants, how each is tested and every finding from development and the
independent audit are in [`../docs/SECURITY.md`](../docs/SECURITY.md). The contract summary is in
[`../docs/SPEC.md`](../docs/SPEC.md).

## Commands

```sh
forge build
forge test                                   # all suites, including fuzz (2,000 runs) and the invariant suite
forge test --match-contract GasReport -vv    # what each operation costs on Arc at the 20 gwei fee floor
forge lint src script
forge fmt --check
```

## Deploying

From the repository root, `node scripts/deploy.ts --network testnet|mainnet|local` runs `script/Deploy.s.sol` with
the key from `.secrets/` and records the address in `core/deployments.ts`. On Arc Mainnet it prints the plan and a
keyless simulation and stops unless `--yes` is given. To run the forge script directly, see the comment at the top of
`script/Deploy.s.sol`: a mainnet broadcast also needs `CONFIRM_MAINNET=yes`, and Arc drops transactions priced under
its 20 gwei base fee floor, so always pass explicit fees.

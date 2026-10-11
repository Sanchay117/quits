# Arc Testnet rehearsal

The whole demo flow ran on Arc Testnet (chain 5042002) on 2026-10-10 from 20:40 to 20:43 UTC (blocks 66535370 to
66535690), using only the repo's scripts with no manual steps. Test USDC has no value. Nothing was sent to Arc Mainnet.

## Contract

| | |
|---|---|
| ClearingHouse | [`0xcf711Fbbc8938F7740615a97dc9b66149cd5e704`](https://explorer.testnet.arc.io/address/0xcf711Fbbc8938F7740615a97dc9b66149cd5e704) |
| Constructor | `ClearingHouse(0x3600000000000000000000000000000000000000, [0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a])` (USDC, [EURC]) |
| Deploy tx | [`0xa702a761…7510`](https://explorer.testnet.arc.io/tx/0xa702a7614248e5f471d5f435cab7858ae9b00ad1029a06de2dc560a1bf527510), block 66535370 |
| Source | [Sourcify, verified](https://repo.sourcify.dev/5042002/0xcf711Fbbc8938F7740615a97dc9b66149cd5e704) |
| Deployer | `0x20Ef96Ce87EA8D3CA0D130848317d33D4010aeDE` |
| Recorded in | `core/deployments.ts`, testnet entry (deployBlock 66535370) |

The deployed code is the current `contracts/src/ClearingHouse.sol` (unchanged since before the deploy), with
`setSolver` and `isSolverFor`.

Verification check: `https://sourcify.dev/server/v2/contract/5042002/0xcf711Fbbc8938F7740615a97dc9b66149cd5e704`
returns `match: "match"` (creation and runtime bytecode both `match`), verified at 2026-10-10 20:40:14 UTC. The older
`check-by-addresses` endpoint now answers 404; the v2 endpoint replaces it. Running `verify.ts` again prints "Contract
source code already verified" and exits 0.

## Cost per step

Every transaction paid an effective 21 gwei (the 20 gwei base fee plus the scripts' 1 gwei tip). The figures come from
the receipts.

| Step | Command | Txs | Gas used | Test USDC | Paid by |
|---|---|---:|---:|---:|---|
| Build | `forge build` (in `contracts/`) | 0 | 0 | 0 | |
| Deploy | `node scripts/deploy.ts --network testnet` | 1 | 2,952,015 | 0.061992 | deployer |
| Verify | `node scripts/verify.ts --network testnet` | 0 | 0 | 0 | |
| Wallets | `node scripts/wallets.ts --network testnet` | 0 | 0 | 0 | |
| Fund | `node scripts/fund.ts --network testnet` | 1 | 360,486 | 0.007570 | deployer |
| Seed round 1 | `node scripts/seed.ts --network testnet` | 22 | 5,051,543 | 0.106082 | companies |
| Cycle 1 | `node scripts/cycle.ts --network testnet` | 1 | 611,121 | 0.012834 | deployer |
| Seed round 2 | `node scripts/seed.ts --network testnet --round 2` | 13 | 1,425,340 | 0.029932 | companies |
| **Total** | | **38** | **10,400,505** | **0.218411** | |

Besides gas, fund.ts sent 5.182 test USDC to the seven companies (their deposits plus gas budgets). The deployer went
from 20.000000 to 14.735604 test USDC: 5.182 sent plus 0.082396 of gas. The companies paid 0.136014 of gas out of what
they were sent.

Cycle 1 (cycle #0) cleared 20 invoices worth $746.55 among 7 members with $1.50 of cash: 99.8% netted away.

## State left on testnet

This is what the app shows with `?network=testnet`. recover.ts was not run, on purpose.

- 7 registered companies, each with `setSolver(address(0), true)` (status.ts shows "anyone" for all).
- 28 invoices: 18 paid, 10 open worth $290.80 (round 2 plus the remainder of round 1).
- $3.95 of deposits in the contract.
- A pending netting opportunity: `node scripts/cycle.ts --network testnet --dry-run` clears all $290.80 with $1.80 of
  cash (99.4% netted), estimated by the node at 384,550 gas (0.008076 USDC). Not sent.

## Arc predeploys and the blocklist

**Memo** (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`). The seed's first invoice, INV-1042 (transaction 3 below), was
issued through `memo(target, data, memoId, memoData)`. Its receipt carries the Memo event (topic0
`0xeb15ee72…a5e4`, `Memo(address,address,bytes32,bytes32,bytes,uint256)`) with sender Kestrel Freight, target the
ClearingHouse, memoId `INV-1042`, memo "Freight, Oct week 1: green coffee from the port" and memoIndex 787291, next to
the ClearingHouse's `InvoiceIssued` for #1 with Kestrel Freight as creditor, so the call ran as the EOA.

**Multicall3From** (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`). 16 of the 38 transactions are batches: the fund
transfers (7 USDC ERC-20 transfers in one transaction), one register + setSolver + issue transaction per company in
round 1 (7), one accept transaction per company with two or more invoices to accept (6 in round 1), and Fernway Cafes'
issue and accept batches in round 2 (2). In every batch the emitted events name the sending EOA (the creditor of
`InvoiceIssued`, the member of `MemberProfile` and `SolverSet`, the `from` of each USDC `Transfer`), and the
debtor of every accepted invoice is the sender: each call ran with the EOA as `msg.sender`. Deposits are direct
`deposit()` calls, because Multicall3From cannot forward value.

**Blocklist.** On Arc Testnet:

```sh
cast call 0x3600000000000000000000000000000000000000 "isBlacklisted(address)(bool)" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url https://rpc.testnet.arc.io   # true
cast call 0x3600000000000000000000000000000000000000 "isBlacklisted(address)(bool)" \
  0x20Ef96Ce87EA8D3CA0D130848317d33D4010aeDE --rpc-url https://rpc.testnet.arc.io   # false
```

This is the view the ClearingHouse calls for every touched member in `settle()` and for the caller in `withdraw()`.

## Transactions

All 38 in order, with links to Arc Testnet's explorer. "Via" is the address each transaction was sent to (Memo and
Multicall3From are Arc predeploys). Gas is gas used; USDC is what it cost at 21 gwei.

| # | Step | Sender | Via | What | Gas | USDC | Transaction |
|---:|---|---|---|---|---:|---:|---|
| 1 | Deploy | deployer | contract creation | Deploy ClearingHouse | 2,952,015 | 0.061992 | [0xa702a761…7510](https://explorer.testnet.arc.io/tx/0xa702a7614248e5f471d5f435cab7858ae9b00ad1029a06de2dc560a1bf527510) |
| 2 | Fund | deployer | Multicall3From | USDC ERC-20 transfers to all 7 companies | 360,486 | 0.007570 | [0x53602aef…fdd0](https://explorer.testnet.arc.io/tx/0x53602aef5a3a4e5e3e4c29dd10d797f1c19b07c9990316841023f90914acfdd0) |
| 3 | Seed 1 | Kestrel Freight | Memo | issue INV-1042 | 250,519 | 0.005261 | [0xe8c9d678…e7f7](https://explorer.testnet.arc.io/tx/0xe8c9d6787b0ba3e582944eaf8da693d91bb3250d8ba3099d5fd6ea7a7042e7f7) |
| 4 | Seed 1 | Kestrel Freight | Multicall3From | register, setSolver(anyone), issue INV-1043, INV-1044 | 495,989 | 0.010416 | [0x88c9cc25…f3db](https://explorer.testnet.arc.io/tx/0x88c9cc251fce1c2468f96b1d6167df3dcc1f18e6d2b6fbf51a6ec7aa37b0f3db) |
| 5 | Seed 1 | Boxwell Packaging | Multicall3From | register, setSolver(anyone), issue BX-2207, BX-2208, BX-2209 | 579,108 | 0.012161 | [0x5d3a547e…1f2c](https://explorer.testnet.arc.io/tx/0x5d3a547e17bb21ba4ac99a7fa0b7c8f68391a8af607cb6723d38a454c2801f2c) |
| 6 | Seed 1 | Ember Hill Roasters | Multicall3From | register, setSolver(anyone), issue EH-0318, EH-0319, EH-0320 | 579,444 | 0.012168 | [0x9ae75f45…ef6a](https://explorer.testnet.arc.io/tx/0x9ae75f451335ce9ed7bdd1666d72eca227d367d2e4992d40a9d0eecb0eefef6a) |
| 7 | Seed 1 | Fernway Cafes | Multicall3From | register, setSolver(anyone), issue FC-5521, FC-5522, FC-5523 | 624,301 | 0.013110 | [0x5e82df86…36f8](https://explorer.testnet.arc.io/tx/0x5e82df86a5880fa87eed909fc2c736e9c90810a9858dc7f09cd3ccbd381e36f8) |
| 8 | Seed 1 | Meadowgate Dairy | Multicall3From | register, setSolver(anyone), issue MD-1190, MD-1191 | 433,684 | 0.009107 | [0x3fec4cbe…937a](https://explorer.testnet.arc.io/tx/0x3fec4cbeac807a3bfb76ce1d87986655b7370590bcfca4ce38aad0c5f650937a) |
| 9 | Seed 1 | Halftone Studio | Multicall3From | register, setSolver(anyone), issue HS-0087, HS-0088, HS-0089 | 579,252 | 0.012164 | [0x73c5b46d…d67c](https://explorer.testnet.arc.io/tx/0x73c5b46d84c700b687433cda3430d01bcc5a2f7b83850521f9d4686e29f0d67c) |
| 10 | Seed 1 | Inkline Print Shop | Multicall3From | register, setSolver(anyone), issue IP-7730, IP-7731, IP-7732, IP-7733 | 724,607 | 0.015217 | [0x7b3942c1…5e71](https://explorer.testnet.arc.io/tx/0x7b3942c1c8778431988c90dc96f81adf7ff468ee0166bb0802cf11ad275a5e71) |
| 11 | Seed 1 | Kestrel Freight | ClearingHouse | deposit $0.20 | 46,221 | 0.000971 | [0x90614afe…eb61](https://explorer.testnet.arc.io/tx/0x90614afe24999447240883992f51ff297d5bf4604fc65c2a3290139e0edeeb61) |
| 12 | Seed 1 | Boxwell Packaging | ClearingHouse | deposit $0.50 | 46,221 | 0.000971 | [0x367d8d83…749f](https://explorer.testnet.arc.io/tx/0x367d8d83bae8f5392a661970fcfdc7480d910dfc8ad0e8095567e688d59a749f) |
| 13 | Seed 1 | Ember Hill Roasters | ClearingHouse | deposit $0.20 | 46,221 | 0.000971 | [0xef4f5954…6a1d](https://explorer.testnet.arc.io/tx/0xef4f595453cc8db577c744f2b988988a9d24e8d6d26f61a5f286fd2fdd856a1d) |
| 14 | Seed 1 | Fernway Cafes | ClearingHouse | deposit $0.75 | 46,221 | 0.000971 | [0x222982b7…f2d3](https://explorer.testnet.arc.io/tx/0x222982b7a2b6a169cb6185ab35c91b6e83525223dcd058a95834a6647672f2d3) |
| 15 | Seed 1 | Meadowgate Dairy | ClearingHouse | deposit $0.50 | 46,221 | 0.000971 | [0xd4734621…6af1](https://explorer.testnet.arc.io/tx/0xd473462145324679feb71642b27ef7693728ec83f12e7246810809b26c8c6af1) |
| 16 | Seed 1 | Halftone Studio | ClearingHouse | deposit $0.20 | 46,221 | 0.000971 | [0xf22fcbfd…01d9](https://explorer.testnet.arc.io/tx/0xf22fcbfd09cd93a7835f4067ea2279ff67a0a69ad9ba504a50e136ffbe7501d9) |
| 17 | Seed 1 | Inkline Print Shop | ClearingHouse | deposit $0.60 | 46,221 | 0.000971 | [0x381de117…902e](https://explorer.testnet.arc.io/tx/0x381de1170f1148e9ea5f3f15370346849b609ea88975cfdc2b2df0613e9b902e) |
| 18 | Seed 1 | Kestrel Freight | Multicall3From | accept #8, #10 | 53,980 | 0.001134 | [0xfe054f5d…ffb5](https://explorer.testnet.arc.io/tx/0xfe054f5d0a8d9d5bfd1cfe298658f369e1a462af96a5f051727c3c14c321ffb5) |
| 19 | Seed 1 | Boxwell Packaging | Multicall3From | accept #2, #16 | 53,980 | 0.001134 | [0x580622da…9c36](https://explorer.testnet.arc.io/tx/0x580622da535c605528199cc22c0179b44aa92733167560991837a50d3e1d9c36) |
| 20 | Seed 1 | Ember Hill Roasters | Multicall3From | accept #1, #4, #15, #19 | 80,749 | 0.001696 | [0x9e80b38a…ce5e](https://explorer.testnet.arc.io/tx/0x9e80b38a0aa9ceb63877a634bd5770c95bc9c331f96c91f14813fa8b2bbcce5e) |
| 21 | Seed 1 | Fernway Cafes | Multicall3From | accept #6, #7, #13, #14, #18, #21 | 107,526 | 0.002258 | [0x048014da…559e](https://explorer.testnet.arc.io/tx/0x048014da8807821dd196acbde3a23d24aee4448a160cf0441cdda734c0e9559e) |
| 22 | Seed 1 | Meadowgate Dairy | Multicall3From | accept #3, #5, #17 | 67,376 | 0.001415 | [0x300ab9e8…d139](https://explorer.testnet.arc.io/tx/0x300ab9e806eb835a497791a3e525bf0c3faae0923db36063bc2d1fa8b952d139) |
| 23 | Seed 1 | Halftone Studio | Multicall3From | accept #9, #11, #20 | 67,376 | 0.001415 | [0xadbcea40…4a1c](https://explorer.testnet.arc.io/tx/0xadbcea40d66d700708039ff126ef0df793df05ca792ec14068c6239a31de4a1c) |
| 24 | Seed 1 | Inkline Print Shop | ClearingHouse | accept #12 | 30,105 | 0.000632 | [0x30e7a37e…bf7b](https://explorer.testnet.arc.io/tx/0x30e7a37ecc46084f072b9eca34f554e459180e5fff83f527cbb188c79d10bf7b) |
| 25 | Cycle 1 | deployer | ClearingHouse | settle(): 20 invoices, $746.55 cleared, $1.50 cash | 611,121 | 0.012834 | [0xcf46664d…d207](https://explorer.testnet.arc.io/tx/0xcf46664dc6084f901bd6b4d2cd02bb76b8465242b9b432000e62a9021066d207) |
| 26 | Seed 2 | Kestrel Freight | ClearingHouse | issue INV-1051 | 168,757 | 0.003544 | [0x4e41265d…5e61](https://explorer.testnet.arc.io/tx/0x4e41265d74e96d653e308ddc9ef38fa8c450daae707cea71099a4ed79d035e61) |
| 27 | Seed 2 | Ember Hill Roasters | ClearingHouse | issue EH-0327 | 168,817 | 0.003545 | [0xace62612…a1c7](https://explorer.testnet.arc.io/tx/0xace62612e76087875205eb1402016795ef8ea8b01015bcf31e584a4fb1cfa1c7) |
| 28 | Seed 2 | Fernway Cafes | Multicall3From | issue FC-5530, FC-5531, FC-5532 | 470,429 | 0.009879 | [0xfeac3281…4cb2](https://explorer.testnet.arc.io/tx/0xfeac3281e60ceaf4c4974e8102c596095d37a0968216a2c59e1fec7746fc4cb2) |
| 29 | Seed 2 | Meadowgate Dairy | ClearingHouse | issue MD-1198 | 168,709 | 0.003543 | [0x4245028c…1269](https://explorer.testnet.arc.io/tx/0x4245028c0cfcdf9cb5672d6e280fd644d6c9ba5053e2893964a1564cd1b61269) |
| 30 | Seed 2 | Halftone Studio | ClearingHouse | issue HS-0094 | 168,781 | 0.003544 | [0xcf14a2d0…18ed](https://explorer.testnet.arc.io/tx/0xcf14a2d03422a9c2a39d609f869a33619f09d1d01331bab96b539d804c9f18ed) |
| 31 | Seed 2 | Fernway Cafes | ClearingHouse | deposit $0.50 | 46,221 | 0.000971 | [0x26c5b06c…16f0](https://explorer.testnet.arc.io/tx/0x26c5b06cf85a7a01fb3c5b264c576a7c1b09d941a848e2295ec3aef8c9e816f0) |
| 32 | Seed 2 | Inkline Print Shop | ClearingHouse | deposit $0.50 | 29,121 | 0.000612 | [0x173e5550…f5e0](https://explorer.testnet.arc.io/tx/0x173e55500ead1ac33a83ea9dd9ad42376740272103e24a383f06c7931390f5e0) |
| 33 | Seed 2 | Kestrel Freight | ClearingHouse | accept #25 | 30,105 | 0.000632 | [0x2b60e4d6…c17d](https://explorer.testnet.arc.io/tx/0x2b60e4d6f26e566f33c48eb270879ce6895b317e29f8fb055efb5b04b46fc17d) |
| 34 | Seed 2 | Ember Hill Roasters | ClearingHouse | accept #22 | 30,105 | 0.000632 | [0x0b167a69…cdf6](https://explorer.testnet.arc.io/tx/0x0b167a69d64ff0aa2ea8e54046b7dcd6fa77d17753cb3fb0fad51cb15d26cdf6) |
| 35 | Seed 2 | Fernway Cafes | Multicall3From | accept #23, #27 | 53,980 | 0.001134 | [0x716d35f3…89c7](https://explorer.testnet.arc.io/tx/0x716d35f356c17967d362dc8aa5b0e4cec6f9744c9e8e64f1b773afebb7cf89c7) |
| 36 | Seed 2 | Meadowgate Dairy | ClearingHouse | accept #28 | 30,105 | 0.000632 | [0xec48d3d2…bfec](https://explorer.testnet.arc.io/tx/0xec48d3d2b76e138a23ee736a112a8ba2bb881dee283e23965135269091b2bfec) |
| 37 | Seed 2 | Halftone Studio | ClearingHouse | accept #26 | 30,105 | 0.000632 | [0x9e912d65…5703](https://explorer.testnet.arc.io/tx/0x9e912d65eeee40a54151fef769bf2d2f8739773b0fa670710cc583a8e62d5703) |
| 38 | Seed 2 | Inkline Print Shop | ClearingHouse | accept #24 | 30,105 | 0.000632 | [0xd7c8a37f…0548](https://explorer.testnet.arc.io/tx/0xd7c8a37f0d22f3bedacd3c0ae0370f734c9b8bee799f75b24713dde451d20548) |

## Re-run checks

Run around 20:50 UTC the same day against the state above, to confirm the scripts resume safely on real Arc:

- `wallets.ts --network testnet` lists the existing wallets and does not overwrite them.
- `verify.ts --network testnet` reports the source as already verified and exits 0.
- `fund.ts --network testnet --dry-run`: nothing to send.
- `seed.ts --network testnet --dry-run` and `seed.ts --network testnet --round 2 --dry-run`: "Nothing to do".
- `cycle.ts --network testnet --dry-run`: the pending $290.80 cycle above.
- `status.ts --network testnet`: the state above.

## Notes

- forge prints "Missing dependencies found. Installing now..." and two failed `git clone` lines on every run, because
  `.gitmodules` declares `contracts/lib/forge-std` but the folder is a plain copy. It is harmless: forge goes on with
  the copy that is there.
- Arc Testnet's explorer (Blockscout) shows the contract as not verified (its API reports `is_verified: false`); the
  verified source is on Sourcify.
- fund.ts budgets Inkline Print Shop's round 2 deposit at the full $1.50 level, because it cannot know cycle 1's result
  in advance. After cycle 1 Inkline needed only $0.50, so $1.00 waits in its wallet until recover.ts sweeps it back.

## Mainnet runbook

Moved to [MAINNET.md](MAINNET.md), with a smaller budget (`--scale 0.1`: about 1.00 USDC on the deployer, about 0.24 USDC of it spent on gas).

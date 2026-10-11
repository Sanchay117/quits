// Deployed addresses per network. Updated by the deploy script; null until deployed.
import type { Hex } from "./chains.ts";

export interface Deployment {
  clearingHouse: Hex | null;
  /** Only set on local networks, where the deploy script also deploys a mock EURC. */
  eurc: Hex | null;
  deployBlock: number;
}

export const deployments: Record<"mainnet" | "testnet" | "local", Deployment> = {
  mainnet: { clearingHouse: null, eurc: null, deployBlock: 0 },
  testnet: { clearingHouse: "0xcf711Fbbc8938F7740615a97dc9b66149cd5e704", eurc: null, deployBlock: 66535370 },
  local: {
    clearingHouse: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    eurc: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    deployBlock: 2,
  },
};

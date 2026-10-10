// Hash routing: GitHub Pages serves one static file, so pages live after the "#".
import { useSyncExternalStore } from "react";

export type Route =
  | { page: "home" }
  | { page: "network" }
  | { page: "account" }
  | { page: "cycles" }
  | { page: "cycle"; id: bigint }
  | { page: "playground" }
  | { page: "how" }
  | { page: "not-found"; path: string };

const SIMPLE_PAGES = {
  "": "home",
  network: "network",
  account: "account",
  cycles: "cycles",
  playground: "playground",
  how: "how",
} as const;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const cycle = /^cycles\/(\d{1,20})$/.exec(path);
  if (cycle) return { page: "cycle", id: BigInt(cycle[1]) };
  const page = SIMPLE_PAGES[path as keyof typeof SIMPLE_PAGES];
  return page ? { page } : { page: "not-found", path };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => "");
}

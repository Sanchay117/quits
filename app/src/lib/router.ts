// Hash routing: GitHub Pages serves one static file, so pages live after the "#".
import { useSyncExternalStore } from "react";

export type Route =
  | { page: "home" }
  | { page: "network" }
  /** viewAs (from #/account?as=0x...) opens any address's Account page read-only, with no wallet. */
  | { page: "account"; viewAs?: string }
  | { page: "cycles" }
  | { page: "cycle"; id: bigint }
  | { page: "playground" }
  | { page: "how" }
  | { page: "not-found"; path: string };

const SIMPLE_PAGES = {
  "": "home",
  network: "network",
  cycles: "cycles",
  playground: "playground",
  how: "how",
} as const;

export function parseRoute(hash: string): Route {
  const rest = hash.replace(/^#\/?/, "");
  const queryAt = rest.indexOf("?");
  const path = (queryAt < 0 ? rest : rest.slice(0, queryAt)).replace(/\/+$/, "");
  const query = new URLSearchParams(queryAt < 0 ? "" : rest.slice(queryAt + 1));
  if (path === "account") {
    const viewAs = query.get("as");
    return viewAs === null ? { page: "account" } : { page: "account", viewAs: viewAs.trim() };
  }
  const cycle = /^cycles\/(\d{1,20})$/.exec(path);
  if (cycle) return { page: "cycle", id: BigInt(cycle[1]) };
  const page = SIMPLE_PAGES[path as keyof typeof SIMPLE_PAGES];
  return page ? { page } : { page: "not-found", path };
}

/** The read-only Account page of `address`. */
export function viewAsHref(address: string): string {
  return `#/account?as=${encodeURIComponent(address)}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => "");
}

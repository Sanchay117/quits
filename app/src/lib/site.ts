// Facts about where the app and its contract live: the source repository behind the site, the networks the site
// offers, and where a deployed contract's source is verified.
import type { ArcNetwork } from "../../../core/chains.ts";

/**
 * The GitHub repository behind a GitHub Pages site, derived from its own address: <owner>.github.io/<repo>/ is
 * served from github.com/<owner>/<repo>. Null anywhere else (local development), so no link is ever guessed.
 */
export function sourceRepoUrl(hostname: string, pathname: string): string | null {
  const owner = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname)?.[1];
  const repo = pathname.split("/").filter(Boolean)[0];
  return owner && repo ? `https://github.com/${owner}/${repo}` : null;
}

/**
 * Sourcify's page for a contract's verified source (scripts/verify.ts verifies every Arc deployment there). Null on
 * the local anvil chain, which Sourcify never sees.
 */
export function sourcifyUrl(net: ArcNetwork, address: string): string | null {
  return net.name === "local" ? null : `https://repo.sourcify.dev/${net.chainId}/${address}`;
}

/**
 * The networks the site offers in its network picker and its "Live on" lists. A production build leaves out the
 * local anvil chain, which exists only on a developer's machine, unless the page was opened on it (?network=local
 * keeps working, and the picker must still be able to show the active network).
 */
export function networksToList(all: readonly ArcNetwork[], active: ArcNetwork, production: boolean): ArcNetwork[] {
  return all.filter((net) => !production || net.name !== "local" || net.name === active.name);
}

// Facts about where the app is hosted.

/**
 * The GitHub repository behind a GitHub Pages site, derived from its own address: <owner>.github.io/<repo>/ is
 * served from github.com/<owner>/<repo>. Null anywhere else (local development), so no link is ever guessed.
 */
export function sourceRepoUrl(hostname: string, pathname: string): string | null {
  const owner = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname)?.[1];
  const repo = pathname.split("/").filter(Boolean)[0];
  return owner && repo ? `https://github.com/${owner}/${repo}` : null;
}

import { Octokit } from "@octokit/rest";

/**
 * Build a per-request Octokit client. The token comes from the incoming HTTP
 * request (Authorization header) or falls back to GITHUB_TOKEN in the env.
 * We build a fresh client per request so tokens are never shared across users.
 */
export function makeGitHubClient(token?: string): Octokit {
  const auth = token || process.env.GITHUB_TOKEN || undefined;
  return new Octokit({
    auth,
    userAgent: "OctoMate/0.1 (+https://github.com/nosana-ci/agent-challenge)",
  });
}

/** Parse an "owner/repo" string safely. */
export function parseRepo(
  input: string
): { owner: string; repo: string } | null {
  const m = input.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

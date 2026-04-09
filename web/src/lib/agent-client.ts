import type { AgentResponse } from "./types";

/**
 * Thin client for the agent REST API. In dev and prod the frontend talks to
 * `/api/agent/*` which Next.js rewrites to http://127.0.0.1:AGENT_PORT.
 */

const AGENT_BASE = "/api/agent";

function getToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem("octomate:github_token") || undefined;
}

function getRepo(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem("octomate:repo") || undefined;
}

export async function sendMessage(
  text: string,
  opts: { repo?: string } = {}
): Promise<AgentResponse> {
  const res = await fetch(`${AGENT_BASE}/api/agents/octomate/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      repo: opts.repo ?? getRepo(),
      github_token: getToken(),
    }),
  });
  if (!res.ok) {
    throw new Error(`agent error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function runAction<T = unknown>(
  name: string,
  params: Record<string, unknown>,
  opts: { repo?: string; text?: string } = {}
): Promise<{ text: string; action: string; data?: T }> {
  const res = await fetch(`${AGENT_BASE}/api/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      params,
      repo: opts.repo ?? getRepo(),
      github_token: getToken(),
      text: opts.text ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`action ${name} failed ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function health(): Promise<{ ok: boolean; agent: string }> {
  const res = await fetch(`${AGENT_BASE}/health`);
  return res.json();
}

/**
 * Query GitHub REST API directly from the browser using the stored PAT. Used
 * for cheap metadata fetches (list PRs, list issues, list workflows) so we
 * don't burn model tokens just to populate the dashboard.
 */
export async function github<T>(path: string): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new Error(`github ${path} ${res.status}`);
  }
  return res.json();
}

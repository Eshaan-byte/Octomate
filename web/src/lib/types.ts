/**
 * Types mirrored from the agent. Kept as a simple duplicate (no cross-package
 * imports) so the web bundle stays clean and the agent's node-only deps don't
 * leak into the browser build.
 */

export interface Repo {
  owner: string;
  repo: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  action?: string | null;
  data?: unknown;
  createdAt: string;
}

export interface AgentResponse {
  agent: string;
  reply: string;
  action?: string | null;
  data?: unknown;
  createdAt: string;
}

export interface PRReview {
  repo: string;
  number: number;
  title: string;
  author?: string;
  url?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  review: {
    summary?: string;
    risk?: "low" | "medium" | "high" | string;
    rationale?: string;
    file_notes?: Array<{ file: string; note: string }>;
    suggestions?: string[];
    verdict?: "approve" | "request_changes" | "comment" | string;
  };
}

export interface TriagedIssue {
  number: number;
  title: string;
  severity: "P0" | "P1" | "P2" | "P3" | string;
  area: string;
  suggested_labels: string[];
  suggested_assignee: string | null;
  reasoning: string;
}

export interface DependencyReport {
  repo: string;
  stats: { total: number; outdated: number; deprecated: number };
  dependencies: Array<{
    name: string;
    requested?: string;
    latest?: string | null;
    status: "up_to_date" | "outdated" | "deprecated" | "unknown";
    deprecated?: string | null;
  }>;
  report: {
    health_score?: number;
    headline?: string;
    critical?: string[];
    recommended?: string[];
    upgrade_order?: string[];
    notes?: string;
  };
}

export interface ActivityDigest {
  repo: string;
  window_days: number;
  stats: {
    commits: number;
    merged_prs: number;
    closed_issues: number;
    contributors: number;
  };
  contributors: string[];
  digest: {
    headline?: string;
    highlights?: string[];
    themes?: string[];
    watch_items?: string[];
  };
}

export interface CIReport {
  repo: string;
  workflows: Array<{
    name: string;
    path: string;
    latest: string;
    fail_streak: number;
    flaky: boolean;
    recent_runs: Array<{
      id: number;
      status: string | null;
      conclusion: string | null;
      branch: string | null;
      sha: string;
      url: string;
      created_at: string;
      actor?: string;
    }>;
  }>;
  failing_count: number;
  flaky_count: number;
  verdict: {
    headline?: string;
    verdict?: "green" | "yellow" | "red" | string;
    advice?: string;
  };
}

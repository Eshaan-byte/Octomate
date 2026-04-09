import type { Action } from "../../types.js";
import { chatCreate } from "../../llm.js";

/**
 * TRIAGE_ISSUES — Fetches open issues and classifies each by severity, area,
 * suggested labels, and suggested assignee (based on recent committers).
 */
export const triageIssues: Action = {
  name: "TRIAGE_ISSUES",
  similes: ["TRIAGE", "CLASSIFY_ISSUES", "SORT_ISSUES"],
  description:
    "Classify a batch of open GitHub issues by severity and area. Use when the user asks to triage, sort, prioritize, or classify issues.",
  examples: [
    "triage the open issues",
    "classify the last 10 issues",
    "prioritize what's in the inbox",
  ],

  validate: async (ctx, input) => {
    const text = input.text.toLowerCase();
    return /\b(triage|classify|prioritize|sort)\b.*\bissue/.test(text);
  },

  handler: async (ctx, input) => {
    const repo = (input.params.repo as typeof ctx.repo) || ctx.repo;
    const limit = Math.min(Number(input.params.limit ?? 10), 25);

    if (!repo) {
      return {
        text: "I need a repo to triage. Set one on the dashboard.",
        action: "TRIAGE_ISSUES",
      };
    }

    // GitHub's issues.listForRepo endpoint returns issues AND pull requests
    // interleaved. On active repos (where most recent activity is PRs) a
    // naive per_page: limit leaves almost no real issues after filtering.
    // Over-fetch to give the filter room to find `limit` actual issues.
    const fetchSize = Math.min(100, Math.max(limit * 5, 20));

    ctx.log("info", `TRIAGE_ISSUES ${repo.owner}/${repo.repo} limit=${limit} fetchSize=${fetchSize}`);

    let issues;
    let commits;
    try {
      [issues, commits] = await Promise.all([
        ctx.github.issues.listForRepo({
          ...repo,
          state: "open",
          per_page: fetchSize,
          sort: "created",
          direction: "desc",
        }),
        ctx.github.repos.listCommits({ ...repo, per_page: 30 }),
      ]);
    } catch (err) {
      // GitHub returns 410 Gone when a repo has issues disabled.
      const msg = (err as Error).message || "";
      if (/410|gone|disabled/i.test(msg)) {
        return {
          text: "Issues are disabled for this repository.",
          action: "TRIAGE_ISSUES",
          data: {
            repo: `${repo.owner}/${repo.repo}`,
            count: 0,
            triaged: [],
            summary: "This repo has the issues tab disabled, so there's nothing to triage.",
          },
        };
      }
      throw err;
    }

    // Skip PRs — the issues endpoint includes them. Then slice to `limit`.
    const realIssues = issues.data
      .filter((i) => !i.pull_request)
      .slice(0, limit);

    // Graceful empty state — repo has issues enabled but none are open.
    if (realIssues.length === 0) {
      return {
        text: "Inbox zero! No open issues to triage.",
        action: "TRIAGE_ISSUES",
        data: {
          repo: `${repo.owner}/${repo.repo}`,
          count: 0,
          triaged: [],
          summary: "This repo currently has no open issues.",
        },
      };
    }

    // Build a small pool of candidate assignees from recent committers.
    const committers = Array.from(
      new Set(
        commits.data
          .map((c) => c.author?.login)
          .filter((x): x is string => Boolean(x))
      )
    ).slice(0, 8);

    const issueBlob = realIssues
      .map(
        (i) =>
          `#${i.number} "${i.title}" by ${i.user?.login}\n  labels: ${i.labels
            .map((l) => (typeof l === "string" ? l : l.name))
            .join(", ") || "none"}\n  body: ${(i.body || "").slice(0, 400)}`
      )
      .join("\n\n");

    const prompt = `You are triaging open issues for a GitHub repository.

Repository: ${repo.owner}/${repo.repo}
Recent committers (possible assignees): ${committers.join(", ") || "(none)"}

Issues to triage:
${issueBlob}

For each issue, return a STRICT JSON object (no markdown) with this shape:
{
  "issues": [
    {
      "number": 123,
      "title": "...",
      "severity": "P0" | "P1" | "P2" | "P3",
      "area": "bug" | "feature" | "docs" | "question" | "chore",
      "suggested_labels": ["..."],
      "suggested_assignee": "login or null",
      "reasoning": "one short sentence"
    }
  ],
  "summary": "two-sentence overview of the queue"
}

Severity guide: P0 = production down, P1 = user-visible bug, P2 = non-critical bug, P3 = nice to have.`;

    const completion = await chatCreate(ctx.openai, {
      model: ctx.model,
      messages: [
        {
          role: "system",
          content: "You are OctoMate, a senior engineer triaging issues. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { issues?: unknown[]; summary?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { issues: [], summary: raw };
    }

    const count = Array.isArray(parsed.issues) ? parsed.issues.length : 0;

    return {
      text: `Triaged ${count} open issue${count === 1 ? "" : "s"}. ${parsed.summary ?? ""}`,
      action: "TRIAGE_ISSUES",
      data: {
        repo: `${repo.owner}/${repo.repo}`,
        count,
        triaged: parsed.issues ?? [],
        summary: parsed.summary ?? "",
      },
    };
  },
};

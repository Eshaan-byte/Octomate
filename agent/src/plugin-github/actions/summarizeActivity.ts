import type { Action } from "../../types.js";
import { chatCreate } from "../../llm.js";

/**
 * SUMMARIZE_ACTIVITY — Produces a weekly-digest-style summary of a repo's
 * recent commits, merged PRs, closed issues, and new contributors.
 */
export const summarizeActivity: Action = {
  name: "SUMMARIZE_ACTIVITY",
  similes: ["WEEKLY_DIGEST", "REPO_SUMMARY", "ACTIVITY_REPORT"],
  description:
    "Summarize recent activity in a repository over a time window. Use when the user asks what happened this week, for a digest, or for recent activity.",
  examples: [
    "what happened in this repo this week",
    "summarize the last 7 days",
    "give me a digest",
  ],

  validate: async (ctx, input) => {
    const t = input.text.toLowerCase();
    return /\b(what('s| is| happened)|digest|summary|summarize|activity|recent|this week|last week)\b/.test(
      t
    );
  },

  handler: async (ctx, input) => {
    const repo = (input.params.repo as typeof ctx.repo) || ctx.repo;
    const days = Math.min(Math.max(Number(input.params.days ?? 7), 1), 30);

    if (!repo) {
      return {
        text: "Tell me which repo — e.g. `octomate-dev/octomate`.",
        action: "SUMMARIZE_ACTIVITY",
      };
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    ctx.log("info", `SUMMARIZE_ACTIVITY ${repo.owner}/${repo.repo} since=${since}`);

    // Use allSettled so a repo with PRs disabled (torvalds/linux) or issues
    // disabled still produces a digest from whatever endpoints *do* work.
    const [commitsRes, prsRes, issuesRes] = await Promise.allSettled([
      ctx.github.repos.listCommits({ ...repo, since, per_page: 50 }),
      ctx.github.pulls.list({
        ...repo,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 50,
      }),
      ctx.github.issues.listForRepo({
        ...repo,
        state: "closed",
        since,
        per_page: 50,
      }),
    ]);

    const unavailable: string[] = [];
    const commits =
      commitsRes.status === "fulfilled"
        ? commitsRes.value
        : (unavailable.push("commits"), { data: [] as Awaited<ReturnType<typeof ctx.github.repos.listCommits>>["data"] });
    const mergedPRs =
      prsRes.status === "fulfilled"
        ? prsRes.value
        : (unavailable.push("pull requests"), { data: [] as Awaited<ReturnType<typeof ctx.github.pulls.list>>["data"] });
    const closedIssues =
      issuesRes.status === "fulfilled"
        ? issuesRes.value
        : (unavailable.push("issues"), { data: [] as Awaited<ReturnType<typeof ctx.github.issues.listForRepo>>["data"] });

    if (unavailable.length > 0) {
      ctx.log(
        "info",
        `SUMMARIZE_ACTIVITY ${repo.owner}/${repo.repo} — unavailable: ${unavailable.join(", ")}`
      );
    }

    // If literally nothing came back, bail out cleanly instead of asking
    // the LLM to summarize nothing.
    if (commits.data.length === 0 && mergedPRs.data.length === 0 && closedIssues.data.length === 0) {
      return {
        text: unavailable.length === 3
          ? "This repo has no accessible activity (commits, PRs, and issues all unavailable)."
          : `No activity in the last ${days} days.`,
        action: "SUMMARIZE_ACTIVITY",
        data: {
          repo: `${repo.owner}/${repo.repo}`,
          window_days: days,
          stats: { commits: 0, merged_prs: 0, closed_issues: 0, contributors: 0 },
          contributors: [],
          unavailable,
          digest: {
            headline: `Quiet week for ${repo.owner}/${repo.repo}`,
            highlights: [],
            themes: [],
            watch_items: [],
          },
        },
      };
    }

    const mergedInWindow = mergedPRs.data.filter(
      (p) => p.merged_at && new Date(p.merged_at).getTime() >= Date.parse(since)
    );
    const closed = closedIssues.data.filter((i) => !i.pull_request);

    const contributors = Array.from(
      new Set(
        commits.data
          .map((c) => c.author?.login)
          .filter((x): x is string => Boolean(x))
      )
    );

    const commitLines = commits.data
      .slice(0, 30)
      .map(
        (c) =>
          `- ${c.sha.slice(0, 7)} ${c.commit.message.split("\n")[0]} (${c.author?.login ?? "?"})`
      )
      .join("\n");

    const prLines = mergedInWindow
      .slice(0, 20)
      .map((p) => `- #${p.number} ${p.title} (${p.user?.login})`)
      .join("\n");

    const issueLines = closed
      .slice(0, 20)
      .map((i) => `- #${i.number} ${i.title}`)
      .join("\n");

    const prompt = `Write a concise weekly digest for this repository.

Repository: ${repo.owner}/${repo.repo}
Window: last ${days} day(s)
Contributors: ${contributors.join(", ") || "(none)"}

Commits (${commits.data.length}):
${commitLines || "(none)"}

Merged PRs (${mergedInWindow.length}):
${prLines || "(none)"}

Closed issues (${closed.length}):
${issueLines || "(none)"}

Return STRICT JSON (no markdown) with this shape:
{
  "headline": "one-line summary",
  "highlights": ["3-5 bullet points of what actually matters"],
  "themes": ["short theme tags like 'performance', 'docs', 'bugfixes'"],
  "watch_items": ["1-3 things worth keeping an eye on next week"]
}`;

    const completion = await chatCreate(ctx.openai, {
      model: ctx.model,
      messages: [
        {
          role: "system",
          content: "You are OctoMate writing a weekly repo digest. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let digest: Record<string, unknown>;
    try {
      digest = JSON.parse(raw);
    } catch {
      digest = { headline: raw, highlights: [], themes: [], watch_items: [] };
    }

    return {
      text: `${digest.headline ?? "Weekly digest ready."}`,
      action: "SUMMARIZE_ACTIVITY",
      data: {
        repo: `${repo.owner}/${repo.repo}`,
        window_days: days,
        stats: {
          commits: commits.data.length,
          merged_prs: mergedInWindow.length,
          closed_issues: closed.length,
          contributors: contributors.length,
        },
        contributors,
        unavailable,
        digest,
      },
    };
  },
};

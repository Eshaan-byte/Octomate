import type { Action } from "../../types.js";
import { chatCreate } from "../../llm.js";

/**
 * CI_STATUS — Fetches the latest GitHub Actions workflow runs, reports
 * per-workflow pass/fail streaks, and flags flaky-test candidates.
 */
export const ciStatus: Action = {
  name: "CI_STATUS",
  similes: ["CHECK_CI", "WORKFLOW_STATUS", "BUILD_STATUS"],
  description:
    "Report the state of GitHub Actions / CI for a repository. Use when the user asks about CI, builds, workflows, or tests passing.",
  examples: [
    "is CI green",
    "what's the state of CI",
    "show me the build status",
  ],

  validate: async (ctx, input) => {
    const t = input.text.toLowerCase();
    return /\b(ci|build|workflow|actions|green|red|failing|passing|tests? passing)\b/.test(
      t
    );
  },

  handler: async (ctx, input) => {
    const repo = (input.params.repo as typeof ctx.repo) || ctx.repo;
    if (!repo) {
      return {
        text: "Which repo should I check CI for?",
        action: "CI_STATUS",
      };
    }

    ctx.log("info", `CI_STATUS ${repo.owner}/${repo.repo}`);

    let workflows;
    try {
      workflows = await ctx.github.actions.listRepoWorkflows({
        ...repo,
        per_page: 20,
      });
    } catch (err) {
      return {
        text: "GitHub Actions isn't enabled for this repo, or I don't have permission to read it.",
        action: "CI_STATUS",
        data: {
          repo: `${repo.owner}/${repo.repo}`,
          workflows: [],
          failing_count: 0,
          flaky_count: 0,
          verdict: {
            headline: "No GitHub Actions access",
            verdict: "unknown",
            advice: (err as Error).message,
          },
        },
      };
    }

    // Graceful empty state: repo has no Actions workflows at all (common for
    // projects that use Circle, Jenkins, Travis, or no CI).
    if (workflows.data.total_count === 0 || workflows.data.workflows.length === 0) {
      return {
        text: "This repo has no GitHub Actions workflows.",
        action: "CI_STATUS",
        data: {
          repo: `${repo.owner}/${repo.repo}`,
          workflows: [],
          failing_count: 0,
          flaky_count: 0,
          verdict: {
            headline: "No GitHub Actions workflows defined",
            verdict: "none",
            advice: "This project doesn't use GitHub Actions for CI. It may use Circle, Jenkins, Travis, or no CI at all.",
          },
        },
      };
    }

    // For each active workflow, grab the last 10 runs and compute a streak.
    const perWorkflow = await Promise.all(
      workflows.data.workflows
        .filter((w) => w.state === "active")
        .slice(0, 10)
        .map(async (w) => {
          const runs = await ctx.github.actions.listWorkflowRuns({
            ...repo,
            workflow_id: w.id,
            per_page: 10,
          });
          const results = runs.data.workflow_runs.map((r) => ({
            id: r.id,
            status: r.status,
            conclusion: r.conclusion,
            branch: r.head_branch,
            sha: r.head_sha?.slice(0, 7),
            url: r.html_url,
            created_at: r.created_at,
            actor: r.actor?.login,
          }));

          // Consecutive failures from the top.
          let failStreak = 0;
          for (const r of results) {
            if (r.conclusion === "failure") failStreak++;
            else break;
          }

          // Flakiness heuristic: alternating success/failure in the window.
          let flips = 0;
          for (let i = 1; i < results.length; i++) {
            if (
              results[i].conclusion &&
              results[i - 1].conclusion &&
              results[i].conclusion !== results[i - 1].conclusion
            )
              flips++;
          }
          const flaky = flips >= 4;

          return {
            name: w.name,
            path: w.path,
            latest: results[0]?.conclusion ?? "unknown",
            fail_streak: failStreak,
            flaky,
            recent_runs: results,
          };
        })
    );

    const failing = perWorkflow.filter((w) => w.latest === "failure");
    const flaky = perWorkflow.filter((w) => w.flaky);

    // Brief LLM commentary — the data is already structured, we just want a
    // one-line senior-engineer verdict.
    const prompt = `Summarize CI health in one or two sentences.

Repository: ${repo.owner}/${repo.repo}
Workflows: ${perWorkflow.length}
Failing workflows: ${failing.map((f) => f.name).join(", ") || "none"}
Flaky workflows: ${flaky.map((f) => f.name).join(", ") || "none"}

Return STRICT JSON (no markdown):
{ "headline": "...", "verdict": "green" | "yellow" | "red", "advice": "one sentence" }`;

    const completion = await chatCreate(ctx.openai, {
      model: ctx.model,
      messages: [
        {
          role: "system",
          content: "You are OctoMate reporting CI health. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let verdict: Record<string, unknown>;
    try {
      verdict = JSON.parse(raw);
    } catch {
      verdict = { headline: raw, verdict: "unknown", advice: "" };
    }

    return {
      text: `${verdict.headline ?? "CI report ready."}`,
      action: "CI_STATUS",
      data: {
        repo: `${repo.owner}/${repo.repo}`,
        workflows: perWorkflow,
        failing_count: failing.length,
        flaky_count: flaky.length,
        verdict,
      },
    };
  },
};

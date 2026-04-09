import type { Action } from "../../types.js";
import { chatCreate } from "../../llm.js";

/**
 * REVIEW_PR — Fetches a pull request's metadata and diff, asks the model to
 * produce a structured review (summary, risk level, file notes, suggestions).
 */
export const reviewPR: Action = {
  name: "REVIEW_PR",
  similes: ["REVIEW_PULL_REQUEST", "CODE_REVIEW", "INSPECT_PR"],
  description:
    "Review a GitHub pull request. Use when the user asks to review, audit, or check a PR by number.",
  examples: [
    "review PR 42",
    "audit pull request 1234 on vercel/next.js",
    "check PR #7 for risks",
  ],

  validate: async (ctx, input) => {
    const text = input.text.toLowerCase();
    // Any mention of a PR (word, #number, or explicit param) is enough — we
    // don't require a specific verb, because natural phrasings like
    // "latest pr what was it about" or "tell me about pr #42" are valid.
    const hasPR = /\b(pr|prs|pull request|pull requests)\b/.test(text) || /#\d+/.test(text);
    const hasParam =
      typeof input.params.pr === "number" ||
      typeof input.params.pr_number === "number" ||
      typeof input.params.number === "number";
    return Boolean(hasPR || hasParam);
  },

  handler: async (ctx, input) => {
    const repo = (input.params.repo as typeof ctx.repo) || ctx.repo;
    // Accept any of `pr`, `pr_number`, `number` for robustness — the frontend
    // uses `pr`, but direct API callers often reach for the GitHub-native
    // `pr_number`. Fall back to parsing the free-text message — but only
    // #-prefixed numbers, because free-floating digits in the text are often
    // counts ("last 10 PRs") not PR numbers.
    const textMatch = input.text.match(/#(\d+)/)?.[1];
    const rawNumber =
      input.params.pr ??
      input.params.pr_number ??
      input.params.number ??
      textMatch;

    if (!repo) {
      return {
        text: "I need a repo to review a PR. Set one on the dashboard or say `owner/repo #42`.",
        action: "REVIEW_PR",
      };
    }

    // "latest"/"most recent"/"newest" semantics: if we don't have an explicit
    // number, look up the most recent PR in the repo and review that. This
    // makes queries like "latest pr what was it about" actually work.
    const wantsLatest = /\b(latest|most recent|newest|last)\b/i.test(input.text);
    let prNumber = Number(rawNumber);

    if (!Number.isFinite(prNumber)) {
      if (!wantsLatest) {
        return {
          text: "I couldn't find a PR number in your message. Try `review PR #42` or `latest PR`.",
          action: "REVIEW_PR",
        };
      }
      try {
        const recent = await ctx.github.pulls.list({
          ...repo,
          state: "all",
          sort: "created",
          direction: "desc",
          per_page: 1,
        });
        if (recent.data.length === 0) {
          return {
            text: `${repo.owner}/${repo.repo} has no pull requests.`,
            action: "REVIEW_PR",
          };
        }
        prNumber = recent.data[0].number;
        ctx.log("info", `REVIEW_PR resolved "latest" -> #${prNumber}`);
      } catch (err) {
        return {
          text: `I couldn't fetch the latest PR: ${(err as Error).message}`,
          action: "REVIEW_PR",
        };
      }
    }

    ctx.log("info", `REVIEW_PR ${repo.owner}/${repo.repo}#${prNumber}`);

    const [pr, files] = await Promise.all([
      ctx.github.pulls.get({ ...repo, pull_number: prNumber }),
      ctx.github.pulls.listFiles({
        ...repo,
        pull_number: prNumber,
        per_page: 50,
      }),
    ]);

    // Build a compact diff summary for the LLM. Truncate per-file patches to
    // avoid blowing up the context window on large PRs.
    const diff = files.data
      .map((f) => {
        const patch = (f.patch || "").slice(0, 4000);
        return `### ${f.filename} (+${f.additions} -${f.deletions})\n${patch}`;
      })
      .join("\n\n")
      .slice(0, 24000);

    const prompt = `You are reviewing a pull request. Be terse and senior.

Repository: ${repo.owner}/${repo.repo}
PR #${prNumber}: ${pr.data.title}
Author: ${pr.data.user?.login}
Branch: ${pr.data.head.ref} -> ${pr.data.base.ref}
Description:
${(pr.data.body || "(no description)").slice(0, 2000)}

Files changed (${files.data.length}, +${pr.data.additions}/-${pr.data.deletions}):
${diff}

Respond with a STRICT JSON object matching this shape (no markdown fences):
{
  "summary": "2-3 sentence plain-English summary",
  "risk": "low" | "medium" | "high",
  "rationale": "why this risk level, one sentence",
  "file_notes": [{"file": "path", "note": "one-sentence observation"}],
  "suggestions": ["short actionable suggestion", ...],
  "verdict": "approve" | "request_changes" | "comment"
}`;

    const completion = await chatCreate(ctx.openai, {
      model: ctx.model,
      messages: [
        {
          role: "system",
          content: "You are OctoMate, a senior staff engineer. Output valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let review: Record<string, unknown>;
    try {
      review = JSON.parse(raw);
    } catch {
      review = { summary: raw, risk: "unknown", file_notes: [], suggestions: [] };
    }

    const risk = String(review.risk ?? "unknown").toUpperCase();
    const verdict = String(review.verdict ?? "comment").replace("_", " ");

    return {
      text: `**PR #${prNumber} — ${pr.data.title}** — ${risk} risk, verdict: ${verdict}.`,
      action: "REVIEW_PR",
      data: {
        repo: `${repo.owner}/${repo.repo}`,
        number: prNumber,
        title: pr.data.title,
        author: pr.data.user?.login,
        url: pr.data.html_url,
        additions: pr.data.additions,
        deletions: pr.data.deletions,
        changed_files: files.data.length,
        review,
      },
    };
  },
};

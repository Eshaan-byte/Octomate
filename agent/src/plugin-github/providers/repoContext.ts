import type { Provider } from "../../types.js";

/**
 * repoContextProvider — if the runtime has an active repo selected, fetch a
 * tiny status snapshot (description, default branch, open PR count, open issue
 * count, latest default-branch commit) and format it as a context block that
 * gets prepended to the model's system prompt on every turn.
 *
 * This is what makes OctoMate feel "repo-aware" rather than a generic chatbot.
 */
export const repoContextProvider: Provider = {
  name: "repoContext",

  get: async (ctx) => {
    if (!ctx.repo) return "";

    try {
      const [meta, commits] = await Promise.all([
        ctx.github.repos.get({ ...ctx.repo }),
        ctx.github.repos.listCommits({ ...ctx.repo, per_page: 1 }),
      ]);

      // `open_issues_count` includes PRs — fetch PRs separately to split them.
      const prs = await ctx.github.pulls.list({
        ...ctx.repo,
        state: "open",
        per_page: 1,
      });
      const openPRCount =
        // Use the Link header total if available, else fall back to the array length.
        Number(
          (prs.headers.link || "")
            .match(/page=(\d+)>; rel="last"/)?.[1] ?? prs.data.length
        );
      const openIssueCount = Math.max(
        meta.data.open_issues_count - openPRCount,
        0
      );

      const latest = commits.data[0];
      const lines = [
        `[repo_context]`,
        `repo: ${meta.data.full_name}`,
        `description: ${meta.data.description ?? "(none)"}`,
        `default_branch: ${meta.data.default_branch}`,
        `stars: ${meta.data.stargazers_count}`,
        `open_prs: ${openPRCount}`,
        `open_issues: ${openIssueCount}`,
        latest
          ? `latest_commit: ${latest.sha.slice(0, 7)} "${latest.commit.message.split("\n")[0]}" by ${latest.author?.login ?? "?"}`
          : "latest_commit: (none)",
        `[/repo_context]`,
      ];
      return lines.join("\n");
    } catch (err) {
      ctx.log("warn", `repoContextProvider failed: ${(err as Error).message}`);
      return "";
    }
  },
};

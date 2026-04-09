import type { Plugin } from "../types.js";
import { reviewPR } from "./actions/reviewPR.js";
import { triageIssues } from "./actions/triageIssue.js";
import { summarizeActivity } from "./actions/summarizeActivity.js";
import { checkDependencies } from "./actions/checkDependencies.js";
import { ciStatus } from "./actions/ciStatus.js";
import { repoContextProvider } from "./providers/repoContext.js";

/**
 * plugin-github — OctoMate's core plugin. Bundles five repo-aware actions and
 * the repoContext provider that keeps every LLM turn grounded in live data.
 */
export const githubPlugin: Plugin = {
  name: "plugin-github",
  description:
    "GitHub repository operations: PR review, issue triage, activity digest, dependency audit, CI status.",
  actions: [reviewPR, triageIssues, summarizeActivity, checkDependencies, ciStatus],
  providers: [repoContextProvider],
};

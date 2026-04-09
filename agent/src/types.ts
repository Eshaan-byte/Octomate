/**
 * Local type definitions that mirror the ElizaOS v2 Action / Provider / Plugin
 * interfaces. We declare them here (rather than importing from `@elizaos/core`)
 * so the agent is resilient to upstream API churn and compiles cleanly against
 * whatever version is installed. The action objects we export still satisfy
 * the upstream interface and can be dropped into a full ElizaOS v2 runtime.
 *
 * Reference: https://github.com/elizaOS/eliza
 */

import type { Octokit } from "@octokit/rest";
import type OpenAI from "openai";

/** A free-form runtime context passed into every action / provider. */
export interface RuntimeContext {
  /** OpenAI-compatible client routed at the configured model endpoint. */
  openai: OpenAI;
  /** Model name (e.g. "qwen3.5-27b-awq-4bit"). */
  model: string;
  /** Per-request Octokit instance, authed with the caller's PAT. */
  github: Octokit;
  /** Currently-selected repository, if any. */
  repo?: { owner: string; repo: string };
  /** Free-form key/value store for providers to stash data. */
  state: Record<string, unknown>;
  /** Logger. */
  log: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
}

/** Payload passed into action handlers. */
export interface ActionInput {
  /** The user's natural-language message, if any. */
  text: string;
  /** Structured parameters parsed by the orchestrator (repo, pr number, etc.). */
  params: Record<string, unknown>;
}

/** Shape of a structured action result the frontend can render. */
export interface ActionResult {
  /** Short human summary (rendered into the chat stream). */
  text: string;
  /** The action name that produced this result (e.g. "REVIEW_PR"). */
  action: string;
  /** Structured data for rich-card rendering. */
  data?: Record<string, unknown>;
}

/**
 * An action the agent can invoke. Shape matches ElizaOS v2's Action interface
 * closely enough to be registerable with the full runtime.
 */
export interface Action {
  /** Canonical name, e.g. "REVIEW_PR". */
  name: string;
  /** Alternative triggers used by LLM routing. */
  similes?: string[];
  /** When the LLM should consider this action. */
  description: string;
  /** Example trigger phrases. */
  examples?: string[];
  /**
   * Returns true if the action should be run. In this local runtime we use a
   * simple keyword check; the full ElizaOS runtime can use LLM routing.
   */
  validate: (ctx: RuntimeContext, input: ActionInput) => Promise<boolean>;
  /** Execute the action. Returns a structured result. */
  handler: (ctx: RuntimeContext, input: ActionInput) => Promise<ActionResult>;
}

/** A provider supplies context that gets injected into the system prompt. */
export interface Provider {
  name: string;
  get: (ctx: RuntimeContext) => Promise<string>;
}

/** A plugin bundles actions and providers. */
export interface Plugin {
  name: string;
  description?: string;
  actions?: Action[];
  providers?: Provider[];
}

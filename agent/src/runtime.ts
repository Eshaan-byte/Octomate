import OpenAI from "openai";
import type { Action, ActionResult, Plugin, RuntimeContext } from "./types.js";
import type { Octokit } from "@octokit/rest";
import { chatCreate } from "./llm.js";

/**
 * A minimal agent runtime that loads plugins, exposes an `invoke(text, ctx)`
 * entrypoint, and:
 *   1. Runs all providers to assemble context.
 *   2. Asks the LLM which action (if any) to invoke, via a simple tool-choice
 *      prompt over the set of action names + descriptions. The LLM returns
 *      JSON {action: string|null, params: {...}, reply: string}.
 *   3. If an action is chosen AND its validate() returns true, runs the
 *      handler and returns the structured result.
 *   4. Otherwise returns a plain chat reply.
 *
 * This is NOT the full ElizaOS v2 runtime — it's a pragmatic subset that
 * runs the same action objects. The action exports are drop-in compatible
 * with ElizaOS v2 and can be registered with the full runtime later.
 */

export interface RuntimeConfig {
  plugins: Plugin[];
  character: {
    name: string;
    system: string;
    bio?: string[];
    style?: { all?: string[]; chat?: string[] };
  };
  openai: OpenAI;
  model: string;
}

export class Runtime {
  private actions: Action[];
  private config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.actions = config.plugins.flatMap((p) => p.actions ?? []);
  }

  /** List all registered actions (name + description). */
  listActions(): Array<{ name: string; description: string }> {
    return this.actions.map((a) => ({ name: a.name, description: a.description }));
  }

  /** Build a RuntimeContext for an ad-hoc action invocation. */
  makeContext(partial: {
    github: Octokit;
    repo?: { owner: string; repo: string };
  }): RuntimeContext {
    return {
      openai: this.config.openai,
      model: this.config.model,
      github: partial.github,
      repo: partial.repo,
      state: {},
      log: (level, msg, meta) => {
        const ts = new Date().toISOString();
        // eslint-disable-next-line no-console
        console[level === "error" ? "error" : "log"](
          `[${ts}] [${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`
        );
      },
    };
  }

  /** Run a specific action by name (bypasses LLM routing). */
  async runAction(
    name: string,
    ctx: RuntimeContext,
    input: { text: string; params: Record<string, unknown> }
  ): Promise<ActionResult> {
    const action = this.actions.find((a) => a.name === name);
    if (!action) throw new Error(`unknown action: ${name}`);
    return action.handler(ctx, input);
  }

  private buildSystemPrompt(providerOutputs: string[]): string {
    const { character } = this.config;
    const styleBlock = [
      ...(character.style?.all ?? []),
      ...(character.style?.chat ?? []),
    ].join("\n- ");

    return [
      character.system,
      character.bio?.length ? `Background:\n- ${character.bio.join("\n- ")}` : "",
      styleBlock ? `Style:\n- ${styleBlock}` : "",
      providerOutputs.filter(Boolean).join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async runProviders(ctx: RuntimeContext): Promise<string[]> {
    const providers = this.config.plugins.flatMap((p) => p.providers ?? []);
    return Promise.all(
      providers.map(async (p) => {
        try {
          return await p.get(ctx);
        } catch (err) {
          ctx.log("warn", `provider ${p.name} failed: ${(err as Error).message}`);
          return "";
        }
      })
    );
  }

  /**
   * Ask the model to route the user's message to an action (or no action).
   * Returns {action, params, reply}.
   */
  private async route(
    ctx: RuntimeContext,
    userText: string,
    systemPrompt: string
  ): Promise<{ action: string | null; params: Record<string, unknown>; reply: string }> {
    const toolMenu = this.actions
      .map(
        (a) =>
          `- ${a.name}: ${a.description}${
            a.similes?.length ? ` (aliases: ${a.similes.join(", ")})` : ""
          }`
      )
      .join("\n");

    const routingPrompt = `${systemPrompt}

You have these tools available:
${toolMenu}

The user said:
"""
${userText}
"""

Decide whether to call a tool. If yes, pick ONE. Extract params (like \`pr\` number, \`days\`, \`limit\`) from the message.

Respond with STRICT JSON (no markdown) matching:
{
  "action": "TOOL_NAME" | null,
  "params": { "pr": number?, "days": number?, "limit": number? },
  "reply": "what to say to the user while the tool runs (1 short sentence). If no tool is chosen, this is the final answer."
}`;

    const completion = await chatCreate(this.config.openai, {
      model: this.config.model,
      messages: [{ role: "user", content: routingPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw);
      return {
        action: parsed.action ?? null,
        params: parsed.params ?? {},
        reply: parsed.reply ?? "",
      };
    } catch {
      return { action: null, params: {}, reply: raw };
    }
  }

  async invoke(
    userText: string,
    partialCtx: {
      github: Octokit;
      repo?: { owner: string; repo: string };
    }
  ): Promise<{ reply: string; result?: ActionResult }> {
    const ctx: RuntimeContext = {
      openai: this.config.openai,
      model: this.config.model,
      github: partialCtx.github,
      repo: partialCtx.repo,
      state: {},
      log: (level, msg, meta) => {
        const ts = new Date().toISOString();
        // eslint-disable-next-line no-console
        console[level === "error" ? "error" : "log"](
          `[${ts}] [${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`
        );
      },
    };

    const providerOutputs = await this.runProviders(ctx);
    const systemPrompt = this.buildSystemPrompt(providerOutputs);

    const routed = await this.route(ctx, userText, systemPrompt);

    if (!routed.action) {
      // No tool call — the reply is the final answer. Run a normal chat turn
      // so the model has full context (providers + history).
      const chat = await chatCreate(this.config.openai, {
        model: this.config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        temperature: 0.5,
      });
      return { reply: chat.choices[0]?.message?.content ?? routed.reply };
    }

    const action = this.actions.find((a) => a.name === routed.action);
    if (!action) {
      return { reply: `I tried to use \`${routed.action}\` but it's not registered.` };
    }

    const input = { text: userText, params: routed.params };
    const valid = await action.validate(ctx, input);
    if (!valid) {
      // The model picked a tool but our validate() says no. Don't return
      // routed.reply as the final answer — that string was the LLM's
      // "while the tool runs" narration ("Fetching details for PR #7379…"),
      // and surfacing it would mislead the user into thinking work is
      // happening. Run a real chat turn instead.
      ctx.log(
        "info",
        `routed to ${action.name} but validate() rejected — falling back to chat`
      );
      const chat = await chatCreate(this.config.openai, {
        model: this.config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        temperature: 0.5,
      });
      return {
        reply:
          chat.choices[0]?.message?.content ??
          "I couldn't complete that action.",
      };
    }

    try {
      const result = await action.handler(ctx, input);
      return { reply: result.text, result };
    } catch (err) {
      ctx.log("error", `action ${action.name} failed: ${(err as Error).message}`);
      return {
        reply: `Action \`${action.name}\` failed: ${(err as Error).message}`,
      };
    }
  }
}

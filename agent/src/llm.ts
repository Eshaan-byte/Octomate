import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

/**
 * Wraps OpenAI chat.completions.create so every call gets the vLLM extras
 * we need on the Nosana-hosted Qwen3.5 endpoint. Specifically:
 *
 *   chat_template_kwargs: { enable_thinking: false }
 *
 * Without this, Qwen3.5 runs in "thinking mode" and all output goes into a
 * non-standard `reasoning` field — `message.content` comes back null and
 * latency balloons from ~2s to ~16s.
 *
 * The field isn't in the OpenAI SDK's types but vLLM forwards any unknown
 * top-level body keys, so a cast is safe.
 *
 * Also retries on transient failures. Nosana's decentralized GPU nodes
 * occasionally return 5xx / connection resets mid-inference; without a
 * retry a single hiccup bubbles up as "Internal Server Error" to the user.
 */
export async function chatCreate(
  openai: OpenAI,
  params: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> {
  const body = {
    ...params,
    chat_template_kwargs: { enable_thinking: false },
  } as ChatCompletionCreateParamsNonStreaming;

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await openai.chat.completions.create(body);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;
      // Exponential backoff: 500ms, 1500ms. Tiny jitter to avoid
      // thundering-herd against a single Nosana node.
      const delay = 500 * attempt * attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const e = err as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  if (e?.status && e.status >= 500 && e.status < 600) return true;
  if (e?.status === 408 || e?.status === 429) return true;
  if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT") return true;
  if (e?.code === "ECONNREFUSED" || e?.code === "EAI_AGAIN") return true;
  if (e?.name === "APIConnectionError") return true;
  if (e?.name === "APIConnectionTimeoutError") return true;
  // OpenAI SDK surfaces network issues as "Connection error."
  if (typeof e?.message === "string" && /connection/i.test(e.message)) return true;
  return false;
}

import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Which model to talk to, and through what.
 *
 * Two routes, because they fail for different reasons. The Vercel AI Gateway is the
 * default — one key, every provider, usage visible in one place — but it declines to
 * serve requests until the Vercel account has a card on file, even on free credits. An
 * ANTHROPIC_API_KEY skips all of that and bills Anthropic directly. Set either.
 */
export const MODEL_NAME = "claude-sonnet-5";

export type ModelRoute = { model: LanguageModel; via: "anthropic" | "gateway" };

export function resolveModel(): ModelRoute | { error: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return { model: anthropic(MODEL_NAME), via: "anthropic" };
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    // A bare "provider/model" string routes through the Gateway.
    return { model: `anthropic/${MODEL_NAME}`, via: "gateway" };
  }
  return {
    error:
      "No model credentials. Set ANTHROPIC_API_KEY, or AI_GATEWAY_API_KEY for the Vercel AI Gateway.",
  };
}

// Provider errors arrive wrapped in ANSI colour codes, which read as line noise in a
// browser. Strip them, then say the useful part plainly.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[\\d+m", "g");

/** Turns provider noise into something a person can act on. */
export function explainModelError(raw: string): string {
  const clean = raw.replace(ANSI, "").trim();

  if (/credit card|add a card/i.test(clean)) {
    return (
      "The Vercel AI Gateway won't serve requests until the account has a card on file. " +
      "Add one, or set ANTHROPIC_API_KEY to bill Anthropic directly instead."
    );
  }
  if (/unauthenticated|authentication failed|invalid api key|401/i.test(clean)) {
    return "The model provider rejected our API key. Check AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY.";
  }
  if (/rate limit|429/i.test(clean)) {
    return "The model provider is rate-limiting us. Try again in a moment.";
  }
  return clean;
}

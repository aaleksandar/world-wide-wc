import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Which model to reason with, and through what.
 *
 * Two routes because they fail differently. An ANTHROPIC_API_KEY bills Anthropic directly
 * and works immediately. The Vercel AI Gateway is one key for every provider, but its free
 * tier refuses the good models outright — `claude-sonnet-5` answers "Free tier users do
 * not have access to this model" — so the default gateway model is one the free tier will
 * actually serve. Add paid credits and set WWWC_MODEL to upgrade.
 *
 * The judge is deliberately insensitive to this choice: lib/evidence.ts establishes every
 * fact deterministically, so the model is only ever asked to weigh settled evidence, never
 * to count days or diff fields.
 */
const GATEWAY_DEFAULT = "openai/gpt-oss-120b";
const ANTHROPIC_DEFAULT = "claude-sonnet-5";

export type ModelRoute = { model: LanguageModel; name: string; via: "anthropic" | "gateway" };

export function resolveModel(): ModelRoute | { error: string } {
  const override = process.env.WWWC_MODEL;

  if (process.env.ANTHROPIC_API_KEY) {
    const name = override?.replace(/^anthropic\//, "") ?? ANTHROPIC_DEFAULT;
    return { model: anthropic(name), name, via: "anthropic" };
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    const name = override ?? GATEWAY_DEFAULT;
    return { model: name, name, via: "gateway" };
  }
  return {
    error:
      "No model credentials. Set ANTHROPIC_API_KEY, or AI_GATEWAY_API_KEY for the Vercel AI Gateway.",
  };
}

// Provider errors arrive wrapped in ANSI colour codes, which read as line noise anywhere
// but a terminal that wants them.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[\\d+m", "g");

/** Turns provider noise into something a person can act on. */
export function explainModelError(raw: string): string {
  const clean = raw.replace(ANSI, "").trim();

  if (/free tier users do not have access/i.test(clean)) {
    return (
      "The Vercel AI Gateway's free tier will not serve that model. Add paid credits, or " +
      `set WWWC_MODEL to one it allows (${GATEWAY_DEFAULT}).`
    );
  }
  if (/rate.?limit/i.test(clean)) {
    return "The model provider is rate-limiting us — the free tier throttles hard. Try again shortly.";
  }
  if (/credit card|add a card/i.test(clean)) {
    return "The Vercel AI Gateway wants a card on the account before it will serve requests.";
  }
  if (/unauthenticated|authentication failed|invalid api key|401/i.test(clean)) {
    return "The model provider rejected our API key.";
  }
  return clean.split("\n")[0];
}

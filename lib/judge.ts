import { generateObject } from "ai";
import { z } from "zod";
import type { Evidence } from "./evidence";
import { explainModelError, resolveModel } from "./model";

/**
 * Weighs gathered evidence and decides how much a stranger should trust an entry.
 *
 * The model's job is judgement, not retrieval. lib/evidence.ts has already established
 * whether the source resolves, how old it is and which fields it contradicts; asking a
 * model to do any of that would be asking it to be a worse HTTP client. What it is
 * genuinely good at is the part that has no formula: weighing a five-year-old but
 * uncontradicted source against a fresh one that disagrees on price.
 */

export const BANDS = {
  low: "the source is gone, or it contradicts what we recorded",
  medium: "the source is real but stale, or only partly supports the entry",
  max: "the source resolves, is recent, and corroborates the claims",
} as const;

export type Band = keyof typeof BANDS;

const Verdict = z.object({
  score: z.number().min(0).max(100).describe("How much a stranger should trust this entry."),
  reasoning: z
    .string()
    .max(160)
    .describe("One sentence, citing the specific evidence that decided it."),
});

export type Judgement = { score: number; band: Band; reasoning: string; model: string };

export const bandFor = (score: number): Band => (score >= 80 ? "max" : score >= 40 ? "medium" : "low");

const SYSTEM = `You score how much a stranger should trust an entry on a public-toilet map, from gathered evidence.

The bands, which the score must land in:
  0-39   low     — the source is gone, or it contradicts what we recorded
  40-79  medium  — the source is real but stale, or only partly supports the entry
  80-100 max     — the source resolves, is recent, and corroborates the claims

How to weigh what you are given:
- Contradictions are the most serious signal. A source that now disagrees about access or
  price means the entry is wrong, not merely old. Any contradiction caps the score below 40.
- sourceStatus "gone" means the source was deleted. That is a low score.
- sourceStatus "blocked" means a site refused our crawler — 403 and the like. That tells
  you nothing about the toilet, so do not punish it; score on the remaining evidence and
  say the source could not be read. It is never worse than medium for that reason alone.
- Age matters but is not fatal. A source last surveyed within a year is fresh; several
  years untouched is stale and belongs in medium even when nothing contradicts it.
- surveyAgeDays is stronger evidence than sourceAgeDays: somebody standing there and
  confirming beats somebody editing the record.
- "unsupported" fields are neither support nor contradiction. Many unsupported claims
  should lower confidence, but gently.

Cite the actual numbers you used. Do not invent corroboration that is not in the evidence.`;

/**
 * The Vercel AI Gateway's free tier throttles after roughly two requests, so judging a
 * whole city needs either paid credits or patience. Backing off lets the free tier limp
 * through a run rather than failing it outright.
 */
const RETRIES = 4;
const BACKOFF_MS = 20_000;

export async function judge(evidence: Evidence): Promise<Judgement | { error: string }> {
  const route = resolveModel();
  if ("error" in route) return route;

  let lastError = "";

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await attemptJudge(evidence, route);
    } catch (error) {
      lastError = explainModelError(error instanceof Error ? error.message : String(error));
      const throttled = /rate.?limit/i.test(lastError);
      if (!throttled || attempt === RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * (attempt + 1)));
    }
  }
  return { error: lastError };
}

async function attemptJudge(
  evidence: Evidence,
  route: Exclude<ReturnType<typeof resolveModel>, { error: string }>,
): Promise<Judgement> {
  {
    const { object } = await generateObject({
      model: route.model,
      schema: Verdict,
      system: SYSTEM,
      prompt: `Score this entry.\n\n${JSON.stringify(evidence, null, 1)}`,
    });

    // The band is derived from the score here rather than asked for, so a model that
    // describes one band and returns a number in another cannot pay out the wrong bonus.
    return {
      score: Math.round(object.score),
      band: bandFor(object.score),
      reasoning: object.reasoning.trim(),
      model: route.name,
    };
  }
}

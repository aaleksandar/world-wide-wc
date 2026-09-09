import { generateText, isStepCount, tool } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatDistance } from "@/lib/geo";
import { formatAccess } from "@/lib/payload";
import {
  fetchGlobalStats,
  searchToilets,
  subgraphConfigured,
  type ToiletHit,
} from "@/lib/subgraph";

/**
 * "Where's a free, clean toilet near me that has paper?"
 *
 * The model has no toilet knowledge of its own. Every fact in its answer comes from a
 * subgraph query it made while answering — which is the point: The Graph is the data,
 * the model is only the interface to it.
 */

const MODEL = "anthropic/claude-sonnet-5";

export const maxDuration = 60;

const SYSTEM = `You help people find a public toilet, using live data from the World Wide WC map.

Rules:
- Only state facts that came back from a tool call. You know nothing about toilets otherwise.
- If a search returns nothing, say so and suggest widening the radius or dropping a filter.
  Never invent a toilet, and never fall back on general knowledge about the city.
- Lead with the best option and say why it wins. Mention distance, how to get in, and any
  attribute the person actually asked for.
- Many entries have no name. Describe those by their building or their distance instead of
  calling them "unnamed".
- Ratings come from contributors, and most entries have none yet because an agent sourced
  them from OpenStreetMap. If nobody has rated a toilet, say that rather than implying it
  is clean.
- Be brief and practical. Two or three sentences is usually right. No preamble.`;

export async function POST(request: Request) {
  if (!subgraphConfigured) {
    return NextResponse.json({ error: "No subgraph configured" }, { status: 503 });
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json(
      { error: "AI_GATEWAY_API_KEY is not set, so the finder can't answer." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    question?: string;
    lat?: number;
    lng?: number;
  } | null;

  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "That question is too long" }, { status: 400 });
  }

  // Trafalgar Square, for someone who hasn't shared their location.
  const here = {
    lat: typeof body?.lat === "number" ? body.lat : 51.508,
    lng: typeof body?.lng === "number" ? body.lng : -0.128,
  };

  // Whatever the model actually looked at, so the map can highlight it.
  const seen = new Map<string, ToiletHit>();

  const findToilets = tool({
    description:
      "Search the live World Wide WC subgraph for toilets near a point. Returns them " +
      "nearest first. Every filter is optional — omit one rather than guessing at it.",
    inputSchema: z.object({
      radiusMetres: z
        .number()
        .min(50)
        .max(20_000)
        .describe("How far to look. Start around 800 and widen if nothing comes back."),
      access: z
        .array(z.enum(["free", "paid", "customer", "unknown"]))
        .optional()
        .describe("Ways of getting in that are acceptable. 'customer' means you must buy something."),
      minCleanliness: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("Only toilets rated at least this clean. Most have no rating, so this excludes a lot."),
      needsPaper: z.boolean().optional(),
      needsStepFree: z.boolean().optional().describe("Step-free access."),
      needsChangingTable: z.boolean().optional(),
      needsBidet: z.boolean().optional(),
      limit: z.number().min(1).max(10).default(5),
    }),
    execute: async (filters) => {
      const hits = await searchToilets({ ...here, ...filters });
      for (const hit of hits) seen.set(hit.id, hit);

      return hits.map((hit) => ({
        id: hit.id,
        name: hit.name || null,
        building: hit.building || null,
        distance: formatDistance(hit.distanceMetres),
        entry: formatAccess(hit),
        openingHours: hit.openingHours || null,
        cleanliness: hit.avgCleanliness > 0 ? hit.avgCleanliness : "nobody has rated it",
        hasPaper: hit.hasPaper,
        hasBidet: hit.hasBidet,
        stepFree: hit.isAccessible,
        changingTable: hit.hasChangingTable,
        staffed: hit.isStaffed,
        note: hit.style || null,
        sourcedBy: hit.source,
      }));
    },
  });

  const mapStats = tool({
    description: "How much of the map exists: how many toilets, how many from agents vs people.",
    inputSchema: z.object({}),
    execute: async () => (await fetchGlobalStats()) ?? { error: "no stats yet" },
  });

  try {
    const result = await generateText({
      model: MODEL,
      system: SYSTEM,
      prompt: question,
      tools: { findToilets, mapStats },
      stopWhen: isStepCount(5),
    });

    return NextResponse.json({
      answer: result.text,
      toilets: [...seen.values()],
      // Worth surfacing: it is the evidence that the answer came from the subgraph.
      queries: result.steps.flatMap((step) =>
        step.toolCalls.map((call) => ({ tool: call.toolName, input: call.input })),
      ),
    });
  } catch (error) {
    // The gateway's own message arrives wrapped in ANSI colour codes, which look like
    // line noise in a browser. Say the useful part plainly instead.
    const raw = error instanceof Error ? error.message : "The finder failed";
    const message = /unauthenticated|authentication failed|invalid api key/i.test(raw)
      ? "The AI Gateway rejected our API key. Check AI_GATEWAY_API_KEY."
      : raw.replace(/\u001b\[\d+m/g, "").trim();
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

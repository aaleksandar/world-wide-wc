#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, rpcUrl, toChainCoord } from "../lib/chain";
import { CONTRIBUTION_DOMAIN, CONTRIBUTION_TYPES, RATING_TYPES } from "../lib/contribution";
import { formatDistance } from "../lib/geo";
import { openState } from "../lib/hours";
import { encodePayload, encodeRatingPayload, formatAccess, type Toilet } from "../lib/payload";
import {
  fetchGlobalStats,
  fetchToilet,
  searchToilets,
  subgraphUrl,
  type ToiletRecord,
} from "../lib/subgraph";

/**
 * World Wide WC over MCP.
 *
 * The Graph already ships a Subgraph MCP that queries 15,000+ subgraphs, so a server that
 * merely proxied GraphQL would be worth nothing. Every tool here is something that cannot
 * be expressed as a subgraph query:
 *
 *   - distance. GraphQL has no geospatial operator, so "within 500m, nearest first" has
 *     to be computed.
 *   - open now. Nothing in GraphQL parses `Jan-Feb 08:00-18:00; Mar 08:30-18:30` in the
 *     toilet's own timezone.
 *   - writing. All nine of The Graph's MCP tools are read-only; an agent cannot contribute
 *     through them, and contribution is the whole point of this map.
 *
 * There is also a blunt practical reason: our subgraph lives in Subgraph Studio on Base
 * Sepolia, and The Graph's MCP needs a Gateway key against published subgraphs. It cannot
 * reach this data at all.
 */

const APP_URL = process.env.WWWC_APP_URL ?? "http://localhost:3000";

const server = new McpServer({ name: "world-wide-wc", version: "0.1.0" });

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** How an entry reads to an agent deciding whether to trust it. */
function describe(toilet: ToiletRecord, distanceMetres?: number): Record<string, unknown> {
  const known = (value: string) => (value === "UNKNOWN" ? null : value === "YES");
  return {
    id: toilet.id,
    name: toilet.name || null,
    building: toilet.building || null,
    ...(distanceMetres === undefined ? {} : { distance: formatDistance(distanceMetres) }),
    lat: toilet.lat,
    lng: toilet.lng,
    entry: formatAccess(toilet),
    openNow: openState(toilet.openingHours, toilet),
    openingHours: toilet.openingHours || null,
    // null means nobody has said, which is not the same as false.
    hasPaper: known(toilet.hasPaper),
    hasBidet: known(toilet.hasBidet),
    isStaffed: known(toilet.isStaffed),
    stepFree: known(toilet.isAccessible),
    changingTable: known(toilet.hasChangingTable),
    music: known(toilet.hasMusic),
    cleanliness: toilet.avgCleanliness || null,
    smell: toilet.avgSmell || null,
    busyness: toilet.avgBusyness || null,
    ratings: toilet.ratingCount,
    character: toilet.style || null,
    provenance: {
      sourcedBy: toilet.source,
      sourceUrl: toilet.sourceUrl || null,
      contributor: toilet.contributor,
      verification:
        toilet.verificationBand === "unchecked"
          ? "nobody has checked this source"
          : `${toilet.verificationBand} (${toilet.verificationScore}/100) — ${toilet.verificationEvidence}`,
    },
  };
}

// --- reading ----------------------------------------------------------------

server.registerTool(
  "find_toilets",
  {
    description:
      "Find public toilets near a point, nearest first. Filters on how you get in, " +
      "whether it is open right now, ratings, and fittings. Distance and opening hours " +
      "are computed — they cannot be expressed as a subgraph query.",
    inputSchema: {
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusMetres: z.number().min(50).max(20000).default(1000),
      access: z.array(z.enum(["free", "paid", "customer", "unknown"])).optional(),
      openNow: z.boolean().optional().describe("Only toilets known to be open right now."),
      needsPaper: z.boolean().optional(),
      needsStepFree: z.boolean().optional(),
      needsChangingTable: z.boolean().optional(),
      needsBidet: z.boolean().optional(),
      minCleanliness: z.number().min(1).max(5).optional().describe("Excludes unrated toilets."),
      limit: z.number().min(1).max(20).default(5),
    },
  },
  async ({ openNow, ...search }) => {
    const hits = await searchToilets(search);
    const open = openNow
      ? hits.filter((hit) => openState(hit.openingHours, hit) === "open")
      : hits;

    if (open.length === 0) {
      return ok(
        JSON.stringify({
          found: 0,
          note: openNow
            ? "Nothing known to be open. Most entries have no recorded hours — try openNow: false."
            : "Nothing matched. Try a larger radius or fewer filters.",
        }),
      );
    }
    return ok(
      JSON.stringify(
        { found: open.length, toilets: open.map((hit) => describe(hit, hit.distanceMetres)) },
        null,
        1,
      ),
    );
  },
);

server.registerTool(
  "get_toilet",
  {
    description: "Everything recorded about one toilet, including its provenance and trust verdict.",
    inputSchema: { id: z.string().describe("The onchain toilet id, e.g. \"42\".") },
  },
  async ({ id }) => {
    const toilet = await fetchToilet(id);
    if (!toilet) return fail(`No toilet ${id}.`);
    return ok(JSON.stringify(describe(toilet), null, 1));
  },
);

server.registerTool(
  "map_stats",
  {
    description: "How much of the map exists: entries, how many from people vs agents, how many verified.",
    inputSchema: {},
  },
  async () => {
    const stats = await fetchGlobalStats();
    if (!stats) return fail("No stats indexed yet.");
    return ok(JSON.stringify({ ...stats, subgraph: subgraphUrl }, null, 1));
  },
);

// --- writing ----------------------------------------------------------------
// The part The Graph's MCP cannot do at all.

function agentWallet() {
  const key = process.env.WWWC_AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error(
      "Set WWWC_AGENT_PRIVATE_KEY to contribute. It identifies your agent onchain and is " +
        "the address rewards accrue to. A throwaway key is fine; it never needs to hold funds.",
    );
  }
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain, transport: http(rpcUrl) }) };
}

server.registerTool(
  "contribute_toilet",
  {
    description:
      "Add a toilet to the map. Agents MUST set sourceUrl to where the data came from — " +
      "an agent entry without a resolvable source is worthless and will be scored as such. " +
      "Do not guess at cleanliness, smell or busyness: no source can tell you those, and a " +
      "guess displaces the observation it imitates. Signing is free; the project pays gas.",
    inputSchema: {
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      sourceUrl: z.string().url().describe("Where you read this. Required."),
      name: z.string().optional(),
      building: z.string().optional().describe("Which building, and how to find it inside."),
      access: z.enum(["free", "paid", "customer", "unknown"]).optional(),
      price: z.number().optional().describe("Entry price in minor units, so 50 is £0.50."),
      currency: z.string().optional(),
      openingHours: z.string().optional().describe("OSM syntax, e.g. \"Mo-Su 10:00-20:00\" or \"24/7\"."),
      hasPaper: z.boolean().optional().describe("Omit unless you actually established it."),
      hasBidet: z.boolean().optional(),
      isStaffed: z.boolean().optional(),
      isAccessible: z.boolean().optional(),
      hasChangingTable: z.boolean().optional(),
      hasMusic: z.boolean().optional(),
    },
  },
  async ({ lat, lng, ...rest }) => {
    let wallet;
    try {
      wallet = agentWallet();
    } catch (error) {
      return fail(error instanceof Error ? error.message : "no wallet");
    }

    const toilet: Partial<Toilet> = { ...rest, source: "agent" };
    const payload = encodePayload(toilet);
    const signedAt = Math.floor(Date.now() / 1000);

    const signature = await wallet.client.signTypedData({
      account: wallet.account,
      domain: CONTRIBUTION_DOMAIN,
      types: CONTRIBUTION_TYPES,
      primaryType: "Contribution",
      message: {
        contributor: wallet.account.address,
        lat: toChainCoord(lat),
        lng: toChainCoord(lng),
        payload,
        signedAt: BigInt(signedAt),
      },
    });

    const response = await fetch(`${APP_URL}/api/contribute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contributor: wallet.account.address,
        lat,
        lng,
        toilet,
        source: "agent",
        signedAt,
        signature,
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return fail(String(body.error));
    return ok(
      JSON.stringify({ ...body, contributor: wallet.account.address, note: "Onchain. Rewards accrue to your address." }),
    );
  },
);

server.registerTool(
  "rate_toilet",
  {
    description:
      "Fill in what you learned about a toilet already on the map — the gaps an agent " +
      "cannot fill from the web. A definite true or false replaces what was there, since " +
      "the newest first-hand report should win; omitting a field changes nothing.",
    inputSchema: {
      id: z.string(),
      cleanliness: z.number().min(1).max(5).optional(),
      smell: z.number().min(1).max(5).optional(),
      busyness: z.number().min(1).max(5).optional(),
      hasPaper: z.boolean().optional(),
      hasBidet: z.boolean().optional(),
      isStaffed: z.boolean().optional(),
      isAccessible: z.boolean().optional(),
      hasChangingTable: z.boolean().optional(),
      hasMusic: z.boolean().optional(),
      note: z.string().optional(),
    },
  },
  async ({ id, ...observations }) => {
    let wallet;
    try {
      wallet = agentWallet();
    } catch (error) {
      return fail(error instanceof Error ? error.message : "no wallet");
    }

    const payload = encodeRatingPayload(observations);
    if (payload === "{}") return fail("Nothing to add — set at least one field.");

    const signedAt = Math.floor(Date.now() / 1000);
    const signature = await wallet.client.signTypedData({
      account: wallet.account,
      domain: CONTRIBUTION_DOMAIN,
      types: RATING_TYPES,
      primaryType: "Rating",
      message: {
        rater: wallet.account.address,
        toiletId: BigInt(id),
        payload,
        signedAt: BigInt(signedAt),
      },
    });

    const response = await fetch(`${APP_URL}/api/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rater: wallet.account.address, toiletId: id, observations, signedAt, signature }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return fail(String(body.error));
    return ok(JSON.stringify(body));
  },
);

await server.connect(new StdioServerTransport());

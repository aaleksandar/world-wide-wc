import { boundingBox, distanceMetres } from "./geo";
import type { Access, Source } from "./payload";

/** Mirrors the subgraph's `Known` enum. */
export type Known = "YES" | "NO" | "UNKNOWN";

/**
 * The only read path in this app.
 *
 * There is no database behind World Wide WC. Every toilet on the map was parsed out of an
 * onchain event by our subgraph, and this module is the single place that talks to it —
 * so "is The Graph load-bearing here?" has a one-file answer.
 */

export const subgraphUrl = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
export const subgraphConfigured = subgraphUrl.length > 0;

export type ToiletRecord = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  building: string;
  access: Access;
  price: number;
  currency: string;
  cleanliness: number;
  smell: number;
  busyness: number;
  hasPaper: Known;
  hasBidet: Known;
  isStaffed: Known;
  hasMusic: Known;
  isAccessible: Known;
  hasChangingTable: Known;
  openingHours: string;
  style: string;
  photoUrl: string;
  source: Source;
  sourceUrl: string;
  contributor: string;
  ratingCount: number;
  avgCleanliness: number;
  createdAt: number;
  txHash: string;
};

export type GlobalStats = {
  toiletCount: number;
  humanToilets: number;
  agentToilets: number;
  ratingCount: number;
  contributorCount: number;
  totalWeight: string;
  totalDonated: string;
  totalClaimed: string;
};

const TOILET_FIELDS = `
  id
  lat
  lng
  name
  building
  access
  price
  currency
  cleanliness
  smell
  busyness
  hasPaper
  hasBidet
  isStaffed
  hasMusic
  isAccessible
  hasChangingTable
  openingHours
  style
  photoUrl
  source
  sourceUrl
  ratingCount
  avgCleanliness
  createdAt
  txHash
  contributor { id }
`;

export class SubgraphNotConfiguredError extends Error {
  constructor() {
    super("NEXT_PUBLIC_SUBGRAPH_URL is not set");
    this.name = "SubgraphNotConfiguredError";
  }
}

export async function query<T>(
  document: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!subgraphConfigured) throw new SubgraphNotConfiguredError();

  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    // The chain is the source of truth and it moves; don't serve a stale map.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Subgraph returned ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`Subgraph error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Subgraph returned no data");
  return body.data;
}

type RawToilet = Omit<ToiletRecord, "lat" | "lng" | "avgCleanliness" | "contributor"> & {
  lat: string;
  lng: string;
  avgCleanliness: string;
  contributor: { id: string };
};

const toRecord = (raw: RawToilet): ToiletRecord => ({
  ...raw,
  lat: Number(raw.lat),
  lng: Number(raw.lng),
  avgCleanliness: Number(raw.avgCleanliness),
  contributor: raw.contributor.id,
  createdAt: Number(raw.createdAt),
});

/**
 * Falls back to the harvested seed file when no subgraph is configured, purely so the map
 * can be worked on before the contract is deployed. The UI says so, loudly, when this
 * happens — it must never be mistaken for live data.
 */
async function previewToilets(): Promise<ToiletRecord[]> {
  // Imported lazily so this module carries no Node-only dependency into a client bundle.
  const { readFile } = await import("node:fs/promises");
  const seed = JSON.parse(await readFile("data/seed-london.json", "utf8")) as {
    lat: number;
    lng: number;
    toilet: Record<string, unknown>;
  }[];

  return seed.map((entry, index) => ({
    ...(entry.toilet as unknown as Omit<ToiletRecord, "id" | "lat" | "lng">),
    id: `preview-${index}`,
    lat: entry.lat,
    lng: entry.lng,
    contributor: "0x0000000000000000000000000000000000000000",
    ratingCount: 0,
    avgCleanliness: 0,
    createdAt: 0,
    txHash: "",
  }));
}

export async function fetchToilets(first = 1000): Promise<ToiletRecord[]> {
  if (!subgraphConfigured) return previewToilets();

  const data = await query<{ toilets: RawToilet[] }>(
    `query Toilets($first: Int!) {
      toilets(first: $first, orderBy: createdAt, orderDirection: desc) { ${TOILET_FIELDS} }
    }`,
    { first },
  );
  return data.toilets.map(toRecord);
}

export async function fetchToilet(id: string): Promise<ToiletRecord | null> {
  if (!subgraphConfigured) return null;
  const data = await query<{ toilet: RawToilet | null }>(
    `query Toilet($id: ID!) { toilet(id: $id) { ${TOILET_FIELDS} } }`,
    { id },
  );
  return data.toilet ? toRecord(data.toilet) : null;
}

export async function fetchGlobalStats(): Promise<GlobalStats | null> {
  if (!subgraphConfigured) return null;
  const data = await query<{ global: GlobalStats | null }>(
    `query Stats {
      global(id: "global") {
        toiletCount humanToilets agentToilets ratingCount contributorCount
        totalWeight totalDonated totalClaimed
      }
    }`,
  );
  return data.global;
}

export type ContributorRecord = {
  id: string;
  toiletsLogged: number;
  ratingsGiven: number;
  weight: bigint;
  claimed: bigint;
  /** Settled but not yet withdrawn. */
  pending: bigint;
  /** Everything this contributor has ever been owed: claimed + pending. */
  earned: bigint;
  firstSeenAt: number;
};

type RawContributor = {
  id: string;
  toiletsLogged: number;
  ratingsGiven: number;
  weight: string;
  claimed: string;
  accrued: string;
  rewardDebt: string;
  firstSeenAt: string;
};

/**
 * Contributors by weight, with what each has earned.
 *
 * `pending` is computed here rather than stored, because a donation moves `accPerWeight`
 * and so changes every contributor's pending balance at once — materialising it would be
 * the O(n) write the contract's accumulator exists to avoid. This is the same expression
 * the contract's `pendingOf` evaluates, and scripts/check-earnings.mts asserts the two
 * agree for every contributor.
 */
export async function fetchLeaderboard(first = 50): Promise<{
  contributors: ContributorRecord[];
  stats: GlobalStats | null;
}> {
  if (!subgraphConfigured) return { contributors: [], stats: null };

  const data = await query<{
    contributors: RawContributor[];
    global: (GlobalStats & { accPerWeight: string }) | null;
  }>(
    `query Leaderboard($first: Int!) {
      contributors(first: $first, orderBy: weight, orderDirection: desc) {
        id toiletsLogged ratingsGiven weight claimed accrued rewardDebt firstSeenAt
      }
      global(id: "global") {
        toiletCount humanToilets agentToilets ratingCount contributorCount
        totalWeight totalDonated totalClaimed accPerWeight
      }
    }`,
    { first },
  );

  const accPerWeight = BigInt(data.global?.accPerWeight ?? "0");

  const contributors = data.contributors.map((raw) => {
    const weight = BigInt(raw.weight);
    const claimed = BigInt(raw.claimed);
    const pending = BigInt(raw.accrued) + weight * accPerWeight - BigInt(raw.rewardDebt);
    return {
      id: raw.id,
      toiletsLogged: raw.toiletsLogged,
      ratingsGiven: raw.ratingsGiven,
      weight,
      claimed,
      pending,
      earned: claimed + pending,
      firstSeenAt: Number(raw.firstSeenAt),
    };
  });

  return { contributors, stats: data.global };
}

export type ToiletSearch = {
  lat: number;
  lng: number;
  radiusMetres: number;
  /** Omit to accept any way of getting in. */
  access?: Access[];
  minCleanliness?: number;
  needsPaper?: boolean;
  needsStepFree?: boolean;
  needsChangingTable?: boolean;
  needsBidet?: boolean;
  limit: number;
};

export type ToiletHit = ToiletRecord & { distanceMetres: number };

/**
 * The subgraph does the coarse work with a bounding box and attribute filters; we measure
 * real distance on the handful of rows that come back. Ordering by distance in GraphQL
 * isn't possible — the subgraph has no idea where the person asking is standing.
 */
export async function searchToilets(search: ToiletSearch): Promise<ToiletHit[]> {
  if (!subgraphConfigured) return [];

  const box = boundingBox(search, search.radiusMetres);
  const where: Record<string, unknown> = {
    lat_gte: box.minLat.toString(),
    lat_lte: box.maxLat.toString(),
    lng_gte: box.minLng.toString(),
    lng_lte: box.maxLng.toString(),
  };

  if (search.access?.length) where.access_in = search.access;
  if (search.minCleanliness) where.avgCleanliness_gte = search.minCleanliness.toString();
  if (search.needsPaper) where.hasPaper = true;
  if (search.needsStepFree) where.isAccessible = true;
  if (search.needsChangingTable) where.hasChangingTable = true;
  if (search.needsBidet) where.hasBidet = true;

  const data = await query<{ toilets: RawToilet[] }>(
    `query Search($where: Toilet_filter!, $first: Int!) {
      toilets(where: $where, first: $first) { ${TOILET_FIELDS} }
    }`,
    // Pull more than we need: the box is square and the radius is round, and we sort by
    // true distance afterwards.
    { where, first: Math.max(search.limit * 5, 50) },
  );

  return data.toilets
    .map((raw) => {
      const record = toRecord(raw);
      return { ...record, distanceMetres: distanceMetres(search, record) };
    })
    .filter((hit) => hit.distanceMetres <= search.radiusMetres)
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, search.limit);
}

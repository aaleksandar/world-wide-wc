import type { Access, Source } from "./payload";

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
  hasPaper: boolean;
  hasBidet: boolean;
  isStaffed: boolean;
  hasMusic: boolean;
  isAccessible: boolean;
  hasChangingTable: boolean;
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
  weight: string;
  claimed: string;
};

export async function fetchTopContributors(first = 20): Promise<ContributorRecord[]> {
  if (!subgraphConfigured) return [];
  const data = await query<{ contributors: ContributorRecord[] }>(
    `query Contributors($first: Int!) {
      contributors(first: $first, orderBy: weight, orderDirection: desc) {
        id toiletsLogged ratingsGiven weight claimed
      }
    }`,
    { first },
  );
  return data.contributors;
}

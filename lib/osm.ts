import { type Toilet, emptyToilet } from "./payload";

/**
 * OpenStreetMap is where the agent gets its raw material. It's free, it's public, and
 * every node has a permanent URL — which is the whole point, because an agent-sourced
 * entry is worth nothing without a link back to where it came from.
 *
 * What OSM has: location, name, fee, opening hours, step-free access.
 * What OSM does not have: whether it's clean, whether it smells, whether there's paper
 * in it right now. That gap is exactly what humans are here to fill.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type BoundingBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Somewhere to start. Central London, roughly Zone 1. */
export const CITIES: Record<string, { label: string; bbox: BoundingBox }> = {
  london: {
    label: "London",
    bbox: { south: 51.46, west: -0.2, north: 51.56, east: -0.04 },
  },
  belgrade: {
    label: "Belgrade",
    bbox: { south: 44.77, west: 20.4, north: 44.84, east: 20.52 },
  },
};

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export async function fetchOsmToilets(bbox: BoundingBox): Promise<OsmElement[]> {
  const { south, west, north, east } = bbox;
  const area = `(${south},${west},${north},${east})`;
  const query = `[out:json][timeout:90];
(
  node["amenity"="toilets"]${area};
  way["amenity"="toilets"]${area};
);
out tags center;`;

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // Overpass answers 406 to requests without one, and asks that tools identify
      // themselves so it can rate-limit fairly rather than block outright.
      "user-agent": "world-wide-wc/0.1 (https://github.com/worldwidewc/world-wide-wc)",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass returned ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { elements: OsmElement[] };
  return body.elements.filter((element) => coordsOf(element) !== null);
}

export function coordsOf(element: OsmElement): { lat: number; lng: number } | null {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return { lat, lng: lon };
}

export const osmUrl = (element: OsmElement) =>
  `https://www.openstreetmap.org/${element.type}/${element.id}`;

/**
 * OSM tags are tri-state and must stay that way. An absent tag means nobody has surveyed
 * it, which is not the same claim as `wheelchair=no`. Flattening the two would have this
 * agent asserting, about a hundred and twenty toilets, that they lack facilities nobody
 * ever checked for — exactly the invented data the project exists to avoid.
 */
const known = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value === "yes" || value === "designated") return true;
  if (value === "no") return false;
  // "limited" means partial access, which this schema cannot express. Reporting it as a
  // yes would tell a wheelchair user they can get in when they may not — a wrong answer
  // with real consequences, so leave it unrecorded and let a person settle it.
  return undefined;
};

/** True only for an explicit affirmative; used where a false would be over-claiming. */
const yes = (value: string | undefined) => known(value) === true;

/**
 * "0.50 GBP", "£0.20", "0.2 EUR", "20p" → minor units and a currency.
 * Anything it can't read comes back as no price, which reads as "paid, amount unknown".
 */
export function parseCharge(charge: string | undefined): { price: number; currency: string } {
  if (!charge) return { price: 0, currency: "GBP" };

  const symbols: Record<string, string> = { "£": "GBP", "€": "EUR", $: "USD" };
  let currency = "GBP";
  for (const [symbol, code] of Object.entries(symbols)) {
    if (charge.includes(symbol)) currency = code;
  }
  const code = charge.match(/\b(GBP|EUR|USD|RSD)\b/i);
  if (code) currency = code[1].toUpperCase();

  // "20p" is twenty pence, not twenty pounds.
  const pence = charge.match(/^\s*(\d+)\s*p\b/i);
  if (pence) return { price: Number(pence[1]), currency: "GBP" };

  const amount = charge.match(/(\d+(?:[.,]\d+)?)/);
  if (!amount) return { price: 0, currency };

  const major = Number.parseFloat(amount[1].replace(",", "."));
  if (!Number.isFinite(major)) return { price: 0, currency };
  return { price: Math.round(major * 100), currency };
}

/**
 * Turns one OSM element into as much of a Toilet as its tags honestly support. Ratings
 * are deliberately left at zero: OSM does not know whether a toilet is clean, and
 * guessing would poison the data this whole project exists to collect.
 */
export function osmToToilet(element: OsmElement): Partial<Toilet> {
  const tags = element.tags ?? {};

  const access =
    tags.access === "customers" || tags.access === "permissive"
      ? "customer"
      : tags.fee === "yes"
        ? "paid"
        : tags.fee === "no"
          ? "free"
          : "unknown";

  const { price, currency } = parseCharge(tags.charge);

  const building = [tags["addr:housename"], tags.operator, tags.level ? `level ${tags.level}` : ""]
    .filter(Boolean)
    .join(" · ");

  return {
    ...emptyToilet,
    name: tags.name ?? tags.operator ?? "",
    building,
    access,
    price: access === "paid" ? price : 0,
    currency,
    hasPaper: known(tags["toilets:paper_supplied"]),
    hasBidet: known(tags["toilets:bidet"]),
    // Either tag saying yes is a yes; otherwise fall back to whichever one was surveyed.
    isStaffed: yes(tags.supervised) || yes(tags.attendant)
      ? true
      : known(tags.supervised) ?? known(tags.attendant),
    isAccessible: yes(tags.wheelchair) || yes(tags["toilets:wheelchair"])
      ? true
      : known(tags.wheelchair) ?? known(tags["toilets:wheelchair"]),
    hasChangingTable: known(tags.changing_table),
    openingHours: tags.opening_hours ?? "",
    source: "agent",
    sourceUrl: osmUrl(element),
  };
}

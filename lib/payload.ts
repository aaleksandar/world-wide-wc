/**
 * The shape of a toilet.
 *
 * Everything except the coordinates travels onchain as a compact JSON string in the
 * event payload, and the subgraph mapping parses it back out. Keys are short because
 * they are calldata; the meaning of each one is fixed here and mirrored in
 * `subgraph/src/mapping.ts`, which is the only other place that knows them.
 *
 * Changing a key is a breaking change: already-indexed entries keep the old spelling.
 * Add a new key rather than renaming one.
 */

export const ACCESS = ["free", "paid", "customer", "unknown"] as const;
export type Access = (typeof ACCESS)[number];

export const SOURCE = ["human", "agent"] as const;
export type Source = (typeof SOURCE)[number];

/**
 * Three states, not two.
 *
 * `false` has to mean "somebody checked, and there isn't one" — distinct from "nobody has
 * said". Conflating them makes a map that looks complete and lies, which is the failure
 * this whole project exists to fix. On the wire the distinction is presence: the key is
 * written for a definite yes or no, and omitted when unknown.
 */
export type Known = boolean | undefined;

export type Toilet = {
  /** What it's called, if it's called anything. */
  name: string;
  /** Which building, and how to actually find it once you're inside. */
  building: string;
  access: Access;
  /** Entry price in minor units of `currency`, so 50 is £0.50. */
  price: number;
  currency: string;
  /** All 1–5, or 0 for "not rated". */
  cleanliness: number;
  smell: number;
  busyness: number;
  hasPaper: Known;
  hasBidet: Known;
  isStaffed: Known;
  hasMusic: Known;
  /** Step-free access. For a lot of people this is the only attribute that matters. */
  isAccessible: Known;
  /** Has a baby changing table. */
  hasChangingTable: Known;
  /** OSM-style opening hours, e.g. "Mo-Su 10:00-20:00" or "24/7". */
  openingHours: string;
  /** Free text — "art deco tiling", "smells of pine", "there is a chandelier". */
  style: string;
  photoUrl: string;
  source: Source;
  /** Where this came from: an OSM node, an article, a review. Required for agents. */
  sourceUrl: string;
};

export const emptyToilet: Toilet = {
  name: "",
  building: "",
  access: "unknown",
  price: 0,
  currency: "GBP",
  cleanliness: 0,
  smell: 0,
  busyness: 0,
  hasPaper: undefined,
  hasBidet: undefined,
  isStaffed: undefined,
  hasMusic: undefined,
  isAccessible: undefined,
  hasChangingTable: undefined,
  openingHours: "",
  style: "",
  photoUrl: "",
  source: "human",
  sourceUrl: "",
};

/** Compact wire keys. Kept in sync with subgraph/src/mapping.ts by hand — there are ten. */
const KEYS = {
  name: "n",
  building: "b",
  access: "a",
  price: "p",
  currency: "cur",
  cleanliness: "c",
  smell: "sm",
  busyness: "bu",
  hasPaper: "pa",
  hasBidet: "bi",
  isStaffed: "st",
  hasMusic: "mu",
  isAccessible: "wh",
  hasChangingTable: "ch",
  openingHours: "oh",
  style: "sy",
  photoUrl: "ph",
  source: "src",
  sourceUrl: "url",
} as const satisfies Record<keyof Toilet, string>;

/**
 * Encodes a toilet for the chain, dropping anything left at its default. An entry where
 * someone only noted "it's free and it's clean" costs calldata for those two facts alone.
 */
export function encodePayload(toilet: Partial<Toilet>): string {
  const full = { ...emptyToilet, ...toilet };
  const out: Record<string, string | number | boolean> = {};
  for (const field of Object.keys(KEYS) as (keyof Toilet)[]) {
    const value = full[field];
    // undefined is "nobody has said" and is the one thing never written. A definite
    // `false` is a fact somebody established, so it costs calldata and gets stored.
    if (value === undefined || value === emptyToilet[field]) continue;
    out[KEYS[field]] = value;
  }
  // Provenance is never dropped, even when it matches the default.
  out[KEYS.source] = full.source;
  return JSON.stringify(out);
}

export function decodePayload(payload: string): Toilet {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return { ...emptyToilet };
  }

  const str = (k: string, fallback = "") =>
    typeof raw[k] === "string" ? (raw[k] as string) : fallback;
  const num = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : 0);
  // Present and boolean means somebody said so; absent means nobody has.
  const known = (k: string): Known => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : undefined);

  const access = str(KEYS.access) as Access;
  const source = str(KEYS.source) as Source;

  return {
    name: str(KEYS.name),
    building: str(KEYS.building),
    access: ACCESS.includes(access) ? access : "unknown",
    price: num(KEYS.price),
    currency: str(KEYS.currency, "GBP"),
    cleanliness: num(KEYS.cleanliness),
    smell: num(KEYS.smell),
    busyness: num(KEYS.busyness),
    hasPaper: known(KEYS.hasPaper),
    hasBidet: known(KEYS.hasBidet),
    isStaffed: known(KEYS.isStaffed),
    hasMusic: known(KEYS.hasMusic),
    isAccessible: known(KEYS.isAccessible),
    hasChangingTable: known(KEYS.hasChangingTable),
    openingHours: str(KEYS.openingHours),
    style: str(KEYS.style),
    photoUrl: str(KEYS.photoUrl),
    source: SOURCE.includes(source) ? source : "human",
    sourceUrl: str(KEYS.sourceUrl),
  };
}

/** "Free", "£0.50", "Customers only". */
export function formatAccess(toilet: Pick<Toilet, "access" | "price" | "currency">): string {
  if (toilet.access === "free") return "Free";
  if (toilet.access === "customer") return "Customers only";
  if (toilet.access === "paid") {
    if (!toilet.price) return "Paid";
    const symbol = { GBP: "£", EUR: "€", USD: "$" }[toilet.currency] ?? "";
    return `${symbol}${(toilet.price / 100).toFixed(2)}`;
  }
  return "Unknown";
}

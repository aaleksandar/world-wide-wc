import { osmToToilet, type OsmElement } from "./osm";
import { type Toilet } from "./payload";
// The subgraph's enum, not payload.ts's boolean|undefined — this compares against
// what is indexed, which is the YES/NO/UNKNOWN form.
import type { Known, ToiletRecord } from "./subgraph";

/**
 * Gathers the facts a judge needs, without a model.
 *
 * Everything here is arithmetic and retrieval: does the source resolve, when was it last
 * touched, does it still say what we recorded. Establishing those deterministically means
 * the model is only ever asked to form a judgement over settled evidence — it is never
 * trusted to count days or diff fields, which is exactly the sort of thing models get
 * quietly wrong.
 *
 * It also means the whole evidence layer is testable with no credentials at all.
 */

const OSM_API = "https://api.openstreetmap.org/api/0.6";
const DAY_MS = 86_400_000;

/** One field where the entry and its source now disagree. */
export type Contradiction = {
  field: string;
  recorded: string;
  sourceSaysNow: string;
};

/**
 * What happened when we went looking for the source.
 *
 * `blocked` matters as much as `gone`. A site that refuses our crawler with 403 has told
 * us nothing about whether the toilet is there — punishing that entry would be punishing
 * the contributor for someone else's bot protection. Two of our own sources
 * (britishmuseum.org, southbankcentre.co.uk) answer 403 to any automated request.
 */
export type SourceStatus = "ok" | "gone" | "blocked" | "unreachable" | "none";

export type Evidence = {
  toiletId: string;
  name: string;
  source: "human" | "agent";
  sourceUrl: string;

  sourceStatus: SourceStatus;
  /** True only for `ok` — the source was fetched and read. */
  sourceResolves: boolean;
  httpStatus: number | null;
  fetchError: string | null;

  /** Recognised, machine-checkable sources. Only OSM so far. */
  sourceKind: "osm" | "web" | "none";

  /** Days since the source itself was last edited. Null when unknowable. */
  sourceAgeDays: number | null;
  /** Days since a surveyor last confirmed the OSM entry on the ground. */
  surveyAgeDays: number | null;
  /** Days since our own entry last changed. */
  entryAgeDays: number;

  /** Fields where we and the source now disagree. Empty is the good case. */
  contradictions: Contradiction[];
  /** Fields the source corroborates. */
  corroborated: string[];
  /** Claims the source says nothing about — neither support nor contradiction. */
  unsupported: string[];
};

const daysSince = (iso: string | number): number | null => {
  const then = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / DAY_MS));
};

/** `https://www.openstreetmap.org/way/374959168` → `{ type, id }`. */
export function parseOsmUrl(url: string): { type: string; id: string } | null {
  const match = url.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/i);
  return match ? { type: match[1].toLowerCase(), id: match[2] } : null;
}

/** The fields a source can meaningfully corroborate. Ratings are excluded — no web page
 *  can tell you whether a toilet was clean when somebody visited. */
const CHECKABLE = [
  "name",
  "access",
  "price",
  "openingHours",
  "hasPaper",
  "hasBidet",
  "isStaffed",
  "isAccessible",
  "hasChangingTable",
] as const;

const show = (value: unknown): string =>
  value === undefined || value === "" ? "unrecorded" : String(value);

/** Our tri-state on the chain is YES/NO/UNKNOWN; the OSM mapper returns true/false/undefined. */
const asKnown = (value: unknown): Known =>
  value === true ? "YES" : value === false ? "NO" : "UNKNOWN";

export async function gatherEvidence(toilet: ToiletRecord): Promise<Evidence> {
  const evidence: Evidence = {
    toiletId: toilet.id,
    name: toilet.name,
    source: toilet.source,
    sourceUrl: toilet.sourceUrl,
    sourceStatus: toilet.sourceUrl ? "unreachable" : "none",
    sourceResolves: false,
    httpStatus: null,
    fetchError: null,
    sourceKind: toilet.sourceUrl ? "web" : "none",
    sourceAgeDays: null,
    surveyAgeDays: null,
    entryAgeDays: daysSince(toilet.createdAt) ?? 0,
    contradictions: [],
    corroborated: [],
    unsupported: [],
  };

  if (!toilet.sourceUrl) return evidence;

  const osm = parseOsmUrl(toilet.sourceUrl);
  if (!osm) return { ...evidence, ...(await checkPlainUrl(toilet.sourceUrl)) };

  evidence.sourceKind = "osm";

  let element: OsmElement & { version?: number; timestamp?: string };
  try {
    const response = await fetch(`${OSM_API}/${osm.type}/${osm.id}.json`, {
      headers: { "user-agent": "world-wide-wc/0.1 (source verification)" },
    });
    evidence.httpStatus = response.status;

    if (!response.ok) {
      // 404/410 from the OSM API means the element really is gone.
      evidence.sourceStatus = classify(response.status);
      evidence.fetchError =
        response.status === 410 || response.status === 404
          ? "deleted from OpenStreetMap"
          : `HTTP ${response.status}`;
      return evidence;
    }

    const body = (await response.json()) as { elements: (OsmElement & { timestamp?: string })[] };
    element = body.elements?.[0];
    if (!element) {
      evidence.fetchError = "no element in OSM response";
      return evidence;
    }
  } catch (error) {
    evidence.fetchError = error instanceof Error ? error.message : "fetch failed";
    return evidence;
  }

  evidence.sourceStatus = "ok";
  evidence.sourceResolves = true;
  if (element.timestamp) evidence.sourceAgeDays = daysSince(element.timestamp);
  const checkDate = element.tags?.check_date;
  if (checkDate) evidence.surveyAgeDays = daysSince(checkDate);

  // Re-derive what this source would produce today, using the exact same mapping that
  // produced the entry — so a difference is a real change in the world, never a change in
  // how we read a tag.
  const now = osmToToilet(element);

  for (const field of CHECKABLE) {
    const recordedRaw = toilet[field as keyof ToiletRecord];
    const currentRaw = now[field as keyof Toilet];

    const isTriState = ["hasPaper", "hasBidet", "isStaffed", "isAccessible", "hasChangingTable"].includes(field);
    const recorded = show(recordedRaw);
    const current: string = isTriState ? asKnown(currentRaw) : show(currentRaw);

    if (recorded === "unrecorded" || recorded === "UNKNOWN") continue; // we claimed nothing

    if (current === "unrecorded" || current === "UNKNOWN") {
      evidence.unsupported.push(field);
    } else if (recorded === current) {
      evidence.corroborated.push(field);
    } else {
      evidence.contradictions.push({ field, recorded, sourceSaysNow: current });
    }
  }

  return evidence;
}

/** For non-OSM sources all we can establish is whether the page is still there. */
async function checkPlainUrl(url: string): Promise<Partial<Evidence>> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "world-wide-wc/0.1 (source verification)" },
      signal: AbortSignal.timeout(15_000),
    });
    return {
      sourceStatus: classify(response.status),
      sourceResolves: response.ok,
      httpStatus: response.status,
      fetchError: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      sourceStatus: "unreachable",
      sourceResolves: false,
      httpStatus: null,
      fetchError: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

/**
 * Being refused is not the same as being absent. 403/429/503 mean a bot defence or a bad
 * moment; only 404 and 410 mean the source is actually gone.
 */
function classify(status: number): SourceStatus {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 403 || status === 401 || status === 429 || status >= 500) return "blocked";
  return "unreachable";
}

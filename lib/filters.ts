import type { OpenState } from "./hours";
import type { Access } from "./payload";
import type { ToiletRecord } from "./subgraph";

export type FilterableToilet = ToiletRecord & { openNow: OpenState };

/** The six tri-state fittings, in the order they read best. */
export const AMENITY_KEYS = [
  "hasPaper",
  "isAccessible",
  "hasChangingTable",
  "isStaffed",
  "hasBidet",
  "hasMusic",
] as const;
export type AmenityKey = (typeof AMENITY_KEYS)[number];

export const AMENITY_LABELS: Record<AmenityKey, string> = {
  hasPaper: "Paper",
  isAccessible: "Step-free",
  hasChangingTable: "Changing table",
  isStaffed: "Staffed",
  hasBidet: "Bidet",
  hasMusic: "Music",
};

export type Filters = {
  /** Empty means any way of getting in. */
  access: Access[];
  openNow: boolean;
  minCleanliness: number;
  minSmell: number;
  /** Busyness runs 1 empty → 5 queue, so this is a ceiling rather than a floor. */
  maxBusyness: number;
  /** Every listed amenity must be a definite yes. */
  amenities: AmenityKey[];
  source: "any" | "human" | "agent";
};

export const NO_FILTERS: Filters = {
  access: [],
  openNow: false,
  minCleanliness: 0,
  minSmell: 0,
  maxBusyness: 0,
  amenities: [],
  source: "any",
};

export function countActive(filters: Filters): number {
  return (
    filters.access.length +
    (filters.openNow ? 1 : 0) +
    (filters.minCleanliness ? 1 : 0) +
    (filters.minSmell ? 1 : 0) +
    (filters.maxBusyness ? 1 : 0) +
    filters.amenities.length +
    (filters.source === "any" ? 0 : 1)
  );
}

/**
 * A rating filter excludes the unrated.
 *
 * Asking for "3 stars or better" and being shown places nobody has rated would be the same
 * quiet lie the tri-state work removed elsewhere: an absent rating is not a good one. The
 * panel says so, because it is otherwise a surprising amount of the map to lose at once.
 */
export function applyFilters(toilets: FilterableToilet[], filters: Filters): FilterableToilet[] {
  return toilets.filter((toilet) => {
    if (filters.access.length && !filters.access.includes(toilet.access)) return false;

    // "Open now" keeps only toilets known to be open — one whose hours nobody recorded
    // cannot be promised.
    if (filters.openNow && toilet.openNow !== "open") return false;

    if (filters.minCleanliness && toilet.avgCleanliness < filters.minCleanliness) return false;
    if (filters.minSmell && toilet.avgSmell < filters.minSmell) return false;
    if (filters.maxBusyness) {
      if (!toilet.avgBusyness || toilet.avgBusyness > filters.maxBusyness) return false;
    }

    for (const amenity of filters.amenities) {
      if (toilet[amenity] !== "YES") return false;
    }

    if (filters.source !== "any" && toilet.source !== filters.source) return false;

    return true;
  });
}

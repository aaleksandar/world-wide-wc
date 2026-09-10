import OpeningHours from "opening_hours";
import tzLookup from "tz-lookup";
import type { ToiletRecord } from "./subgraph";

/**
 * Whether a toilet is open right now, where the toilet is.
 *
 * Evaluated on the server and shipped as a plain string, for two reasons. The parser and
 * its holiday tables are several megabytes, which has no business in a phone's bundle;
 * and OSM opening hours are far messier than they look — our own London data has month
 * ranges, public-holiday clauses, split intervals and `08:00-dusk`. A hand-rolled parser
 * would quietly get those wrong, and being wrong here sends somebody to a locked door.
 */

export type OpenState = "open" | "closed" | "unknown";

/**
 * "Now" as the clock reads at those coordinates.
 *
 * The parser reads a Date with local getters, so it would otherwise answer in whatever
 * timezone the server happens to sit in — someone in Belgrade would be told a London
 * toilet was open an hour before it opened.
 */
function localise(at: Date, timeZone: string): Date {
  const there = new Date(at.toLocaleString("en-US", { timeZone }));
  const here = new Date(at.toLocaleString("en-US"));
  return new Date(at.getTime() + (there.getTime() - here.getTime()));
}

export function openState(
  openingHours: string,
  where: { lat: number; lng: number },
  at = new Date(),
): OpenState {
  if (!openingHours.trim()) return "unknown";

  let timeZone: string;
  try {
    timeZone = tzLookup(where.lat, where.lng);
  } catch {
    return "unknown";
  }
  const now = localise(at, timeZone);
  const place = placeFor(timeZone);

  // With a country and state the parser can resolve public holidays and "dusk". A `PH`
  // clause for a country it has no holiday table for throws, so fall back to parsing
  // without a location: losing the holiday rule is much better than losing the entry,
  // and roughly one in five of our London toilets has a PH clause.
  for (const location of [
    { lat: where.lat, lon: where.lng, address: { country_code: place.country, state: place.state } },
    undefined,
  ]) {
    try {
      return new OpeningHours(openingHours, location).getState(now) ? "open" : "closed";
    } catch {
      // Try the simpler parse.
    }
  }
  // Unparseable hours are a fact we don't have, not a closed door.
  return "unknown";
}

/**
 * Public holidays are per-country and the parser wants a code, plus a state for the ones
 * whose holidays vary regionally. A timezone is a decent proxy for the handful of cities
 * this map covers.
 */
function placeFor(timeZone: string): { country: string; state: string } {
  const byZone: Record<string, { country: string; state: string }> = {
    "Europe/London": { country: "gb", state: "England" },
    "Europe/Belgrade": { country: "rs", state: "" },
    "Europe/Berlin": { country: "de", state: "Berlin" },
    "Europe/Paris": { country: "fr", state: "" },
    "Asia/Ho_Chi_Minh": { country: "vn", state: "" },
  };
  return byZone[timeZone] ?? { country: "", state: "" };
}

/** Adds `openNow` to each toilet, so the browser never has to parse anything. */
export function withOpenState<T extends Pick<ToiletRecord, "openingHours" | "lat" | "lng">>(
  toilets: T[],
  at = new Date(),
): (T & { openNow: OpenState })[] {
  return toilets.map((toilet) => ({ ...toilet, openNow: openState(toilet.openingHours, toilet, at) }));
}

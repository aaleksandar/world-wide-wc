/**
 * The harvesting agent's first stage: pull real toilets out of OpenStreetMap and
 * normalise them into our shape, keeping a link back to the OSM node for every one.
 *
 *   npm run harvest -- --city london --limit 100
 *
 * Writes data/seed-<city>.json. Submitting that to the chain is a separate step, so the
 * data can be reviewed before it costs gas — and so a re-run doesn't re-hit Overpass.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CITIES, coordsOf, fetchOsmToilets, osmToToilet, type OsmElement } from "../lib/osm";
import type { Toilet } from "../lib/payload";

export type HarvestedToilet = {
  lat: number;
  lng: number;
  osmType: string;
  osmId: number;
  toilet: Partial<Toilet>;
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const cityKey = (arg("city", "london") ?? "london").toLowerCase();
const city = CITIES[cityKey];
if (!city) {
  throw new Error(`Unknown city "${cityKey}". Known: ${Object.keys(CITIES).join(", ")}`);
}
const limit = Number(arg("limit", "100"));
const refresh = process.argv.includes("--refresh");

mkdirSync("data", { recursive: true });
const rawPath = `data/osm-${cityKey}.raw.json`;

let elements: OsmElement[];
if (existsSync(rawPath) && !refresh) {
  elements = JSON.parse(readFileSync(rawPath, "utf8")) as OsmElement[];
  console.log(`${elements.length} elements from cache (${rawPath}) — pass --refresh to refetch`);
} else {
  console.log(`querying Overpass for ${city.label}…`);
  elements = await fetchOsmToilets(city.bbox);
  writeFileSync(rawPath, JSON.stringify(elements, null, 2));
  console.log(`${elements.length} elements fetched, cached to ${rawPath}`);
}

// Named entries first: they make a far better map than a hundred unnamed dots, and if we
// are capping the run we would rather cap it at the useful end.
const ranked = [...elements].sort((a, b) => {
  const score = (element: OsmElement) => Object.keys(element.tags ?? {}).length;
  return score(b) - score(a);
});

const harvested: HarvestedToilet[] = [];
for (const element of ranked.slice(0, limit)) {
  const coords = coordsOf(element);
  if (!coords) continue;
  harvested.push({
    lat: coords.lat,
    lng: coords.lng,
    osmType: element.type,
    osmId: element.id,
    toilet: osmToToilet(element),
  });
}

const outPath = `data/seed-${cityKey}.json`;
writeFileSync(outPath, `${JSON.stringify(harvested, null, 2)}\n`);

const count = (predicate: (h: HarvestedToilet) => boolean) => harvested.filter(predicate).length;
console.log(`\n${harvested.length} toilets → ${outPath}`);
console.log(`  named            ${count((h) => !!h.toilet.name)}`);
console.log(`  free             ${count((h) => h.toilet.access === "free")}`);
console.log(`  paid             ${count((h) => h.toilet.access === "paid")}`);
console.log(`  customers only   ${count((h) => h.toilet.access === "customer")}`);
console.log(`  step-free  yes   ${count((h) => h.toilet.isAccessible === true)}`);
console.log(`  step-free  no    ${count((h) => h.toilet.isAccessible === false)}`);
console.log(`  step-free  ?     ${count((h) => h.toilet.isAccessible === undefined)}`);
console.log(`  changing table   ${count((h) => h.toilet.hasChangingTable === true)}`);
console.log(`  opening hours    ${count((h) => !!h.toilet.openingHours)}`);
console.log(`  with provenance  ${count((h) => !!h.toilet.sourceUrl)}`);

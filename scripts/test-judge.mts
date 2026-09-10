/**
 * Puts the judge in front of evidence where the right answer is known, including the
 * cases most likely to be got wrong.
 *
 *   npx tsx scripts/test-judge.mts
 */
import "dotenv/config";
import type { Evidence } from "../lib/evidence";
import { judge } from "../lib/judge";

const base: Evidence = {
  toiletId: "1", name: "Test", source: "agent",
  sourceUrl: "https://www.openstreetmap.org/way/1",
  sourceStatus: "ok", sourceResolves: true, httpStatus: 200, fetchError: null,
  sourceKind: "osm", sourceAgeDays: 30, surveyAgeDays: 30, entryAgeDays: 1,
  contradictions: [], corroborated: ["access", "price", "isAccessible"], unsupported: [],
};

const cases: [string, Partial<Evidence>, (b: string) => boolean, string][] = [
  ["fresh, surveyed 30d ago, 3 fields corroborated", {}, (b) => b === "max", "max"],
  ["valid but untouched for 1833 days",
    { sourceAgeDays: 1833, surveyAgeDays: null }, (b) => b === "medium", "medium"],
  ["source deleted from OSM",
    { sourceStatus: "gone", sourceResolves: false, httpStatus: 410,
      fetchError: "deleted from OpenStreetMap", corroborated: [], sourceAgeDays: null, surveyAgeDays: null },
    (b) => b === "low", "low"],
  ["contradicts us on access and price",
    { contradictions: [
        { field: "access", recorded: "free", sourceSaysNow: "paid" },
        { field: "price", recorded: "0", sourceSaysNow: "50" }],
      corroborated: [] },
    (b) => b === "low", "low"],
  ["site blocked our crawler (403) — must not be treated as gone",
    { sourceKind: "web", sourceStatus: "blocked", sourceResolves: false, httpStatus: 403,
      fetchError: "HTTP 403", corroborated: [], sourceAgeDays: null, surveyAgeDays: null },
    (b) => b !== "low", "not low"],
];

let failed = 0;
for (const [label, patch, ok, expected] of cases) {
  const verdict = await judge({ ...base, ...patch });
  if ("error" in verdict) {
    console.error(`✗ ${label}\n    ERROR ${verdict.error}`);
    failed++;
    continue;
  }
  const pass = ok(verdict.band);
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  console.log(`    ${verdict.band} ${verdict.score}/100 (expected ${expected}) [${verdict.model}]`);
  console.log(`    "${verdict.reasoning}"`);
}

console.log(failed ? `\n${failed} case(s) wrong` : "\n✓ the judge lands every case in the right band");
process.exit(failed ? 1 : 0);

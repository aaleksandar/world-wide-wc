/**
 * Exercises the evidence gatherer against live entries and a deliberately broken source.
 * Needs no model — this is the deterministic half of the judge.
 *
 *   npx tsx scripts/test-evidence.mts
 */
import "dotenv/config";
import { gatherEvidence, parseOsmUrl } from "../lib/evidence";
import { fetchToilets } from "../lib/subgraph";

const all = await fetchToilets();
const withSource = all.filter((t) => t.sourceUrl);
console.log(`${all.length} toilets, ${withSource.length} with a source URL\n`);

const osmSourced = withSource.filter((t) => /openstreetmap\.org/.test(t.sourceUrl));
console.log(`${osmSourced.length} of them cite OpenStreetMap\n`);
for (const toilet of osmSourced.slice(0, 4)) {
  const e = await gatherEvidence(toilet);
  console.log(`#${e.toiletId} ${(e.name || "(unnamed)").slice(0, 30).padEnd(30)} ${e.sourceKind}`);
  console.log(`   status ${e.sourceStatus}  http ${e.httpStatus}  ${e.fetchError ?? ""}`);
  console.log(`   source edited ${e.sourceAgeDays}d ago · surveyed ${e.surveyAgeDays ?? "never"}d ago · our entry ${e.entryAgeDays}d`);
  console.log(`   corroborated ${e.corroborated.length}: ${e.corroborated.join(", ") || "—"}`);
  console.log(`   unsupported  ${e.unsupported.length}: ${e.unsupported.join(", ") || "—"}`);
  console.log(`   CONTRADICTS  ${e.contradictions.length}: ${e.contradictions.map((c) => `${c.field} we=${c.recorded} osm=${c.sourceSaysNow}`).join("; ") || "—"}`);
  console.log();
}

// A dead source must be recognised as dead, not merely unverified.
const broken = { ...withSource[0], sourceUrl: "https://www.openstreetmap.org/node/999999999999" };
const dead = await gatherEvidence(broken);
console.log(`dead OSM node   → ${dead.sourceStatus}, http ${dead.httpStatus}, "${dead.fetchError}"`);

const nonsense = { ...withSource[0], sourceUrl: "https://not-a-real-domain-xyzzy.example/toilet" };
const gone = await gatherEvidence(nonsense);
console.log(`unreachable url → ${gone.sourceStatus}, kind ${gone.sourceKind}, "${gone.fetchError}"`);

const blocked = await gatherEvidence({ ...withSource[0], sourceUrl: "https://www.britishmuseum.org/visit/facilities" });
console.log(`bot-blocked url → ${blocked.sourceStatus}, http ${blocked.httpStatus}  (must NOT be "gone")`);

console.log("\nurl parsing:");
for (const u of [
  "https://www.openstreetmap.org/way/374959168",
  "https://www.openstreetmap.org/node/344521109",
  "https://the-attendant.com/",
]) console.log(`  ${u.padEnd(48)} → ${JSON.stringify(parseOsmUrl(u))}`);

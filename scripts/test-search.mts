import "dotenv/config";
import { searchToilets } from "../lib/subgraph";
import { formatDistance } from "../lib/geo";

// Trafalgar Square.
const here = { lat: 51.508, lng: -0.128 };

for (const [label, filters] of [
  ["anything within 500m", {}],
  ["free only", { access: ["free" as const] }],
  ["step-free within 1km", { needsStepFree: true, radiusMetres: 1000 }],
  ["free with a changing table", { access: ["free" as const], needsChangingTable: true, radiusMetres: 2000 }],
] as const) {
  const hits = await searchToilets({ ...here, radiusMetres: 500, limit: 5, ...filters });
  console.log(`\n${label} → ${hits.length}`);
  for (const hit of hits) {
    console.log(
      `  ${formatDistance(hit.distanceMetres).padStart(6)}  ${(hit.name || "(unnamed)").padEnd(30)} ${hit.access.padEnd(9)} ${hit.isAccessible ? "step-free" : ""}`,
    );
  }
}

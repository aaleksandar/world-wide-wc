/**
 * Copies MapLibre's worker bundle into public/.
 *
 * MapLibre 6 works out its own worker URL from `import.meta.url` and gives up — returning
 * an empty string, with no error — unless that is an http(s) URL. Under Turbopack it
 * isn't, so no worker starts, no vector tiles are ever requested, and the map renders a
 * blank canvas while reporting no errors at all. Serving the worker from our own origin
 * and telling MapLibre where it is fixes it.
 *
 * Copied from node_modules at build time rather than committed, so the worker can never
 * drift from the installed version of the library.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");

mkdirSync("public/maplibre", { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join("public/maplibre", file));
  console.log(`public/maplibre/${file}`);
}

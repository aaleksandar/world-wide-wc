import { setWorkerUrl } from "maplibre-gl";

/**
 * MapLibre 6 derives its worker URL from `import.meta.url` and silently gives up when
 * that isn't an http(s) URL — which is exactly what Turbopack hands it. The failure is
 * invisible: no worker starts, no vector tile is ever requested, and the map paints a
 * blank canvas while `map.on("error")` stays quiet. Style, TileJSON and sprites all load
 * fine over the main thread, which makes it look like the map is working.
 *
 * So we serve the worker from our own origin and say where it is. scripts/copy-map-worker.mts
 * puts it there on predev and prebuild.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

let configured = false;

export function configureMapWorker() {
  if (configured) return;
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  configured = true;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// MapLibre 6 dropped the default export; everything is named now.
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL, configureMapWorker } from "@/lib/map";
import {
  ACCESS_COLOURS,
  applyFilters,
  type FilterableToilet,
  type Filters,
  NO_FILTERS,
} from "@/lib/filters";
import type { ToiletRecord } from "@/lib/subgraph";
import { FilterPanel } from "./Filters";
import { ToiletCard } from "./ToiletCard";

/**
 * Toilets are drawn as a GeoJSON circle layer rather than one DOM marker each: a few
 * hundred markers is where MapLibre starts to feel it, and this map is meant to hold a
 * city.
 */

const SOURCE_ID = "toilets";

export function ToiletMap({
  toilets,
  center,
  isPreview,
}: {
  toilets: FilterableToilet[];
  center: [number, number];
  isPreview: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [selected, setSelected] = useState<ToiletRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  // Filtering happens here rather than in the subgraph because every toilet is already
  // loaded: a re-query would be slower than a predicate and would make the map flicker.
  // The subgraph supports the same filters natively for anyone querying it directly.
  const visible = useMemo(() => applyFilters(toilets, filters), [toilets, filters]);

  const byId = useRef(new Map<string, ToiletRecord>());
  byId.current = new Map(visible.map((toilet) => [toilet.id, toilet]));

  useEffect(() => {
    if (!container.current || map.current) return;
    configureMapWorker();

    const instance = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE_URL,
      center,
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    map.current = instance;

    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new GeolocateControl({ trackUserLocation: true, showAccuracyCircle: true }),
      "top-right",
    );

    instance.on("load", () => {
      instance.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      instance.addLayer({
        id: "toilet-halo",
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 16],
          "circle-color": ["get", "colour"],
          "circle-opacity": 0.18,
          "circle-opacity-transition": { duration: 200 },
        },
      });

      instance.addLayer({
        id: "toilet-dot",
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8],
          "circle-color": ["get", "colour"],
          "circle-stroke-width": 2,
          // Agent-sourced entries are outlined, human-verified ones are solid white-ringed.
          // You can see at a glance how much of the map a person has actually stood in.
          "circle-stroke-color": ["case", ["get", "isAgent"], "#ffffff", "#111111"],
        },
      });

      instance.on("click", "toilet-dot", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;
        if (id) setSelected(byId.current.get(id) ?? null);
      });
      for (const [event, cursor] of [
        ["mouseenter", "pointer"],
        ["mouseleave", ""],
      ] as const) {
        instance.on(event, "toilet-dot", () => {
          instance.getCanvas().style.cursor = cursor;
        });
      }

      setReady(true);
    });

    return () => {
      instance.remove();
      map.current = null;
    };
  }, [center]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: visible.map((toilet) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [toilet.lng, toilet.lat] },
        properties: {
          id: toilet.id,
          colour: ACCESS_COLOURS[toilet.access] ?? ACCESS_COLOURS.unknown,
          isAgent: toilet.source === "agent",
        },
      })),
    });
  }, [visible, ready]);


  useEffect(() => {
    if (selected && !visible.some((toilet) => toilet.id === selected.id)) setSelected(null);
  }, [visible, selected]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
        <div className="pointer-events-auto w-full max-w-sm">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            showing={visible.length}
            total={toilets.length}
          />
          {visible.length === 0 ? (
            <p className="mt-2 rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-zinc-500 shadow-lg dark:bg-zinc-900/95">
              Nothing matches. Try dropping a filter.
            </p>
          ) : null}
        </div>
      </div>

      {isPreview ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center p-3">
          <p className="pointer-events-auto rounded-full bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950 shadow-lg">
            Preview data — no subgraph configured, nothing here is onchain yet
          </p>
        </div>
      ) : null}

      {selected ? (
        <div className="absolute inset-x-0 bottom-0 z-20 p-3 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-96">
          <ToiletCard toilet={selected} onClose={() => setSelected(null)} />
        </div>
      ) : null}

    </div>
  );
}


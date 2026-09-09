"use client";

import { useEffect, useRef } from "react";
import { GeolocateControl, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL, configureMapWorker } from "@/lib/map";

/**
 * A map whose only job is to answer "which toilet?". Drag the pin, or click anywhere.
 */
export function PinMap({
  position,
  onMove,
}: {
  position: { lat: number; lng: number };
  onMove: (position: { lat: number; lng: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!container.current || map.current) return;
    configureMapWorker();

    const instance = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE_URL,
      center: [position.lng, position.lat],
      zoom: 16,
      attributionControl: { compact: true },
    });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    });
    instance.addControl(geolocate, "top-right");
    geolocate.on("geolocate", (event) => {
      const { latitude, longitude } = event.coords;
      onMoveRef.current({ lat: latitude, lng: longitude });
      marker.current?.setLngLat([longitude, latitude]);
    });

    const pin = new Marker({ draggable: true, color: "#16a34a" })
      .setLngLat([position.lng, position.lat])
      .addTo(instance);
    marker.current = pin;

    pin.on("dragend", () => {
      const { lat, lng } = pin.getLngLat();
      onMoveRef.current({ lat, lng });
    });

    instance.on("click", (event) => {
      pin.setLngLat(event.lngLat);
      onMoveRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    // Ask once on open — most people are submitting the toilet they're standing in.
    geolocate.on("error", () => {});
    instance.on("load", () => geolocate.trigger());

    return () => {
      instance.remove();
      map.current = null;
    };
    // Deliberately mount-only: re-centring while someone is dragging the pin would fight them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={container} className="h-64 w-full rounded-lg" />;
}

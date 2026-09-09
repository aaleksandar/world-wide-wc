/** Metres between two points, good enough for "is this toilet closer than that one". */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A latitude/longitude box that contains everything within `radiusMetres`. Lets the
 * subgraph do the coarse filtering, so we only pull back a handful of rows and measure
 * true distance on those.
 */
export function boundingBox(centre: { lat: number; lng: number }, radiusMetres: number) {
  const latDelta = radiusMetres / 111_320;
  const lngDelta = radiusMetres / (111_320 * Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180)));
  return {
    minLat: centre.lat - latDelta,
    maxLat: centre.lat + latDelta,
    minLng: centre.lng - lngDelta,
    maxLng: centre.lng + lngDelta,
  };
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

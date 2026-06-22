// Geometry helpers. All distances in nautical miles, all bearings in
// degrees clockwise from true north.

const R_NM = 3440.065; // Earth radius in nautical miles

export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance between two lat/lon points, in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

/** Initial bearing (degrees, 0-360) from point 1 to point 2. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Is bearing b inside the [start, end] arc? Handles wrap-around past 360. */
export function inCone(b: number, start: number, end: number): boolean {
  if (start <= end) return b >= start && b <= end;
  return b >= start || b <= end;
}

/** Project from a point along a bearing/distance, returning [lng, lat] (GeoJSON order). */
export function destPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distNm: number
): [number, number] {
  const latOff = (distNm / 60) * Math.cos(toRad(bearingDeg));
  const lonOff = ((distNm / 60) * Math.sin(toRad(bearingDeg))) / Math.cos(toRad(lat));
  return [lon + lonOff, lat + latOff];
}

/** Build a pie-slice polygon (GeoJSON ring) for the view cone. */
export function conePolygon(
  lat: number,
  lon: number,
  start: number,
  end: number,
  distNm: number
): [number, number][] {
  const ring: [number, number][] = [[lon, lat]];
  const span = (end - start + 360) % 360 || 360;
  const steps = Math.max(2, Math.ceil(span / 4));
  for (let i = 0; i <= steps; i++) {
    ring.push(destPoint(lat, lon, start + (span * i) / steps, distNm));
  }
  ring.push([lon, lat]);
  return ring;
}

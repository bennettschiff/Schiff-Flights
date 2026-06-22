import { destPoint } from "@/lib/geo";

export interface MovingPosition {
  lat: number;
  lon: number;
  track?: number;
  gs?: number;
  positionTs?: number;
  alt_baro?: number | "ground";
}

export interface ProjectedPosition {
  lat: number;
  lon: number;
  ageSeconds: number;
}

/**
 * Dead-reckon an ADS-B position to the current animation frame. Live feeds are
 * snapshots, so this uses the reported track and groundspeed to keep an
 * aircraft moving between snapshots. Projection is deliberately capped so a
 * stale aircraft never continues flying indefinitely.
 */
export function projectAircraftPosition(
  plane: MovingPosition,
  nowMs: number,
  maxProjectionSeconds = 12
): ProjectedPosition {
  const positionTs = plane.positionTs ?? nowMs;
  const ageSeconds = Math.max(0, Math.min(maxProjectionSeconds, (nowMs - positionTs) / 1000));

  if (
    plane.alt_baro === "ground" ||
    typeof plane.track !== "number" ||
    typeof plane.gs !== "number" ||
    plane.gs < 5 ||
    ageSeconds === 0
  ) {
    return { lat: plane.lat, lon: plane.lon, ageSeconds };
  }

  const distanceNm = (plane.gs * ageSeconds) / 3600;
  const [lon, lat] = destPoint(plane.lat, plane.lon, plane.track, distanceNm);
  return { lat, lon, ageSeconds };
}

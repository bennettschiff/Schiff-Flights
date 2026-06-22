import { REGIONAL_AIRPORTS } from "@/lib/airports";
import { distanceNm } from "@/lib/geo";
import type { Plane, TrackSample } from "@/lib/types";

export type TrackHistory = Map<string, TrackSample[]>;

const MAX_HISTORY_AGE_MS = 10 * 60 * 1000;
const MAX_SAMPLES = 12;

export function annotateLocalOperations(
  planes: Plane[],
  history: TrackHistory,
  nowMs: number
): Plane[] {
  const activeIds = new Set(planes.map((plane) => plane.id));

  for (const [id, samples] of history) {
    const last = samples[samples.length - 1];
    if (!last || nowMs - last.at > MAX_HISTORY_AGE_MS || !activeIds.has(id)) history.delete(id);
  }

  return planes.map((plane) => {
    if (plane.lat == null || plane.lon == null) return plane;

    const samples = history.get(plane.id) ?? [];
    const previous = samples[samples.length - 1];
    const sample: TrackSample = {
      at: nowMs,
      lat: plane.lat,
      lon: plane.lon,
      altitude: plane.alt_baro,
    };
    history.set(plane.id, [...samples, sample].slice(-MAX_SAMPLES));

    const nearby = REGIONAL_AIRPORTS.map((airport) => ({
      airport,
      distance: distanceNm(plane.lat!, plane.lon!, airport.lat, airport.lon),
    })).sort((a, b) => a.distance - b.distance)[0];

    if (!nearby || nearby.distance > 20) return plane;
    if (plane.alt_baro === "ground" && nearby.distance <= 3) {
      return {
        ...plane,
        localOperation: {
          kind: "ground",
          airport: nearby.airport.iata,
          label: `At ${nearby.airport.iata}`,
        },
      };
    }

    if (!previous || previous.altitude === "ground" || typeof plane.alt_baro !== "number") {
      return plane;
    }

    const previousDistance = distanceNm(
      previous.lat,
      previous.lon,
      nearby.airport.lat,
      nearby.airport.lon
    );
    const distanceDelta = nearby.distance - previousDistance;
    const previousAltitude = typeof previous.altitude === "number" ? previous.altitude : plane.alt_baro;
    const altitudeDelta = plane.alt_baro - previousAltitude;
    const descending = (plane.baro_rate ?? 0) <= -250 || altitudeDelta <= -75;
    const climbing = (plane.baro_rate ?? 0) >= 250 || altitudeDelta >= 75;

    if (plane.alt_baro <= 8000 && descending && distanceDelta <= -0.04) {
      return {
        ...plane,
        localOperation: {
          kind: "arriving",
          airport: nearby.airport.iata,
          label: `Arriving ${nearby.airport.iata}`,
        },
      };
    }

    if (plane.alt_baro <= 8000 && climbing && distanceDelta >= 0.04) {
      return {
        ...plane,
        localOperation: {
          kind: "departing",
          airport: nearby.airport.iata,
          label: `Departed ${nearby.airport.iata}`,
        },
      };
    }

    return plane;
  });
}

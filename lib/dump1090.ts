// Adapter for a local ADS-B receiver (Raspberry Pi running dump1090 / readsb /
// PiAware). Those decoders publish every aircraft the antenna can hear at
//   http://<pi-ip>:8080/data/aircraft.json
// in a shape close to — but not identical to — the airplanes.live point feed:
//   - the array is `aircraft`, not `ac`
//   - `now` is epoch SECONDS (float), not milliseconds
//   - results are NOT pre-filtered to a point+radius; the receiver returns
//     everything in range, including aircraft with no position fix yet.
// This module normalizes that into the same {ac, now(ms)} the rest of the app
// already consumes, filtered to the viewer's radius.

import { distanceNm } from "@/lib/geo";
import type { RawAircraft } from "@/lib/types";

interface Dump1090Aircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  squawk?: string;
  baro_rate?: number;
  category?: string;
  seen_pos?: number;
}

interface Dump1090Feed {
  now?: number; // epoch seconds
  aircraft?: Dump1090Aircraft[];
}

export interface NormalizedFeed {
  ac: RawAircraft[];
  now: number; // epoch milliseconds
}

// Drop a position older than this; a Pi keeps echoing an aircraft for a while
// after it goes out of range, and a stale fix shouldn't masquerade as live.
const MAX_POSITION_AGE_S = 60;

function trimFlight(flight: string | undefined): string | undefined {
  const trimmed = flight?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Convert a raw dump1090 `aircraft.json` payload into the app's feed shape,
 * keeping only aircraft with a recent position within `radiusNm` of the
 * viewer. Tolerant of partial/garbage input — a malformed feed yields an
 * empty result rather than throwing.
 */
export function normalizeDump1090(
  raw: unknown,
  center: { lat: number; lon: number; radiusNm: number }
): NormalizedFeed {
  const feed = (raw ?? {}) as Dump1090Feed;
  const nowMs =
    typeof feed.now === "number" && Number.isFinite(feed.now)
      ? feed.now * 1000
      : Date.now();

  const source = Array.isArray(feed.aircraft) ? feed.aircraft : [];
  const ac: RawAircraft[] = [];

  for (const a of source) {
    if (!a || typeof a.hex !== "string") continue;
    if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if (typeof a.seen_pos === "number" && a.seen_pos > MAX_POSITION_AGE_S) continue;
    if (distanceNm(center.lat, center.lon, a.lat, a.lon) > center.radiusNm) continue;

    ac.push({
      hex: a.hex,
      flight: trimFlight(a.flight),
      r: a.r,
      t: a.t,
      alt_baro: a.alt_baro,
      gs: a.gs,
      track: a.track,
      lat: a.lat,
      lon: a.lon,
      squawk: a.squawk,
      baro_rate: a.baro_rate,
      category: a.category,
      seen_pos: a.seen_pos,
    });
  }

  return { ac, now: nowMs };
}

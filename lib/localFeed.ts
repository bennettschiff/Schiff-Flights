// Client-side bridge to a self-hosted ADS-B receiver (Raspberry Pi) on the
// viewer's home network. The deployed server can't reach a private LAN IP, so
// the browser fetches the receiver directly and hands the raw payload to our
// API route to be normalized + enriched. Any failure returns null, and the
// caller falls back to the public feeds — so leaving the home network, or the
// Pi being off, degrades silently.

import type { RawAircraft } from "@/lib/types";

export interface LocalFeedResult {
  ac: RawAircraft[];
  now: number;
  source: string;
}

/** Strip trailing slashes so we can append a known path safely. */
function normalizeBase(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  // Only http(s); refuse anything exotic the user might paste in.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export async function fetchLocalFeed(
  s: { lat: number; lon: number; radiusNm: number; localFeedUrl?: string },
  signal?: AbortSignal
): Promise<LocalFeedResult | null> {
  const base = s.localFeedUrl ? normalizeBase(s.localFeedUrl) : null;
  if (!base) return null;

  try {
    // Short timeout: if the Pi is unreachable we want to fail fast and let the
    // public feed take over within the same poll tick.
    const raw = await fetch(`${base}/data/aircraft.json`, {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(2500),
    }).then((r) => {
      if (!r.ok) throw new Error(`local-pi ${r.status}`);
      return r.json();
    });

    // Round-trip through our route so the local feed gets the same
    // registration/photo enrichment the public feeds receive.
    const res = await fetch("/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({ raw, lat: s.lat, lon: s.lon, radius: s.radiusNm }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LocalFeedResult;
    return Array.isArray(data.ac) ? data : null;
  } catch {
    return null;
  }
}

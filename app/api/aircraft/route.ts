import { NextResponse } from "next/server";
import type { RawAircraft } from "@/lib/types";

export const dynamic = "force-dynamic";

// Tiny in-memory cache so multiple viewers near the same spot don't each
// hammer the upstream free API. Keyed by rounded lat/lon + radius.
interface AircraftPayload {
  ac: RawAircraft[];
  now: number;
  source: "airplanes.live" | "adsb.lol";
  fallback?: boolean;
  stale?: boolean;
  error?: string;
}

const cache = new Map<string, { t: number; data: AircraftPayload }>();
const TTL_MS = 3000;
const MAX_CACHE_ENTRIES = 100;

interface AircraftMetadata {
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  photoUrl?: string;
  photoThumbnailUrl?: string;
}

// Registration data changes very slowly. Cache both hits and misses so the
// five-second live poll never turns into a storm of metadata requests.
const metadataCache = new Map<string, { t: number; data: AircraftMetadata | null }>();
const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NEW_METADATA_LOOKUPS = 16;

async function fetchAircraftMetadata(hex: string): Promise<AircraftMetadata | null> {
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`, {
      headers: { "User-Agent": "plane-spotter/0.5 (personal use)" },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const aircraft = json?.response?.aircraft;
    if (!aircraft) return null;
    return {
      r: aircraft.registration || undefined,
      t: aircraft.icao_type || undefined,
      desc: [aircraft.manufacturer, aircraft.type].filter(Boolean).join(" ") || undefined,
      ownOp: aircraft.registered_owner || undefined,
      photoUrl: aircraft.url_photo || undefined,
      photoThumbnailUrl: aircraft.url_photo_thumbnail || undefined,
    };
  } catch {
    return null;
  }
}

async function supplementAircraft(rows: RawAircraft[]): Promise<RawAircraft[]> {
  const now = Date.now();
  const lookups: Promise<void>[] = [];
  let started = 0;

  for (const aircraft of rows) {
    const key = aircraft.hex.replace(/^~/, "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(key)) continue;
    const cached = metadataCache.get(key);
    if (cached && now - cached.t < METADATA_TTL_MS) continue;
    if (started >= MAX_NEW_METADATA_LOOKUPS) continue;
    // The supplement is most useful when a feed omitted its database fields.
    if (aircraft.r && aircraft.t && aircraft.ownOp && aircraft.desc) continue;
    started += 1;
    lookups.push(
      fetchAircraftMetadata(key).then((data) => {
        metadataCache.set(key, { t: Date.now(), data });
      })
    );
  }

  await Promise.all(lookups);
  return rows.map((aircraft) => {
    const key = aircraft.hex.replace(/^~/, "").toUpperCase();
    const supplemental = metadataCache.get(key)?.data;
    if (!supplemental) return aircraft;
    return {
      ...supplemental,
      ...aircraft,
      // Empty upstream strings should not erase useful supplemental values.
      r: aircraft.r || supplemental.r,
      t: aircraft.t || supplemental.t,
      desc: aircraft.desc || supplemental.desc,
      ownOp: aircraft.ownOp || supplemental.ownOp,
      photoUrl: aircraft.photoUrl || supplemental.photoUrl,
      photoThumbnailUrl: aircraft.photoThumbnailUrl || supplemental.photoThumbnailUrl,
    };
  });
}

async function fetchFeed(url: string, source: AircraftPayload["source"]): Promise<AircraftPayload> {
  const res = await fetch(url, {
    headers: { "User-Agent": "plane-spotter/0.4 (personal use)" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const data = (await res.json()) as { ac?: RawAircraft[]; now?: number };
  return { ac: data.ac ?? [], now: data.now ?? Date.now(), source };
}

// Server-side proxy to airplanes.live. Location now comes from the viewer's
// settings (query params) instead of being hard-coded.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lon = parseFloat(searchParams.get("lon") ?? "");
  const requestedRadius = parseInt(searchParams.get("radius") ?? "40", 10);
  const radius = Number.isFinite(requestedRadius)
    ? Math.min(250, Math.max(1, requestedRadius))
    : 40;
  const nowMs = Date.now();

  if (
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json({ ac: [], error: "missing lat/lon", now: nowMs }, { status: 200 });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${radius}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.t < TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "Cache-Control": "no-store" } });
  }

  const failures: string[] = [];
  const feeds: Array<{ source: AircraftPayload["source"]; url: string }> = [
    {
      source: "airplanes.live",
      url: `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}`,
    },
    {
      source: "adsb.lol",
      url: `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`,
    },
  ];

  for (const [index, feed] of feeds.entries()) {
    try {
      const payload = await fetchFeed(feed.url, feed.source);
      payload.ac = await supplementAircraft(payload.ac);
      if (index > 0) payload.fallback = true;
      cache.set(key, { t: nowMs, data: payload });
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return NextResponse.json(payload, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      failures.push(String(error));
    }
  }

  // A temporarily stale position is safer and more useful than making every
  // aircraft vanish during a brief upstream outage.
  if (hit) {
    return NextResponse.json(
      { ...hit.data, stale: true, error: failures.join("; ") },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { ac: [], error: failures.join("; "), now: nowMs, source: "airplanes.live" },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

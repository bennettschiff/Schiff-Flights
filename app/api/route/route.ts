import { NextResponse } from "next/server";
import { assessRoute } from "@/lib/route-confidence";
import type { Airport, RouteInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

// Cache route lookups — a given callsign's route is stable for the day.
const cache = new Map<string, { t: number; data: RouteInfo | null }>();
const TTL_MS = 60 * 60 * 1000;

function mapAirport(a: any): Airport | null {
  if (!a || typeof a.latitude !== "number" || typeof a.longitude !== "number") return null;
  return {
    iata: a.iata_code || undefined,
    icao: a.icao_code || undefined,
    name: a.name || a.icao_code || "",
    municipality: a.municipality || undefined,
    country: a.country_iso_name || undefined,
    lat: a.latitude,
    lon: a.longitude,
  };
}

// Free callsign -> route (origin/destination) lookup via adsbdb. ADS-B itself
// doesn't carry route info; this matches the callsign against a schedule DB.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const callsign = (searchParams.get("callsign") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2,12}$/.test(callsign)) {
    return NextResponse.json({ route: null }, { status: 200 });
  }

  const latRaw = searchParams.get("lat");
  const lonRaw = searchParams.get("lon");
  const trackRaw = searchParams.get("track");
  const lat = latRaw == null ? Number.NaN : Number(latRaw);
  const lon = lonRaw == null ? Number.NaN : Number(lonRaw);
  const track = trackRaw == null ? Number.NaN : Number(trackRaw);
  const altitudeRaw = searchParams.get("altitude");
  const altitude =
    altitudeRaw === "ground"
      ? "ground"
      : altitudeRaw == null
        ? Number.NaN
        : Number(altitudeRaw);

  const withConfidence = (candidate: RouteInfo | null): RouteInfo | null => {
    if (!candidate) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return {
        ...candidate,
        confidence: "uncertain",
        reason: "No live position was supplied to verify this schedule match.",
      };
    }
    return assessRoute(candidate, {
      lat,
      lon,
      track: Number.isFinite(track) ? track : undefined,
      altitude:
        altitude === "ground" || Number.isFinite(altitude) ? altitude : undefined,
    });
  };

  const hit = cache.get(callsign);
  if (hit && Date.now() - hit.t < TTL_MS) {
    return NextResponse.json({ route: withConfidence(hit.data) }, { status: 200 });
  }

  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
      headers: { "User-Agent": "plane-spotter/0.3 (personal use)" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      cache.set(callsign, { t: Date.now(), data: null });
      return NextResponse.json({ route: null }, { status: 200 });
    }
    const json = await res.json();
    const fr = json?.response?.flightroute;
    if (!fr) {
      cache.set(callsign, { t: Date.now(), data: null });
      return NextResponse.json({ route: null }, { status: 200 });
    }
    const route: RouteInfo = {
      callsign,
      airline: fr.airline?.name || undefined,
      origin: mapAirport(fr.origin),
      destination: mapAirport(fr.destination),
      source: "adsbdb",
    };
    cache.set(callsign, { t: Date.now(), data: route });
    return NextResponse.json({ route: withConfidence(route) }, { status: 200 });
  } catch {
    return NextResponse.json({ route: null }, { status: 200 });
  }
}

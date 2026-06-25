import { NextResponse } from "next/server";
import { assessRoute } from "@/lib/route-confidence";
import { findRegionalAirport } from "@/lib/airports";
import type { Airport, RouteAudit, RouteInfo } from "@/lib/types";

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

function mapRegionalAirport(code?: string): Airport | null {
  const airport = findRegionalAirport(code);
  if (!airport) return null;
  return {
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    lat: airport.lat,
    lon: airport.lon,
  };
}

function routeResponse(route: RouteInfo | null, audit: RouteAudit) {
  return NextResponse.json({ route, audit }, { status: 200 });
}

// Free callsign -> route (origin/destination) lookup via adsbdb. ADS-B itself
// doesn't carry route info; this matches the callsign against a schedule DB.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const callsign = (searchParams.get("callsign") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const feedOrigin = (searchParams.get("route_origin") ?? "").trim().toUpperCase();
  const feedDestination = (searchParams.get("route_dest") ?? "").trim().toUpperCase();
  const localKind = searchParams.get("local_kind");
  const localAirport = (searchParams.get("local_airport") ?? "").trim().toUpperCase();

  const localAudit = (): RouteAudit | null => {
    if (!localKind || !localAirport) return null;
    const action =
      localKind === "arriving"
        ? `Observed descending toward ${localAirport}.`
        : localKind === "departing"
          ? `Observed climbing away from ${localAirport}.`
          : `Observed on the ground at ${localAirport}.`;
    return {
      status: "observed_local",
      provider: "local",
      reason: `${action} No free public source supplied a complete origin-destination pair.`,
      originHint: localKind === "departing" || localKind === "ground" ? localAirport : undefined,
      destinationHint: localKind === "arriving" || localKind === "ground" ? localAirport : undefined,
    };
  };

  if (!/^[A-Z0-9]{2,12}$/.test(callsign)) {
    return routeResponse(null, {
      status: "missing_callsign",
      reason: "No usable callsign was available for a schedule lookup.",
    });
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

  const feedRoute = (() => {
    if (!feedOrigin || !feedDestination) return null;
    const origin = mapRegionalAirport(feedOrigin);
    const destination = mapRegionalAirport(feedDestination);
    if (!origin || !destination) return null;
    return withConfidence({
      callsign,
      origin,
      destination,
      source: "tfms",
    });
  })();

  if (feedRoute) {
    const status = feedRoute.confidence === "rejected" ? "hidden" : "identified";
    return routeResponse(feedRoute, {
      status,
      provider: "tfms",
      reason:
        status === "hidden"
          ? feedRoute.reason || "The feed route hint contradicted the live aircraft position."
          : "The live feed supplied route endpoints and the live position did not contradict them.",
      originHint: feedOrigin,
      destinationHint: feedDestination,
    });
  }

  const hit = cache.get(callsign);
  if (hit && Date.now() - hit.t < TTL_MS) {
    const checked = withConfidence(hit.data);
    if (checked) {
      return routeResponse(checked, {
        status: checked.confidence === "rejected" ? "hidden" : "identified",
        provider: "adsbdb",
        reason:
          checked.confidence === "rejected"
            ? checked.reason || "ADSBDB had a schedule candidate, but live geometry rejected it."
            : "ADSBDB supplied a schedule candidate for this callsign.",
      });
    }
    const fallbackAudit = localAudit();
    if (fallbackAudit) return routeResponse(null, fallbackAudit);
    return routeResponse(null, {
      status: feedOrigin || feedDestination ? "feed_hint_unresolved" : "no_public_match",
      provider: feedOrigin || feedDestination ? "tfms" : "adsbdb",
      reason:
        feedOrigin || feedDestination
          ? "The live feed included route text, but this app could not resolve both endpoints for geometry checks."
          : "ADSBDB did not have a public schedule match for this callsign.",
      originHint: feedOrigin || undefined,
      destinationHint: feedDestination || undefined,
    });
  }

  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
      headers: { "User-Agent": "plane-spotter/0.3 (personal use)" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      cache.set(callsign, { t: Date.now(), data: null });
      const fallbackAudit = localAudit();
      if (fallbackAudit) return routeResponse(null, fallbackAudit);
      return routeResponse(null, {
        status: "no_public_match",
        provider: "adsbdb",
        reason: `ADSBDB route lookup returned ${res.status}.`,
      });
    }
    const json = await res.json();
    const fr = json?.response?.flightroute;
    if (!fr) {
      cache.set(callsign, { t: Date.now(), data: null });
      const fallbackAudit = localAudit();
      if (fallbackAudit) return routeResponse(null, fallbackAudit);
      return routeResponse(null, {
        status: feedOrigin || feedDestination ? "feed_hint_unresolved" : "no_public_match",
        provider: feedOrigin || feedDestination ? "tfms" : "adsbdb",
        reason:
          feedOrigin || feedDestination
            ? "The live feed included route text, but this app could not resolve both endpoints for geometry checks."
            : "ADSBDB did not have a public schedule match for this callsign.",
        originHint: feedOrigin || undefined,
        destinationHint: feedDestination || undefined,
      });
    }
    const route: RouteInfo = {
      callsign,
      airline: fr.airline?.name || undefined,
      origin: mapAirport(fr.origin),
      destination: mapAirport(fr.destination),
      source: "adsbdb",
    };
    cache.set(callsign, { t: Date.now(), data: route });
    const checked = withConfidence(route);
    return routeResponse(checked, {
      status: checked?.confidence === "rejected" ? "hidden" : "identified",
      provider: "adsbdb",
      reason:
        checked?.confidence === "rejected"
          ? checked.reason || "ADSBDB had a schedule candidate, but live geometry rejected it."
          : "ADSBDB supplied a schedule candidate for this callsign.",
    });
  } catch {
    const fallbackAudit = localAudit();
    if (fallbackAudit) return routeResponse(null, fallbackAudit);
    return routeResponse(null, {
      status: "no_public_match",
      provider: "adsbdb",
      reason: "ADSBDB route lookup failed before returning a public schedule match.",
    });
  }
}

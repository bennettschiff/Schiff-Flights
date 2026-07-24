import { NextResponse } from "next/server";
import { assessRoute, pickBestLeg, type RouteObservation } from "@/lib/route-confidence";
import { callsignVariants, parseVrsRoute, vrsRouteUrl } from "@/lib/route-source";
import { findRegionalAirport } from "@/lib/airports";
import type { Airport, RouteAudit, RouteInfo, RouteLeg } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ScheduleMatch {
  legs: RouteLeg[];
  airline?: string;
  provider: "vrs" | "adsbdb";
}

// Cache route lookups — a given callsign's rotation is stable for the day.
const cache = new Map<string, { t: number; data: ScheduleMatch | null }>();
const TTL_MS = 60 * 60 * 1000;
// A miss is cached far more briefly than a hit. A timeout or a blip at the
// upstream is indistinguishable from "this callsign has no route", and an hour
// of blank routes for an aircraft overhead is a bad trade for one saved fetch.
const MISS_TTL_MS = 5 * 60 * 1000;

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

async function fetchVrs(callsign: string): Promise<ScheduleMatch | null> {
  for (const variant of callsignVariants(callsign)) {
    const url = vrsRouteUrl(variant);
    if (!url) continue;
    const res = await fetch(url, {
      headers: { "User-Agent": "plane-spotter/0.6 (personal use)" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) continue;
    const legs = parseVrsRoute(await res.json());
    if (legs.length) return { legs, provider: "vrs" };
  }
  return null;
}

// adsbdb collapses a rotation into a single origin/destination pair and its
// snapshot lags schedule changes, so it is only consulted when VRS has no file
// for the callsign at all.
async function fetchAdsbdb(callsign: string): Promise<ScheduleMatch | null> {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
    headers: { "User-Agent": "plane-spotter/0.6 (personal use)" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const fr = (await res.json())?.response?.flightroute;
  if (!fr) return null;
  const origin = mapAirport(fr.origin);
  const destination = mapAirport(fr.destination);
  if (!origin || !destination) return null;
  return {
    legs: [{ origin, destination, legIndex: 0, legCount: 1 }],
    airline: fr.airline?.name || undefined,
    provider: "adsbdb",
  };
}

async function resolveSchedule(callsign: string): Promise<ScheduleMatch | null> {
  const hit = cache.get(callsign);
  if (hit && Date.now() - hit.t < (hit.data ? TTL_MS : MISS_TTL_MS)) return hit.data;

  let match: ScheduleMatch | null = null;
  for (const lookup of [fetchVrs, fetchAdsbdb]) {
    try {
      match = await lookup(callsign);
    } catch {
      match = null;
    }
    if (match) break;
  }
  cache.set(callsign, { t: Date.now(), data: match });
  return match;
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

// Free callsign -> route lookup. ADS-B itself doesn't carry route info, so
// this matches the callsign against a schedule table and then checks the claim
// against the live position — a schedule match is a candidate, not a fact.
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

  const observation = (): RouteObservation => ({
    lat,
    lon,
    track: Number.isFinite(track) ? track : undefined,
    altitude: altitude === "ground" || Number.isFinite(altitude) ? altitude : undefined,
  });

  const withConfidence = (candidate: RouteInfo | null): RouteInfo | null => {
    if (!candidate) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return {
        ...candidate,
        confidence: "uncertain",
        reason: "No live position was supplied to verify this schedule match.",
      };
    }
    return assessRoute(candidate, observation());
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

  const match = await resolveSchedule(callsign);

  if (!match) {
    const fallbackAudit = localAudit();
    if (fallbackAudit) return routeResponse(null, fallbackAudit);
    return routeResponse(null, {
      status: feedOrigin || feedDestination ? "feed_hint_unresolved" : "no_public_match",
      provider: feedOrigin || feedDestination ? "tfms" : "vrs",
      reason:
        feedOrigin || feedDestination
          ? "The live feed included route text, but this app could not resolve both endpoints for geometry checks."
          : "No public schedule source listed a route for this callsign.",
      originHint: feedOrigin || undefined,
      destinationHint: feedDestination || undefined,
    });
  }

  const providerName = match.provider === "vrs" ? "The VRS schedule data" : "ADSBDB";
  const base = { airline: match.airline, source: match.provider } as const;

  // Without a live position there is nothing to check the schedule against, so
  // the first leg is shown as an unverified guess rather than a fact.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const [first] = match.legs;
    return routeResponse(
      {
        ...base,
        callsign,
        origin: first.origin,
        destination: first.destination,
        legIndex: first.legIndex,
        legCount: first.legCount,
        confidence: "uncertain",
        reason: "No live position was supplied to verify this schedule match.",
      },
      {
        status: "identified",
        provider: match.provider,
        reason: `${providerName} supplied a schedule candidate for this callsign.`,
      }
    );
  }

  const checked = pickBestLeg(callsign, match.legs, observation(), base);
  if (!checked) {
    const fallbackAudit = localAudit();
    if (fallbackAudit) return routeResponse(null, fallbackAudit);
    return routeResponse(null, {
      status: "no_public_match",
      provider: match.provider,
      reason: `${providerName} listed this callsign but without usable airport coordinates.`,
    });
  }

  const rejected = checked.confidence === "rejected";
  const legNote =
    (checked.legCount ?? 1) > 1
      ? ` Leg ${(checked.legIndex ?? 0) + 1} of ${checked.legCount} best fits the live position.`
      : "";
  return routeResponse(checked, {
    status: rejected ? "hidden" : "identified",
    provider: match.provider,
    reason: rejected
      ? checked.reason || `${providerName} had a schedule candidate, but live geometry rejected it.`
      : `${providerName} supplied a schedule candidate for this callsign.${legNote}`,
  });
}

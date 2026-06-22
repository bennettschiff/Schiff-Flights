import { bearing, distanceNm, toRad } from "@/lib/geo";
import type { RouteInfo } from "@/lib/types";

const EARTH_RADIUS_NM = 3440.065;

export interface RouteObservation {
  lat: number;
  lon: number;
  track?: number;
  altitude?: number | "ground";
}

export interface RouteGeometry {
  routeLengthNm: number;
  crossTrackNm: number;
  alongTrackNm: number;
  distanceToOriginNm: number;
  distanceToDestinationNm: number;
}

function signedAngleDifference(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export function routeGeometry(route: RouteInfo, observation: RouteObservation): RouteGeometry | null {
  const { origin, destination } = route;
  if (!origin || !destination) return null;

  const routeLengthNm = distanceNm(origin.lat, origin.lon, destination.lat, destination.lon);
  const distanceToOriginNm = distanceNm(origin.lat, origin.lon, observation.lat, observation.lon);
  const distanceToDestinationNm = distanceNm(
    observation.lat,
    observation.lon,
    destination.lat,
    destination.lon
  );
  const angularDistance = distanceToOriginNm / EARTH_RADIUS_NM;
  const routeBearing = bearing(origin.lat, origin.lon, destination.lat, destination.lon);
  const observationBearing = bearing(origin.lat, origin.lon, observation.lat, observation.lon);
  const bearingDelta = toRad(signedAngleDifference(observationBearing, routeBearing));
  const crossTrackAngle = Math.asin(Math.sin(angularDistance) * Math.sin(bearingDelta));
  const alongTrackAngle = Math.atan2(
    Math.sin(angularDistance) * Math.cos(bearingDelta),
    Math.cos(angularDistance)
  );

  return {
    routeLengthNm,
    crossTrackNm: Math.abs(crossTrackAngle * EARTH_RADIUS_NM),
    alongTrackNm: alongTrackAngle * EARTH_RADIUS_NM,
    distanceToOriginNm,
    distanceToDestinationNm,
  };
}

export function assessRoute(route: RouteInfo, observation: RouteObservation): RouteInfo {
  const geometry = routeGeometry(route, observation);
  if (!geometry) {
    return { ...route, confidence: "uncertain", reason: "Route endpoints are incomplete." };
  }

  const result = { ...route, ...geometry };
  const endpointDistance = Math.min(
    geometry.distanceToOriginNm,
    geometry.distanceToDestinationNm
  );

  if (observation.altitude === "ground") {
    if (endpointDistance <= 8) {
      return {
        ...result,
        confidence: "plausible",
        reason: "Aircraft is on the ground near a claimed endpoint.",
      };
    }
    return {
      ...result,
      confidence: "rejected",
      reason: `Aircraft is on the ground ${Math.round(endpointDistance)} nm from either claimed airport.`,
    };
  }

  // Long routes need a somewhat wider airway corridor, but never one so wide
  // that a Philadelphia aircraft can validate a route across the southern US.
  const corridorNm = Math.max(35, Math.min(120, geometry.routeLengthNm * 0.12));
  if (geometry.crossTrackNm > corridorNm) {
    return {
      ...result,
      confidence: "rejected",
      reason: `Live position is ${Math.round(geometry.crossTrackNm)} nm off the claimed route.`,
    };
  }

  const endpointMarginNm = 75;
  if (
    geometry.alongTrackNm < -endpointMarginNm ||
    geometry.alongTrackNm > geometry.routeLengthNm + endpointMarginNm
  ) {
    return {
      ...result,
      confidence: "rejected",
      reason: "Live position lies beyond the claimed flight segment.",
    };
  }

  if (
    typeof observation.track === "number" &&
    geometry.distanceToDestinationNm > 100 &&
    // Airliners commonly depart on a runway heading that points away from the
    // destination, then turn onto the route after several miles. Do not reject
    // a schedule match while the aircraft is still in that departure phase.
    geometry.distanceToOriginNm > Math.max(40, geometry.routeLengthNm * 0.1) &&
    Math.abs(
      signedAngleDifference(
        observation.track,
        bearing(observation.lat, observation.lon, route.destination!.lat, route.destination!.lon)
      )
    ) > 120
  ) {
    return {
      ...result,
      confidence: "uncertain",
      reason: "Position fits the corridor, but the aircraft is tracking away from the destination.",
    };
  }

  return {
    ...result,
    confidence: "plausible",
    reason: `Live position is within ${Math.round(geometry.crossTrackNm)} nm of the claimed route.`,
  };
}

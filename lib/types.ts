// Raw shape returned by airplanes.live (subset of fields we use).
export interface RawAircraft {
  hex: string;
  flight?: string; // callsign
  r?: string; // registration / tail number
  t?: string; // ICAO aircraft type, e.g. "B738"
  alt_baro?: number | "ground";
  gs?: number; // ground speed (knots)
  track?: number; // true track (deg)
  lat?: number;
  lon?: number;
  squawk?: string;
  baro_rate?: number; // vertical rate (ft/min)
  category?: string; // ADS-B emitter category, e.g. "A3", "A7" (rotorcraft)
  desc?: string; // human description, e.g. "BOEING 737-900"
  ownOp?: string; // operator/owner
  photoUrl?: string; // supplemental aircraft photo
  photoThumbnailUrl?: string;
  seen_pos?: number; // seconds since last position update
  route_origin?: string; // present on TFMS-enriched receiver feeds
  route_dest?: string;
}

export interface Airport {
  iata?: string;
  icao?: string;
  name: string;
  municipality?: string;
  country?: string;
  lat: number;
  lon: number;
}

// One sector of a (possibly multi-stop) rotation flown under a single callsign.
export interface RouteLeg {
  origin: Airport;
  destination: Airport;
  legIndex: number; // 0-based position within the rotation
  legCount: number; // total legs the callsign flies today
}

export interface RouteInfo {
  callsign: string;
  airline?: string;
  origin: Airport | null;
  destination: Airport | null;
  source?: "vrs" | "adsbdb" | "tfms" | "local";
  confidence?: "verified" | "plausible" | "uncertain" | "rejected";
  reason?: string;
  crossTrackNm?: number;
  alongTrackNm?: number;
  routeLengthNm?: number;
  distanceToOriginNm?: number;
  distanceToDestinationNm?: number;
  legIndex?: number;
  legCount?: number;
}

export interface RouteAudit {
  status:
    | "identified"
    | "missing_callsign"
    | "no_public_match"
    | "hidden"
    | "feed_hint_unresolved"
    | "observed_local";
  provider?: "vrs" | "adsbdb" | "tfms" | "local";
  reason: string;
  originHint?: string;
  destinationHint?: string;
}

export interface LocalOperation {
  kind: "arriving" | "departing" | "ground";
  airport: string;
  label: string;
}

export interface TrackSample {
  at: number;
  lat: number;
  lon: number;
  altitude?: number | "ground";
}

// Enriched with values computed relative to HOME.
export interface Plane extends RawAircraft {
  id: string;
  callsign: string;
  distNm: number;
  brg: number; // bearing from home to plane
  inView: boolean; // inside your balcony's view cone
  localOperation?: LocalOperation;
  positionTs: number; // epoch ms for the underlying ADS-B position sample
}

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

export interface RouteInfo {
  callsign: string;
  airline?: string;
  origin: Airport | null;
  destination: Airport | null;
  source?: "adsbdb" | "tfms";
  confidence?: "verified" | "plausible" | "uncertain" | "rejected";
  reason?: string;
  crossTrackNm?: number;
  alongTrackNm?: number;
  routeLengthNm?: number;
  distanceToOriginNm?: number;
  distanceToDestinationNm?: number;
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
}

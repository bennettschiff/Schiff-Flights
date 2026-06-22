import assert from "node:assert/strict";
import test from "node:test";
import { assessRoute } from "../lib/route-confidence";
import type { Airport, RouteInfo } from "../lib/types";

const airport = (iata: string, lat: number, lon: number): Airport => ({
  iata,
  name: iata,
  lat,
  lon,
});

const route = (origin: Airport, destination: Airport): RouteInfo => ({
  callsign: "TEST1",
  origin,
  destination,
  source: "adsbdb",
});

test("rejects the observed AAL3042 DFW-RSW false match over Philadelphia", () => {
  const result = assessRoute(
    route(airport("DFW", 32.896801, -97.038002), airport("RSW", 26.5362, -81.7552)),
    { lat: 39.94, lon: -75.45, track: 343, altitude: 10500 }
  );

  assert.equal(result.confidence, "rejected");
  assert.ok((result.crossTrackNm ?? 0) > 800);
  assert.match(result.reason ?? "", /off the claimed route/);
});

test("accepts a position near a claimed PHL-BOS corridor", () => {
  const result = assessRoute(
    route(airport("PHL", 39.8719, -75.2411), airport("BOS", 42.3656, -71.0096)),
    { lat: 40.45, lon: -74.45, track: 45, altitude: 18000 }
  );

  assert.equal(result.confidence, "plausible");
  assert.ok((result.crossTrackNm ?? Infinity) < 35);
});

test("accepts a commercial flight still on an opposite-direction departure heading", () => {
  const result = assessRoute(
    route(airport("PHL", 39.8719, -75.2411), airport("MIA", 25.7932, -80.2906)),
    // A southbound flight can initially depart north/east for its assigned
    // runway before turning toward Florida.
    { lat: 39.92, lon: -75.18, track: 40, altitude: 4075 }
  );

  assert.equal(result.confidence, "plausible");
  assert.ok((result.distanceToOriginNm ?? Infinity) < 10);
});

test("rejects a ground aircraft far from both claimed airports", () => {
  const result = assessRoute(
    route(airport("PHX", 33.4353, -112.0059), airport("MIA", 25.7932, -80.2906)),
    { lat: 39.872, lon: -75.244, altitude: "ground" }
  );

  assert.equal(result.confidence, "rejected");
  assert.match(result.reason ?? "", /on the ground/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { assessRoute, pickBestLeg } from "../lib/route-confidence";
import { callsignVariants, parseVrsRoute, vrsRouteUrl } from "../lib/route-source";
import type { Airport, RouteInfo, RouteLeg } from "../lib/types";

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

// --- multi-leg rotations -------------------------------------------------

const CLT = airport("CLT", 35.214, -80.9431);
const BOS = airport("BOS", 42.3656, -71.0096);

const leg = (origin: Airport, destination: Airport, legIndex: number): RouteLeg => ({
  origin,
  destination,
  legIndex,
  legCount: 2,
});

test("picks the return leg of an out-and-back rotation from the direction of travel", () => {
  // AAL1552 flies KCLT-KBOS-KCLT. Both legs share one great circle, so only
  // the aircraft's heading separates them. Southwest over Philadelphia means
  // it is on the BOS-CLT leg.
  const best = pickBestLeg(
    "AAL1552",
    [leg(CLT, BOS, 0), leg(BOS, CLT, 1)],
    { lat: 40.05, lon: -75.1, track: 225, altitude: 32000 }
  );

  assert.equal(best?.origin?.iata, "BOS");
  assert.equal(best?.destination?.iata, "CLT");
  assert.equal(best?.confidence, "plausible");
  assert.equal(best?.legIndex, 1);
  assert.equal(best?.legCount, 2);
});

test("picks the outbound leg of the same rotation when tracking the other way", () => {
  const best = pickBestLeg(
    "AAL1552",
    [leg(CLT, BOS, 0), leg(BOS, CLT, 1)],
    { lat: 40.05, lon: -75.1, track: 45, altitude: 32000 }
  );

  assert.equal(best?.origin?.iata, "CLT");
  assert.equal(best?.destination?.iata, "BOS");
  assert.equal(best?.confidence, "plausible");
  assert.equal(best?.legIndex, 0);
});

test("accepts the live UAL310 IAD-DUB schedule over Philadelphia", () => {
  // The stale adsbdb entry claimed EWR-SFO for this callsign. VRS has the
  // route actually flown, and the live position sits in its corridor.
  const best = pickBestLeg(
    "UAL310",
    [
      {
        origin: airport("IAD", 38.9445, -77.455803),
        destination: airport("DUB", 53.421299, -6.27007),
        legIndex: 0,
        legCount: 1,
      },
    ],
    { lat: 39.93, lon: -75.03, track: 55, altitude: 33000 }
  );

  assert.equal(best?.confidence, "plausible");
  assert.ok((best?.crossTrackNm ?? Infinity) < 60);
});

// --- VRS route documents -------------------------------------------------

test("splits a multi-stop VRS route into per-leg candidates", () => {
  const legs = parseVrsRoute({
    callsign: "AAL1552",
    airport_codes: "KCLT-KBOS-KCLT",
    _airport_codes_iata: "CLT-BOS-CLT",
    _airports: [
      { name: "Charlotte Douglas", icao: "KCLT", iata: "CLT", location: "Charlotte", lat: 35.214, lon: -80.9431 },
      { name: "Logan", icao: "KBOS", iata: "BOS", location: "Boston", lat: 42.3656, lon: -71.0096 },
      { name: "Charlotte Douglas", icao: "KCLT", iata: "CLT", location: "Charlotte", lat: 35.214, lon: -80.9431 },
    ],
  });

  assert.equal(legs.length, 2);
  assert.deepEqual(
    legs.map((l) => `${l.origin.iata}-${l.destination.iata}`),
    ["CLT-BOS", "BOS-CLT"]
  );
  assert.deepEqual(legs.map((l) => l.legCount), [2, 2]);
});

test("drops VRS legs whose endpoint has no coordinates", () => {
  const legs = parseVrsRoute({
    airport_codes: "KJFK-XXXX-KJFK",
    _airports: [
      { icao: "KJFK", iata: "JFK", lat: 40.6398, lon: -73.7789 },
      null,
      { icao: "KJFK", iata: "JFK", lat: 40.6398, lon: -73.7789 },
    ],
  });

  assert.equal(legs.length, 0);
});

test("only builds VRS lookups for airline-style callsigns", () => {
  assert.match(vrsRouteUrl("AAL1552") ?? "", /routes\/AA\/AAL1552\.json$/);
  assert.match(vrsRouteUrl("ual310") ?? "", /routes\/UA\/UAL310\.json$/);
  assert.equal(vrsRouteUrl("N416MC"), null);
});

test("tries the unpadded flight number when a callsign is broadcast zero-padded", () => {
  // AFR099 over the air is filed as AFR99 in the route table.
  assert.deepEqual(callsignVariants("AFR099"), ["AFR099", "AFR99"]);
  assert.deepEqual(callsignVariants("DAL0042"), ["DAL0042", "DAL42"]);
  assert.deepEqual(callsignVariants("AAL1552"), ["AAL1552"]);
  // A number that is genuinely all zeros has no unpadded form to fall back to.
  assert.deepEqual(callsignVariants("XXX000"), ["XXX000"]);
});

test("tolerates departure vectoring off a very long great circle", () => {
  // LAN533 leaves JFK for Santiago heading southwest before turning south.
  // Its first 80 nm sit well off the direct line without being a bad match.
  const result = assessRoute(
    route(airport("JFK", 40.6398, -73.7789), airport("SCL", -33.393, -70.7858)),
    { lat: 39.6, lon: -75.9, track: 228, altitude: 32900 }
  );

  assert.equal(result.confidence, "plausible");
  assert.ok((result.distanceToOriginNm ?? Infinity) < 175);
});

test("still rejects a far-off match that is nowhere near either endpoint", () => {
  // The terminal-area widening must not resurrect the cross-country false
  // matches the corridor exists to catch.
  const result = assessRoute(
    route(airport("DFW", 32.896801, -97.038002), airport("TPA", 27.9755, -82.5332)),
    { lat: 40.05, lon: -75.1, track: 225, altitude: 32000 }
  );

  assert.equal(result.confidence, "rejected");
  assert.ok((result.crossTrackNm ?? 0) > 500);
});

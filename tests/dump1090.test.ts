import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDump1090 } from "../lib/dump1090";

// Center over Philadelphia for distance filtering.
const center = { lat: 39.95, lon: -75.16, radiusNm: 40 };

const sampleFeed = {
  now: 1_700_000_000, // epoch seconds
  aircraft: [
    // In range, complete fix.
    { hex: "a1b2c3", flight: "AAL123  ", lat: 39.96, lon: -75.2, alt_baro: 12000, gs: 320, track: 270, seen_pos: 0.3 },
    // No position yet — should be dropped.
    { hex: "ddddddd", flight: "NOFIX", seen_pos: 0.1 },
    // Stale position — should be dropped.
    { hex: "eeeeee", lat: 39.97, lon: -75.18, seen_pos: 120 },
    // Far outside the radius (NYC) — should be dropped.
    { hex: "ffffff", lat: 40.71, lon: -74.0, seen_pos: 0.2 },
  ],
};

test("normalizes dump1090 shape and converts seconds to milliseconds", () => {
  const result = normalizeDump1090(sampleFeed, center);
  assert.equal(result.now, 1_700_000_000_000);
  assert.equal(result.ac.length, 1);
  assert.equal(result.ac[0].hex, "a1b2c3");
});

test("trims padded callsigns and keeps used fields", () => {
  const { ac } = normalizeDump1090(sampleFeed, center);
  assert.equal(ac[0].flight, "AAL123");
  assert.equal(ac[0].gs, 320);
  assert.equal(ac[0].alt_baro, 12000);
});

test("drops aircraft without a position fix", () => {
  const { ac } = normalizeDump1090(sampleFeed, center);
  assert.ok(!ac.some((a) => a.hex === "ddddddd"));
});

test("drops stale positions beyond the age cutoff", () => {
  const { ac } = normalizeDump1090(sampleFeed, center);
  assert.ok(!ac.some((a) => a.hex === "eeeeee"));
});

test("filters aircraft outside the requested radius", () => {
  const { ac } = normalizeDump1090(sampleFeed, center);
  assert.ok(!ac.some((a) => a.hex === "ffffff"));
});

test("tolerates malformed input without throwing", () => {
  assert.deepEqual(normalizeDump1090(null, center).ac, []);
  assert.deepEqual(normalizeDump1090({ aircraft: "nope" }, center).ac, []);
  assert.deepEqual(normalizeDump1090({}, center).ac, []);
});

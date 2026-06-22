import assert from "node:assert/strict";
import test from "node:test";
import { distanceNm } from "../lib/geo";
import { projectAircraftPosition } from "../lib/motion";

test("projects an airborne aircraft continuously between feed snapshots", () => {
  const start = { lat: 39.974, lon: -75.141 };
  const projected = projectAircraftPosition(
    {
      ...start,
      track: 90,
      gs: 360,
      positionTs: 1_000,
      alt_baro: 10_000,
    },
    11_000
  );

  assert.ok(Math.abs(distanceNm(start.lat, start.lon, projected.lat, projected.lon) - 1) < 0.02);
  assert.ok(projected.lon > start.lon);
});

test("does not move ground or nearly stationary aircraft", () => {
  const projected = projectAircraftPosition(
    {
      lat: 39.872,
      lon: -75.241,
      track: 90,
      gs: 25,
      positionTs: 1_000,
      alt_baro: "ground",
    },
    11_000
  );

  assert.equal(projected.lat, 39.872);
  assert.equal(projected.lon, -75.241);
});

test("caps projection so stale aircraft do not fly forever", () => {
  const start = { lat: 39.974, lon: -75.141 };
  const projected = projectAircraftPosition(
    { ...start, track: 0, gs: 360, positionTs: 0, alt_baro: 20_000 },
    60_000,
    12
  );

  assert.equal(projected.ageSeconds, 12);
  assert.ok(distanceNm(start.lat, start.lon, projected.lat, projected.lon) < 1.3);
});

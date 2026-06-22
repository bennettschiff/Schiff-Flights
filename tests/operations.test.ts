import assert from "node:assert/strict";
import test from "node:test";
import { annotateLocalOperations, type TrackHistory } from "../lib/operations";
import type { Plane } from "../lib/types";

function plane(overrides: Partial<Plane>): Plane {
  return {
    hex: "abc123",
    id: "abc123",
    callsign: "TEST1",
    lat: 39.95,
    lon: -75.25,
    alt_baro: 3000,
    baro_rate: 0,
    distNm: 1,
    brg: 180,
    inView: true,
    ...overrides,
  };
}

test("labels a descending aircraft moving toward PHL as arriving", () => {
  const history: TrackHistory = new Map();
  annotateLocalOperations([plane({})], history, 1_000);
  const [result] = annotateLocalOperations(
    [plane({ lat: 39.93, alt_baro: 2800, baro_rate: -900 })],
    history,
    6_000
  );

  assert.equal(result.localOperation?.kind, "arriving");
  assert.equal(result.localOperation?.airport, "PHL");
});

test("labels a climbing aircraft moving away from PHL as departed", () => {
  const history: TrackHistory = new Map();
  annotateLocalOperations(
    [plane({ lat: 39.90, alt_baro: 1200, baro_rate: 600 })],
    history,
    1_000
  );
  const [result] = annotateLocalOperations(
    [plane({ lat: 39.93, alt_baro: 1600, baro_rate: 900 })],
    history,
    6_000
  );

  assert.equal(result.localOperation?.kind, "departing");
  assert.equal(result.localOperation?.airport, "PHL");
});

test("labels a ground aircraft at PHL", () => {
  const [result] = annotateLocalOperations(
    [plane({ lat: 39.872, lon: -75.241, alt_baro: "ground" })],
    new Map(),
    1_000
  );

  assert.equal(result.localOperation?.label, "At PHL");
});

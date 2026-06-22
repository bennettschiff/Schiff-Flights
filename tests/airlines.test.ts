import test from "node:test";
import assert from "node:assert/strict";
import { airlineBadgeForCallsign } from "../lib/airlines";

test("identifies a major airline from an ICAO callsign", () => {
  assert.deepEqual(airlineBadgeForCallsign(" AAL1147 "), {
    mark: "AA",
    name: "American Airlines",
    background: [20, 73, 133, 245],
    foreground: [255, 255, 255, 255],
  });
});

test("uses a dark mark on a bright carrier color", () => {
  assert.deepEqual(airlineBadgeForCallsign("NKS302"), {
    mark: "NK",
    name: "Spirit Airlines",
    background: [255, 225, 0, 250],
    foreground: [24, 27, 31, 255],
  });
});

test("does not guess for private or ambiguous callsigns", () => {
  assert.equal(airlineBadgeForCallsign("N123AB"), undefined);
  assert.equal(airlineBadgeForCallsign("RPA4512"), undefined);
  assert.equal(airlineBadgeForCallsign(undefined), undefined);
});

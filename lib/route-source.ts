import type { Airport, RouteLeg } from "@/lib/types";

// The VRS standing-data set is the same route table tar1090 and the ADS-B
// aggregators render from, published as one static JSON file per callsign. It
// is regenerated continuously, so it tracks schedule changes that adsbdb's
// older snapshot misses, and — unlike adsbdb — it keeps every leg of a
// multi-sector rotation instead of collapsing it to a single origin/destination
// pair.
export function vrsRouteUrl(callsign: string): string | null {
  const cs = callsign.trim().toUpperCase().replace(/\s+/g, "");
  // Files are sharded by the first two characters of the callsign. A bare
  // registration (N416MC, private traffic) has no scheduled route to look up.
  if (!/^[A-Z]{2,3}[0-9][A-Z0-9]*$/.test(cs)) return null;
  return `https://vrs-standing-data.adsb.lol/routes/${cs.slice(0, 2)}/${encodeURIComponent(cs)}.json`;
}

/**
 * Callsign spellings to try against the route table, best guess first.
 * Operators are inconsistent about zero-padding the flight number over the
 * air — Air France broadcasts "AFR099" while the schedule is filed as "AFR99"
 * — so an exact-string lookup alone silently misses those flights.
 */
export function callsignVariants(callsign: string): string[] {
  const cs = callsign.trim().toUpperCase().replace(/\s+/g, "");
  const variants = [cs];
  const padded = cs.match(/^([A-Z]{2,3})0+([1-9][A-Z0-9]*)$/);
  if (padded) variants.push(`${padded[1]}${padded[2]}`);
  return variants;
}

function mapVrsAirport(a: any): Airport | null {
  if (!a || typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  return {
    iata: a.iata || undefined,
    icao: a.icao || undefined,
    name: a.name || a.icao || a.iata || "",
    municipality: a.location || undefined,
    country: a.countryiso2 || undefined,
    lat: a.lat,
    lon: a.lon,
  };
}

/**
 * Turn a VRS route document into the individual legs it describes.
 * "KCLT-KBOS-KCLT" is a two-leg rotation, not a CLT-CLT round trip, so each
 * consecutive pair becomes its own candidate for the live position to judge.
 */
export function parseVrsRoute(json: any): RouteLeg[] {
  const airports = Array.isArray(json?._airports) ? json._airports : [];
  const codes = typeof json?.airport_codes === "string" ? json.airport_codes.split("-") : [];
  // The codes string is authoritative for how many stops there are; _airports
  // is the positional detail for each one.
  const stops = (codes.length >= 2 ? codes : airports).map((_: unknown, i: number) =>
    mapVrsAirport(airports[i])
  );

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const origin = stops[i];
    const destination = stops[i + 1];
    // A stop VRS could not resolve to coordinates can't be geometry-checked,
    // so drop that leg rather than guess at it.
    if (!origin || !destination) continue;
    legs.push({ origin, destination, legIndex: i, legCount: stops.length - 1 });
  }
  return legs;
}

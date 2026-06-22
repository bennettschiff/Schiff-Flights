// A viewer's personal setup: where they are and which slice of sky they
// can see. Encoded in the URL so a configured view is shareable, and
// mirrored to localStorage so the app remembers them.

export interface Settings {
  lat: number;
  lon: number;
  label: string; // e.g. "Philadelphia, PA"
  zip?: string;
  heading: number; // direction they face, compass degrees (0 = N)
  width: number; // total width of their view window, degrees
  radiusNm: number; // how far out to pull aircraft
}

// Sensible default (the original 19122 balcony) so the app works out of the box.
export const DEFAULT_SETTINGS: Settings = {
  lat: 39.974,
  lon: -75.141,
  label: "Philadelphia, PA",
  zip: "19122",
  heading: 150, // SE-ish
  width: 30,
  radiusNm: 40,
};

export function clampWidth(w: number): number {
  if (Number.isNaN(w)) return 30;
  return Math.max(10, Math.min(180, Math.round(w)));
}

export function normHeading(h: number): number {
  return ((Math.round(h) % 360) + 360) % 360;
}

/** Turn "facing + width" into the [start, end] arc the cone helpers use. */
export function coneFromHeading(heading: number, width: number): { start: number; end: number } {
  const start = ((heading - width / 2) % 360 + 360) % 360;
  const end = ((heading + width / 2) % 360 + 360) % 360;
  return { start, end };
}

export function settingsFromParams(params: URLSearchParams): Settings | null {
  const lat = parseFloat(params.get("lat") ?? "");
  const lon = parseFloat(params.get("lon") ?? "");
  const heading = parseFloat(params.get("heading") ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(heading)) return null;
  return {
    lat,
    lon,
    heading: normHeading(heading),
    width: clampWidth(parseFloat(params.get("width") ?? "30")),
    label: params.get("label") || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    zip: params.get("zip") || undefined,
    radiusNm: 40,
  };
}

export function settingsToQuery(s: Settings): string {
  const p = new URLSearchParams();
  p.set("lat", s.lat.toFixed(5));
  p.set("lon", s.lon.toFixed(5));
  p.set("heading", String(normHeading(s.heading)));
  p.set("width", String(clampWidth(s.width)));
  if (s.zip) p.set("zip", s.zip);
  if (s.label) p.set("label", s.label);
  return p.toString();
}

const LS_KEY = "ptrack-settings-v1";

export function loadStored(): Settings | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : null;
  } catch {
    return null;
  }
}

export function saveStored(s: Settings): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

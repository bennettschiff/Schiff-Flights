const DIRS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/** Compass point for a bearing, e.g. 135 -> "SE". */
export function cardinal(b: number): string {
  return DIRS[Math.round(b / 22.5) % 16];
}

export function fmtAlt(alt: number | "ground" | null | undefined): string {
  if (alt === "ground") return "on ground";
  if (alt == null) return "—";
  return `${alt.toLocaleString()} ft`;
}

export function fmtSpeed(gs: number | null | undefined): string {
  if (gs == null) return "—";
  return `${Math.round(gs)} kt`;
}

export function fmtDist(nm: number): string {
  return `${nm.toFixed(1)} nm`;
}

export function fmtDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes < 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const HELI_TYPES = new Set([
  "R44", "R22", "R66", "EC45", "EC30", "EC35", "EC20", "EC55", "B06", "B407",
  "B412", "B429", "B505", "AS50", "AS65", "A139", "A169", "A189", "S76", "S92",
  "H60", "UH60", "H500", "H125", "H135", "H145", "H160", "EXEC", "GLID",
]);

/** Best-effort helicopter detection from ADS-B category + type code. */
export function isHelicopter(p: { category?: string; t?: string; desc?: string }): boolean {
  if (p.category === "A7") return true;
  if (p.t && HELI_TYPES.has(p.t.toUpperCase())) return true;
  const d = (p.desc || "").toUpperCase();
  return d.includes("HELI") || d.includes("ROTOR");
}

// High-precision medical / air-ambulance phrases. Matched against the
// registered owner/operator, the description and the callsign — these are the
// only free signals for HEMS, as ADS-B carries no medical flag.
const MEDICAL_PATTERNS = [
  "MEDICAL", "MEDEVAC", "MED-EVAC", "MED EVAC", "MEDFLIGHT", "MED FLIGHT",
  "MEDTRANS", "MED-TRANS", "LIFEFLIGHT", "LIFE FLIGHT", "LIFE NET", "LIFENET",
  "LIFEGUARD", "LIFE GUARD", "AIR METHODS", "AIR EVAC", "AIR AMBULANCE",
  "AMBULANCE", "AIRMED", "AIR MEDICAL", "AIRLIFE", "AIR LIFE", "HEMS",
  "CARE FLIGHT", "CAREFLIGHT", "CARE FLITE", "SURVIVAL FLIGHT", "MERCY FLIGHT",
  "MERCY AIR", "STARFLIGHT", "STAR FLIGHT", "FLIGHT FOR LIFE", "METRO AVIATION",
  "PHI AIR MEDICAL", "REACH AIR", "CALSTAR", "HOSPITAL", "HEALTHCARE",
  "HEALTH SYSTEM", "HEALTH NETWORK", "CLINIC", "SHANDS",
];

/** True when ownership/description/callsign indicate a medical (air-ambulance) flight. */
export function isMedical(p: { ownOp?: string; desc?: string; flight?: string }): boolean {
  const haystack = `${p.ownOp ?? ""} ${p.desc ?? ""} ${p.flight ?? ""}`.toUpperCase();
  if (!haystack.trim()) return false;
  return MEDICAL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

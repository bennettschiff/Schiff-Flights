export interface AirlineBadge {
  mark: string;
  name: string;
  logo: string;
  background: [number, number, number, number];
  foreground: [number, number, number, number];
  // "commercial" = scheduled airline matched from the callsign; "private" =
  // fractional/charter operator or business-jet manufacturer. Absent on the
  // legacy commercial-only helper so its return shape stays stable.
  kind?: "commercial" | "private";
}

type BadgeDefinition = Omit<AirlineBadge, "foreground" | "logo" | "kind"> & {
  foreground?: [number, number, number, number];
  logoCode?: string;
  logoFile?: string; // full filename (with extension) under /airline-logos
};

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const DARK: [number, number, number, number] = [24, 27, 31, 255];

// ICAO operator prefix -> compact passenger-facing airline mark. We only map
// unambiguous operators; generic/private callsigns and regionals that fly for
// several brands intentionally receive no badge.
const AIRLINES: Record<string, BadgeDefinition> = {
  AAL: { mark: "AA", name: "American Airlines", background: [20, 73, 133, 245] },
  ENY: { mark: "AA", name: "American Eagle", background: [20, 73, 133, 245] },
  JIA: { mark: "AA", name: "American Eagle", background: [20, 73, 133, 245] },
  PDT: { mark: "AA", name: "American Eagle", background: [20, 73, 133, 245] },
  DAL: { mark: "DL", name: "Delta Air Lines", background: [176, 18, 37, 245] },
  EDV: { mark: "DL", name: "Delta Connection", background: [176, 18, 37, 245] },
  UAL: { mark: "UA", name: "United Airlines", background: [0, 63, 135, 245] },
  SWA: { mark: "WN", name: "Southwest Airlines", background: [48, 76, 178, 245] },
  JBU: { mark: "B6", name: "JetBlue", background: [0, 54, 99, 245] },
  FFT: { mark: "F9", name: "Frontier Airlines", background: [0, 122, 83, 245] },
  NKS: { mark: "NK", name: "Spirit Airlines", background: [255, 225, 0, 250], foreground: DARK },
  AAY: { mark: "G4", name: "Allegiant Air", background: [2, 66, 123, 245] },
  ASA: { mark: "AS", name: "Alaska Airlines", background: [0, 83, 107, 245] },
  HAL: { mark: "HA", name: "Hawaiian Airlines", background: [92, 42, 125, 245] },
  SCX: { mark: "SY", name: "Sun Country Airlines", background: [244, 121, 32, 245] },

  ACA: { mark: "AC", name: "Air Canada", background: [201, 20, 31, 245] },
  ROU: { mark: "AC", name: "Air Canada Rouge", background: [201, 20, 31, 245] },
  WJA: { mark: "WS", name: "WestJet", background: [0, 111, 128, 245] },
  BAW: { mark: "BA", name: "British Airways", background: [8, 43, 94, 245] },
  EIN: { mark: "EI", name: "Aer Lingus", background: [0, 132, 111, 245] },
  AFR: { mark: "AF", name: "Air France", background: [16, 47, 113, 245] },
  KLM: { mark: "KL", name: "KLM", background: [0, 160, 222, 245] },
  DLH: { mark: "LH", name: "Lufthansa", background: [5, 27, 68, 245] },
  SWR: { mark: "LX", name: "SWISS", background: [213, 0, 28, 245] },
  TAP: { mark: "TP", name: "TAP Air Portugal", background: [42, 143, 62, 245] },
  IBE: { mark: "IB", name: "Iberia", background: [210, 18, 28, 245] },
  UAE: { mark: "EK", name: "Emirates", background: [211, 25, 39, 245] },
  QTR: { mark: "QR", name: "Qatar Airways", background: [91, 31, 55, 245] },
  THY: { mark: "TK", name: "Turkish Airlines", background: [200, 16, 46, 245] },

  UPS: { mark: "UPS", logoCode: "5X", name: "UPS Airlines", background: [53, 38, 30, 245] },
  FDX: { mark: "FX", name: "FedEx Express", background: [77, 20, 140, 245] },
  GTI: { mark: "5Y", name: "Atlas Air", background: [19, 66, 121, 245] },
};

// Fractional / charter operators. Their aircraft are registered to banks,
// trusts and leasing SPVs just like airliners, so the callsign — not the
// owner — is the only reliable identifier. Mapped to brand-coloured wordmarks.
const PRIVATE_OPERATORS: Record<string, BadgeDefinition> = {
  EJA: { mark: "NJ", name: "NetJets", background: [20, 60, 110, 250], logoFile: "netjets.svg" },
  NJE: { mark: "NJ", name: "NetJets Europe", background: [20, 60, 110, 250], logoFile: "netjets.svg" },
  EJM: { mark: "NJ", name: "Executive Jet Management", background: [20, 60, 110, 250], logoFile: "netjets.svg" },
  LXJ: { mark: "FJ", name: "Flexjet", background: [150, 16, 40, 250], logoFile: "flexjet.svg" },
  VJT: { mark: "VJ", name: "VistaJet", background: [17, 17, 17, 250], foreground: [212, 175, 55, 255], logoFile: "vistajet.svg" },
  PSN: { mark: "PS", name: "PlaneSense", background: [10, 125, 90, 250], logoFile: "planesense.svg" },
  XOJ: { mark: "XO", name: "XO", background: [17, 17, 17, 250], logoFile: "xo.svg" },
};

// Business-jet manufacturers keyed by ICAO type code. When no operator can be
// read from the callsign, the airframe itself still tells us it is a private
// jet — a Gulfstream squawking its tail number gets a maker badge.
interface MakerDefinition {
  name: string;
  mark: string;
  logoFile: string;
  background: [number, number, number, number];
  foreground?: [number, number, number, number];
  codes: string[];
}

const MAKERS: MakerDefinition[] = [
  {
    name: "Gulfstream",
    mark: "G",
    logoFile: "gulfstream.svg",
    background: [11, 37, 64, 250],
    codes: ["GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "G150", "G280", "GA5C", "GA6C", "GA7C"],
  },
  {
    name: "Bombardier",
    mark: "B",
    logoFile: "bombardier.svg",
    background: [11, 61, 145, 250],
    codes: [
      "GLEX", "GL5T", "GL7T", "GL5000", "CL30", "CL35", "CL60", "CL600", "CL604",
      "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ70", "LJ75",
    ],
  },
  {
    name: "Cessna Citation",
    mark: "C",
    logoFile: "cessna.svg",
    background: [179, 18, 44, 250],
    codes: [
      "C25A", "C25B", "C25C", "C25M", "C500", "C501", "C510", "C525", "C526",
      "C550", "C551", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750",
    ],
  },
  {
    name: "Embraer Executive",
    mark: "E",
    logoFile: "embraer.svg",
    background: [27, 78, 160, 250],
    codes: ["E50P", "E55P", "E545", "E550", "E35L"],
  },
  {
    name: "Dassault Falcon",
    mark: "F",
    logoFile: "falcon.svg",
    background: [42, 61, 86, 250],
    codes: ["FA50", "FA5X", "FA6X", "FA7X", "FA8X", "F2TH", "F900", "FA10", "FA20", "FA30", "FA40", "F2000"],
  },
  {
    name: "Hawker",
    mark: "H",
    logoFile: "hawker.svg",
    background: [90, 74, 42, 250],
    codes: ["H25A", "H25B", "H25C", "HA4T", "BE40"],
  },
];

const GENERIC_PRIVATE: BadgeDefinition = {
  mark: "P",
  name: "Private jet",
  background: [71, 85, 105, 250],
  logoFile: "private-jet.svg",
};

// Light / very-light jets and turboprops that fly mostly privately but have no
// dedicated maker badge above. They still get the generic private indicator.
const GENERIC_PRIVATE_TYPES = new Set(["PC24", "PC12", "HDJT", "SF50", "TBM7", "TBM8", "TBM9", "EA50"]);

const MAKER_BY_CODE = new Map<string, MakerDefinition>();
for (const maker of MAKERS) {
  for (const code of maker.codes) MAKER_BY_CODE.set(code, maker);
}

function resolveLogo(def: { logoFile?: string; logoCode?: string; mark: string }): string {
  return def.logoFile
    ? `/airline-logos/${def.logoFile}`
    : `/airline-logos/${def.logoCode ?? def.mark}.png`;
}

export function airlineBadgeForCallsign(callsign?: string): AirlineBadge | undefined {
  const compact = callsign?.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact || !/^[A-Z]{3}\d/.test(compact)) return undefined;
  const badge = AIRLINES[compact.slice(0, 3)];
  if (!badge) return undefined;
  return {
    ...badge,
    logo: `/airline-logos/${badge.logoCode ?? badge.mark}.png`,
    foreground: badge.foreground ?? WHITE,
  };
}

function privateOperatorForCallsign(callsign?: string): AirlineBadge | undefined {
  const compact = callsign?.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact || !/^[A-Z]{3}\d/.test(compact)) return undefined;
  const def = PRIVATE_OPERATORS[compact.slice(0, 3)];
  if (!def) return undefined;
  return { ...def, logo: resolveLogo(def), foreground: def.foreground ?? WHITE, kind: "private" };
}

function bizjetMakerBadge(typeCode?: string): AirlineBadge | undefined {
  const code = typeCode?.trim().toUpperCase();
  if (!code) return undefined;
  const maker = MAKER_BY_CODE.get(code);
  if (maker) {
    return { ...maker, logo: resolveLogo(maker), foreground: maker.foreground ?? WHITE, kind: "private" };
  }
  if (GENERIC_PRIVATE_TYPES.has(code)) {
    return { ...GENERIC_PRIVATE, logo: resolveLogo(GENERIC_PRIVATE), foreground: WHITE, kind: "private" };
  }
  return undefined;
}

// Unified resolver used by the UI: a scheduled airline wins, then a known
// fractional/charter operator, then the airframe maker for an unaffiliated
// business jet. Owner/registration is deliberately never used here — it names
// the bank or lessor that holds the aircraft, not who operates it.
export function operatorBadge(plane: {
  flight?: string;
  t?: string;
}): AirlineBadge | undefined {
  const commercial = airlineBadgeForCallsign(plane.flight);
  if (commercial) return { ...commercial, kind: "commercial" };
  return privateOperatorForCallsign(plane.flight) ?? bizjetMakerBadge(plane.t);
}

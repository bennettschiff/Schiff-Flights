export interface AirlineBadge {
  mark: string;
  name: string;
  logo: string;
  background: [number, number, number, number];
  foreground: [number, number, number, number];
}

type BadgeDefinition = Omit<AirlineBadge, "foreground" | "logo"> & {
  foreground?: [number, number, number, number];
  logoCode?: string;
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

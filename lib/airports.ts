export interface RegionalAirport {
  icao: string;
  iata: string;
  name: string;
  lat: number;
  lon: number;
}

// Airports whose low traffic commonly appears around Philadelphia. Coordinates
// are intentionally kept local so arrival/departure labels do not depend on a
// third-party lookup during every five-second refresh.
export const REGIONAL_AIRPORTS: RegionalAirport[] = [
  { icao: "KPHL", iata: "PHL", name: "Philadelphia International", lat: 39.8719, lon: -75.2411 },
  { icao: "KPNE", iata: "PNE", name: "Northeast Philadelphia", lat: 40.0819, lon: -75.0106 },
  { icao: "KTTN", iata: "TTN", name: "Trenton Mercer", lat: 40.2767, lon: -74.8135 },
  { icao: "KILG", iata: "ILG", name: "Wilmington", lat: 39.6787, lon: -75.6065 },
  { icao: "KACY", iata: "ACY", name: "Atlantic City International", lat: 39.4576, lon: -74.5772 },
  { icao: "KLOM", iata: "LOM", name: "Wings Field", lat: 40.1375, lon: -75.2651 },
];

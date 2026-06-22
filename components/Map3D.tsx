"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { IconLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Tile3DLayer, GreatCircleLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";
import { conePolygon, distanceNm } from "@/lib/geo";
import { fmtAlt, fmtSpeed, fmtDist, cardinal, fmtDuration, fmtClock, isHelicopter } from "@/lib/format";
import type { Plane, RouteInfo, Airport } from "@/lib/types";
import Basemap2D from "@/components/Basemap2D";

export type ViewMode = "light" | "satellite" | "3d";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const CLAY: [number, number, number] = [193, 95, 60];

const FT_TO_M = 0.3048;
const altM = (p: Plane) => (typeof p.alt_baro === "number" ? p.alt_baro * FT_TO_M : 0);

// Emoji atlas: cell 0 = airplane, cell 1 = helicopter.
function makeIconAtlas(): string {
  const cell = 128;
  const cv = document.createElement("canvas");
  cv.width = cell * 2;
  cv.height = cell;
  const ctx = cv.getContext("2d")!;
  ctx.font = `${Math.round(cell * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✈️", cell * 0.5, cell * 0.55);
  ctx.fillText("🚁", cell * 1.5, cell * 0.55);
  return cv.toDataURL();
}

const ICON_MAPPING = {
  plane: { x: 0, y: 0, width: 128, height: 128, anchorX: 64, anchorY: 64, mask: false },
  heli: { x: 128, y: 0, width: 128, height: 128, anchorX: 64, anchorY: 64, mask: false },
};

export default function Map3D({
  mode,
  home,
  cone,
  heading,
  radiusNm,
  planes,
  selectedId,
  route,
  onSelect,
  on3DError,
}: {
  mode: ViewMode;
  home: { lat: number; lon: number; label: string };
  cone: { start: number; end: number };
  heading: number;
  radiusNm: number;
  planes: Plane[];
  selectedId: string | null;
  route: RouteInfo | null;
  onSelect: (id: string | null) => void;
  on3DError: () => void;
}) {
  const icon = useMemo(() => (typeof document !== "undefined" ? makeIconAtlas() : ""), []);
  const [credits, setCredits] = useState("");
  const creditsRef = useRef<Set<string>>(new Set());
  const failed3DRef = useRef(false);

  // Animation clock — drives the radar sweep and the breathing glow so the
  // map reads as live rather than a static screenshot. Only runs in the 2D
  // modes (the 3D tileset is expensive to redraw) and pauses when hidden.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode === "3d") return;
    let raf = 0;
    let running = true;
    const loop = (ts: number) => {
      if (!running) return;
      setTick(ts);
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "3d") {
      failed3DRef.current = false;
      return;
    }
    if (!KEY && !failed3DRef.current) {
      failed3DRef.current = true;
      on3DError();
    }
  }, [mode, on3DError]);

  const initialViewState = {
    longitude: home.lon,
    latitude: home.lat,
    zoom: mode === "3d" ? 12.5 : 10.5,
    pitch: mode === "3d" ? 60 : 0,
    bearing: mode === "3d" ? heading : 0,
  };

  function addCredits(tile: any) {
    try {
      const c = tile?.content?.gltf?.asset?.copyright || tile?.content?.copyright;
      if (!c) return;
      let changed = false;
      String(c)
        .split(/;\s*/)
        .forEach((part: string) => {
          const t = part.trim();
          if (t && !creditsRef.current.has(t)) {
            creditsRef.current.add(t);
            changed = true;
          }
        });
      if (changed) setCredits(Array.from(creditsRef.current).join(", "));
    } catch {
      /* ignore */
    }
  }

  const sel = selectedId ? planes.find((p) => p.id === selectedId) : null;
  const routeUsable = route?.confidence === "verified" || route?.confidence === "plausible";

  // Drawn flight path for the selected aircraft (origin → now → destination).
  function routeLayers(): any[] {
    if (
      !sel ||
      sel.lon == null ||
      sel.lat == null ||
      !routeUsable ||
      !route?.origin ||
      !route?.destination
    ) return [];
    const o = route.origin;
    const d = route.destination;
    return [
      new GreatCircleLayer({
        id: "route-corridor",
        data: [{ from: [o.lon, o.lat, 0], to: [d.lon, d.lat, 0] }],
        getSourcePosition: (x: any) => x.from,
        getTargetPosition: (x: any) => x.to,
        getSourceColor: [193, 95, 60, 180],
        getTargetColor: [193, 95, 60, 180],
        getWidth: 2.5,
      }),
      new ScatterplotLayer<Airport>({
        id: "route-ap",
        data: [o, d],
        getPosition: (x) => [x.lon, x.lat],
        getRadius: 5,
        radiusUnits: "pixels",
        getFillColor: [31, 30, 28],
        stroked: true,
        getLineColor: [255, 255, 255],
        getLineWidth: 2,
        lineWidthUnits: "pixels",
      }),
      new TextLayer<Airport>({
        id: "route-lbl",
        data: [o, d],
        getPosition: (x) => [x.lon, x.lat],
        getText: (x) => x.iata || x.icao || "",
        getSize: 13,
        sizeUnits: "pixels",
        getColor: [31, 30, 28],
        getPixelOffset: [0, -16],
        background: true,
        getBackgroundColor: [250, 249, 245, 235],
        backgroundPadding: [4, 2],
      }),
    ];
  }

  // ── Aircraft + decorations, shared by the 2D overlay and the 3D scene ──
  // Gentle 0.85→1.15 pulse so in-view aircraft visibly "breathe".
  const breath = 1 + 0.15 * Math.sin(tick / 460);
  const breathBucket = Math.round(tick / 40);

  const glow = new ScatterplotLayer<Plane>({
    id: "plane-glow",
    data: planes.filter((p) => p.inView || p.id === selectedId),
    getPosition: (d) => [d.lon!, d.lat!, altM(d)],
    getRadius: (d) => (d.id === selectedId ? 19 : 13) * breath,
    radiusUnits: "pixels",
    getFillColor: (d) => (d.id === selectedId ? [193, 95, 60, 70] : [193, 95, 60, 40]),
    stroked: true,
    getLineColor: (d) => (d.id === selectedId ? [193, 95, 60, 255] : [193, 95, 60, 0]),
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    billboard: true,
    // Glide to the next reported position instead of jumping each poll.
    transitions: { getPosition: { duration: 1800 } },
    updateTriggers: {
      getRadius: [selectedId, breathBucket],
      getFillColor: selectedId,
      getLineColor: selectedId,
    },
  });

  const planeLayer = new IconLayer<Plane>({
    id: "planes",
    data: planes,
    iconAtlas: icon,
    iconMapping: ICON_MAPPING,
    getIcon: (d) => (isHelicopter(d) ? "heli" : "plane"),
    getPosition: (d) => [d.lon!, d.lat!, altM(d)],
    getSize: (d) => (d.id === selectedId ? 38 : 30),
    sizeUnits: "pixels",
    // ✈️ emoji points NE (~45°); rotate so the nose follows the track.
    getAngle: (d) => (isHelicopter(d) ? 0 : 45 - (d.track ?? 0)),
    billboard: true,
    pickable: true,
    // Smoothly interpolate between the 5s position snapshots.
    transitions: { getPosition: { duration: 1800 } },
    updateTriggers: { getSize: selectedId },
  });

  // Expanding radar pulses from home — two rings, half a cycle apart, so the
  // sweep feels continuous. Radius is geographic so it tracks the view range.
  const radarRings = [0, 1].map((i) => {
    const phase = (tick / 3400 + i * 0.5) % 1;
    const fade = (1 - phase) * (1 - phase);
    return new ScatterplotLayer<{ position: [number, number] }>({
      id: `radar-ring-${i}`,
      data: [{ position: [home.lon, home.lat] }],
      getPosition: (d) => d.position,
      getRadius: radiusNm * 1852 * (0.04 + phase * 0.96),
      radiusUnits: "meters",
      stroked: true,
      filled: false,
      getLineColor: [193, 95, 60, Math.round(210 * fade)],
      getLineWidth: 2.2,
      lineWidthUnits: "pixels",
      updateTriggers: { getRadius: tick, getLineColor: tick },
    });
  });

  const coneLayer = new PolygonLayer<{ polygon: [number, number][] }>({
    id: "cone",
    data: [{ polygon: conePolygon(home.lat, home.lon, cone.start, cone.end, radiusNm) }],
    getPolygon: (d) => d.polygon,
    getFillColor: [193, 95, 60, 52],
    getLineColor: [193, 95, 60, 220],
    getLineWidth: 2.5,
    lineWidthUnits: "pixels",
    stroked: true,
    filled: true,
  });

  const homeLayer = new ScatterplotLayer<{ position: [number, number] }>({
    id: "home",
    data: [{ position: [home.lon, home.lat] }],
    getPosition: (d) => d.position,
    getRadius: 7,
    radiusUnits: "pixels",
    getFillColor: [255, 255, 255],
    stroked: true,
    getLineColor: [193, 95, 60],
    lineWidthUnits: "pixels",
    getLineWidth: 3,
  });

  // Layers drawn over the MapLibre vector/satellite base in the 2D modes.
  const layers2D = [
    ...radarRings,
    coneLayer,
    homeLayer,
    ...routeLayers(),
    glow,
    planeLayer,
  ];

  // Full deck.gl scene for the 3D photorealistic mode.
  const layers3D = [
    new Tile3DLayer({
      id: "google-3d",
      data: "https://tile.googleapis.com/v1/3dtiles/root.json",
      loader: Tiles3DLoader,
      loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": KEY ?? "" } } },
      onTileLoad: addCredits,
      onTileError: () => {
        if (failed3DRef.current) return;
        failed3DRef.current = true;
        on3DError();
      },
    }),
    ...routeLayers(),
    glow,
    planeLayer,
  ];

  const heli = sel ? isHelicopter(sel) : false;
  const vs = sel?.baro_rate;
  const climb = vs != null && vs > 100 ? " ↑" : vs != null && vs < -100 ? " ↓" : "";

  // Direct-route estimate. This is deliberately not labeled as an actual
  // flown track because ADS-B snapshots do not contain historical routing.
  let prog: {
    o: Airport;
    d: Airport;
    along: number;
    remain: number;
    pct: number;
    mins: number | null;
    eta: Date | null;
  } | null = null;
  if (
    sel &&
    sel.lon != null &&
    sel.lat != null &&
    routeUsable &&
    route?.origin &&
    route?.destination
  ) {
    const o = route.origin;
    const d = route.destination;
    const remain = distanceNm(sel.lat, sel.lon, d.lat, d.lon);
    const total = route.routeLengthNm ?? distanceNm(o.lat, o.lon, d.lat, d.lon);
    const along = Math.max(0, Math.min(total, route.alongTrackNm ?? 0));
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((along / total) * 100))) : 0;
    const gs = sel.gs && sel.gs > 40 ? sel.gs : null;
    const mins = gs ? (remain / gs) * 60 : null;
    const eta = mins != null && isFinite(mins) ? new Date(Date.now() + mins * 60000) : null;
    prog = { o, d, along, remain, pct, mins, eta };
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {mode === "3d" && KEY ? (
        <DeckGL
          key={`3d:${home.lat.toFixed(4)}:${home.lon.toFixed(4)}:${Math.round(heading)}`}
          views={new MapView({ repeat: true })}
          initialViewState={initialViewState}
          controller={{ dragRotate: true, touchRotate: true, inertia: true, minPitch: 0, maxPitch: 79 } as any}
          layers={layers3D as any}
          onClick={(info) => onSelect(info?.layer?.id === "planes" && info.object ? (info.object as Plane).id : null)}
          getTooltip={({ object }: any) => (object?.callsign ? { text: object.callsign } : null)}
          getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        />
      ) : (
        <Basemap2D
          key={`2d:${home.lat.toFixed(4)}:${home.lon.toFixed(4)}`}
          mode={mode === "satellite" ? "satellite" : "light"}
          center={[home.lon, home.lat]}
          bearing={0}
          layers={layers2D as any}
          onSelect={onSelect}
        />
      )}

      {mode === "3d" && <div className="map-credit">Imagery © {credits || "Google"}</div>}
      {mode === "light" && <div className="map-credit">© OpenStreetMap · OpenFreeMap</div>}
      {mode === "satellite" && <div className="map-credit">Imagery © Esri</div>}

      {sel && (
        <div className="plane-card">
          <button className="plane-card-x" aria-label="Close" onClick={() => onSelect(null)}>
            ×
          </button>
          <div className="pc-call">
            {heli ? "🚁 " : ""}
            {sel.callsign}
            {sel.t ? <span className="pc-type"> · {sel.t}</span> : null}
          </div>
          {(sel.desc || sel.ownOp) && (
            <div className="pc-sub">{[sel.desc, sel.ownOp].filter(Boolean).join(" · ")}</div>
          )}
          <div className="pc-row">
            {fmtAlt(sel.alt_baro)}
            {climb} · {fmtSpeed(sel.gs)}
          </div>
          <div className="pc-row">
            {fmtDist(sel.distNm)} to your {cardinal(sel.brg)} ({Math.round(sel.brg)}°)
          </div>
          {sel.inView && <span className="pc-inview">In your view</span>}
          {sel.localOperation && <span className="pc-operation">{sel.localOperation.label}</span>}

          {route && !routeUsable && (
            <div className="pc-route-note">
              <b>Route hidden</b> · {route.reason || "Schedule match could not be verified."}
            </div>
          )}

          {prog && (
            <div className="pc-route">
              <div className="pc-airports">
                <b>{prog.o.iata || prog.o.icao}</b>
                <i className="pc-arrow">✈</i>
                <b>{prog.d.iata || prog.d.icao}</b>
              </div>
              <div className="pc-apnames">
                {prog.o.municipality || prog.o.name} → {prog.d.municipality || prog.d.name}
              </div>
              <div className="pc-bar">
                <div className="pc-bar-fill" style={{ width: `${prog.pct}%` }} />
              </div>
              <div className="pc-row pc-small">
                Approx. {prog.pct}% along direct route · {prog.remain.toFixed(0)} nm direct to destination
              </div>
              {prog.mins != null && (
                <div className="pc-row pc-small">
                  Direct estimate: {fmtDuration(prog.mins)}
                  {prog.eta ? ` · ETA ~${fmtClock(prog.eta)}` : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

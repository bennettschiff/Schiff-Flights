"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { IconLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Tile3DLayer, GreatCircleLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";
import { conePolygon, distanceNm } from "@/lib/geo";
import { projectAircraftPosition } from "@/lib/motion";
import { operatorBadge, type AirlineBadge } from "@/lib/airlines";
import { fmtAlt, fmtSpeed, fmtDist, cardinal, fmtDuration, fmtClock, isHelicopter, isMedical } from "@/lib/format";
import type { Plane, RouteAudit, RouteInfo, Airport } from "@/lib/types";
import Basemap2D from "@/components/Basemap2D";

export type ViewMode = "light" | "satellite" | "3d";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const CLAY: [number, number, number] = [193, 95, 60];

const FT_TO_M = 0.3048;
const altM = (p: Plane) => (typeof p.alt_baro === "number" ? p.alt_baro * FT_TO_M : 0);

// `enrich` already dropped any aircraft without a position, so a render row can
// narrow lat/lon to plain numbers and feed the motion projector directly.
interface RenderPlane extends Omit<Plane, "lat" | "lon"> {
  lat: number;
  lon: number;
  renderLat: number;
  renderLon: number;
  airlineBadge?: AirlineBadge;
}

interface MotionState {
  lat: number;
  lon: number;
}

// deck.gl icon definitions have to keep a stable identity. IconLayer's auto
// packing walks the whole data array whenever it sees a change, so an accessor
// that builds a fresh object per aircraft per frame both allocates needlessly
// and defeats the atlas cache.
type IconDef = {
  url: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: boolean;
};

const iconDefs = new Map<string, IconDef>();
function iconDef(url: string): IconDef {
  let def = iconDefs.get(url);
  if (!def) {
    def = { url, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: false };
    iconDefs.set(url, def);
  }
  return def;
}

const MEDICAL_ICON = iconDef("/medical-cross.svg");

// Emoji atlas: cell 0 = airplane, cell 1 = helicopter.
function makeIconAtlas(): string {
  // Leave generous transparent padding: a rotated color emoji otherwise clips
  // its wing tips on high-density iPhone canvases.
  const cell = 192;
  const cv = document.createElement("canvas");
  cv.width = cell * 2;
  cv.height = cell;
  const ctx = cv.getContext("2d")!;
  ctx.font = `${Math.round(cell * 0.54)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✈️", cell * 0.5, cell * 0.51);
  ctx.fillText("🚁", cell * 1.5, cell * 0.51);
  return cv.toDataURL();
}

const ICON_MAPPING = {
  plane: { x: 0, y: 0, width: 192, height: 192, anchorX: 96, anchorY: 96, mask: false },
  heli: { x: 192, y: 0, width: 192, height: 192, anchorX: 96, anchorY: 96, mask: false },
};

export default function Map3D({
  mode,
  home,
  cone,
  heading,
  radiusNm,
  showFieldOfView,
  planes,
  selectedId,
  route,
  routeAudit,
  onSelect,
  on3DError,
}: {
  mode: ViewMode;
  home: { lat: number; lon: number; label: string };
  cone: { start: number; end: number };
  heading: number;
  radiusNm: number;
  showFieldOfView: boolean;
  planes: Plane[];
  selectedId: string | null;
  route: RouteInfo | null;
  routeAudit: RouteAudit | null;
  onSelect: (id: string | null) => void;
  on3DError: () => void;
}) {
  const icon = useMemo(() => (typeof document !== "undefined" ? makeIconAtlas() : ""), []);
  const [credits, setCredits] = useState("");
  const creditsRef = useRef<Set<string>>(new Set());
  const failed3DRef = useRef(false);
  const motionRef = useRef<Map<string, MotionState>>(new Map());
  const lastMotionFrameRef = useRef<number | null>(null);

  // Animation clock for continuous aircraft motion. At the zoom this map uses,
  // even a 500-knot aircraft crosses about 3 pixels per second, so a frame at
  // 15 fps moves it a fifth of a pixel — anything faster spends real phone
  // battery redrawing differences no one can see. 3D is heavier still, so it
  // runs at 8.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    let running = true;
    let lastPaint = 0;
    const frameInterval = mode === "3d" ? 1000 / 8 : 1000 / 15;
    const loop = (ts: number) => {
      if (!running) return;
      if (ts - lastPaint >= frameInterval) {
        lastPaint = ts;
        setTick(ts);
      }
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
  // Geometry-rejected schedule matches stay hidden. An uncertain match that
  // still fits the route may be shown with a clear caveat instead of making a
  // commercial flight look as though it has no route data at all.
  const routeUsable =
    Boolean(route?.origin && route?.destination) && route?.confidence !== "rejected";

  // The rows handed to deck.gl. These are rebuilt only when a new ADS-B
  // snapshot arrives — never per animation frame. A fresh `data` reference
  // makes deck.gl treat every attribute as dirty and re-upload all of them
  // (and makes IconLayer re-pack its atlas), which at 30 fps costs more than a
  // phone can pay. Instead the rows below are mutated in place and only the
  // position attribute is invalidated each frame.
  const animatedPlanes = useMemo<RenderPlane[]>(() => {
    const rows: RenderPlane[] = planes.map((plane) => ({
      ...plane,
      lat: plane.lat!,
      lon: plane.lon!,
      renderLat: plane.lat!,
      renderLon: plane.lon!,
      airlineBadge: operatorBadge(plane),
    }));
    const active = new Set(rows.map((row) => row.id));
    for (const id of motionRef.current.keys()) {
      if (!active.has(id)) motionRef.current.delete(id);
    }
    return rows;
  }, [planes]);

  // Subsets are memoised alongside the rows for the same reason: a new array
  // each frame would put those layers back on the full-rebuild path.
  const glowPlanes = useMemo(
    () => animatedPlanes.filter((p) => p.inView || p.id === selectedId),
    [animatedPlanes, selectedId]
  );
  const badgedPlanes = useMemo(
    () => animatedPlanes.filter((plane) => plane.airlineBadge),
    [animatedPlanes]
  );
  const medicalPlanes = useMemo(
    () => animatedPlanes.filter((plane) => isMedical(plane)),
    [animatedPlanes]
  );

  // Project every fresh ADS-B snapshot forward to this frame, then gently
  // absorb the small correction when the next real position arrives. The list
  // still shows source data; only map coordinates are animated. Mutating the
  // existing rows keeps their array identity stable — see above.
  useMemo(() => {
    const now = Date.now();
    const previousFrame = lastMotionFrameRef.current;
    const frameDelta = previousFrame == null ? 0 : Math.max(0, Math.min(250, tick - previousFrame));
    lastMotionFrameRef.current = tick;
    const correctionBlend = previousFrame == null ? 1 : 1 - Math.exp(-frameDelta / 350);

    for (const row of animatedPlanes) {
      const target = projectAircraftPosition(row, now);
      const prior = motionRef.current.get(row.id);
      if (prior) {
        prior.lat += (target.lat - prior.lat) * correctionBlend;
        prior.lon += (target.lon - prior.lon) * correctionBlend;
      } else {
        motionRef.current.set(row.id, { lat: target.lat, lon: target.lon });
      }
      const state = motionRef.current.get(row.id)!;
      row.renderLat = state.lat;
      row.renderLon = state.lon;
    }
  }, [animatedPlanes, tick]);

  // The view cone and home marker only move when the viewer changes their
  // setup, so they are held still rather than regenerated 30 times a second.
  const coneData = useMemo(
    () =>
      showFieldOfView
        ? [{ polygon: conePolygon(home.lat, home.lon, cone.start, cone.end, radiusNm) }]
        : [],
    [showFieldOfView, home.lat, home.lon, cone.start, cone.end, radiusNm]
  );
  const homeData = useMemo<{ position: [number, number] }[]>(
    () => [{ position: [home.lon, home.lat] }],
    [home.lat, home.lon]
  );

  // A drawn route only changes when the selection does, so its geometry is
  // held still instead of being re-tessellated on every animation frame.
  const routeShape = useMemo(() => {
    const o = route?.origin;
    const d = route?.destination;
    if (!routeUsable || !o || !d) return null;
    return { airports: [o, d], arc: [{ from: [o.lon, o.lat, 0], to: [d.lon, d.lat, 0] }] };
  }, [routeUsable, route?.origin, route?.destination]);

  // Claimed great-circle corridor for a route that passed the live plausibility check.
  function routeLayers(): any[] {
    if (!sel || sel.lon == null || sel.lat == null || !routeShape) return [];
    return [
      new GreatCircleLayer({
        id: "route-corridor",
        data: routeShape.arc,
        getSourcePosition: (x: any) => x.from,
        getTargetPosition: (x: any) => x.to,
        getSourceColor: [193, 95, 60, 180],
        getTargetColor: [193, 95, 60, 180],
        getWidth: 2.5,
      }),
      new ScatterplotLayer<Airport>({
        id: "route-ap",
        data: routeShape.airports,
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
        data: routeShape.airports,
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

  // ── Aircraft, shared by the 2D overlay and the 3D scene ───────────────
  const glow = new ScatterplotLayer<RenderPlane>({
    id: "plane-glow",
    data: glowPlanes,
    getPosition: (d) => [d.renderLon, d.renderLat, altM(d)],
    getRadius: (d) => (d.id === selectedId ? 19 : 13),
    radiusUnits: "pixels",
    getFillColor: (d) => (d.id === selectedId ? [193, 95, 60, 70] : [193, 95, 60, 40]),
    stroked: true,
    getLineColor: (d) => (d.id === selectedId ? [193, 95, 60, 255] : [193, 95, 60, 0]),
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    billboard: true,
    updateTriggers: {
      // Only the position moves between snapshots; leaving the other triggers
      // alone keeps their attributes off the per-frame recompute path.
      getPosition: tick,
      getRadius: selectedId,
      getFillColor: selectedId,
      getLineColor: selectedId,
    },
  });

  const planeLayer = new IconLayer<RenderPlane>({
    id: "planes",
    data: animatedPlanes,
    iconAtlas: icon,
    iconMapping: ICON_MAPPING,
    getIcon: (d) => (isHelicopter(d) ? "heli" : "plane"),
    getPosition: (d) => [d.renderLon, d.renderLat, altM(d)],
    getSize: (d) => (d.id === selectedId ? 38 : 30),
    sizeUnits: "pixels",
    // ✈️ emoji points NE (~45°); rotate so the nose follows the track.
    getAngle: (d) => (isHelicopter(d) ? 0 : 45 - (d.track ?? 0)),
    billboard: true,
    pickable: true,
    updateTriggers: { getPosition: tick, getSize: selectedId },
  });

  // Locally bundled real airline artwork stays crisp and avoids a network
  // request per aircraft. Unknown/private operators simply get no logo.
  const airlineLogoLayer = new IconLayer<RenderPlane>({
    id: "airline-logos",
    data: badgedPlanes,
    getPosition: (plane) => [plane.renderLon, plane.renderLat, altM(plane)],
    getIcon: (plane) => iconDef(plane.airlineBadge!.logo),
    getSize: 21,
    sizeUnits: "pixels",
    getPixelOffset: [0, 22],
    billboard: true,
    pickable: false,
    updateTriggers: { getPosition: tick },
  });

  // Red medical cross pinned just below any air-ambulance flight — mostly the
  // HEMS helicopters registered to hospitals and medical operators.
  const medicalLayer = new IconLayer<RenderPlane>({
    id: "medical-cross",
    data: medicalPlanes,
    getPosition: (plane) => [plane.renderLon, plane.renderLat, altM(plane)],
    getIcon: () => MEDICAL_ICON,
    getSize: 16,
    sizeUnits: "pixels",
    getPixelOffset: [0, 24],
    billboard: true,
    pickable: false,
    updateTriggers: { getPosition: tick },
  });

  const coneLayer = new PolygonLayer<{ polygon: [number, number][] }>({
    id: "cone",
    data: coneData,
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
    data: homeData,
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
    coneLayer,
    homeLayer,
    ...routeLayers(),
    glow,
    airlineLogoLayer,
    medicalLayer,
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
    airlineLogoLayer,
    medicalLayer,
    planeLayer,
  ];

  // The card only changes when the selection or its route does. Keeping it out
  // of the animation clock's path means a frame touches the map and nothing
  // else — it was previously being reconciled on every tick.
  const planeCard = useMemo(() => {
    if (!sel) return null;

    const heli = isHelicopter(sel);
    const selectedAirline = operatorBadge(sel);
    const selMedical = isMedical(sel);
    const vs = sel.baro_rate;
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
    if (sel.lon != null && sel.lat != null && routeUsable && route?.origin && route?.destination) {
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
    const showAuditNote =
      Boolean(routeAudit) &&
      !prog &&
      !(route && !routeUsable) &&
      routeAudit?.status !== "identified";

    return (
      <div className="plane-card">
        <button className="plane-card-x" aria-label="Close" onClick={() => onSelect(null)}>
          ×
        </button>
        <div className="pc-call">
          {selectedAirline && <img className="pc-airline-logo" src={selectedAirline.logo} alt={selectedAirline.name} />}
          {heli ? "🚁 " : ""}
          {sel.callsign}
          {sel.t ? <span className="pc-type"> · {sel.t}</span> : null}
        </div>
        {selectedAirline?.kind === "private" && (
          <div className="pc-sub pc-operator">Operated by {selectedAirline.name}</div>
        )}
        {sel.desc && <div className="pc-sub">{sel.desc}</div>}
        {sel.ownOp && (
          <div className="pc-sub pc-owner">Registered owner · {sel.ownOp}</div>
        )}
        {sel.photoThumbnailUrl && (
          <img className="pc-aircraft-photo" src={sel.photoThumbnailUrl} alt={`${sel.callsign} aircraft`} />
        )}
        <div className="pc-row">
          {fmtAlt(sel.alt_baro)}
          {climb} · {fmtSpeed(sel.gs)}
        </div>
        <div className="pc-row">
          {fmtDist(sel.distNm)} to your {cardinal(sel.brg)} ({Math.round(sel.brg)}°)
        </div>
        {selMedical && <span className="pc-medical">✚ Medical / air ambulance</span>}
        {sel.inView && <span className="pc-inview">In your view</span>}
        {sel.localOperation && <span className="pc-operation">{sel.localOperation.label}</span>}

        {route && !routeUsable && (
          <div className="pc-route-note">
            <b>Route hidden</b> · {route.reason || "Schedule match could not be verified."}
          </div>
        )}

        {showAuditNote && routeAudit && (
          <div className="pc-route-note">
            <b>
              {routeAudit.status === "observed_local"
                ? "Local movement"
                : routeAudit.status === "feed_hint_unresolved"
                  ? "Route hint"
                  : "Route not identified"}
            </b>{" "}
            · {routeAudit.reason}
          </div>
        )}

        {route?.confidence === "uncertain" && routeUsable && (
          <div className="pc-route-note">
            <b>Schedule match</b> · {route.reason || "Route is not fully verified yet."}
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
            {(route?.legCount ?? 1) > 1 && (
              <div className="pc-apnames">
                Leg {(route!.legIndex ?? 0) + 1} of {route!.legCount} on this callsign today
              </div>
            )}
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
    );
  }, [sel, route, routeAudit, routeUsable, onSelect]);

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

      {planeCard}
    </div>
  );
}

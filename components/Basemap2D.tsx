"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { MAP_ZOOM } from "@/lib/config";
import type { Plane } from "@/lib/types";

// Bright, modern vector basemap — smooth at any zoom (no "screenshot" feel),
// keyless and unmetered. https://openfreemap.org
const VECTOR_STYLE = "https://tiles.openfreemap.org/styles/bright";

// Esri World Imagery as a raster style for satellite mode.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Imagery © Esri",
    },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

// Keyless raster fallback if the vector tiles ever fail to load.
const RASTER_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const styleFor = (mode: "light" | "satellite") =>
  mode === "satellite" ? SATELLITE_STYLE : VECTOR_STYLE;

export default function Basemap2D({
  mode,
  center,
  bearing,
  layers,
  onSelect,
}: {
  mode: "light" | "satellite";
  center: [number, number];
  bearing: number;
  layers: Layer[];
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const layersRef = useRef(layers);
  const onSelectRef = useRef(onSelect);
  const fellBackRef = useRef(false);
  layersRef.current = layers;
  onSelectRef.current = onSelect;

  // ── init once ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(mode),
      center,
      zoom: MAP_ZOOM + 1,
      bearing,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    // deck.gl draws the planes/cone/radar on top; the base map keeps the camera.
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: layersRef.current,
      onClick: (info) =>
        onSelectRef.current(
          info?.layer?.id === "planes" && info.object ? (info.object as Plane).id : null
        ),
      getTooltip: ({ object }: any) => (object?.callsign ? { text: object.callsign } : null),
      getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
    });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;

    // Fall back to raster if the vector style/tiles never come up.
    let loaded = false;
    map.on("load", () => {
      loaded = true;
    });
    const fallback = () => {
      if (fellBackRef.current || mode === "satellite") return;
      fellBackRef.current = true;
      map.setStyle(RASTER_FALLBACK);
    };
    const failTimer = setTimeout(() => {
      if (!loaded) fallback();
    }, 8000);
    map.on("error", (e: any) => {
      const msg = String(e?.error?.message || "");
      if (/openfreemap|openmaptiles|style|sprite|glyph/i.test(msg)) fallback();
    });

    return () => {
      clearTimeout(failTimer);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── swap style when toggling light ↔ satellite ─────
  const initialModeRef = useRef(mode);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode === initialModeRef.current) return; // skip the mount render
    initialModeRef.current = mode;
    if (mode === "light") fellBackRef.current = false; // give vector another try
    map.setStyle(styleFor(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── push fresh deck layers each render ─────────────
  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

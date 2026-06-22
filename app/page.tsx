"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { POLL_MS } from "@/lib/config";
import { bearing, distanceNm, inCone } from "@/lib/geo";
import {
  coneFromHeading,
  loadStored,
  saveStored,
  settingsFromParams,
  settingsToQuery,
  DEFAULT_SETTINGS,
  type Settings,
} from "@/lib/settings";
import { cardinal } from "@/lib/format";
import { annotateLocalOperations, type TrackHistory } from "@/lib/operations";
import type { Plane, RawAircraft, RouteInfo } from "@/lib/types";
import AircraftList from "@/components/AircraftList";
import SetupModal from "@/components/SetupModal";
import MapCompass from "@/components/MapCompass";
import CameraView from "@/components/CameraView";
import type { ViewMode } from "@/components/Map3D";

const Map3D = dynamic(() => import("@/components/Map3D"), { ssr: false });

const MODES: { key: ViewMode; label: string }[] = [
  { key: "light", label: "Map" },
  { key: "satellite", label: "Satellite" },
  { key: "3d", label: "3D" },
];

const FOV_STORAGE_KEY = "schiff-flights-show-fov";
const LIST_STORAGE_KEY = "schiff-flights-list-collapsed";

function trackerQuery(settings: Settings, showFieldOfView: boolean): string {
  const params = new URLSearchParams(settingsToQuery(settings));
  if (!showFieldOfView) params.set("fov", "0");
  return params.toString();
}

function enrich(raw: RawAircraft[], s: Settings, receivedAt: number): Plane[] {
  const cone = coneFromHeading(s.heading, s.width);
  return raw
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .map((a) => {
      const distNm = distanceNm(s.lat, s.lon, a.lat!, a.lon!);
      const brg = bearing(s.lat, s.lon, a.lat!, a.lon!);
      return {
        ...a,
        id: a.hex,
        callsign: (a.flight ?? "").trim() || a.r || a.hex.toUpperCase(),
        distNm,
        brg,
        inView: inCone(brg, cone.start, cone.end),
        positionTs: receivedAt - Math.max(0, Math.min(30, a.seen_pos ?? 0)) * 1000,
      };
    })
    .sort((x, y) => x.distNm - y.distNm);
}

export default function Page() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [setupOpen, setSetupOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [planes, setPlanes] = useState<Plane[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [mode, setMode] = useState<ViewMode>("light");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [feedSource, setFeedSource] = useState<string>("airplanes.live");
  const [feedStale, setFeedStale] = useState(false);
  const [showFieldOfView, setShowFieldOfView] = useState(true);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const trackHistoryRef = useRef<TrackHistory>(new Map());
  const loadSequenceRef = useRef(0);

  // Decide initial settings: URL > localStorage > default (and prompt setup).
  useEffect(() => {
    const fovParam = new URLSearchParams(window.location.search).get("fov");
    const storedFov = window.localStorage.getItem(FOV_STORAGE_KEY);
    setShowFieldOfView(fovParam != null ? fovParam !== "0" : storedFov !== "0");
    setListCollapsed(window.localStorage.getItem(LIST_STORAGE_KEY) === "1");

    const fromUrl = settingsFromParams(new URLSearchParams(window.location.search));
    if (fromUrl) {
      setSettings(fromUrl);
      setConfigured(true);
      return;
    }
    const stored = loadStored();
    if (stored) {
      setSettings(stored);
      setConfigured(true);
      return;
    }
    setSetupOpen(true); // first-time visitor
  }, []);

  const load = useCallback(async (s: Settings) => {
    const sequence = ++loadSequenceRef.current;
    try {
      const res = await fetch(`/api/aircraft?lat=${s.lat}&lon=${s.lon}&radius=${s.radiusNm}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ac: RawAircraft[];
        now?: number;
        error?: string;
        source?: string;
        fallback?: boolean;
        stale?: boolean;
      };
      if (sequence !== loadSequenceRef.current) return;
      const now = Date.now();
      const sourceNow =
        typeof data.now === "number" && Number.isFinite(data.now)
          ? data.now < 1_000_000_000_000
            ? data.now * 1000
            : data.now
          : now;
      setPlanes(
        annotateLocalOperations(enrich(data.ac ?? [], s, sourceNow), trackHistoryRef.current, now)
      );
      if (!data.stale) setUpdatedAt(now);
      setError(data.error ?? null);
      setFeedSource(data.source ?? "airplanes.live");
      setFeedStale(Boolean(data.stale));
    } catch (e) {
      if (sequence !== loadSequenceRef.current) return;
      setError(String(e));
      setFeedStale(true);
    }
  }, []);

  // Poll whenever settings change.
  useEffect(() => {
    if (!configured) return;
    load(settings);
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => load(settings), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    start();
    const onVis = () => {
      if (document.hidden) stop();
      else {
        load(settings);
        start();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [configured, settings, load]);

  useEffect(() => {
    if (
      "serviceWorker" in navigator &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Look up origin/destination for the selected flight (once per selection).
  useEffect(() => {
    if (!selectedId) {
      setRoute(null);
      return;
    }
    const p = planes.find((x) => x.id === selectedId);
    setRoute(null);
    if (!p) return;
    const cs = p.flight?.trim();
    if (!cs) return;
    let cancelled = false;
    const params = new URLSearchParams({
      callsign: cs,
      lat: String(p.lat),
      lon: String(p.lon),
    });
    if (typeof p.track === "number") params.set("track", String(p.track));
    if (p.alt_baro != null) params.set("altitude", String(p.alt_baro));
    fetch(`/api/route?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRoute(d.route ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function applySettings(s: Settings) {
    setSettings(s);
    setConfigured(true);
    setSetupOpen(false);
    setSelectedId(null);
    saveStored(s);
    const q = trackerQuery(s, showFieldOfView);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }

  function toggleFieldOfView() {
    const next = !showFieldOfView;
    setShowFieldOfView(next);
    window.localStorage.setItem(FOV_STORAGE_KEY, next ? "1" : "0");
    const q = trackerQuery(settings, next);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }

  function toggleList() {
    const next = !listCollapsed;
    setListCollapsed(next);
    window.localStorage.setItem(LIST_STORAGE_KEY, next ? "1" : "0");
  }

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}?${trackerQuery(settings, showFieldOfView)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Schiff Flights", url });
      } else {
        await navigator.clipboard.writeText(url);
        setToast("Link copied!");
        setTimeout(() => setToast(null), 2000);
      }
    } catch {
      /* user cancelled */
    }
  }

  const handle3DError = useCallback(() => {
    setMode("light");
    setToast("3D unavailable — switched to map");
    setTimeout(() => setToast(null), 2500);
  }, []);

  const inViewCount = useMemo(() => planes.filter((p) => p.inView).length, [planes]);
  const cone = coneFromHeading(settings.heading, settings.width);
  const home = { lat: settings.lat, lon: settings.lon, label: settings.label };
  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;

  return (
    <div className="app">
      <header className="header">
        <div className="title-block">
          <h1>
            <span className="live-dot" aria-hidden />
            Schiff Flights
          </h1>
          <div className="sub">
            {settings.label} · facing {cardinal(settings.heading)} · {settings.width}° view
            {feedStale
              ? " · stale data · retrying…"
              : error
                ? " · retrying…"
                : ago != null
                  ? ` · ${ago}s ago`
                  : ""}
            {feedSource === "adsb.lol" ? " · backup feed" : ""}
          </div>
        </div>
        <div className="header-right">
          <div className="stats">
            <div className="stat">
              <div className="n">{planes.length}</div>
              <div className="l">In range</div>
            </div>
            <div className="stat">
              <div className="n accent">{inViewCount}</div>
              <div className="l">In view</div>
            </div>
          </div>
          <button className="icon-btn" aria-label="Share" onClick={share} title="Share your view">
            <span aria-hidden>⤴</span>
          </button>
          <button
            className="icon-btn camera-btn"
            aria-label="Open flight camera"
            onClick={() => setCameraOpen(true)}
            title="Identify aircraft with your camera"
          >
            <svg aria-hidden viewBox="0 0 24 24">
              <path d="M8.3 6.3 9.5 4h5l1.2 2.3H19a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.3a2 2 0 0 1 2-2h3.3Z" />
              <circle cx="12" cy="12.5" r="3.4" />
            </svg>
          </button>
          <button
            className="icon-btn"
            aria-label="Settings"
            onClick={() => setSetupOpen(true)}
            title="Change location / direction"
          >
            <span aria-hidden>⚙</span>
          </button>
        </div>
      </header>

      <div className={`body${listCollapsed ? " list-collapsed" : ""}`}>
        <div className="map-wrap">
          <Map3D
            mode={mode}
            home={home}
            cone={cone}
            heading={settings.heading}
            radiusNm={settings.radiusNm}
            showFieldOfView={showFieldOfView}
            planes={planes}
            selectedId={selectedId}
            route={route}
            onSelect={setSelectedId}
            on3DError={handle3DError}
          />
          <div className="map-controls">
            <div className="mode-toggle">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  className={mode === m.key ? "active" : ""}
                  onClick={() => setMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              className={`fov-toggle${showFieldOfView ? " active" : ""}`}
              type="button"
              aria-pressed={showFieldOfView}
              onClick={toggleFieldOfView}
              title={`${showFieldOfView ? "Hide" : "Show"} your field of view`}
            >
              <span aria-hidden>◉</span> View cone
            </button>
          </div>
          <MapCompass heading={settings.heading} />
        </div>
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>Aircraft · nearest first {inViewCount > 0 && `· ${inViewCount} in view`}</span>
            <button
              type="button"
              className="list-toggle"
              aria-expanded={!listCollapsed}
              aria-label={listCollapsed ? "Show aircraft list" : "Hide aircraft list"}
              onClick={toggleList}
            >
              <span aria-hidden>{listCollapsed ? "⌃" : "⌄"}</span>
            </button>
          </div>
          <AircraftList planes={planes} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {cameraOpen && (
        <CameraView
          planes={planes}
          fallbackHeading={settings.heading}
          onSelect={setSelectedId}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {setupOpen && (
        <SetupModal
          initial={settings}
          dismissable={configured}
          onSave={applySettings}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </div>
  );
}

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
import type { ViewMode } from "@/components/Map3D";

const Map3D = dynamic(() => import("@/components/Map3D"), { ssr: false });

const MODES: { key: ViewMode; label: string }[] = [
  { key: "light", label: "Map" },
  { key: "satellite", label: "Satellite" },
  { key: "3d", label: "3D" },
];

function enrich(raw: RawAircraft[], s: Settings): Plane[] {
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
  const trackHistoryRef = useRef<TrackHistory>(new Map());
  const loadSequenceRef = useRef(0);

  // Decide initial settings: URL > localStorage > default (and prompt setup).
  useEffect(() => {
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
        error?: string;
        source?: string;
        fallback?: boolean;
        stale?: boolean;
      };
      if (sequence !== loadSequenceRef.current) return;
      const now = Date.now();
      setPlanes(annotateLocalOperations(enrich(data.ac ?? [], s), trackHistoryRef.current, now));
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
  }, [settings, load]);

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
    const q = settingsToQuery(s);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}?${settingsToQuery(settings)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Plane Spotter", url });
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
            Plane Spotter
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
            className="icon-btn"
            aria-label="Settings"
            onClick={() => setSetupOpen(true)}
            title="Change location / direction"
          >
            <span aria-hidden>⚙</span>
          </button>
        </div>
      </header>

      <div className="body">
        <div className="map-wrap">
          <Map3D
            mode={mode}
            home={home}
            cone={cone}
            heading={settings.heading}
            radiusNm={settings.radiusNm}
            planes={planes}
            selectedId={selectedId}
            route={route}
            onSelect={setSelectedId}
            on3DError={handle3DError}
          />
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
        </div>
        <aside className="sidebar">
          <div className="sidebar-head">
            Aircraft · nearest first {inViewCount > 0 && `· ${inViewCount} in view`}
          </div>
          <AircraftList planes={planes} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}

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

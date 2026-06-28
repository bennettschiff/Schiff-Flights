"use client";

import { useState } from "react";
import CompassPicker from "@/components/CompassPicker";
import { clampWidth, normHeading, type Settings } from "@/lib/settings";

interface Resolved {
  lat: number;
  lon: number;
  label: string;
  zip?: string;
}

export default function SetupModal({
  initial,
  onSave,
  onClose,
  dismissable,
}: {
  initial: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  dismissable: boolean;
}) {
  const [zip, setZip] = useState(initial.zip ?? "");
  const [heading, setHeading] = useState(initial.heading);
  const [width, setWidth] = useState(initial.width);
  const [localFeedUrl, setLocalFeedUrl] = useState(initial.localFeedUrl ?? "");
  const [resolved, setResolved] = useState<Resolved | null>(
    initial.zip ? { lat: initial.lat, lon: initial.lon, label: initial.label, zip: initial.zip } : null
  );
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/geocode?zip=${encodeURIComponent(zip.trim())}`);
      const d = await res.json();
      if (!res.ok) {
        setResolved(null);
        setStatus(d.error ?? "Lookup failed.");
      } else {
        setResolved({ lat: d.lat, lon: d.lon, label: `${d.city}, ${d.state}`, zip: d.zip });
        setStatus(null);
      }
    } catch {
      setStatus("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  function useExactLocation() {
    if (!navigator.geolocation) {
      setStatus("Location access is not available in this browser.");
      return;
    }
    setLoading(true);
    setStatus(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setZip("");
        setResolved({
          lat: coords.latitude,
          lon: coords.longitude,
          label: "Exact location",
        });
        setLoading(false);
      },
      () => {
        setStatus("Location permission was unavailable — ZIP setup still works.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function save() {
    if (!resolved) return;
    onSave({
      lat: resolved.lat,
      lon: resolved.lon,
      label: resolved.label,
      zip: resolved.zip,
      heading: normHeading(heading),
      width: clampWidth(width),
      radiusNm: initial.radiusNm,
      localFeedUrl: localFeedUrl.trim() || undefined,
    });
  }

  return (
    <div className="modal-overlay" onClick={() => dismissable && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Set up your sky</h2>
          {dismissable && (
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
        <p className="modal-sub">Use your location or enter a ZIP, then point the dial the way you look out.</p>

        <label className="field-label" htmlFor="zip">Your ZIP code</label>
        <div className="zip-row">
          <input
            id="zip"
            inputMode="numeric"
            maxLength={5}
            placeholder="e.g. 19122"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button className="btn" onClick={lookup} disabled={loading || zip.length !== 5}>
            {loading ? "…" : "Find"}
          </button>
        </div>
        {resolved && <div className="resolved">📍 {resolved.label}</div>}
        {status && <div className="error">{status}</div>}
        <button className="btn btn-location" onClick={useExactLocation} disabled={loading}>
          Use my exact location
        </button>
        <div className="field-help">Best for accurate balcony bearings. Coordinates are used for nearby-aircraft requests and included in shared URLs.</div>

        <label className="field-label" style={{ marginTop: 18 }}>Which way are you facing?</label>
        <CompassPicker heading={heading} width={width} onHeading={setHeading} />

        <div className="width-row">
          <span className="field-label" style={{ margin: 0 }}>View width</span>
          <input
            type="range"
            min={10}
            max={120}
            step={5}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="width-val">{width}°</span>
        </div>

        <label className="field-label" style={{ marginTop: 18 }} htmlFor="local-feed">
          Local ADS-B receiver <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          id="local-feed"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="http://192.168.1.50:8080"
          value={localFeedUrl}
          onChange={(e) => setLocalFeedUrl(e.target.value)}
        />
        <div className="field-help">
          Running a Raspberry Pi with dump1090/PiAware? Enter its address to pull live aircraft straight
          from your own antenna. Used only from this browser on your home network; it falls back to public
          feeds when the receiver is unreachable.
        </div>

        <button className="btn btn-primary" onClick={save} disabled={!resolved}>
          Start tracking
        </button>
      </div>
    </div>
  );
}

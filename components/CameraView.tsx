"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { airlineBadgeForCallsign } from "@/lib/airlines";
import { fmtAlt, fmtDist } from "@/lib/format";
import type { Plane } from "@/lib/types";

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function signedAngle(value: number) {
  return ((value + 540) % 360) - 180;
}

export default function CameraView({
  planes,
  fallbackHeading,
  onClose,
  onSelect,
}: {
  planes: Plane[];
  fallbackHeading: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState(fallbackHeading);
  const [pitch, setPitch] = useState(90);
  const [hasCompass, setHasCompass] = useState(false);

  useEffect(() => {
    if (!started) return;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const ios = event as IOSOrientationEvent;
      const nextHeading =
        typeof ios.webkitCompassHeading === "number"
          ? ios.webkitCompassHeading
          : typeof event.alpha === "number"
            ? (360 - event.alpha + 360) % 360
            : null;
      if (nextHeading != null) {
        setHeading(nextHeading);
        setHasCompass(true);
      }
      if (typeof event.beta === "number") setPitch(event.beta);
    };
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, [started]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    }
  }, [started]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  async function startCamera() {
    setStarting(true);
    setError(null);
    try {
      const Orientation = window.DeviceOrientationEvent as OrientationConstructor | undefined;
      if (Orientation?.requestPermission) await Orientation.requestPermission();
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setStarted(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Camera permission was not granted.";
      setError(message);
    } finally {
      setStarting(false);
    }
  }

  function close() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    onClose();
  }

  const visible = useMemo(
    () =>
      planes
        .map((plane) => {
          const horizontal = signedAngle(plane.brg - heading);
          const altitude = typeof plane.alt_baro === "number" ? plane.alt_baro : 0;
          const elevation = Math.atan2(altitude, Math.max(0.1, plane.distNm) * 6076.12) * (180 / Math.PI);
          const horizon = 50 + (pitch - 90) * 1.35;
          return {
            plane,
            x: 50 + (horizontal / 64) * 100,
            y: horizon - elevation * 2.5,
          };
        })
        .filter(({ x, y }) => x > -8 && x < 108 && y > 5 && y < 92),
    [planes, heading, pitch]
  );

  return (
    <div className="camera-view" role="dialog" aria-modal="true" aria-label="Camera flight finder">
      <video ref={videoRef} className="camera-video" muted playsInline />
      <div className="camera-shade" />
      <div className="camera-topbar">
        <div>
          <b>Flight camera</b>
          <span>{hasCompass ? `${Math.round(heading)}°` : "Point toward your view"}</span>
        </div>
        <button type="button" onClick={close} aria-label="Close camera">×</button>
      </div>

      {!started ? (
        <div className="camera-start">
          <div className="camera-start-icon" aria-hidden>◎</div>
          <h2>Identify planes through your camera</h2>
          <p>Your camera stays on this phone. Location and live flight data are only used to place labels.</p>
          <button type="button" className="camera-start-btn" onClick={startCamera} disabled={starting}>
            {starting ? "Starting…" : "Start camera"}
          </button>
          {error && <div className="camera-error">{error}</div>}
        </div>
      ) : (
        <>
          <div className="camera-reticle" aria-hidden />
          {visible.map(({ plane, x, y }) => {
            const airline = airlineBadgeForCallsign(plane.flight);
            return (
              <button
                type="button"
                key={plane.id}
                className="camera-plane"
                style={{ left: `${x}%`, top: `${y}%` }}
                onClick={() => { onSelect(plane.id); close(); }}
              >
                {airline && <img src={airline.logo} alt="" />}
                <span><b>{plane.callsign}</b><small>{fmtDist(plane.distNm)} · {fmtAlt(plane.alt_baro)}</small></span>
              </button>
            );
          })}
          <div className="camera-hint">
            {hasCompass ? `${visible.length} aircraft aligned` : "Compass unavailable · using your saved view direction"}
          </div>
        </>
      )}
    </div>
  );
}

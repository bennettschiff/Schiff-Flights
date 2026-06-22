"use client";

import { useEffect, useRef } from "react";
import { cardinal, fmtAlt, fmtSpeed, fmtDist, isHelicopter } from "@/lib/format";
import type { Plane } from "@/lib/types";
import { airlineBadgeForCallsign } from "@/lib/airlines";

function Compass({ deg }: { deg: number }) {
  // Arrow points in the compass direction from you to the aircraft.
  return (
    <svg className="compass" viewBox="0 0 24 24" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M12 3 L17 19 L12 15 L7 19 Z" fill="currentColor" />
    </svg>
  );
}

export default function AircraftList({
  planes,
  selectedId,
  onSelect,
}: {
  planes: Plane[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (planes.length === 0) {
    return <div className="empty">No aircraft in range right now. Hang tight…</div>;
  }

  return (
    <>
      {planes.map((p) => {
        const active = p.id === selectedId;
        const airline = airlineBadgeForCallsign(p.flight);
        return (
          <div
            key={p.id}
            ref={active ? activeRef : undefined}
            className={`row${p.inView ? " inview" : ""}${active ? " active" : ""}`}
            onClick={() => onSelect(active ? null : p.id)}
          >
            <Compass deg={p.brg} />
            <div>
              <div className="callsign">
                {airline && <img className="row-airline-logo" src={airline.logo} alt={airline.name} />}
                {isHelicopter(p) ? "🚁 " : ""}
                {p.callsign}
                {p.inView && <span className="badge">IN VIEW</span>}
              </div>
              <div className="meta">
                {p.localOperation ? `${p.localOperation.label} · ` : ""}
                {p.t ? `${p.t} · ` : p.r && p.r !== p.callsign ? `${p.r} · ` : ""}
                {fmtAlt(p.alt_baro)} · {fmtSpeed(p.gs)}
              </div>
            </div>
            <div className="right">
              <div className="dist">{fmtDist(p.distNm)}</div>
              <div className="brg">
                {cardinal(p.brg)} · {Math.round(p.brg)}°
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

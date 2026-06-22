"use client";

import { useRef } from "react";
import { cardinal } from "@/lib/format";
import { normHeading } from "@/lib/settings";

const SIZE = 220;
const C = SIZE / 2;
const R = 86;

function pt(bearing: number, radius: number): [number, number] {
  const rad = (bearing * Math.PI) / 180;
  return [C + radius * Math.sin(rad), C - radius * Math.cos(rad)];
}

function wedgePath(heading: number, width: number): string {
  const start = heading - width / 2;
  const end = heading + width / 2;
  let d = `M ${C} ${C} `;
  const steps = Math.max(2, Math.ceil(width / 3));
  for (let i = 0; i <= steps; i++) {
    const [x, y] = pt(start + (width * i) / steps, R);
    d += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d + "Z";
}

export default function CompassPicker({
  heading,
  width,
  onHeading,
}: {
  heading: number;
  width: number;
  onHeading: (h: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  function setFromEvent(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SIZE;
    const y = ((clientY - rect.top) / rect.height) * SIZE;
    const dx = x - C;
    const dy = y - C;
    const bearing = normHeading((Math.atan2(dx, -dy) * 180) / Math.PI);
    onHeading(bearing);
  }

  const [hx, hy] = pt(heading, R - 6);
  const ticks = ["N", "E", "S", "W"];

  return (
    <div className="compass-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="compass-svg"
        role="slider"
        aria-label="Facing direction"
        aria-valuenow={Math.round(heading)}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setFromEvent(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => dragging.current && setFromEvent(e.clientX, e.clientY)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <circle cx={C} cy={C} r={R} className="compass-dial" />
        <path d={wedgePath(heading, width)} className="compass-wedge" />
        <line x1={C} y1={C} x2={hx} y2={hy} className="compass-needle" />
        <circle cx={hx} cy={hy} r={6} className="compass-knob" />
        <circle cx={C} cy={C} r={3} className="compass-center" />
        {ticks.map((t, i) => {
          const [lx, ly] = pt(i * 90, R + 14);
          return (
            <text key={t} x={lx} y={ly} className="compass-tick" dominantBaseline="middle" textAnchor="middle">
              {t}
            </text>
          );
        })}
      </svg>
      <div className="compass-readout">
        Facing <b>{cardinal(heading)}</b> · {Math.round(heading)}°
      </div>
    </div>
  );
}

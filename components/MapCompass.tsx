import { cardinal } from "@/lib/format";

export default function MapCompass({ heading }: { heading: number }) {
  return (
    <div className="map-compass" title={`You are facing ${cardinal(heading)} · ${Math.round(heading)}°`}>
      <svg viewBox="0 0 76 76" role="img" aria-label={`Compass, facing ${cardinal(heading)}`}>
        <circle className="map-compass-face" cx="38" cy="38" r="35" />
        <text className="map-compass-north" x="38" y="13" textAnchor="middle">N</text>
        <text x="65" y="42" textAnchor="middle">E</text>
        <text x="38" y="69" textAnchor="middle">S</text>
        <text x="11" y="42" textAnchor="middle">W</text>
        <g transform={`rotate(${heading} 38 38)`}>
          <path className="map-compass-arrow" d="M38 15 L32.5 40 L38 36.5 L43.5 40 Z" />
          <line className="map-compass-tail" x1="38" y1="38" x2="38" y2="56" />
        </g>
        <circle className="map-compass-center-dot" cx="38" cy="38" r="3" />
      </svg>
      <span>{cardinal(heading)} · {Math.round(heading)}°</span>
    </div>
  );
}

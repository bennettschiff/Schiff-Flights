// App-wide constants that aren't per-user. Per-user location/direction
// lives in lib/settings.ts (shareable via URL).

// How often to refresh, in milliseconds. The free API asks for <= ~1 req/sec.
export const POLL_MS = 5000;

// Initial map zoom when centering on a viewer's location.
export const MAP_ZOOM = 9.4;

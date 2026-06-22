# Schiff Flights

A personal live flight tracker centered on **19122 (Philadelphia)**, with your
balcony's view cone (**SE 120° → S 180°**) highlighted. Free data, no API keys,
no ads. Runs as a website on your laptop and installs to your iPhone home screen.

## Data source
Live aircraft come from the free, community-run **[airplanes.live](https://airplanes.live/api-guide/)**
ADS-B network via its point/radius endpoint, with **[ADSB.lol](https://api.adsb.lol/docs)**
as an automatic backup if the primary feed is unavailable. No key or signup is
required. The app proxies them server-side (`app/api/aircraft/route.ts`) and
retains the last successful snapshot through brief upstream outages.

When a live feed omits an aircraft's registration, type, description, owner, or
photo, the server supplements that row from **[ADSBDB](https://www.adsbdb.com/)**.
Those slow-changing results (including misses) are cached for seven days, and
only a small capped batch is fetched on each live poll. Some TIS-B targets,
airport vehicles, military/privacy-address aircraft, and malformed callsigns
will still remain unidentified because no public database has a safe match.

## Route confidence
ADS-B transmits an aircraft identity and motion, not a trustworthy origin and
destination. When a plane is selected, ADSBDB supplies a schedule candidate;
the app checks that candidate against the live position, route corridor,
segment endpoints, ground state, and direction of travel. Contradicted routes
are hidden instead of being presented as fact. Plausible routes are explicitly
shown as direct-route estimates rather than historical tracks.

For low regional traffic, a short in-browser position history identifies
observed arrivals, departures, and ground aircraft around PHL, PNE, TTN, ILG,
ACY, and Wings Field without another API.

## Run it locally
```bash
npm install
npm run dev
```
Open http://localhost:3000 (also reachable from your phone on the same Wi‑Fi at
`http://<your-laptop-ip>:3000`).

Run the geometry and local-operation checks with `npm test`; verify a production
bundle with `npm run build`.

## Put it on your iPhone
1. Deploy free to Vercel (`vercel` or push to GitHub + import), **or** run
   `npm run dev` and reach your laptop's LAN IP from the phone.
2. In Safari, open the URL → Share → **Add to Home Screen**.

## Shareable setup
Anyone can configure their own view — no accounts:
- The setup screen takes a **ZIP code** (resolved free via Zippopotam, no key)
  and a **compass dial** for the direction they face + a view-width slider.
- Settings are encoded in the **URL** (`?lat=..&lon=..&heading=..&width=..`) and
  saved to `localStorage`. Hit **Share** to copy a link that drops a friend into
  their own setup to tweak.
- Defaults and helpers live in [`lib/settings.ts`](lib/settings.ts); refresh
  interval and zoom in [`lib/config.ts`](lib/config.ts).

## What you see
- **Dark radar map** centered on home, with a cyan **view wedge**.
- **Cyan planes** = inside your view cone; grey = elsewhere in range.
- **Sidebar list**, nearest first, with a compass arrow, altitude, speed,
  distance, and an **IN VIEW** badge. Tap a plane (map or list) for details.
- On mobile, collapse the aircraft drawer to give the map the full screen, or
  open **Flight camera** to place nearby aircraft labels over the rear camera.
  Camera imagery never leaves the device.
- Known airlines use locally bundled airline logo artwork; unknown and private
  operators remain unbranded rather than receiving a guessed logo.

## Later: your own receiver (Path B)
Because you have rooftop sky access, a ~$30 RTL-SDR dongle + 1090 MHz antenna
running `readsb`/`tar1090` gives you a private, no-rate-limit feed. Point the
`app/api/aircraft` proxy at your receiver's JSON instead of airplanes.live and
the rest of the app is unchanged.

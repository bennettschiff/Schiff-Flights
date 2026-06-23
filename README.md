# Schiff Flights

A personal live flight tracker. Pick any location and the compass direction you
face, and it highlights the slice of sky in your view. Free ADS-B data and no
ads; the optional photorealistic **3D** map uses a Google Maps Platform key
(`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local`). Runs as a website on your
laptop and installs to your iPhone home screen.

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
- A warm **light/tan map** centered on your spot, with a clay **view wedge** for
  the direction you face. Toggle between **Map**, **Satellite**, and a
  photorealistic **3D** view (Google 3D Tiles).
- **Emoji aircraft** drawn at true altitude — clay = inside your view cone, grey
  = elsewhere in range, **🚁** for helicopters.
- **Sidebar list**, nearest first, with a compass arrow, altitude, speed,
  distance, an airline mark, local arrival/departure labels, and an **IN VIEW**
  badge. Tap a plane (map or list) for a detail card.
- **Operator badges** come from the callsign — scheduled airlines, plus
  fractional / charter operators (NetJets, Flexjet, VistaJet…) — or, when there
  is no operator callsign, from the airframe type (Gulfstream, Bombardier,
  Cessna…). They are **never** taken from the registered owner, which for most
  airliners is a leasing bank or trust, not the operator. Medical / air-ambulance
  flights get a red ✚ marker.
- The **detail card** shows aircraft type and the registered owner (labelled as
  such), distance and bearing to you, and — when a schedule match passes the live
  plausibility check — origin → destination, a drawn route corridor, and
  approximate trip progress (percent, distance, ETA). Routes that can't be
  verified are hidden with a reason.
- On mobile, collapse the aircraft drawer to give the map the full screen, or
  open **Flight camera** to place nearby aircraft labels over the rear camera.
  Camera imagery never leaves the device.
- Airlines and major private operators use locally bundled logo marks;
  unrecognised aircraft stay unbranded rather than receiving a guessed logo.

## Later: your own receiver (Path B)
Because you have rooftop sky access, a ~$30 RTL-SDR dongle + 1090 MHz antenna
running `readsb`/`tar1090` gives you a private, no-rate-limit feed. Point the
`app/api/aircraft` proxy at your receiver's JSON instead of airplanes.live and
the rest of the app is unchanged.

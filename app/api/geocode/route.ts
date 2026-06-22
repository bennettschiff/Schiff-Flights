import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Free, no-key US ZIP -> lat/lon lookup via Zippopotam. Runs once per
// viewer at setup time (not per frame), so a free service is plenty.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get("zip") ?? "").trim();

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "Enter a 5-digit US ZIP code." }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: "force-cache" });
    if (!res.ok) {
      return NextResponse.json({ error: "ZIP not found." }, { status: 404 });
    }
    const d = (await res.json()) as {
      places?: Array<{
        latitude: string;
        longitude: string;
        "place name": string;
        "state abbreviation": string;
      }>;
    };
    const place = d.places?.[0];
    if (!place) {
      return NextResponse.json({ error: "ZIP not found." }, { status: 404 });
    }
    return NextResponse.json({
      lat: parseFloat(place.latitude),
      lon: parseFloat(place.longitude),
      city: place["place name"],
      state: place["state abbreviation"],
      zip,
    });
  } catch {
    return NextResponse.json({ error: "Lookup failed — try again." }, { status: 500 });
  }
}

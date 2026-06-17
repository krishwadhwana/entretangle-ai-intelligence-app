import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
});

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    country?: string;
  };
};

export async function GET(req: NextRequest) {
  const parsed = SearchSchema.safeParse({
    q: req.nextUrl.searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", parsed.data.q);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "EntreTangle audience locality search",
        "Accept-Language": "en",
      },
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) throw new Error(`geocoder failed (${res.status})`);
    const raw = (await res.json()) as NominatimResult[];
    const results = raw
      .map((r) => ({
        label: r.display_name ?? "Unknown locality",
        country: r.address?.country ?? "",
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "geocoding failed" },
      { status: 502 }
    );
  }
}

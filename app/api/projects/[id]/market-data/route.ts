import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callMarketData } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { saveMarketDatum } from "@/lib/store";
import {
  ClientProfileSchema,
  LaunchBusinessModelSchema,
  MarketDatumSchema,
} from "@/lib/schema";
import {
  categoryKeyFromProfile,
  marketFromGeography,
  type Market,
} from "@/lib/datasources/benchmarks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MarketDataBodySchema = {
  parse(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { businessModel: null as null };
    }
    const parsed = LaunchBusinessModelSchema.nullable()
      .optional()
      .safeParse((raw as { businessModel?: unknown }).businessModel);
    return { businessModel: parsed.success ? parsed.data ?? null : null };
  },
};

// Best-effort readable country for the web search (so a UK/UAE venture searches
// the right market even though it shares the USD baseline).
function countryLabel(
  geography: string[] | null | undefined,
  market: Market
): string {
  const KNOWN = [
    "United States", "USA", "United Kingdom", "UK", "Canada", "Australia",
    "UAE", "United Arab Emirates", "Singapore", "Germany", "France", "India",
  ];
  const g = (geography ?? []).join(" ");
  for (const k of KNOWN) {
    if (new RegExp(`\\b${k.replace(/\s/g, "\\s")}\\b`, "i").test(g)) return k;
  }
  return market === "US" ? "United States" : "India";
}

// Source current, cited benchmark figures for this project's market × category
// and persist them as overrides on the curated priors.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = MarketDataBodySchema.parse(await req.json().catch(() => ({})));
  const row = await prisma.project.findUnique({
    where: { id: params.id },
    select: { ventureProfile: true },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const profile = ClientProfileSchema.safeParse(row.ventureProfile);
  if (!profile.success) {
    return NextResponse.json(
      { error: "build the venture profile first" },
      { status: 409 }
    );
  }

  const category = categoryKeyFromProfile(profile.data);
  const market = marketFromGeography(profile.data.geography);
  const country = countryLabel(profile.data.geography, market);

  try {
    const out = await callMarketData(
      params.id,
      country,
      category,
      body.businessModel ?? undefined
    );
    const datum = MarketDatumSchema.parse({
      ...out,
      market,
      category,
      country,
      asOf: new Date().toISOString(),
    });
    await saveMarketDatum(params.id, `${market}:${category}`, datum);
    return NextResponse.json({ datum });
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(
      e,
      "market data sourcing failed"
    );
    return NextResponse.json(payload, { status });
  }
}

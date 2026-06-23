import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ClientProfileSchema, FulfillmentPathSchema } from "@/lib/schema";
import { computeExportViability } from "@/lib/exportSim";
import { loadExportContext } from "@/lib/exportRun";
import {
  runExportLaunch,
  launchBusinessModelForProfile,
  suggestExportAdSpend,
} from "@/lib/exportLaunch";
import type { LaunchPersona } from "@/lib/launchSim";
import { callClassifyVenture } from "@/lib/llm";
import {
  resolveBenchmarks,
  categoryKeyFromProfile,
  geoTiersFromLocalities,
  marketFromCountries,
} from "@/lib/datasources/benchmarks";
import {
  fetchFxRate,
  fetchImportDutyPct,
  US_AVG_SALES_TAX_PCT,
} from "@/lib/datasources/exportCosts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Export viability — the deterministic landed-cost / export-pricing engine.
//   POST { ...overrides } → assemble inputs (live FX + duty, parent home COGS,
//                           this run's destination WTP), run the engine, return
//                           the cross-border viability report. No persistence.
// All knobs are overridable so the engine stays a pure function of its inputs;
// the route only sources the live/contextual defaults.

const BodySchema = z.object({
  // Overrides — every field falls back to a sourced/contextual default.
  unitCogsHome: z.number().nonnegative().optional(),
  unitWeightKg: z.number().positive().optional(),
  hsCode: z.string().optional(),
  fxRate: z.number().positive().optional(),
  dutyRatePct: z.number().min(0).max(100).optional(),
  deMinimisActive: z.boolean().optional(),
  targetMarginPct: z.number().min(0).max(95).optional(),
  salesTaxPct: z.number().min(0).max(30).optional(),
  scenarios: z.array(FulfillmentPathSchema).min(1).optional(),
  // Phase 4 launch trajectory (per scenario). Defaults on; ad budget auto-derived.
  includeLaunch: z.boolean().optional(),
  adSpendPerMonth: z.number().nonnegative().optional(),
});

// Destination country → ISO2 for the duty lookup (default US).
const COUNTRY_ISO2: Record<string, string> = {
  "united states": "US",
  usa: "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  uae: "AE",
  "united arab emirates": "AE",
  canada: "CA",
  australia: "AU",
  singapore: "SG",
  germany: "DE",
};

function isoForCountry(name: string): string {
  return COUNTRY_ISO2[name.trim().toLowerCase()] ?? "US";
}

function dominant<T extends string>(xs: T[]): T | null {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = -1;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  const o = body.data;

  const profile = (() => {
    try {
      return ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    } catch {
      return null;
    }
  })();
  const destCountry = run.targetMarket ?? profile?.geography?.[0] ?? "United States";

  // Home-market context (parent run): proven COGS + currency. Best-effort — an
  // export run normally has a parent, but the engine still runs from overrides.
  const exportCtx = run.parentRunId
    ? await loadExportContext(run.parentRunId).catch(() => null)
    : null;
  const homeCurrency = exportCtx?.homeCurrency ?? "INR";

  // Destination audience: this run's frozen personas (the US/destination market).
  const personaRows = await prisma.persona.findMany({
    where: { cohort: { runId: run.id } },
    select: {
      wtp: true,
      wtpCurrency: true,
      intent: true,
      priceSensitivity: true,
      channelPref: true,
      platforms: true,
      objection: true,
      age: true,
      gender: true,
      cohort: { select: { segment: true, locality: true, country: true } },
    },
  });
  const destCurrency = dominant(personaRows.map((p) => p.wtpCurrency)) ?? "USD";
  const destPersonas = personaRows.filter((p) => p.wtpCurrency === destCurrency);
  const wtpSamplesDest = destPersonas.map((p) => p.wtp);
  const launchPersonas: LaunchPersona[] = destPersonas.map((p) => ({
    intent: p.intent,
    wtp: p.wtp,
    priceSensitivity: p.priceSensitivity,
    segment: p.cohort.segment,
    channelPref: p.channelPref,
    platforms: ((): string[] => {
      try {
        const v = JSON.parse(p.platforms);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    })(),
    objection: p.objection,
    age: p.age,
    gender: p.gender,
    locality: p.cohort.locality,
    country: p.cohort.country,
  }));

  // Home unit COGS: override → parent launch-sim cost price → parent financial
  // model BOM total → a conservative fallback from the home audience's WTP.
  let unitCogsHome = o.unitCogsHome ?? null;
  const sources: string[] = [];
  if (unitCogsHome == null && run.parentRunId) {
    const launch = await prisma.launchSimulation.findFirst({
      where: { runId: run.parentRunId },
      orderBy: { createdAt: "desc" },
      select: { inputs: true },
    });
    const cp = (launch?.inputs as { costPrice?: number } | null)?.costPrice;
    if (typeof cp === "number" && cp > 0) {
      unitCogsHome = cp;
      sources.push("Home unit COGS ← parent launch-sim cost price");
    }
  }
  if (unitCogsHome == null && exportCtx?.financial) {
    const bom = exportCtx.financial.costStructure?.reduce(
      (s, l) => s + (Number.isFinite(l.amount?.value) ? l.amount.value : 0),
      0
    );
    if (bom && bom > 0) {
      unitCogsHome = bom;
      sources.push("Home unit COGS ← parent financial model BOM");
    }
  }
  if (unitCogsHome == null) {
    // Last resort: assume COGS ≈ 40% of the home audience's median WTP.
    const homeWtpMid = exportCtx?.aggregate
      ? Object.values(exportCtx.aggregate.bySegment).map((s) => s.wtpP50).sort((a, b) => a - b)
      : [];
    const med = homeWtpMid.length ? homeWtpMid[Math.floor(homeWtpMid.length / 2)] : 0;
    unitCogsHome = med > 0 ? med * 0.4 : 100;
    sources.push("Home unit COGS ← estimated 40% of home median WTP (no cost data)");
  }

  // HS code → import duty. Override wins; else classify the venture (cheap) and
  // look up the live applied tariff. Default 0 (de-minimis-friendly) on miss.
  let hsCode = o.hsCode ?? "";
  if (!hsCode && profile) {
    const industry = await callClassifyVenture(run.id, profile).catch(() => null);
    hsCode = industry?.hsCodes?.[0] ?? "";
  }
  let dutyRatePct = o.dutyRatePct ?? 0;
  if (o.dutyRatePct == null && hsCode) {
    const duty = await fetchImportDutyPct(hsCode, isoForCountry(destCountry));
    if (duty) {
      dutyRatePct = duty.pct;
      sources.push(`Import duty ${duty.pct}% (HS ${hsCode}) — ${duty.source}`);
    }
  }

  // FX: override → live mid-market → prior.
  let fxRate = o.fxRate ?? 0;
  if (!fxRate) {
    const fx = await fetchFxRate(homeCurrency, destCurrency);
    fxRate = fx.rate;
    sources.push(`FX ${homeCurrency}→${destCurrency} ${fx.rate} — ${fx.source}`);
  }

  const report = computeExportViability({
    homeCurrency,
    destCurrency,
    destCountry,
    fxRate,
    unitCogsHome,
    unitWeightKg: o.unitWeightKg ?? 0.5,
    hsCode,
    dutyRatePct,
    deMinimisActive: o.deMinimisActive ?? true,
    deMinimisThresholdUsd: 800,
    targetMarginPct: o.targetMarginPct ?? profile?.targetMarginPct ?? 50,
    salesTaxPct: o.salesTaxPct ?? US_AVG_SALES_TAX_PCT,
    paymentFeePct: 0.029,
    originLogisticsUsd: 1.2,
    bulkUnitsPerEntry: 500,
    scenarios: o.scenarios ?? ["dtc_parcel", "bulk_warehouse", "marketplace"],
    wtpSamplesDest,
    sources,
    notes:
      o.unitWeightKg == null
        ? ["Unit weight defaulted to 0.5 kg — set the real per-unit weight for accurate freight & duty."]
        : [],
  });

  // Phase 4 — run a destination launch trajectory per scenario over the frozen
  // audience, using each path's landed cost / required price. Best-effort: a
  // launch failure for one scenario leaves its `launch` null, never 500s.
  const includeLaunch = o.includeLaunch ?? true;
  if (includeLaunch && launchPersonas.length > 0 && profile) {
    const distinctLocalities = Array.from(
      new Map(
        launchPersonas.map((p) => [p.locality, { name: p.locality, country: p.country }])
      ).values()
    );
    const market = marketFromCountries(launchPersonas.map((p) => p.country));
    const priors = resolveBenchmarks(
      categoryKeyFromProfile(profile),
      geoTiersFromLocalities(distinctLocalities),
      market
    );
    const businessModel = launchBusinessModelForProfile(profile);
    const adSpendPerMonth = o.adSpendPerMonth ?? suggestExportAdSpend(priors);
    const launchMonth = new Date().getMonth() + 1;
    for (const sc of report.scenarios) {
      try {
        sc.launch = runExportLaunch({
          personas: launchPersonas,
          priors,
          businessModel,
          currency: destCurrency,
          costPrice: sc.landedCostPerUnit,
          salePrice: sc.requiredPrice,
          adSpendPerMonth,
          launchStartMonth: launchMonth,
        });
      } catch (e) {
        console.error(`[export-sim] launch failed for ${sc.path}:`, e);
      }
    }
  }

  return NextResponse.json({ report });
}

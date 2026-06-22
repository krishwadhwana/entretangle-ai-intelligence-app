import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getFinancialModel, getMarketData } from "@/lib/store";
import { simulateLaunch, type LaunchPersona } from "@/lib/launchSim";
import {
  ClientProfileSchema,
  LaunchSimInputsSchema,
  LaunchSimRecordSchema,
  type LaunchBusinessModel,
  type LaunchSimInputs,
  type LaunchSimRecord,
  type MarketDatum,
} from "@/lib/schema";
import {
  resolveBenchmarks,
  marketFromCountries,
  categoryKeyFromProfile,
  categoryKeyFromBusinessModel,
  geoTiersFromLocalities,
  type BenchmarkPriors,
} from "@/lib/datasources/benchmarks";
import { getAttentionMomentumPct } from "@/lib/datasources/structured";
import { regionForLocality } from "@/lib/datasources/politicalGeography";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Launch Simulation — a deterministic, persona-driven launch trajectory.
//   • GET                       → saved scenarios + form defaults (from financials)
//   • POST { inputs, name }     → run the engine over the frozen personas, save
//                                 the scenario, return it. No LLM; pure compute.
// The engine is a pure function of its inputs, so rerunning identical inputs
// reproduces an identical result — that is the predictiveness contract.

const BodySchema = z.object({
  inputs: LaunchSimInputsSchema,
  name: z.string().max(80).default("Scenario"),
  projectId: z.string().nullable().optional(),
});

// A persona plus the GoI region (zone) it belongs to, so a launch can be scoped
// to one ring of the country.
type ScopedPersona = LaunchPersona & { region: string };

// Load the run's frozen personas in the shape the engine needs, each tagged with
// its region. `regions` is the sorted set of regions present (for the picker).
async function loadPersonas(runId: string): Promise<{
  personas: ScopedPersona[];
  currency: string;
  regions: string[];
}> {
  const rows = await prisma.persona.findMany({
    where: { cohort: { runId } },
    select: {
      intent: true,
      wtp: true,
      wtpCurrency: true,
      priceSensitivity: true,
      channelPref: true,
      platforms: true,
      objection: true,
      age: true,
      gender: true,
      cohort: { select: { segment: true, locality: true, country: true } },
    },
  });
  const personas: ScopedPersona[] = rows.map((p) => ({
    intent: p.intent,
    wtp: p.wtp,
    priceSensitivity: p.priceSensitivity,
    segment: p.cohort.segment,
    channelPref: p.channelPref,
    platforms: safeJsonArray(p.platforms),
    objection: p.objection,
    age: p.age,
    gender: p.gender,
    locality: p.cohort.locality,
    country: p.cohort.country,
    region: regionForLocality(p.cohort.locality, p.cohort.country)?.zone ?? "Other",
  }));
  const regions = Array.from(new Set(personas.map((p) => p.region))).sort();
  return {
    personas,
    currency: dominantCurrency(rows.map((p) => p.wtpCurrency)) ?? "INR",
    regions,
  };
}

// Restrict the audience to a region and report its share of the whole run, so we
// can scale the (global) reachable-prospects market down to the regional slice.
function scopeToRegion(
  all: ScopedPersona[],
  region: string | null
): { personas: ScopedPersona[]; share: number } {
  if (!region) return { personas: all, share: 1 };
  const personas = all.filter((p) => p.region === region);
  const share = all.length > 0 ? personas.length / all.length : 0;
  return { personas, share };
}

// Each region's share of the whole audience (by persona count) — surfaced so the
// UI can show "this run uses ~X% of your budget" for a regional scenario.
function regionSharesOf(all: ScopedPersona[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (all.length === 0) return out;
  for (const p of all) out[p.region] = (out[p.region] ?? 0) + 1;
  for (const k of Object.keys(out)) out[k] = out[k] / all.length;
  return out;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [rows, personaData] = await Promise.all([
    prisma.launchSimulation.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
    }),
    loadPersonas(run.id),
  ]);
  const { personas, currency, regions } = personaData;

  // Prefill suggestions from the saved financial model, if the founder built one.
  const model = run.projectId ? await getFinancialModel(run.projectId) : null;
  const baseTier =
    model?.priceTiers.find((t) => t.label) ?? model?.priceTiers[0] ?? null;
  const reachableProspectsPerMonth =
    model?.marketSizing.reachableProspectsPerMonth.value ?? null;
  const blendedCac = model?.unitEconomics.blendedCac.value ?? null;
  const suggestedBusinessModel = inferLaunchBusinessModel(run);
  const priors = await benchmarkPriorsForRun(run, suggestedBusinessModel, personas);
  const defaults = {
    currency: model?.currency ?? currency,
    suggestedBusinessModel,
    suggestedCostPrice: model
      ? model.costStructure.reduce((s, c) => s + c.amount.value, 0)
      : null,
    suggestedSalePrice: baseTier?.price.value ?? null,
    suggestedAdSpendPerMonth: suggestAdSpendPerMonth(
      blendedCac,
      reachableProspectsPerMonth,
      model?.breakEven.fixedCostsPerMonth.value ?? null,
      baseTier?.price.value ?? null
    ),
    reachableProspectsPerMonth,
    // Regions present in this run's audience — powers the launch-sim scope picker.
    availableRegions: regions,
    // Each region's share of the audience (proportional-slice budget hint).
    regionShares: regionSharesOf(personas),
    fixedCostsPerMonth: model?.breakEven.fixedCostsPerMonth.value ?? null,
    // Real category × geo priors (INR). Surfaced so the form prefills CPM and
    // shipping with market numbers instead of the universal 250 / 120 defaults.
    benchmarks: {
      suggestedCpm: priors.cpmInr.mid,
      suggestedShippingPerOrder: priors.shippingPerOrderInr,
      returnRatePct: priors.returnRatePct.mid,
      repeatRatePct: priors.repeatRatePct.mid,
      codSharePct: priors.codSharePct,
      peakMonths: priors.peakMonths,
      confidence: priors.confidence,
      sources: priors.sources,
    },
  };

  const scenarios: LaunchSimRecord[] = rows.map((r) => {
    const inputs = applyBenchmarkRefund(
      applyDefaultBusinessModel(
        applyLegacyAcquisitionDefault(
          LaunchSimInputsSchema.parse(r.inputs),
          defaults.suggestedAdSpendPerMonth
        ),
        suggestedBusinessModel
      ),
      priors
    );
    // Scope to the scenario's region (null → whole audience) and scale the
    // reachable market to that region's share, so a regional run is self-contained.
    const scoped = scopeToRegion(personas, inputs.region);
    return {
      id: r.id,
      runId: r.runId,
      name: r.name,
      inputs,
      result:
        scoped.personas.length > 0
          ? simulateLaunch(scoped.personas, inputs, {
              reachableProspectsPerMonth,
              // Proportional regional slice: the engine scales pool + ad spend +
              // fixed costs by this share, so regions reconcile with the whole.
              audienceShare: scoped.share,
              // Fall back to the benchmark CAC so paid acquisition is ALWAYS
              // capped — without it the engine converts most of the reachable
              // pool and revenue/orders blow up.
              blendedCac: blendedCac ?? priors.cacInr.mid,
              // Benchmark seasonality curve; applied only if the scenario has a
              // stored launchStartMonth (so re-simulation stays deterministic).
              seasonality: priors.seasonality,
            })
          : (r.result as unknown as LaunchSimRecord["result"]),
      followUp: LaunchSimRecordSchema.shape.followUp.parse(r.followUp),
      createdAt: r.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ scenarios, defaults });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for a launch simulation yet` },
      { status: 409 }
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const { personas } = await loadPersonas(run.id);
  if (personas.length === 0) {
    return NextResponse.json(
      { error: "no simulated personas to run a launch against" },
      { status: 409 }
    );
  }
  // Scope to the requested region (null → whole audience). Done before the sim so
  // a regional scenario only ever sees that ring's personas.
  const requestedRegion = body.data.inputs.region ?? null;
  const scoped = scopeToRegion(personas, requestedRegion);
  if (scoped.personas.length === 0) {
    return NextResponse.json(
      { error: `no personas in region "${requestedRegion}" to run a launch against` },
      { status: 409 }
    );
  }

  // Reach ceiling default comes from the founder's financial model when present.
  const model = run.projectId ? await getFinancialModel(run.projectId) : null;
  const reachableProspectsPerMonth =
    model?.marketSizing.reachableProspectsPerMonth.value ?? null;
  const blendedCac = model?.unitEconomics.blendedCac.value ?? null;
  const suggestedBusinessModel = inferLaunchBusinessModel(run);
  const priors = await benchmarkPriorsForRun(run, suggestedBusinessModel, personas);

  // Capture the attention/hype momentum once (frozen into the scenario), and
  // pin the launch month so seasonality applies deterministically on re-sim.
  const momentumPct = await getAttentionMomentumPct(
    productTermForRun(run.clientProfile)
  ).catch(() => 0);
  const nowMonth = new Date().getMonth() + 1;

  try {
    const inputs = applyDemandDefaults(
      applyBenchmarkRefund(
        applyDefaultBusinessModel(body.data.inputs, suggestedBusinessModel),
        priors
      ),
      momentumPct,
      nowMonth
    );
    const result = simulateLaunch(scoped.personas, inputs, {
      reachableProspectsPerMonth,
      audienceShare: scoped.share,
      // Benchmark CAC fallback → paid acquisition is always capped (see GET).
      blendedCac: blendedCac ?? priors.cacInr.mid,
      seasonality: priors.seasonality,
    });

    const row = await prisma.launchSimulation.create({
      data: {
        runId: run.id,
        projectId: run.projectId ?? body.data.projectId ?? null,
        name: body.data.name,
        inputs: inputs as unknown as object,
        result: result as unknown as object,
      },
    });

    const record: LaunchSimRecord = {
      id: row.id,
      runId: row.runId,
      name: row.name,
      inputs,
      result,
      followUp: [],
      createdAt: row.createdAt.toISOString(),
    };
    return NextResponse.json(record);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "launch simulation failed" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const scenarioId = new URL(req.url).searchParams.get("scenarioId");
  if (!scenarioId) {
    return NextResponse.json({ error: "scenarioId required" }, { status: 400 });
  }
  await prisma.launchSimulation.deleteMany({
    where: { id: scenarioId, runId: params.id },
  });
  return NextResponse.json({ ok: true });
}

// Resolve benchmark priors for a run: category from its profile (fall back to
// the inferred business model) × geo tiers from the actual simulated localities.
async function benchmarkPriorsForRun(
  run: { clientProfile: string; projectId: string | null },
  businessModel: LaunchBusinessModel,
  personas: { locality: string; country: string }[]
): Promise<BenchmarkPriors> {
  let category;
  try {
    const parsed = ClientProfileSchema.safeParse(
      JSON.parse(run.clientProfile || "{}")
    );
    category = parsed.success
      ? categoryKeyFromProfile(parsed.data)
      : categoryKeyFromBusinessModel(businessModel);
  } catch {
    category = categoryKeyFromBusinessModel(businessModel);
  }
  if (category === "general")
    category = categoryKeyFromBusinessModel(businessModel);
  const geoTiers = geoTiersFromLocalities(
    personas.map((p) => ({ name: p.locality, country: p.country }))
  );
  // Country dimension: a US (or any non-India) audience gets US/USD benchmarks
  // instead of India/INR — matching the planner-set sim currency.
  const market = marketFromCountries(personas.map((p) => p.country));
  const priors = resolveBenchmarks(category, geoTiers, market);

  // Apply web-sourced overrides for this market × category when present, so the
  // priors reflect current, cited figures instead of the curated estimate.
  if (run.projectId) {
    try {
      const datum = (await getMarketData(run.projectId))[`${market}:${category}`];
      if (datum) return applyMarketDatum(priors, datum);
    } catch {
      // sourcing is best-effort — keep the curated priors on any failure
    }
  }
  return priors;
}

// Overlay web-sourced figures onto the curated priors (only the fields the
// search actually found), upgrading provenance + confidence and citing sources.
function applyMarketDatum(p: BenchmarkPriors, d: MarketDatum): BenchmarkPriors {
  const next: BenchmarkPriors = { ...p };
  if (d.aov) next.aovInr = d.aov;
  if (d.grossMarginPct) {
    next.grossMarginPct = d.grossMarginPct;
    next.grossMarginProvenance = "reported";
  }
  if (d.landingCvrPct) next.landingCvrPct = d.landingCvrPct;
  if (d.repeatRatePct) next.repeatRatePct = d.repeatRatePct;
  if (d.returnRatePct) next.returnRatePct = d.returnRatePct;
  if (d.cac) next.cacInr = d.cac;
  if (d.cpmMeta) {
    next.cpmInr = d.cpmMeta;
    next.cpmByChannelInr = { ...p.cpmByChannelInr, meta: d.cpmMeta };
  }
  next.sources = [...p.sources, ...(d.sources ?? [])];
  next.notes = [
    ...p.notes,
    `Web-sourced ${d.country || d.market} ${d.category} figures applied${
      d.asOf ? ` (${d.asOf.slice(0, 10)})` : ""
    }${d.notes ? `: ${d.notes}` : ""}.`,
  ];
  if (d.sources?.length) next.confidence = Math.min(0.85, p.confidence + 0.15);
  return next;
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function dominantCurrency(codes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) ((best = c), (bestN = n));
  return best;
}

function suggestAdSpendPerMonth(
  blendedCac: number | null,
  reachableProspectsPerMonth: number | null,
  fixedCostsPerMonth: number | null,
  salePrice: number | null
): number | null {
  const candidates: number[] = [];
  if (
    blendedCac != null &&
    blendedCac > 0 &&
    reachableProspectsPerMonth != null &&
    reachableProspectsPerMonth > 0
  ) {
    const targetCustomers = Math.min(
      250,
      Math.max(20, reachableProspectsPerMonth * 0.01)
    );
    candidates.push(blendedCac * targetCustomers);
  }
  if (fixedCostsPerMonth != null && fixedCostsPerMonth > 0) {
    candidates.push(fixedCostsPerMonth * 0.15);
  }
  if (salePrice != null && salePrice > 0) {
    candidates.push(salePrice * 20);
  }
  const suggested = candidates.find((n) => Number.isFinite(n) && n > 0);
  return suggested == null ? null : Math.round(suggested);
}

function applyLegacyAcquisitionDefault(
  inputs: LaunchSimInputs,
  suggestedAdSpendPerMonth: number | null
): LaunchSimInputs {
  if (
    inputs.adSpendPerMonth === 0 &&
    inputs.organicReachPerStep === 0 &&
    inputs.initialInventoryUnits == null &&
    suggestedAdSpendPerMonth != null &&
    suggestedAdSpendPerMonth > 0
  ) {
    return { ...inputs, adSpendPerMonth: suggestedAdSpendPerMonth };
  }
  return inputs;
}

function applyDefaultBusinessModel(
  inputs: LaunchSimInputs,
  businessModel: LaunchBusinessModel
): LaunchSimInputs {
  if (inputs.businessModel !== "generic") return inputs;
  return { ...inputs, businessModel, channels: [] };
}

// Anchor the launch-sim refund curve to the benchmark layer's returns/RTO rate
// unless the founder set an explicit target. Provenance-tracked, deterministic.
function applyBenchmarkRefund(
  inputs: LaunchSimInputs,
  priors: BenchmarkPriors
): LaunchSimInputs {
  if (inputs.targetRefundRatePct != null) return inputs;
  return { ...inputs, targetRefundRatePct: priors.returnRatePct.mid };
}

// Freeze the demand tilts into a NEW scenario: launch start month (defaults to
// the current calendar month) drives benchmark seasonality, and the attention/
// hype momentum % is captured once. Frozen so GET re-simulates identically.
function applyDemandDefaults(
  inputs: LaunchSimInputs,
  momentumPct: number,
  nowMonth: number
): LaunchSimInputs {
  return {
    ...inputs,
    launchStartMonth: inputs.launchStartMonth ?? nowMonth,
    demandMomentumPct:
      inputs.demandMomentumPct !== 0 ? inputs.demandMomentumPct : momentumPct,
  };
}

function productTermForRun(clientProfile: string): string {
  try {
    const p = ClientProfileSchema.safeParse(JSON.parse(clientProfile || "{}"));
    return p.success ? p.data.product || p.data.category || "" : "";
  } catch {
    return "";
  }
}

function inferLaunchBusinessModel(run: {
  brief: string;
  clientProfile: string;
}): LaunchBusinessModel {
  let rawProfile: unknown = {};
  try {
    rawProfile = JSON.parse(run.clientProfile || "{}");
  } catch {
    rawProfile = {};
  }
  const parsed = ClientProfileSchema.safeParse(
    rawProfile
  );
  const profile = parsed.success ? parsed.data : null;
  const text = [
    run.brief,
    profile?.product,
    profile?.category,
    profile?.targetAudience,
    profile?.priceBand,
    profile?.goal,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hasAny(text, ["marketplace", "two-sided", "two sided", "sellers", "buyers and sellers", "aggregator"])) {
    return "marketplace";
  }
  if (hasAny(text, ["saas", "software", "app", "subscription platform", "b2b platform", "ai tool", "dashboard", "crm"])) {
    return "saas";
  }
  if (hasAny(text, ["service", "agency", "consulting", "consultancy", "clinic", "salon", "studio", "training", "course"])) {
    return "services";
  }
  if (hasAny(text, ["furniture", "sofa", "chair", "table", "bed", "mattress", "home decor", "interior", "cabinet", "wardrobe"])) {
    return "furniture";
  }
  if (hasAny(text, ["clothing", "apparel", "fashion", "garment", "shirt", "shirts", "dress", "dresses", "wear", "westernwear", "footwear", "shoes", "accessories", "jewellery", "jewelry"])) {
    return "apparel";
  }
  if (hasAny(text, ["food", "beverage", "drink", "snack", "supplement", "skincare", "cosmetic", "beauty", "wellness", "grocery", "coffee", "tea", "protein"])) {
    return "consumable";
  }
  return "generic";
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

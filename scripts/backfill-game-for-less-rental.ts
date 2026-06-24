// Backfill Game For Less launch scenarios from the generic services model to
// the rental/asset-utilisation model, then recompute persisted results.
//
// Run with env loaded, for example:
//   set -a; source .env; set +a; npx tsx scripts/backfill-game-for-less-rental.ts

import { prisma } from "../lib/db";
import { simulateLaunch, type LaunchPersona } from "../lib/launchSim";
import {
  ClientProfileSchema,
  LaunchSimInputsSchema,
  type LaunchBusinessModel,
  type LaunchSimInputs,
  type MarketDatum,
} from "../lib/schema";
import {
  categoryKeyFromBusinessModel,
  categoryKeyFromProfile,
  geoTiersFromLocalities,
  marketFromCountries,
  resolveBenchmarks,
  type BenchmarkPriors,
} from "../lib/datasources/benchmarks";
import { regionForLocality } from "../lib/datasources/politicalGeography";
import { getFinancialModel, getMarketData } from "../lib/store";

type ScopedPersona = LaunchPersona & { region: string };

const projectName = process.argv.includes("--all")
  ? null
  : process.env.GFL_PROJECT_NAME || "Game For Less 2";
const dryRun = process.argv.includes("--dry-run");

const BASE_ANNUAL_REPEAT_BY_SEGMENT: Record<string, number> = {
  budget: 0.35,
  middle: 0.45,
  affluent: 0.6,
  luxury: 0.75,
};

const BUSINESS_REPEAT_MULT: Record<LaunchBusinessModel, number> = {
  generic: 1,
  apparel: 1.2,
  furniture: 0.45,
  consumable: 2.2,
  saas: 3,
  services: 0.9,
  rental: 1.1,
  subscription: 2.5,
  booking: 0.9,
  usage_based: 2.4,
  lead_gen: 0.25,
  project_services: 0.35,
  marketplace: 1.1,
};

async function main() {
  const project = await prisma.project.findFirst({
    where: projectName
      ? { name: { equals: projectName, mode: "insensitive" } }
      : { name: { contains: "Game For Less", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      runs: {
        where: { status: { in: ["complete", "capped"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          projectId: true,
          clientProfile: true,
          launchSims: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              inputs: true,
              result: true,
              projectId: true,
            },
          },
        },
      },
    },
  });

  if (!project) throw new Error("Game For Less project not found");

  const updates: {
    id: string;
    name: string;
    ordersBefore: number;
    ordersAfter: number;
    netBefore: number;
    netAfter: number;
    fixedAfter: number;
    capacityMisses: number;
  }[] = [];

  for (const run of project.runs) {
    const personas = await loadPersonas(run.id);
    if (personas.length === 0) continue;

    const model = run.projectId
      ? await getFinancialModel(run.projectId, run.id)
      : null;
    const reachableProspectsPerMonth =
      model?.marketSizing.reachableProspectsPerMonth.value ?? null;
    const priors = await benchmarkPriorsForRun(
      run,
      "rental",
      personas.map((p) => ({ locality: p.locality, country: p.country }))
    );

    for (const sim of run.launchSims) {
      const existing = LaunchSimInputsSchema.parse(sim.inputs);
      if (existing.businessModel !== "services") continue;

      const rentalInputs = applyBenchmarkRepeat(
        applyBenchmarkRefund(
          LaunchSimInputsSchema.parse({
            ...existing,
            businessModel: "rental",
            channels: [],
            initialInventoryUnits: null,
            minOrderQtyUnits: null,
            launchInvestmentReserve:
              existing.launchInvestmentReserve == null
                ? 0
                : existing.launchInvestmentReserve,
            rentalAssetCount: existing.rentalAssetCount || 3,
            rentalAssetCost: existing.rentalAssetCost ?? 0,
            rentalRentableDaysPerMonth:
              existing.rentalRentableDaysPerMonth || 24,
            rentalAvgDurationDays: existing.rentalAvgDurationDays || 1,
            rentalMaintenancePerOrder:
              existing.rentalMaintenancePerOrder ?? 0,
            rentalDamageLossPct: existing.rentalDamageLossPct ?? 0,
            rentalDepositAmount: existing.rentalDepositAmount ?? 0,
          }),
          priors
        ),
        priors,
        personas
      );

      const scoped = scopeToRegion(personas, rentalInputs.region);
      if (scoped.personas.length === 0) continue;
      const result = simulateLaunch(scoped.personas, rentalInputs, {
        reachableProspectsPerMonth,
        audienceShare: scoped.share,
        blendedCac:
          rentalInputs.paidCac && rentalInputs.paidCac > 0
            ? rentalInputs.paidCac
            : priors.cacInr.mid,
        fixedCostsPerMonthFloor: 0,
        launchInvestmentFloor: 0,
        seasonality: priors.seasonality,
      });

      const oldResult = sim.result as {
        summary?: { totalOrders?: number; netProfit?: number };
      };
      updates.push({
        id: sim.id,
        name: sim.name,
        ordersBefore: oldResult.summary?.totalOrders ?? 0,
        ordersAfter: result.summary.totalOrders,
        netBefore: oldResult.summary?.netProfit ?? 0,
        netAfter: result.summary.netProfit,
        fixedAfter: result.summary.totalFixedCosts,
        capacityMisses: result.summary.stockoutUnits,
      });

      if (!dryRun) {
        await prisma.launchSimulation.update({
          where: { id: sim.id },
          data: {
            inputs: rentalInputs as unknown as object,
            result: result as unknown as object,
            projectId: sim.projectId ?? run.projectId ?? project.id,
          },
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        project: project.name,
        dryRun,
        updated: dryRun ? 0 : updates.length,
        candidates: updates.length,
        scenarios: updates,
      },
      null,
      2
    )
  );
}

async function loadPersonas(runId: string): Promise<ScopedPersona[]> {
  const rows = await prisma.persona.findMany({
    where: { cohort: { runId } },
    select: {
      intent: true,
      wtp: true,
      priceSensitivity: true,
      channelPref: true,
      platforms: true,
      objection: true,
      age: true,
      gender: true,
      cohort: { select: { segment: true, locality: true, country: true } },
    },
  });
  return rows.map((p) => ({
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
    region:
      regionForLocality(p.cohort.locality, p.cohort.country)?.zone ?? "Other",
  }));
}

function scopeToRegion(
  all: ScopedPersona[],
  region: string | null
): { personas: ScopedPersona[]; share: number } {
  if (!region) return { personas: all, share: 1 };
  const personas = all.filter((p) => p.region === region);
  return {
    personas,
    share: all.length > 0 ? personas.length / all.length : 0,
  };
}

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
  if (category === "general") {
    category = categoryKeyFromBusinessModel(businessModel);
  }

  const geoTiers = geoTiersFromLocalities(
    personas.map((p) => ({ name: p.locality, country: p.country }))
  );
  const market = marketFromCountries(personas.map((p) => p.country));
  const priors = resolveBenchmarks(category, geoTiers, market);

  if (!run.projectId) return priors;
  try {
    const datum = (await getMarketData(run.projectId))[`${market}:${category}`];
    return datum ? applyMarketDatum(priors, datum) : priors;
  } catch {
    return priors;
  }
}

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
  if (d.modelInputs?.paidCac) next.cacInr = d.modelInputs.paidCac;
  next.modelInputs = d.modelInputs ?? {};
  next.sources = [...p.sources, ...(d.sources ?? [])];
  return next;
}

function applyBenchmarkRefund(
  inputs: LaunchSimInputs,
  priors: BenchmarkPriors
): LaunchSimInputs {
  if (inputs.targetRefundRatePct != null) return inputs;
  return { ...inputs, targetRefundRatePct: priors.returnRatePct.mid };
}

function applyBenchmarkRepeat(
  inputs: LaunchSimInputs,
  priors: BenchmarkPriors,
  personas: { segment: string | null }[]
): LaunchSimInputs {
  if (inputs.repeatRateMult !== 1 || personas.length === 0) return inputs;

  const baseAnnual =
    personas.reduce((s, p) => {
      const seg = String(p.segment ?? "middle").toLowerCase();
      return s + (BASE_ANNUAL_REPEAT_BY_SEGMENT[seg] ?? 0.45);
    }, 0) / personas.length;
  const preset = BUSINESS_REPEAT_MULT[inputs.businessModel] ?? 1;
  const targetAnnual = Math.max(0, priors.repeatRatePct.mid / 100);
  const denom = baseAnnual * preset;
  if (denom <= 0 || targetAnnual <= 0) return inputs;

  return {
    ...inputs,
    repeatRateMult:
      Math.round(Math.max(0.05, Math.min(3, targetAnnual / denom)) * 100) /
      100,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

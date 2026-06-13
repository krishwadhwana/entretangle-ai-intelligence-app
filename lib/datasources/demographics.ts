import { z } from "zod";
import type { PlannerV2Output, Segment } from "../schema";

// ---------------------------------------------------------------------------
// Real-demographics calibration (SPEC-V2 §1A "pull from real data", option A).
// Before the audience is simulated, pull real population + income-tier shares
// for the planner's localities and reweight the cohort matrix so cohort SIZES
// mirror the real market (a populous city with a big middle class gets more
// simulated agents than a small luxury enclave). Sources are kept for display.
//
// The numbers come web-grounded in real mode (see callDemographics in llm.ts);
// in mock mode a deterministic fixture stands in. If the lookup fails the
// planner's own weights are used unchanged — calibration is best-effort.
// ---------------------------------------------------------------------------

export const LocalityDemographicsSchema = z.object({
  locality: z.string(),
  country: z.string(),
  population: z.number().nonnegative().nullable().default(null),
  // Share of the locality's adult population in each income tier (sum ~1).
  incomeTierShares: z.object({
    budget: z.number().min(0).max(1),
    middle: z.number().min(0).max(1),
    affluent: z.number().min(0).max(1),
    luxury: z.number().min(0).max(1),
  }),
  sources: z.array(z.string()).default([]),
});
export type LocalityDemographics = z.infer<typeof LocalityDemographicsSchema>;

export const DemographicsOutputSchema = z.object({
  localities: z.array(LocalityDemographicsSchema),
});
export type DemographicsOutput = z.infer<typeof DemographicsOutputSchema>;

export function demographicsUser(
  localities: PlannerV2Output["cohortPlan"]["localities"]
): string {
  return JSON.stringify(
    localities.map((l) => ({ name: l.name, country: l.country })),
    null,
    2
  );
}

export const DEMOGRAPHICS_SYSTEM = `You are a demographics data desk. For each locality given, return REAL,
current best-estimate figures, grounded in published statistics (census,
government data, World Bank, reputable reports). For each locality output:
- "population": adult population of the city/metro (number), or null if truly
  unknown. Use the metro figure when the locality is a metro.
- "incomeTierShares": the share (0–1, summing to ~1) of that adult population
  in four tiers: budget (lower-income), middle, affluent (upper-middle/HNW
  adjacent), luxury (top wealth). Base this on real income distribution.
- "sources": URLs or named sources you used (prefer real URLs).
Be realistic: in most cities budget+middle dominate and luxury is a few
percent. Do not fabricate precise populations — round sensibly.
Output JSON only, no markdown fences:
{"localities":[{"locality":"...","country":"...","population":0,
"incomeTierShares":{"budget":0,"middle":0,"affluent":0,"luxury":0},
"sources":["..."]}]}`;

/** Deterministic mock demographics — plausible tier shares per locality. */
export function mockDemographics(
  localities: PlannerV2Output["cohortPlan"]["localities"]
): DemographicsOutput {
  // Rough, defensible adult-population + tier-share priors by city.
  const known: Record<
    string,
    { pop: number; tiers: [number, number, number, number] }
  > = {
    Mumbai: { pop: 16_000_000, tiers: [0.45, 0.4, 0.13, 0.02] },
    "Delhi NCR": { pop: 22_000_000, tiers: [0.43, 0.41, 0.14, 0.02] },
    Bangalore: { pop: 9_000_000, tiers: [0.35, 0.45, 0.18, 0.02] },
    Dubai: { pop: 2_800_000, tiers: [0.3, 0.4, 0.22, 0.08] },
    London: { pop: 7_000_000, tiers: [0.28, 0.42, 0.24, 0.06] },
  };
  return {
    localities: localities.map((l) => {
      const k = known[l.name];
      const tiers = k?.tiers ?? [0.4, 0.4, 0.17, 0.03];
      const pop = k?.pop ?? 3_000_000;
      return {
        locality: l.name,
        country: l.country,
        population: pop,
        incomeTierShares: {
          budget: tiers[0],
          middle: tiers[1],
          affluent: tiers[2],
          luxury: tiers[3],
        },
        sources: ["mock:census-priors"],
      };
    }),
  };
}

/**
 * Reweight the planner's cohort matrix by real demographics:
 *   calibratedWeight = plannerWeight × localityPopShare × segmentTierShare
 * Cohorts whose locality has no demographics keep their planner weight.
 * Role weighting (business structure) is left to the planner. Weights are
 * renormalized to sum 100 so downstream size distribution is unchanged in
 * total — only the SHAPE shifts toward real demographics.
 */
export function calibrateCohortPlan(
  cohortPlan: PlannerV2Output["cohortPlan"],
  demographics: DemographicsOutput
): {
  cohortPlan: PlannerV2Output["cohortPlan"];
  changed: boolean;
} {
  const byLocality = new Map(
    demographics.localities.map((d) => [d.locality, d])
  );
  const totalPop =
    demographics.localities.reduce((s, d) => s + (d.population ?? 0), 0) || 0;

  let changed = false;
  const raw = cohortPlan.cohorts.map((c) => {
    const demo = byLocality.get(c.locality);
    if (!demo || totalPop <= 0) return { c, w: c.weightPct };
    const popShare = (demo.population ?? 0) / totalPop;
    const tierShare = demo.incomeTierShares[c.segment as Segment] ?? 0.25;
    changed = true;
    // Scale by population share (×localityCount keeps magnitudes sane) and tier.
    const factor =
      popShare * demographics.localities.length * (tierShare * 4);
    return { c, w: Math.max(0.0001, c.weightPct * factor) };
  });

  if (!changed) return { cohortPlan, changed: false };

  const total = raw.reduce((s, r) => s + r.w, 0) || 1;
  return {
    cohortPlan: {
      ...cohortPlan,
      cohorts: raw.map((r) => ({
        ...r.c,
        weightPct: Math.round((r.w / total) * 1000) / 10,
      })),
    },
    changed: true,
  };
}

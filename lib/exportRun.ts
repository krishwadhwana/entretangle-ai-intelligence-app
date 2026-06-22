import { prisma } from "./db";
import { getFinancialModel } from "./store";
import {
  AudienceAggregateSchema,
  ClientProfileSchema,
  type AudienceAggregate,
  type ClientProfile,
  type FinancialModel,
} from "./schema";

// ---------------------------------------------------------------------------
// Cross-border export runs (Phase 1–2). An export run is a DEPENDENT run: it
// is born from a completed home-market (e.g. India) run and tests the same
// product in a destination market (e.g. the US). The home run's PROVEN results
// — concluded research, the simulated audience's intent/WTP by segment, the
// launch trajectory — are carried forward as PRIORS, so the destination run
// reasons from "what actually happened at home" instead of from scratch.
//
// This module only LOADS + FORMATS that prior. The destination market's own
// demographics and behaviour still dominate the output (the prior is an anchor,
// not the answer) — see formatExportTransferContext.
// ---------------------------------------------------------------------------

export type ExportContext = {
  parentRunId: string;
  /** The home-market venture profile (product, category, …). */
  homeProfile: ClientProfile;
  /** Currency the home audience priced WTP in (e.g. "INR"). */
  homeCurrency: string;
  /** Top concluded findings from the home run, highest-confidence first. */
  conclusions: { claim: string; value: string; confidence: number }[];
  /** The home run's simulated-audience rollup, if it produced one. */
  aggregate: AudienceAggregate | null;
  /** Headline figures from the home run's most recent launch simulation. */
  launch: {
    currency: string;
    totalOrders: number;
    unitsSold: number;
    netProfit: number;
    blendedCac: number;
    grossMarginPct: number;
    breakEvenLabel: string | null;
  } | null;
  /** The home venture's financial model, if the founder built one. */
  financial: FinancialModel | null;
};

/**
 * Load everything an export run needs to carry its parent home-market run
 * forward. Best-effort: any missing piece (no audience, no launch sim, no
 * financials) is simply null — never throws. Returns null only when the parent
 * run itself can't be loaded.
 */
export async function loadExportContext(
  parentRunId: string
): Promise<ExportContext | null> {
  const parent = await prisma.run
    .findUnique({ where: { id: parentRunId } })
    .catch(() => null);
  if (!parent) return null;

  let homeProfile: ClientProfile;
  try {
    homeProfile = ClientProfileSchema.parse(JSON.parse(parent.clientProfile));
  } catch {
    return null;
  }

  const [concluded, aggEvent, latestLaunch, samplePersona] = await Promise.all([
    prisma.block.findMany({
      where: { runId: parentRunId, state: "concluded" },
      include: { conclusions: true },
    }),
    prisma.runEvent.findFirst({
      where: { runId: parentRunId, type: "audience_aggregated" },
      orderBy: { seq: "desc" },
    }),
    prisma.launchSimulation.findFirst({
      where: { runId: parentRunId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.persona.findFirst({
      where: { cohort: { runId: parentRunId } },
      select: { wtpCurrency: true },
    }),
  ]);

  // Top conclusions across all concluded blocks, highest-confidence first.
  const conclusions = concluded
    .flatMap((b) => b.conclusions)
    .map((c) => ({ claim: c.claim, value: c.value, confidence: c.confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 16);

  let aggregate: AudienceAggregate | null = null;
  if (aggEvent) {
    const parsed = AudienceAggregateSchema.safeParse(
      JSON.parse(aggEvent.payload).aggregate
    );
    aggregate = parsed.success ? parsed.data : null;
  }

  let launch: ExportContext["launch"] = null;
  if (latestLaunch) {
    const res = latestLaunch.result as {
      summary?: {
        totalOrders?: number;
        unitsSold?: number;
        netProfit?: number;
        blendedCac?: number;
        grossMarginPct?: number;
        breakEvenLabel?: string | null;
      };
      resolvedInputs?: { currency?: string };
    };
    const s = res.summary;
    if (s) {
      launch = {
        currency: res.resolvedInputs?.currency ?? samplePersona?.wtpCurrency ?? "INR",
        totalOrders: s.totalOrders ?? 0,
        unitsSold: s.unitsSold ?? 0,
        netProfit: s.netProfit ?? 0,
        blendedCac: s.blendedCac ?? 0,
        grossMarginPct: s.grossMarginPct ?? 0,
        breakEvenLabel: s.breakEvenLabel ?? null,
      };
    }
  }

  const financial = parent.projectId
    ? await getFinancialModel(parent.projectId).catch(() => null)
    : null;

  return {
    parentRunId,
    homeProfile,
    homeCurrency: samplePersona?.wtpCurrency ?? "INR",
    conclusions,
    aggregate,
    launch,
    financial,
  };
}

function homeMarketLabel(currency: string): string {
  return currency === "INR" ? "India (home market)" : `home market (${currency})`;
}

/**
 * A labelled ground-truth block for the export run's PLANNER and RESEARCH desks.
 * Tells them the product is already validated at home and to plan the
 * destination-market study as a *transfer* question (will it cross the border?),
 * grounded in the home results.
 */
export function formatExportPriorGroundTruth(
  ctx: ExportContext,
  targetMarket: string
): string {
  const home = homeMarketLabel(ctx.homeCurrency);
  const lines: string[] = [
    `CROSS-BORDER EXPORT PRIOR — this is a DEPENDENT run. The same product was`,
    `already simulated in ${home}; below are its PROVEN results. Plan this study as`,
    `an EXPORT-TRANSFER question: how does a product with this home performance fare`,
    `in ${targetMarket}? Anchor to these priors, but the ${targetMarket} market`,
    `(demand, competition, price expectations, channels, import economics) governs`,
    `the answer — call out where the destination market diverges from home.`,
    `Product: ${ctx.homeProfile.product}`,
  ];

  if (ctx.aggregate) {
    const a = ctx.aggregate;
    lines.push(
      `Home audience: ${a.totalPersonas} simulated buyers across ${a.totalCohorts} cohorts.`
    );
    const segs = Object.entries(a.bySegment)
      .map(
        ([seg, s]) =>
          `${seg} (n=${s.n}): intent ${(s.meanIntent * 100).toFixed(0)}%, median WTP ${ctx.homeCurrency} ${Math.round(s.wtpP50)}`
      )
      .join("; ");
    if (segs) lines.push(`Home WTP/intent by segment — ${segs}.`);
    if (a.channelShare.length)
      lines.push(
        `Top home channels: ${a.channelShare.slice(0, 4).map((c) => `${c.name} ${(c.share * 100).toFixed(0)}%`).join(", ")}.`
      );
    if (a.topObjections.length)
      lines.push(
        `Top home objections: ${a.topObjections.slice(0, 4).map((o) => o.text).join("; ")}.`
      );
  }

  if (ctx.launch) {
    const l = ctx.launch;
    lines.push(
      `Home launch sim: ${l.totalOrders} orders, ${l.unitsSold} units, ${l.grossMarginPct.toFixed(0)}% gross margin, blended CAC ${l.currency} ${Math.round(l.blendedCac)}, net ${l.currency} ${Math.round(l.netProfit)}${l.breakEvenLabel ? `, break-even ${l.breakEvenLabel}` : ""}.`
    );
  }

  if (ctx.conclusions.length) {
    lines.push(`Key proven findings from the home run:`);
    for (const c of ctx.conclusions.slice(0, 10))
      lines.push(`- ${c.claim}: ${c.value} (conf ${(c.confidence * 100).toFixed(0)}%)`);
  }

  lines.push(`END CROSS-BORDER EXPORT PRIOR.`);
  return lines.join("\n");
}

/**
 * The per-run additionalContext for the export run's COHORT SIMULATION. This is
 * the Phase-2 "prior transfer": each destination-market persona is told how the
 * analogous home-market segment behaved, then instructed that its OWN real
 * demographics and market behaviour dominate — so the home signal anchors the
 * draw without overriding genuine US/destination differences.
 */
export function formatExportTransferContext(
  ctx: ExportContext,
  targetMarket: string
): string {
  const home = homeMarketLabel(ctx.homeCurrency);
  const parts: string[] = [
    `CROSS-BORDER TRANSFER PRIOR: this exact product was validated in ${home}. You`,
    `are now simulating its reception in ${targetMarket}. Use the home signal below`,
    `as a PRIOR for product appeal, then let THIS persona's real ${targetMarket}`,
    `demographics, income, price expectations and shopping behaviour DOMINATE —`,
    `adjust intent and willingness-to-pay to the destination market (which has`,
    `different prices, competitors and currency), do not copy the home numbers.`,
  ];
  if (ctx.aggregate) {
    const segs = Object.entries(ctx.aggregate.bySegment)
      .map(
        ([seg, s]) =>
          `${seg}: home intent ${(s.meanIntent * 100).toFixed(0)}%, home median WTP ${ctx.homeCurrency} ${Math.round(s.wtpP50)}`
      )
      .join("; ");
    if (segs) parts.push(`Home segment signal — ${segs}.`);
    if (ctx.aggregate.topObjections.length)
      parts.push(
        `Objections seen at home (may or may not transfer): ${ctx.aggregate.topObjections.slice(0, 4).map((o) => o.text).join("; ")}.`
      );
  }
  return parts.join("\n");
}

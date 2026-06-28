// ---------------------------------------------------------------------------
// Plan vs Actual reconciliation — the payoff of integrations.
//
// `buildActuals` reduces the MetricSnapshot fact table (whatever connectors
// landed) into canonical business metrics over a window. `getPredicted` pulls
// the same canonical metrics out of the simulation's own outputs (the latest
// launch simulation, falling back to the financials model). `reconcile` lines
// them up and reports per-metric deltas, so a founder sees exactly where
// reality diverged from the plan — and the deltas can later recalibrate the
// persona priors.
//
// Honesty about comparability: rate/ratio metrics (AOV, refund rate, repeat
// rate, CAC, margin, conversion) compare directly. Volume metrics (orders,
// revenue, ad spend) are normalized to a PER-DAY basis on both sides — actuals
// over the window's days, predictions over the simulated horizon's days — so a
// 90-day window and a 30-day launch sim still compare fairly.
// ---------------------------------------------------------------------------
import { prisma } from "./db";
import { log } from "./log";
import type { LaunchSimResult, FinancialModel } from "./schema";

export type MetricKind = "perDay" | "rate" | "currency" | "ratio";

export type ReconciliationLine = {
  key: string;
  label: string;
  kind: MetricKind;
  predicted: number | null;
  actual: number | null;
  deltaAbs: number | null; // actual − predicted
  deltaPct: number | null; // (actual − predicted) / predicted
  status: "on_track" | "over" | "under" | "no_data";
  unit?: string;
};

export type ReconciliationReport = {
  windowDays: number;
  since: string;
  until: string;
  predictedSource: "launch_sim" | "financials" | "none";
  currency: string;
  lines: ReconciliationLine[];
};

// --- Actuals from the fact table -------------------------------------------
type Canon = {
  orders: number;
  revenue: number;
  units: number;
  refunds: number;
  refundAmount: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  newCustomers: number;
  returningCustomers: number;
  sessions: number;
  cogs: number;
  currency: string;
};

const ZERO: Canon = {
  orders: 0,
  revenue: 0,
  units: 0,
  refunds: 0,
  refundAmount: 0,
  adSpend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  newCustomers: 0,
  returningCustomers: 0,
  sessions: 0,
  cogs: 0,
  currency: "USD",
};

const METRIC_TO_KEY: Record<string, keyof Canon> = {
  orders: "orders",
  revenue: "revenue",
  units: "units",
  refunds: "refunds",
  refund_amount: "refundAmount",
  ad_spend: "adSpend",
  impressions: "impressions",
  clicks: "clicks",
  conversions: "conversions",
  new_customers: "newCustomers",
  returning_customers: "returningCustomers",
  sessions: "sessions",
  cogs: "cogs",
};

export async function buildActuals(
  projectId: string,
  since: Date,
  until: Date,
): Promise<{ totals: Canon; days: number }> {
  const rows = await prisma.metricSnapshot.findMany({
    where: { projectId, date: { gte: since, lte: until } },
    select: { metric: true, value: true, currency: true },
  });
  const totals = { ...ZERO };
  for (const r of rows) {
    const key = METRIC_TO_KEY[r.metric];
    if (!key) continue;
    (totals[key] as number) += r.value;
    if (r.currency) totals.currency = r.currency;
  }
  const days = Math.max(
    1,
    Math.round((until.getTime() - since.getTime()) / 86_400_000),
  );
  return { totals, days };
}

// --- Predicted from the simulation -----------------------------------------
type Predicted = {
  source: "launch_sim" | "financials" | "none";
  currency: string;
  horizonDays: number;
  // per-day volumes
  ordersPerDay?: number;
  revenuePerDay?: number;
  adSpendPerDay?: number;
  // rates / ratios
  aov?: number;
  refundRate?: number; // 0..1
  repeatRate?: number; // 0..1
  blendedCac?: number;
  grossMargin?: number; // 0..1
  conversionRate?: number; // 0..1 (orders / sessions-or-visits)
};

function horizonDaysOf(result: LaunchSimResult): number {
  const steps = result.timeline.length || 1;
  const gran = (result.resolvedInputs as { granularity?: string })?.granularity;
  return gran === "month" ? steps * 30 : steps;
}

export function predictedFromLaunchSim(result: LaunchSimResult): Predicted {
  const s = result.summary;
  const horizonDays = horizonDaysOf(result);
  const visits = s.totalProductVisits || s.totalReached || 0;
  return {
    source: "launch_sim",
    currency: (result.resolvedInputs as { currency?: string })?.currency || "USD",
    horizonDays,
    ordersPerDay: s.totalOrders / horizonDays,
    revenuePerDay: s.grossRevenue / horizonDays,
    adSpendPerDay: s.totalAdSpend / horizonDays,
    aov: s.unitsSold ? s.grossRevenue / s.totalOrders : undefined,
    refundRate: s.refundRatePct / 100,
    repeatRate: s.returningCustomerSharePct / 100,
    blendedCac: s.blendedCac || undefined,
    grossMargin: s.grossMarginPct / 100,
    conversionRate: visits ? s.totalOrders / visits : undefined,
  };
}

export function predictedFromFinancials(model: FinancialModel): Predicted {
  const tier = model.priceTiers[0];
  const aov = tier?.price?.value;
  const cac = model.unitEconomics?.blendedCac?.value;
  const margin = tier?.grossMarginPct?.value;
  return {
    source: "financials",
    currency: model.currency || "USD",
    horizonDays: 30,
    aov: aov ?? undefined,
    blendedCac: cac ?? undefined,
    grossMargin: margin != null ? margin / 100 : undefined,
  };
}

export async function getPredicted(projectId: string): Promise<Predicted> {
  // Prefer the most recent launch simulation for this project.
  const sim = await prisma.launchSimulation.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  if (sim?.result) {
    try {
      return predictedFromLaunchSim(sim.result as unknown as LaunchSimResult);
    } catch (e) {
      log.warn("reconcile: launch sim parse failed", { error: String(e) });
    }
  }
  // Fall back to the persisted financials model.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerDashboard: true },
  });
  const fin = (project?.ownerDashboard as { financials?: { model?: FinancialModel } } | null)
    ?.financials?.model;
  if (fin) return predictedFromFinancials(fin);
  return { source: "none", currency: "USD", horizonDays: 30 };
}

// --- Reconcile --------------------------------------------------------------
function line(
  key: string,
  label: string,
  kind: MetricKind,
  predicted: number | null | undefined,
  actual: number | null | undefined,
  unit?: string,
): ReconciliationLine {
  const p = predicted ?? null;
  const a = actual ?? null;
  let deltaAbs: number | null = null;
  let deltaPct: number | null = null;
  let status: ReconciliationLine["status"] = "no_data";
  if (p != null && a != null) {
    deltaAbs = a - p;
    deltaPct = p !== 0 ? (a - p) / p : null;
    const mag = deltaPct == null ? 0 : Math.abs(deltaPct);
    status = mag <= 0.15 ? "on_track" : a > p ? "over" : "under";
  }
  return { key, label, kind, predicted: p, actual: a, deltaAbs, deltaPct, status, unit };
}

export function reconcile(
  predicted: Predicted,
  actuals: { totals: Canon; days: number },
  window: { since: Date; until: Date },
): ReconciliationReport {
  const { totals, days } = actuals;
  const currency = predicted.currency || totals.currency;

  // Derived actual rates.
  const aov = totals.orders ? totals.revenue / totals.orders : null;
  const refundRate = totals.orders ? totals.refunds / totals.orders : null;
  const repeatRate =
    totals.newCustomers + totals.returningCustomers
      ? totals.returningCustomers / (totals.newCustomers + totals.returningCustomers)
      : null;
  const cacBase = totals.newCustomers || totals.conversions || totals.orders;
  const blendedCac = cacBase ? totals.adSpend / cacBase : null;
  const grossMargin = totals.revenue
    ? (totals.revenue - totals.cogs) / totals.revenue
    : null;
  const convBase = totals.sessions || totals.clicks;
  const conversionRate = convBase ? (totals.conversions || totals.orders) / convBase : null;

  const lines: ReconciliationLine[] = [
    line("orders_per_day", "Orders / day", "perDay", predicted.ordersPerDay, totals.orders / days),
    line("revenue_per_day", "Revenue / day", "currency", predicted.revenuePerDay, totals.revenue / days, currency),
    line("ad_spend_per_day", "Ad spend / day", "currency", predicted.adSpendPerDay, totals.adSpend / days, currency),
    line("aov", "Average order value", "currency", predicted.aov, aov, currency),
    line("blended_cac", "Blended CAC", "currency", predicted.blendedCac, blendedCac, currency),
    line("refund_rate", "Refund rate", "rate", predicted.refundRate, refundRate),
    line("repeat_rate", "Repeat-customer rate", "rate", predicted.repeatRate, repeatRate),
    line("gross_margin", "Gross margin", "rate", predicted.grossMargin, grossMargin),
    line("conversion_rate", "Conversion rate", "rate", predicted.conversionRate, conversionRate),
  ];

  return {
    windowDays: days,
    since: window.since.toISOString().slice(0, 10),
    until: window.until.toISOString().slice(0, 10),
    predictedSource: predicted.source,
    currency,
    // Drop lines where neither side has data so the UI stays clean.
    lines: lines.filter((l) => l.predicted != null || l.actual != null),
  };
}

/** Convenience: build the full report for a project over a lookback window. */
export async function buildReconciliation(
  projectId: string,
  lookbackDays = 90,
): Promise<ReconciliationReport> {
  const until = new Date();
  const since = new Date(until.getTime() - lookbackDays * 86_400_000);
  const [predicted, actuals] = await Promise.all([
    getPredicted(projectId),
    buildActuals(projectId, since, until),
  ]);
  return reconcile(predicted, actuals, { since, until });
}

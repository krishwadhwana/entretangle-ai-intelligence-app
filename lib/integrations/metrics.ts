// ---------------------------------------------------------------------------
// Business overview: turn the raw MetricSnapshot fact table into everything the
// Integrations dashboard shows — headline KPIs (with period-over-period change),
// daily time series for charts, cross-source derived metrics (ROAS, blended
// CAC, AOV, conversion rate), channel breakdowns, and auto-generated insights.
//
// Double-count discipline: additive metrics (ad spend, impressions, clicks,
// conversions) sum across providers; everything else takes the single
// highest-priority source that has data (so Shopify + Stripe revenue don't get
// added together). The chosen source per metric is reported back for the UI.
// ---------------------------------------------------------------------------
import { prisma } from "../db";
import type { MetricName } from "./types";

// Providers that legitimately add together (multi-network ad spend, reach).
const ADDITIVE = new Set<MetricName>(["ad_spend", "impressions", "clicks", "conversions"]);

// For non-additive metrics, the source we trust first when several report it.
const PRIORITY: Partial<Record<MetricName, string[]>> = {
  revenue: ["shopify", "stripe", "quickbooks", "ga4", "unified"],
  orders: ["shopify", "unified"],
  units: ["shopify", "unified"],
  new_customers: ["shopify", "stripe", "unified"],
  returning_customers: ["shopify"],
  refunds: ["shopify", "stripe"],
  refund_amount: ["shopify", "stripe"],
  cogs: ["quickbooks", "shopify"],
  sessions: ["ga4"],
  mrr: ["stripe"],
  churn: ["stripe"],
};

type Row = { provider: string; metric: string; date: Date; value: number; currency: string | null };

type ProviderSeries = Map<string, Map<string, number>>; // provider -> dayISO -> value
type MetricStore = Map<string, ProviderSeries>; // metric -> ...

function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ingest(rows: Row[]): { store: MetricStore; currency: string } {
  const store: MetricStore = new Map();
  const currencyVotes = new Map<string, number>();
  for (const r of rows) {
    if (!store.has(r.metric)) store.set(r.metric, new Map());
    const byProvider = store.get(r.metric)!;
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, new Map());
    const series = byProvider.get(r.provider)!;
    const d = dayISO(r.date);
    series.set(d, (series.get(d) ?? 0) + r.value);
    if (r.currency)
      currencyVotes.set(r.currency, (currencyVotes.get(r.currency) ?? 0) + 1);
  }
  let currency = "USD";
  let best = 0;
  for (const [c, n] of currencyVotes) if (n > best) { best = n; currency = c; }
  return { store, currency };
}

/** Pick the contributing providers + a merged daily series for one metric. */
function resolveMetric(
  store: MetricStore,
  metric: MetricName,
): { sources: string[]; daily: Map<string, number>; total: number } {
  const byProvider = store.get(metric);
  if (!byProvider || byProvider.size === 0)
    return { sources: [], daily: new Map(), total: 0 };

  let providers: string[];
  if (ADDITIVE.has(metric)) {
    providers = [...byProvider.keys()];
  } else {
    const order = PRIORITY[metric] ?? [...byProvider.keys()];
    const chosen = order.find((p) => byProvider.has(p)) ?? [...byProvider.keys()][0];
    providers = [chosen];
  }
  const daily = new Map<string, number>();
  let total = 0;
  for (const p of providers) {
    for (const [d, v] of byProvider.get(p) ?? []) {
      daily.set(d, (daily.get(d) ?? 0) + v);
      total += v;
    }
  }
  return { sources: providers, daily, total };
}

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  deltaPct: number | null;
  format: "currency" | "number" | "percent" | "ratio";
  sources: string[];
};

export type SeriesPoint = { date: string; [key: string]: number | string };

export type ChannelSlice = { name: string; value: number };

export type Insight = {
  tone: "positive" | "warning" | "neutral";
  title: string;
  detail: string;
};

export type IntegrationsOverview = {
  windowDays: number;
  since: string;
  until: string;
  currency: string;
  hasData: boolean;
  kpis: Kpi[];
  revenueSeries: SeriesPoint[]; // revenue, orders
  adSeries: SeriesPoint[]; // ad_spend per provider + total
  funnelSeries: SeriesPoint[]; // sessions, conversions, new_customers
  efficiencySeries: SeriesPoint[]; // daily cac, roas
  adSpendByChannel: ChannelSlice[];
  revenueBySource: ChannelSlice[];
  insights: Insight[];
};

function pct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  const r = (curr - prev) / prev;
  // >900% period-over-period almost always means an empty/partial prior
  // baseline (e.g. a fresh backfill), not real growth — hide it rather than
  // show a nonsense delta.
  if (Math.abs(r) > 9) return null;
  return r;
}

const PROVIDER_LABEL: Record<string, string> = {
  shopify: "Shopify",
  meta_ads: "Meta",
  google_ads: "Google Ads",
  ga4: "GA4",
  stripe: "Stripe",
  quickbooks: "QuickBooks",
  unified: "Other",
};

export async function buildOverview(
  projectId: string,
  days = 90,
): Promise<IntegrationsOverview> {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const prevSince = new Date(since.getTime() - days * 86_400_000);

  const [curRows, prevRows] = await Promise.all([
    prisma.metricSnapshot.findMany({
      where: { projectId, date: { gte: since, lte: until } },
      select: { provider: true, metric: true, date: true, value: true, currency: true },
    }),
    prisma.metricSnapshot.findMany({
      where: { projectId, date: { gte: prevSince, lt: since } },
      select: { provider: true, metric: true, date: true, value: true, currency: true },
    }),
  ]);

  const cur = ingest(curRows);
  const prev = ingest(prevRows);

  const m = (s: MetricStore, name: MetricName) => resolveMetric(s, name);
  const C = (name: MetricName) => m(cur.store, name);
  const P = (name: MetricName) => m(prev.store, name);

  // Resolved current-window metrics.
  const revenue = C("revenue");
  const orders = C("orders");
  const units = C("units");
  const adSpend = C("ad_spend");
  const impressions = C("impressions");
  const clicks = C("clicks");
  const conversions = C("conversions");
  const newCust = C("new_customers");
  const retCust = C("returning_customers");
  const refunds = C("refunds");
  const refundAmt = C("refund_amount");
  const sessions = C("sessions");
  const cogs = C("cogs");
  const mrr = C("mrr");

  // Derived helpers (current + previous for deltas).
  const aov = orders.total ? revenue.total / orders.total : null;
  const roas = adSpend.total ? revenue.total / adSpend.total : null;
  const cacBase = newCust.total || conversions.total || orders.total;
  const cac = cacBase ? adSpend.total / cacBase : null;
  const refundRate = orders.total ? refunds.total / orders.total : null;
  const repeatBase = newCust.total + retCust.total;
  const repeatRate = repeatBase ? retCust.total / repeatBase : null;
  const convBase = sessions.total || clicks.total;
  const convRate = convBase ? (conversions.total || orders.total) / convBase : null;
  // Only meaningful when a COGS source (accounting/commerce) is actually
  // connected — otherwise it falsely reads as 100%.
  const grossMargin = revenue.total && cogs.total > 0
    ? (revenue.total - cogs.total) / revenue.total
    : null;

  const pRevenue = P("revenue").total;
  const pOrders = P("orders").total;
  const pAdSpend = P("ad_spend").total;
  const pNew = P("new_customers").total || P("conversions").total || pOrders;
  const pAov = pOrders ? pRevenue / pOrders : null;
  const pRoas = pAdSpend ? pRevenue / pAdSpend : null;
  const pCac = pNew ? pAdSpend / pNew : null;

  const kpisAll: Kpi[] = [
    { key: "revenue", label: "Revenue", value: revenue.total || null, prev: pRevenue || null, deltaPct: pct(revenue.total, pRevenue), format: "currency", sources: revenue.sources },
    { key: "orders", label: "Orders", value: orders.total || null, prev: pOrders || null, deltaPct: pct(orders.total, pOrders), format: "number", sources: orders.sources },
    { key: "aov", label: "Avg order value", value: aov, prev: pAov, deltaPct: pct(aov, pAov), format: "currency", sources: revenue.sources },
    { key: "ad_spend", label: "Ad spend", value: adSpend.total || null, prev: pAdSpend || null, deltaPct: pct(adSpend.total, pAdSpend), format: "currency", sources: adSpend.sources },
    { key: "roas", label: "ROAS", value: roas, prev: pRoas, deltaPct: pct(roas, pRoas), format: "ratio", sources: [...new Set([...revenue.sources, ...adSpend.sources])] },
    { key: "cac", label: "Blended CAC", value: cac, prev: pCac, deltaPct: pct(cac, pCac), format: "currency", sources: adSpend.sources },
    { key: "new_customers", label: "New customers", value: newCust.total || null, prev: P("new_customers").total || null, deltaPct: pct(newCust.total, P("new_customers").total), format: "number", sources: newCust.sources },
    { key: "repeat_rate", label: "Repeat rate", value: repeatRate, prev: null, deltaPct: null, format: "percent", sources: retCust.sources },
    { key: "conversion_rate", label: "Conversion rate", value: convRate, prev: null, deltaPct: null, format: "percent", sources: [...new Set([...sessions.sources, ...orders.sources])] },
    { key: "refund_rate", label: "Refund rate", value: refundRate, prev: null, deltaPct: null, format: "percent", sources: refunds.sources },
    { key: "gross_margin", label: "Gross margin", value: grossMargin, prev: null, deltaPct: null, format: "percent", sources: [...new Set([...revenue.sources, ...cogs.sources])] },
    { key: "sessions", label: "Sessions", value: sessions.total || null, prev: P("sessions").total || null, deltaPct: pct(sessions.total, P("sessions").total), format: "number", sources: sessions.sources },
    { key: "impressions", label: "Impressions", value: impressions.total || null, prev: P("impressions").total || null, deltaPct: pct(impressions.total, P("impressions").total), format: "number", sources: impressions.sources },
    { key: "clicks", label: "Clicks", value: clicks.total || null, prev: P("clicks").total || null, deltaPct: pct(clicks.total, P("clicks").total), format: "number", sources: clicks.sources },
    { key: "mrr", label: "MRR", value: mrr.daily.size ? [...mrr.daily.values()].at(-1) ?? null : null, prev: null, deltaPct: null, format: "currency", sources: mrr.sources },
    { key: "units", label: "Units sold", value: units.total || null, prev: null, deltaPct: null, format: "number", sources: units.sources },
  ];
  const kpis = kpisAll.filter((k) => k.value != null);

  // --- Time series ---------------------------------------------------------
  const allDays = (...maps: Map<string, number>[]): string[] => {
    const s = new Set<string>();
    for (const mp of maps) for (const d of mp.keys()) s.add(d);
    return [...s].sort();
  };

  const revDays = allDays(revenue.daily, orders.daily);
  const revenueSeries: SeriesPoint[] = revDays.map((date) => ({
    date,
    revenue: Math.round(revenue.daily.get(date) ?? 0),
    orders: Math.round(orders.daily.get(date) ?? 0),
  }));

  // Ad spend per provider (additive) → one line per network + total.
  const adByProvider = cur.store.get("ad_spend") ?? new Map();
  const adDays = allDays(adSpend.daily);
  const adSeries: SeriesPoint[] = adDays.map((date) => {
    const point: SeriesPoint = { date, total: Math.round(adSpend.daily.get(date) ?? 0) };
    for (const [provider, series] of adByProvider) {
      point[PROVIDER_LABEL[provider] ?? provider] = Math.round(series.get(date) ?? 0);
    }
    return point;
  });

  const funnelDays = allDays(sessions.daily, conversions.daily, newCust.daily);
  const funnelSeries: SeriesPoint[] = funnelDays.map((date) => ({
    date,
    sessions: Math.round(sessions.daily.get(date) ?? 0),
    conversions: Math.round(conversions.daily.get(date) ?? 0),
    newCustomers: Math.round(newCust.daily.get(date) ?? 0),
  }));

  // Daily efficiency: CAC and ROAS per day.
  const effDays = allDays(adSpend.daily, revenue.daily, newCust.daily);
  const efficiencySeries: SeriesPoint[] = effDays.map((date) => {
    const spend = adSpend.daily.get(date) ?? 0;
    const rev = revenue.daily.get(date) ?? 0;
    const acq = newCust.daily.get(date) ?? conversions.daily.get(date) ?? 0;
    return {
      date,
      cac: acq ? Math.round((spend / acq) * 100) / 100 : 0,
      roas: spend ? Math.round((rev / spend) * 100) / 100 : 0,
    };
  });

  // --- Breakdowns ----------------------------------------------------------
  const adSpendByChannel: ChannelSlice[] = [...adByProvider.entries()]
    .map(([provider, series]) => ({
      name: PROVIDER_LABEL[provider] ?? provider,
      value: Math.round([...(series as Map<string, number>).values()].reduce((a, b) => a + b, 0)),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const revStore = cur.store.get("revenue") ?? new Map();
  const revenueBySource: ChannelSlice[] = [...revStore.entries()]
    .map(([provider, series]) => ({
      name: PROVIDER_LABEL[provider] ?? provider,
      value: Math.round([...(series as Map<string, number>).values()].reduce((a, b) => a + b, 0)),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // --- Insights ------------------------------------------------------------
  const insights: Insight[] = [];
  const cacDelta = pct(cac, pCac);
  if (cacDelta != null && cacDelta > 0.15)
    insights.push({ tone: "warning", title: `CAC up ${Math.round(cacDelta * 100)}%`, detail: "Acquisition cost is rising vs the previous period — check ad creative/targeting." });
  if (cacDelta != null && cacDelta < -0.15)
    insights.push({ tone: "positive", title: `CAC down ${Math.round(-cacDelta * 100)}%`, detail: "Acquisition is getting cheaper — consider scaling spend." });
  if (roas != null && roas < 1 && adSpend.total > 0)
    insights.push({ tone: "warning", title: `ROAS ${roas.toFixed(2)}× — below break-even`, detail: "Ads are returning less than they cost. Pause or rework underperforming campaigns." });
  if (roas != null && roas >= 3)
    insights.push({ tone: "positive", title: `Strong ROAS ${roas.toFixed(1)}×`, detail: "Paid channels are efficient — there's likely room to scale." });
  if (refundRate != null && refundRate > 0.1)
    insights.push({ tone: "warning", title: `Refund rate ${Math.round(refundRate * 100)}%`, detail: "Elevated returns — a product, sizing or expectation gap may be hurting margin." });
  const revDelta = pct(revenue.total, pRevenue);
  if (revDelta != null && revDelta > 0.1)
    insights.push({ tone: "positive", title: `Revenue up ${Math.round(revDelta * 100)}%`, detail: "Sales are growing vs the previous period." });
  if (revDelta != null && revDelta < -0.1)
    insights.push({ tone: "warning", title: `Revenue down ${Math.round(-revDelta * 100)}%`, detail: "Sales are contracting vs the previous period." });
  if (repeatRate != null && repeatRate >= 0.3)
    insights.push({ tone: "positive", title: `${Math.round(repeatRate * 100)}% repeat customers`, detail: "Healthy retention — loyalty/CRM investment is paying off." });

  return {
    windowDays: days,
    since: dayISO(since),
    until: dayISO(until),
    currency: cur.currency,
    hasData: curRows.length > 0,
    kpis,
    revenueSeries,
    adSeries,
    funnelSeries,
    efficiencySeries,
    adSpendByChannel,
    revenueBySource,
    insights,
  };
}

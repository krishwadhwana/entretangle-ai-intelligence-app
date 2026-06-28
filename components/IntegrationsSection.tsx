"use client";

// Owner Dashboard → Integrations. A full business-overview dashboard built on
// the real data we sync from each source (Shopify, Meta, Google, Stripe,
// QuickBooks): headline KPIs with trends, time-series charts, channel
// breakdowns, auto insights, Plan-vs-Actual reconciliation, and source health.
import { useCallback, useEffect, useState } from "react";
import {
  Plug,
  Loader2,
  RefreshCw,
  Check,
  AlertCircle,
  X,
  ShoppingBag,
  Megaphone,
  BarChart3,
  CreditCard,
  BookOpen,
  Boxes,
  Mail,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";

type CatalogItem = {
  provider: string;
  label: string;
  category: string;
  authType: "oauth2" | "apiKey";
  metrics: string[];
  connectFields: { name: string; label: string; placeholder?: string }[] | null;
  comingSoon: boolean;
};
type Integration = {
  id: string;
  provider: string;
  category: string;
  status: string;
  displayName: string | null;
  externalAccountId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  metricCount: number;
  demo: boolean;
};
type Kpi = {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  deltaPct: number | null;
  format: "currency" | "number" | "percent" | "ratio";
  sources: string[];
};
type SeriesPoint = { date: string } & Record<string, number>;
type ChannelSlice = { name: string; value: number };
type Insight = { tone: "positive" | "warning" | "neutral"; title: string; detail: string };
type Overview = {
  windowDays: number;
  since: string;
  until: string;
  currency: string;
  hasData: boolean;
  kpis: Kpi[];
  revenueSeries: SeriesPoint[];
  adSeries: SeriesPoint[];
  funnelSeries: SeriesPoint[];
  efficiencySeries: SeriesPoint[];
  adSpendByChannel: ChannelSlice[];
  revenueBySource: ChannelSlice[];
  insights: Insight[];
};
type ReconLine = {
  key: string;
  label: string;
  kind: "perDay" | "rate" | "currency" | "ratio";
  predicted: number | null;
  actual: number | null;
  deltaPct: number | null;
  status: "on_track" | "over" | "under" | "no_data";
};
type ReconReport = {
  windowDays: number;
  predictedSource: "launch_sim" | "financials" | "none";
  currency: string;
  lines: ReconLine[];
};

const CATEGORY_ICON: Record<string, typeof Plug> = {
  commerce: ShoppingBag,
  ads: Megaphone,
  analytics: BarChart3,
  payments: CreditCard,
  accounting: BookOpen,
  marketing: Mail,
};
const PALETTE = ["#0ea5e9", "#6366f1", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

function providerIcon(category: string) {
  return CATEGORY_ICON[category] ?? Boxes;
}
function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
function fmtKpi(v: number | null, format: Kpi["format"], currency: string): string {
  if (v == null) return "—";
  if (format === "percent") return `${(v * 100).toFixed(1)}%`;
  if (format === "ratio") return `${v.toFixed(2)}×`;
  if (format === "currency") return `${currency} ${compact(v)}`;
  return compact(v);
}
function shortDate(d: string): string {
  return new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" });
}

const WINDOWS = [
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
];
type Tab = "overview" | "plan" | "sources";

export default function IntegrationsSection({ projectId }: { projectId: string | null }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(90);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [report, setReport] = useState<ReconReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/integrations`);
    if (res.ok) {
      const data = await res.json();
      setCatalog(data.catalog ?? []);
      setIntegrations(data.integrations ?? []);
    }
    setLoading(false);
  }, [projectId]);

  const loadOverview = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/integrations/metrics?days=${days}`);
    if (res.ok) setOverview((await res.json()).overview);
  }, [projectId, days]);

  const loadReport = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/reconciliation?days=${days}`);
    if (res.ok) setReport((await res.json()).report);
  }, [projectId, days]);

  useEffect(() => {
    setLoading(true);
    load();
    loadOverview();
    loadReport();
  }, [load, loadOverview, loadReport]);

  // Refresh while anything is syncing.
  useEffect(() => {
    if (!integrations.some((i) => i.status === "syncing")) return;
    const t = setInterval(() => {
      load();
      loadOverview();
      loadReport();
    }, 2500);
    return () => clearInterval(t);
  }, [integrations, load, loadOverview, loadReport]);

  const connected = (provider: string) => integrations.find((i) => i.provider === provider);
  const anyConnected = integrations.length > 0;

  const connectOAuth = (provider: string) => {
    // Full-page redirect: live → provider consent screen, demo → connect + back.
    window.location.href = `/api/projects/${projectId}/integrations/connect/${provider}`;
  };
  const connectShopify = (domain: string) => {
    const shop = domain.trim();
    if (!projectId || !shop) return;
    window.location.href = `/api/projects/${projectId}/integrations/connect/shopify?shop=${encodeURIComponent(shop)}`;
  };
  const connectWithKey = async (provider: string, values: Record<string, string>) => {
    if (!projectId) return;
    setBusy(provider);
    const res = await fetch(`/api/projects/${projectId}/integrations/connect/${provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setBusy(null);
    if (res.ok) load();
    else {
      const { error } = await res.json().catch(() => ({ error: "failed" }));
      alert(`Connect failed: ${error}`);
    }
  };
  const sync = async (integrationId: string) => {
    if (!projectId) return;
    setBusy(integrationId);
    await fetch(`/api/projects/${projectId}/integrations/${integrationId}/sync`, { method: "POST" });
    setBusy(null);
    load();
  };
  const disconnect = async (integrationId: string) => {
    if (!projectId) return;
    setBusy(integrationId);
    await fetch(`/api/projects/${projectId}/integrations/${integrationId}`, { method: "DELETE" });
    setBusy(null);
    load();
    loadOverview();
    loadReport();
  };

  if (!projectId) {
    return <div className="p-8 text-sm text-neutral-500">Integrations attach to a saved project.</div>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-neutral-700" />
            <h2 className="text-lg font-semibold text-neutral-900">Integrations</h2>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                  days === w.days ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <nav className="flex gap-1 border-b border-neutral-200">
          {([
            ["overview", "Overview"],
            ["plan", "Plan vs Actual"],
            ["sources", `Sources${anyConnected ? ` (${integrations.length})` : ""}`],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === id
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-400 hover:text-neutral-600"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "overview" && (
        <OverviewTab
          overview={overview}
          onConnect={() => setTab("sources")}
          hasSources={anyConnected}
          syncing={integrations.some((i) => i.status === "syncing")}
          syncedDays={days}
        />
      )}
      {tab === "plan" && <ReconciliationPanel report={report} />}
      {tab === "sources" && (
        <SourcesTab
          catalog={catalog}
          connected={connected}
          busy={busy}
          onSync={sync}
          onDisconnect={disconnect}
          onConnectOAuth={connectOAuth}
          onConnectShopify={connectShopify}
          onConnectKey={connectWithKey}
        />
      )}
    </div>
  );
}

// --- Overview ---------------------------------------------------------------
function OverviewTab({
  overview,
  onConnect,
  hasSources,
  syncing,
  syncedDays,
}: {
  overview: Overview | null;
  onConnect: () => void;
  hasSources: boolean;
  syncing: boolean;
  syncedDays: number;
}) {
  if (!overview || !overview.hasData) {
    const message = !hasSources
      ? "Connect a source to see your business overview."
      : syncing
        ? "Syncing your data…"
        : `Connected — but no orders, charges or ad activity in the last ${syncedDays} days. New activity will appear here automatically.`;
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
        <Boxes className="mx-auto h-8 w-8 text-neutral-300" />
        <p className="mx-auto mt-3 max-w-sm text-sm text-neutral-500">{message}</p>
        {!hasSources && (
          <button
            onClick={onConnect}
            className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            Connect a source
          </button>
        )}
      </div>
    );
  }
  const cur = overview.currency;
  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {overview.kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} currency={cur} />
        ))}
      </div>

      {/* Insights */}
      {overview.insights.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {overview.insights.map((ins, i) => (
            <InsightCard key={i} insight={ins} />
          ))}
        </div>
      )}

      {/* Revenue & orders */}
      <ChartCard title="Revenue & orders" subtitle={`${shortDate(overview.since)} – ${shortDate(overview.until)}`}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={overview.revenueSeries} margin={{ left: 4, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickFormatter={compact} width={44} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} tickFormatter={compact} width={36} />
            <Tooltip formatter={(v, n) => (n === "revenue" ? `${cur} ${compact(Number(v))}` : compact(Number(v)))} labelFormatter={(d) => shortDate(String(d))} />
            <Area yAxisId="l" type="monotone" dataKey="revenue" stroke="#0ea5e9" fill="url(#rev)" strokeWidth={2} name="revenue" />
            <Line yAxisId="r" type="monotone" dataKey="orders" stroke="#6366f1" strokeWidth={1.5} dot={false} name="orders" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Ad spend by channel */}
        {overview.adSeries.length > 0 && (
          <ChartCard title="Ad spend by channel">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={overview.adSeries} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={compact} width={44} />
                <Tooltip formatter={(v) => `${cur} ${compact(Number(v))}`} labelFormatter={(d) => shortDate(String(d))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {channelKeys(overview.adSeries).map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={PALETTE[i % PALETTE.length]}
                    fill={PALETTE[i % PALETTE.length]}
                    fillOpacity={0.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Efficiency: CAC + ROAS */}
        {overview.efficiencySeries.length > 0 && (
          <ChartCard title="Acquisition efficiency" subtitle="CAC & ROAS per day">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={overview.efficiencySeries} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis yAxisId="cac" tick={{ fontSize: 10 }} tickFormatter={compact} width={44} />
                <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 10 }} width={30} />
                <Tooltip labelFormatter={(d) => shortDate(String(d))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="cac" type="monotone" dataKey="cac" stroke="#f59e0b" strokeWidth={1.5} dot={false} name={`CAC (${cur})`} />
                <Line yAxisId="roas" type="monotone" dataKey="roas" stroke="#10b981" strokeWidth={1.5} dot={false} name="ROAS (×)" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Funnel */}
        {overview.funnelSeries.length > 0 && (
          <ChartCard title="Traffic & conversion">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={overview.funnelSeries} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={compact} width={44} />
                <Tooltip formatter={(v) => compact(Number(v))} labelFormatter={(d) => shortDate(String(d))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sessions" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="conversions" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="newCustomers" stroke="#10b981" strokeWidth={1.5} dot={false} name="new customers" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Channel split donut */}
        {overview.adSpendByChannel.length > 0 && (
          <ChartCard title="Spend & revenue mix">
            <div className="flex items-center justify-around">
              <DonutLegend title="Ad spend" data={overview.adSpendByChannel} currency={cur} />
              {overview.revenueBySource.length > 0 && (
                <DonutLegend title="Revenue" data={overview.revenueBySource} currency={cur} />
              )}
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function channelKeys(series: SeriesPoint[]): string[] {
  const keys = new Set<string>();
  for (const p of series) for (const k of Object.keys(p)) if (k !== "date" && k !== "total") keys.add(k);
  return [...keys];
}

function KpiCard({ kpi, currency }: { kpi: Kpi; currency: string }) {
  const up = kpi.deltaPct != null && kpi.deltaPct > 0;
  // For CAC / refund rate, "up" is bad; for everything else up is good.
  const inverse = kpi.key === "cac" || kpi.key === "refund_rate";
  const good = kpi.deltaPct == null ? null : inverse ? !up : up;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="text-[11px] font-medium text-neutral-400">{kpi.label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">
        {fmtKpi(kpi.value, kpi.format, currency)}
      </div>
      <div className="mt-1 flex items-center gap-1">
        {kpi.deltaPct != null ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
              good ? "text-emerald-600" : "text-rose-500"
            }`}
          >
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(kpi.deltaPct * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="text-[11px] text-neutral-300">—</span>
        )}
        {kpi.sources.length > 0 && (
          <span className="ml-auto truncate text-[10px] text-neutral-300">{kpi.sources.map(srcLabel).join(", ")}</span>
        )}
      </div>
    </div>
  );
}

function srcLabel(p: string): string {
  return (
    {
      shopify: "Shopify",
      meta_ads: "Meta",
      google_ads: "Google",
      ga4: "GA4",
      stripe: "Stripe",
      quickbooks: "QuickBooks",
      tiktok_shop: "TikTok Shop",
      tiktok_ads: "TikTok Ads",
      amazon: "Amazon",
      etsy: "Etsy",
      faire: "Faire",
      klaviyo: "Klaviyo",
      unified: "Other",
    } as Record<string, string>
  )[p] ?? p;
}

function InsightCard({ insight }: { insight: Insight }) {
  const tone =
    insight.tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : insight.tone === "warning"
        ? "border-amber-200 bg-amber-50"
        : "border-neutral-200 bg-neutral-50";
  const Icon = insight.tone === "positive" ? TrendingUp : insight.tone === "warning" ? TrendingDown : Lightbulb;
  const ic = insight.tone === "positive" ? "text-emerald-600" : insight.tone === "warning" ? "text-amber-600" : "text-neutral-500";
  return (
    <div className={`flex gap-2.5 rounded-xl border p-3 ${tone}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ic}`} />
      <div>
        <div className="text-sm font-medium text-neutral-900">{insight.title}</div>
        <div className="text-[11px] text-neutral-500">{insight.detail}</div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle && <span className="text-[11px] text-neutral-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function DonutLegend({ title, data, currency }: { title: string; data: ChannelSlice[]; currency: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="text-center">
      <div className="mb-1 text-[11px] font-medium text-neutral-400">{title}</div>
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={38} outerRadius={56} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => `${currency} ${compact(Number(v))}`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-0.5">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center justify-center gap-1.5 text-[10px] text-neutral-500">
            <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {d.name} · {total ? Math.round((d.value / total) * 100) : 0}%
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Sources ----------------------------------------------------------------
function SourcesTab({
  catalog,
  connected,
  busy,
  onSync,
  onDisconnect,
  onConnectOAuth,
  onConnectShopify,
  onConnectKey,
}: {
  catalog: CatalogItem[];
  connected: (p: string) => Integration | undefined;
  busy: string | null;
  onSync: (id: string) => void;
  onDisconnect: (id: string) => void;
  onConnectOAuth: (p: string) => void;
  onConnectShopify: (domain: string) => void;
  onConnectKey: (p: string, values: Record<string, string>) => void;
}) {
  // Which card's inline form is open, and its field values.
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Providers with an inline form: Shopify (shop domain) or apiKey connectors.
  const hasInlineForm = (item: CatalogItem) =>
    item.provider === "shopify" || item.authType === "apiKey";

  const onConnectClick = (item: CatalogItem) => {
    if (hasInlineForm(item)) {
      setFields({});
      setOpenForm((p) => (p === item.provider ? null : item.provider));
    } else {
      onConnectOAuth(item.provider);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {catalog.map((item) => {
        const conn = connected(item.provider);
        const comingSoon = item.comingSoon && !conn;
        const Icon = providerIcon(item.category);
        return (
          <div
            key={item.provider}
            className={`rounded-xl border border-neutral-200 bg-white p-4${comingSoon ? " opacity-70" : ""}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-neutral-100 p-2">
                  <Icon className="h-4 w-4 text-neutral-700" />
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-900">{item.label}</div>
                  <div className="text-[11px] capitalize text-neutral-400">{item.category}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {comingSoon && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                    Coming soon
                  </span>
                )}
                {conn && <StatusBadge status={conn.status} />}
              </div>
            </div>

            {conn ? (
              <div className="mt-3 space-y-2">
                <div className="text-[11px] text-neutral-500">
                  {conn.displayName}
                  {conn.metricCount > 0 && <> · {conn.metricCount.toLocaleString()} data points</>}
                  {conn.lastSyncedAt && <> · synced {new Date(conn.lastSyncedAt).toLocaleDateString()}</>}
                </div>
                {conn.lastError && <div className="text-[11px] text-red-500">{conn.lastError}</div>}
                <div className="text-[10px] text-neutral-400">Tracks: {item.metrics.map(metricLabel).join(", ")}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onSync(conn.id)}
                    disabled={busy === conn.id}
                    className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {busy === conn.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync now
                  </button>
                  <button
                    onClick={() => onDisconnect(conn.id)}
                    disabled={busy === conn.id}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-600 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" /> Disconnect
                  </button>
                </div>
              </div>
            ) : comingSoon ? (
              <div className="mt-3 text-[10px] text-neutral-400">
                Tracks: {item.metrics.map(metricLabel).join(", ")}
              </div>
            ) : (
              <div className="mt-3">
                <button
                  onClick={() => onConnectClick(item)}
                  className="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Connect
                </button>
                <div className="mt-2 text-[10px] text-neutral-400">Tracks: {item.metrics.map(metricLabel).join(", ")}</div>

                {openForm === item.provider && item.provider === "shopify" && (
                  <div className="mt-3 space-y-2 rounded-lg bg-neutral-50 p-3">
                    <input
                      value={fields.shop ?? ""}
                      onChange={(e) => setFields({ shop: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && onConnectShopify(fields.shop ?? "")}
                      placeholder="your-store.myshopify.com"
                      className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => onConnectShopify(fields.shop ?? "")}
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      Connect store
                    </button>
                    <p className="text-[10px] text-neutral-400">
                      Enter your store domain — you&apos;ll approve access on Shopify&apos;s own screen.
                    </p>
                  </div>
                )}

                {openForm === item.provider && item.authType === "apiKey" && (
                  <div className="mt-3 space-y-2 rounded-lg bg-neutral-50 p-3">
                    {(item.connectFields ?? []).map((f) => (
                      <input
                        key={f.name}
                        value={fields[f.name] ?? ""}
                        onChange={(e) => setFields((p) => ({ ...p, [f.name]: e.target.value }))}
                        placeholder={f.placeholder ? `${f.label} — ${f.placeholder}` : f.label}
                        className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs"
                      />
                    ))}
                    <button
                      onClick={() => onConnectKey(item.provider, fields)}
                      disabled={busy === item.provider}
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                    >
                      {busy === item.provider && <Loader2 className="h-3 w-3 animate-spin" />}
                      Connect
                    </button>
                    <p className="text-[10px] text-neutral-400">Paste your {item.label} API key.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function metricLabel(m: string): string {
  return m.replace(/_/g, " ");
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: typeof Check; label: string }> = {
    connected: { cls: "bg-emerald-50 text-emerald-600", icon: Check, label: "Connected" },
    syncing: { cls: "bg-blue-50 text-blue-600", icon: Loader2, label: "Syncing" },
    error: { cls: "bg-red-50 text-red-600", icon: AlertCircle, label: "Error" },
  };
  const s = map[status] ?? map.connected;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>
      <Icon className={`h-3 w-3 ${status === "syncing" ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

// --- Plan vs Actual ---------------------------------------------------------
function ReconciliationPanel({ report }: { report: ReconReport | null }) {
  if (!report || report.lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
        Connect a source and run a simulation to see Plan vs Actual.
      </div>
    );
  }
  const currency = report.currency;
  const fmt = (v: number | null, kind: ReconLine["kind"]) => {
    if (v == null) return "—";
    if (kind === "rate" || kind === "ratio") return `${(v * 100).toFixed(1)}%`;
    if (kind === "currency") return `${currency} ${compact(v)}`;
    return v < 10 ? v.toFixed(1) : compact(v);
  };
  const chartData = report.lines
    .filter((l) => l.predicted != null && l.actual != null && l.predicted !== 0)
    .map((l) => ({ label: l.label, actualPct: Math.round((l.actual! / l.predicted!) * 100), status: l.status }));
  const color = (s: string) => (s === "on_track" ? "#059669" : s === "over" ? "#2563eb" : "#d97706");
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Plan vs Actual</h3>
        <span className="text-[11px] text-neutral-400">
          {report.predictedSource === "launch_sim"
            ? "vs launch simulation"
            : report.predictedSource === "financials"
              ? "vs financial model"
              : "no prediction yet"}{" "}
          · last {report.windowDays}d
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Metric</th>
              <th className="px-4 py-2 text-right font-medium">Predicted</th>
              <th className="px-4 py-2 text-right font-medium">Actual</th>
              <th className="px-4 py-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {report.lines.map((l) => (
              <tr key={l.key}>
                <td className="px-4 py-2 text-neutral-700">{l.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{fmt(l.predicted, l.kind)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-900">{fmt(l.actual, l.kind)}</td>
                <td className="px-4 py-2 text-right">
                  {l.deltaPct == null ? (
                    <span className="text-[11px] text-neutral-300">—</span>
                  ) : (
                    <span
                      className={`text-[11px] font-medium tabular-nums ${
                        l.status === "on_track" ? "text-emerald-600" : l.status === "over" ? "text-blue-600" : "text-amber-600"
                      }`}
                    >
                      {l.deltaPct > 0 ? "+" : ""}
                      {(l.deltaPct * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chartData.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-[11px] text-neutral-400">Actual as % of predicted (100% = on plan)</div>
          <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${v}% of plan`} />
              <Bar dataKey="actualPct" radius={[0, 4, 4, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={color(d.status)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

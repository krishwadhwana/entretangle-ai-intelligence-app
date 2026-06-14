"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
  BarChart,
} from "recharts";
import {
  Rocket,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  ChevronDown,
  Settings2,
  Trash2,
} from "lucide-react";
import { SEGMENT_COLORS } from "./segments";
import type { LaunchSimInputs, LaunchSimRecord } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Launch Simulation view. Feed cost / sale price / ad spend, fast-forward the
// launch day-by-day (or month-by-month), and read the full trajectory: orders
// by channel, scroll-past, refunds, P&L, deadstock, demographics, returning
// customers. Reruns with identical inputs reproduce identical results — the
// engine (lib/launchSim.ts) is a pure function of its inputs.
// ---------------------------------------------------------------------------

type Defaults = {
  currency: string;
  suggestedCostPrice: number | null;
  suggestedSalePrice: number | null;
  suggestedAdSpendPerMonth: number | null;
  reachableProspectsPerMonth: number | null;
  fixedCostsPerMonth: number | null;
};

const DEFAULT_INPUTS: LaunchSimInputs = {
  currency: "INR",
  costPrice: 0,
  salePrice: 0,
  adSpendPerMonth: 0,
  granularity: "day",
  horizon: 90,
  reachablePool: null,
  cpm: 250,
  frequencyCap: 3,
  targetingQuality: 0.5,
  adPlatforms: ["instagram", "facebook"],
  organicReachPerStep: 0,
  viralityK: 0.15,
  decisionSpeed: null,
  abandonRate: 0.05,
  shippingPerOrder: 120,
  paymentFeePct: 0.02,
  fixedCostsPerMonth: 0,
  returnWindowDays: 30,
  refundRateMult: 1,
  resellablePct: 0.7,
  returnShippingPerOrder: null,
  initialInventoryUnits: null,
  reorderLeadTimeDays: 30,
  reorderEnabled: true,
  repeatRateMult: 1,
  jitterAmplitude: 0.06,
};

export default function LaunchSimulation({
  runId,
  projectId,
}: {
  runId: string;
  projectId: string | null;
}) {
  const [inputs, setInputs] = useState<LaunchSimInputs>(DEFAULT_INPUTS);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [scenarios, setScenarios] = useState<LaunchSimRecord[]>([]);
  const [active, setActive] = useState<LaunchSimRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState("Scenario 1");

  const currency = inputs.currency || defaults?.currency || "INR";
  const fmt = useMemo(() => makeFormatters(currency), [currency]);

  // Load defaults + saved scenarios once.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/launch-sim`);
        if (!res.ok) throw new Error(`failed to load (${res.status})`);
        const data = (await res.json()) as {
          scenarios: LaunchSimRecord[];
          defaults: Defaults;
        };
        if (!alive) return;
        setScenarios(data.scenarios);
        setDefaults(data.defaults);
        setInputs((cur) => ({
          ...cur,
          currency: data.defaults.currency ?? cur.currency,
          costPrice: cur.costPrice || data.defaults.suggestedCostPrice || 0,
          salePrice: cur.salePrice || data.defaults.suggestedSalePrice || 0,
          adSpendPerMonth:
            cur.adSpendPerMonth || data.defaults.suggestedAdSpendPerMonth || 0,
          fixedCostsPerMonth:
            cur.fixedCostsPerMonth || data.defaults.fixedCostsPerMonth || 0,
        }));
        if (data.scenarios[0]) {
          setActive(data.scenarios[0]);
          setInputs(data.scenarios[0].inputs);
          setName(nextName(data.scenarios));
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "Failed to load defaults");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  const run = useCallback(async () => {
    if (busy) return;
    if (inputs.salePrice <= 0 || inputs.adSpendPerMonth < 0) {
      setError("Set a sale price (and a non-negative ad spend) first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/launch-sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, name, projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `failed (${res.status})`);
      const record = data as LaunchSimRecord;
      setScenarios((s) => [record, ...s]);
      setActive(record);
      setName(nextName([record, ...scenarios]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }, [busy, inputs, name, projectId, runId, scenarios]);

  const onDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/runs/${runId}/launch-sim?scenarioId=${id}`, {
        method: "DELETE",
      });
      setScenarios((s) => s.filter((x) => x.id !== id));
      if (active?.id === id) setActive(null);
    },
    [active?.id, runId]
  );

  const set = <K extends keyof LaunchSimInputs>(
    key: K,
    value: LaunchSimInputs[K]
  ) => setInputs((cur) => ({ ...cur, [key]: value }));

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto max-w-6xl space-y-5 p-5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-indigo-600" />
          <h1 className="text-base font-semibold text-neutral-900">
            Launch Simulation
          </h1>
          <p className="ml-2 text-xs text-neutral-500">
            Fast-forward the launch over your simulated audience. Same inputs →
            same trajectory, every time.
          </p>
        </div>

        {loading ? (
          <section className="flex min-h-56 items-center justify-center rounded-xl border border-neutral-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              Loading launch simulation…
            </div>
          </section>
        ) : (
          <>
        {/* Saved scenarios */}
        {scenarios.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-neutral-500">
              Saved:
            </span>
            {scenarios.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${
                  active?.id === s.id
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                }`}
              >
                <button
                  onClick={() => {
                    setActive(s);
                    setInputs(s.inputs);
                  }}
                  title={`${fmt.money(s.result.summary.netProfit)} net profit`}
                >
                  {s.name}
                </button>
                <button
                  onClick={() => onDelete(s.id)}
                  className="opacity-0 transition group-hover:opacity-100"
                  title="Delete scenario"
                >
                  <Trash2 className="h-3 w-3 text-neutral-400 hover:text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input form */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumField
              label="Cost price"
              unit={`${currency}/unit`}
              value={inputs.costPrice}
              onChange={(v) => set("costPrice", v)}
            />
            <NumField
              label="Sale price"
              unit={`${currency}/unit`}
              value={inputs.salePrice}
              onChange={(v) => set("salePrice", v)}
            />
            <NumField
              label="Ad spend"
              unit={`${currency}/month`}
              value={inputs.adSpendPerMonth}
              onChange={(v) => set("adSpendPerMonth", v)}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Granularity
              </label>
              <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
                {(["day", "month"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => {
                      set("granularity", g);
                      set("horizon", g === "day" ? 90 : 12);
                    }}
                    className={`px-3 py-1.5 ${
                      inputs.granularity === g
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-neutral-600"
                    }`}
                  >
                    {g === "day" ? "Day-by-day" : "Month-by-month"}
                  </button>
                ))}
              </div>
            </div>
            <NumField
              label="Horizon"
              unit={inputs.granularity === "day" ? "days" : "months"}
              value={inputs.horizon}
              onChange={(v) => set("horizon", Math.round(v))}
              small
            />
            <button
              onClick={() => setShowAdvanced((s) => !s)}
              className="ml-auto flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-700"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Advanced
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-4 space-y-4 border-t border-neutral-100 pt-4">
              <AdvancedGroup
                title="Acquisition"
                description="Controls how many qualified people the launch can put into the funnel."
              >
                <NumField
                  label="Reachable pool"
                  unit="people"
                  help="Unique prospects available over the scenario. Use 0 to auto-size from the financial model."
                  value={inputs.reachablePool ?? 0}
                  onChange={(v) => set("reachablePool", v || null)}
                  small
                />
                <NumField
                  label="CPM"
                  unit={`${currency}/1k`}
                  help="Estimated currency cost per 1,000 paid impressions."
                  value={inputs.cpm}
                  onChange={(v) => set("cpm", v)}
                  small
                />
                <NumField
                  label="Frequency cap"
                  unit="impr./person"
                  help="Impressions needed before one person is likely to notice the launch."
                  value={inputs.frequencyCap}
                  onChange={(v) => set("frequencyCap", v)}
                  small
                />
                <NumField
                  label="Organic reach/step"
                  unit="people/step"
                  help="Non-paid people reached per day or month."
                  value={inputs.organicReachPerStep}
                  onChange={(v) => set("organicReachPerStep", v)}
                  small
                />
              </AdvancedGroup>

              <AdvancedGroup
                title="Funnel behavior"
                description="Controls how quickly reached people decide, drop off, or spread word of mouth."
              >
                <NumField
                  label="Targeting quality"
                  unit="%"
                  help="0% = broad delivery, 100% = strongly aimed at high-intent personas."
                  value={inputs.targetingQuality * 100}
                  onChange={(v) => set("targetingQuality", pctToRatio(v))}
                  step={5}
                  small
                />
                <NumField
                  label="Virality k"
                  unit="people/buyer"
                  help="Extra awareness created by recent buyers through referrals or sharing."
                  value={inputs.viralityK}
                  onChange={(v) => set("viralityK", v)}
                  step={0.05}
                  small
                />
                <NumField
                  label="Abandon rate"
                  unit="%"
                  help="Percent of considerers who lose interest each step before buying."
                  value={inputs.abandonRate * 100}
                  onChange={(v) => set("abandonRate", pctToRatio(v))}
                  step={1}
                  small
                />
              </AdvancedGroup>

              <AdvancedGroup
                title="Operations & costs"
                description="Controls fulfillment economics, working capital, and inventory constraints."
              >
                <NumField
                  label="Shipping/order"
                  unit={`${currency}/order`}
                  help="Outbound fulfillment cost per shipped order."
                  value={inputs.shippingPerOrder}
                  onChange={(v) => set("shippingPerOrder", v)}
                  small
                />
                <NumField
                  label="Payment fee"
                  unit="%"
                  help="Payment gateway or marketplace fee as a percent of revenue."
                  value={inputs.paymentFeePct * 100}
                  onChange={(v) => set("paymentFeePct", pctToRatio(v))}
                  step={0.5}
                  small
                />
                <NumField
                  label="Fixed costs"
                  unit={`${currency}/month`}
                  help="Monthly overhead burned regardless of sales."
                  value={inputs.fixedCostsPerMonth}
                  onChange={(v) => set("fixedCostsPerMonth", v)}
                  small
                />
                <NumField
                  label="Initial inventory"
                  unit="units"
                  help="Opening units available. Use 0 to let the simulator auto-size it."
                  value={inputs.initialInventoryUnits ?? 0}
                  onChange={(v) =>
                    set("initialInventoryUnits", v ? Math.round(v) : null)
                  }
                  small
                />
                <NumField
                  label="Reorder lead"
                  unit="days"
                  help="Days between placing replenishment and receiving sellable inventory."
                  value={inputs.reorderLeadTimeDays}
                  onChange={(v) => set("reorderLeadTimeDays", Math.round(v))}
                  small
                />
              </AdvancedGroup>

              <AdvancedGroup
                title="Returns & retention"
                description="Controls refund timing, resale value of returns, and repeat purchasing."
              >
                <NumField
                  label="Return window"
                  unit="days"
                  help="Days after purchase when refunds land in cash and inventory."
                  value={inputs.returnWindowDays}
                  onChange={(v) => set("returnWindowDays", Math.round(v))}
                  small
                />
                <NumField
                  label="Refund rate ×"
                  unit="multiplier"
                  help="Multiplier on persona-level refund risk from objections and channel."
                  value={inputs.refundRateMult}
                  onChange={(v) => set("refundRateMult", v)}
                  step={0.1}
                  small
                />
                <NumField
                  label="Resellable returns"
                  unit="%"
                  help="Percent of returned units that can be sold again."
                  value={inputs.resellablePct * 100}
                  onChange={(v) => set("resellablePct", pctToRatio(v))}
                  step={5}
                  small
                />
                <NumField
                  label="Repeat rate ×"
                  unit="multiplier"
                  help="Multiplier on segment-level repeat purchase behavior."
                  value={inputs.repeatRateMult}
                  onChange={(v) => set("repeatRateMult", v)}
                  step={0.1}
                  small
                />
              </AdvancedGroup>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-40 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
              placeholder="Scenario name"
            />
            <button
              onClick={run}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {busy ? "Simulating…" : active ? "Run new scenario" : "Run simulation"}
            </button>
            {error && <span className="text-[11px] text-red-600">{error}</span>}
          </div>
        </section>

        {active && <Results record={active} fmt={fmt} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: animated playback + stat cards + P&L + breakdowns.
// ---------------------------------------------------------------------------

function Results({
  record,
  fmt,
}: {
  record: LaunchSimRecord;
  fmt: Formatters;
}) {
  const { result } = record;
  const { summary: s, timeline, breakdowns: b } = result;
  const [visible, setVisible] = useState(timeline.length);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restart playback whenever a new scenario is shown.
  useEffect(() => {
    setVisible(timeline.length);
    setPlaying(false);
  }, [record.id, timeline.length]);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setVisible((v) => {
        if (v >= timeline.length) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, 40);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, timeline.length]);

  const play = () => {
    if (visible >= timeline.length) setVisible(1);
    setPlaying(true);
  };

  const shown = timeline.slice(0, visible);
  const chartData = shown.map((t) => ({
    label: t.label,
    orders: t.newOrders + t.repeatOrders,
    refunds: t.refunds,
    cumProfit: t.cumulativeNetProfit,
    cumCash: t.cumulativeCash,
  }));

  const costStack = [
    { name: "COGS", value: s.totalCogs },
    { name: "Ad spend", value: s.totalAdSpend },
    { name: "Shipping", value: s.totalShipping },
    { name: "Refund cost", value: s.totalRefundCost },
    { name: "Payment fees", value: s.totalPaymentFees },
    { name: "Fixed costs", value: s.totalFixedCosts },
  ].filter((c) => c.value > 0);

  return (
    <div className="space-y-5">
      <Readout diagnostics={result.diagnostics} />

      {/* Headline stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Net profit"
          value={fmt.money(s.netProfit)}
          tone={s.netProfit >= 0 ? "good" : "bad"}
          sub={`${s.netMarginPct}% net margin`}
        />
        <Stat label="Net revenue" value={fmt.money(s.netRevenue)} sub={`${fmt.money(s.grossRevenue)} gross`} />
        <Stat label="Orders" value={fmt.num(s.totalOrders)} sub={`${s.returningCustomerSharePct}% returning`} />
        <Stat
          label="Refund rate"
          value={`${s.refundRatePct}%`}
          tone={s.refundRatePct > 15 ? "bad" : "neutral"}
          sub={`${fmt.num(s.refunds)} refunds`}
        />
        <Stat label="Ad spend / conversion" value={fmt.money(s.adSpendPerConversion)} sub={`CAC ${fmt.money(s.blendedCac)}`} />
        <Stat
          label="Break-even"
          value={s.breakEvenLabel ?? "Never"}
          tone={s.breakEvenLabel ? "good" : "bad"}
          sub={`peak capital ${fmt.money(s.peakCapitalNeeded)}`}
        />
        <Stat
          label="Deadstock"
          value={fmt.num(s.deadstockUnits)}
          tone={s.deadstockValue > s.grossRevenue * 0.2 ? "bad" : "neutral"}
          sub={`${fmt.money(s.deadstockValue)} tied up`}
        />
        <Stat
          label="Stockouts"
          value={fmt.num(s.stockoutUnits)}
          tone={s.stockoutUnits > s.unitsSold * 0.1 ? "bad" : "neutral"}
          sub="lost sales (units)"
        />
      </div>

      {/* Trajectory chart with playback */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-xs font-semibold text-neutral-700">
            Trajectory — orders & cumulative profit
          </h3>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => (playing ? setPlaying(false) : play())}
              className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:border-indigo-400"
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                setVisible(timeline.length);
                setPlaying(false);
              }}
              className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:border-indigo-400"
            >
              <RotateCcw className="h-3 w-3" /> Full
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={28} />
            <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickFormatter={fmt.compact} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={fmt.compact} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v, name) => [
                name === "orders" || name === "refunds"
                  ? fmt.num(Number(v))
                  : fmt.money(Number(v)),
                String(name),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="left" dataKey="orders" fill="#6366f1" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="left" dataKey="refunds" fill="#ef4444" radius={[3, 3, 0, 0]} />
            <Line yAxisId="right" dataKey="cumProfit" stroke="#10b981" dot={false} strokeWidth={2} />
            <Line yAxisId="right" dataKey="cumCash" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mt-1 text-[10px] text-neutral-400">
          Green = cumulative net profit · amber = cumulative cash (working-capital
          view) · showing {visible}/{timeline.length} {result.resolvedInputs.granularity}s
        </p>
      </section>

      {/* P&L waterfall + funnel */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold text-neutral-700">
            Where the revenue goes
          </h3>
          <Pnl fmt={fmt} grossRevenue={s.grossRevenue} refunded={s.grossRevenue - s.netRevenue} costStack={costStack} netProfit={s.netProfit} />
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold text-neutral-700">
            Awareness funnel
          </h3>
          <Funnel
            fmt={fmt}
            impressions={s.totalImpressions}
            reached={s.totalReached}
            scrolledPast={s.totalScrolledPast}
            orders={s.totalOrders}
          />
        </section>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BreakdownCard title="Orders by channel" data={b.byChannel} fmt={fmt} />
        <BreakdownCard
          title="Orders by segment"
          data={b.bySegment}
          fmt={fmt}
          colorBy={(n) => SEGMENT_COLORS[n] ?? "#6366f1"}
        />
        <BreakdownCard title="Buyers by location" data={b.byLocality} fmt={fmt} />
        <BreakdownCard title="Buyers by age" data={b.byAgeBand} fmt={fmt} />
        <BreakdownCard title="Buyers by gender" data={b.byGender} fmt={fmt} />
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold text-neutral-700">
            New vs returning
          </h3>
          <div className="flex h-[170px] flex-col justify-center gap-3">
            <Ratio
              label="New customers"
              value={b.newVsReturning.newCustomers}
              total={b.newVsReturning.newCustomers + b.newVsReturning.returningOrders}
              color="#6366f1"
              fmt={fmt}
            />
            <Ratio
              label="Returning orders"
              value={b.newVsReturning.returningOrders}
              total={b.newVsReturning.newCustomers + b.newVsReturning.returningOrders}
              color="#10b981"
              fmt={fmt}
            />
            <p className="text-[10px] text-neutral-400">
              {s.returningCustomerSharePct}% of all orders came from repeat buyers.
            </p>
          </div>
        </section>
      </div>

      {/* Determinism footnote */}
      <p className="text-center text-[10px] text-neutral-400">
        Deterministic seed #{result.seed} · each persona represents{" "}
        {fmt.num(result.scaleFactor)} prospects · rerun these exact inputs to
        reproduce this trajectory.
      </p>
    </div>
  );
}

// --- sub-components --------------------------------------------------------

function Readout({
  diagnostics,
}: {
  diagnostics: {
    headline: string;
    drivers: string[];
    risks: string[];
    nextMoves: string[];
  };
}) {
  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <h3 className="text-xs font-semibold text-neutral-800">Simulation readout</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-neutral-700">
        {diagnostics.headline}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <ReadoutList title="Drivers" items={diagnostics.drivers} />
        <ReadoutList title="Risks" items={diagnostics.risks} />
        <ReadoutList title="Next moves" items={diagnostics.nextMoves} />
      </div>
    </section>
  );
}

function ReadoutList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-neutral-400">No major signal.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-[11px] leading-snug text-neutral-600">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-red-600"
        : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function Pnl({
  fmt,
  grossRevenue,
  refunded,
  costStack,
  netProfit,
}: {
  fmt: Formatters;
  grossRevenue: number;
  refunded: number;
  costStack: { name: string; value: number }[];
  netProfit: number;
}) {
  const rows = [
    { name: "Gross revenue", value: grossRevenue, kind: "in" as const },
    ...(refunded > 0
      ? [{ name: "− Refunds", value: -refunded, kind: "out" as const }]
      : []),
    ...costStack.map((c) => ({ name: `− ${c.name}`, value: -c.value, kind: "out" as const })),
    { name: "Net profit", value: netProfit, kind: "net" as const },
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-neutral-500">
            {r.name}
          </span>
          <div className="relative h-4 flex-1 rounded bg-neutral-100">
            <div
              className={`h-4 rounded ${
                r.kind === "in"
                  ? "bg-emerald-400"
                  : r.kind === "net"
                    ? r.value >= 0
                      ? "bg-emerald-600"
                      : "bg-red-600"
                    : "bg-red-300"
              }`}
              style={{ width: `${Math.min(100, (Math.abs(r.value) / max) * 100)}%` }}
            />
          </div>
          <span
            className={`w-24 shrink-0 text-right text-[11px] tabular-nums ${
              r.value < 0 ? "text-red-600" : "text-neutral-700"
            }`}
          >
            {fmt.money(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Funnel({
  fmt,
  impressions,
  reached,
  scrolledPast,
  orders,
}: {
  fmt: Formatters;
  impressions: number;
  reached: number;
  scrolledPast: number;
  orders: number;
}) {
  const steps = [
    { name: "Impressions", value: impressions, color: "#c7d2fe" },
    { name: "People reached", value: reached, color: "#a5b4fc" },
    { name: "Scrolled past", value: scrolledPast, color: "#fca5a5" },
    { name: "Orders", value: orders, color: "#6366f1" },
  ];
  const max = Math.max(impressions, 1);
  return (
    <div className="space-y-2">
      {steps.map((st) => (
        <div key={st.name} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[11px] text-neutral-500">
            {st.name}
          </span>
          <div className="h-5 flex-1 rounded bg-neutral-100">
            <div
              className="flex h-5 items-center rounded px-1.5 text-[10px] font-medium text-neutral-700"
              style={{
                width: `${Math.max(2, (st.value / max) * 100)}%`,
                backgroundColor: st.color,
              }}
            >
              {fmt.num(st.value)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  fmt,
  colorBy,
}: {
  title: string;
  data: { name: string; orders: number; revenue: number }[];
  fmt: Formatters;
  colorBy?: (name: string) => string;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold text-neutral-700">{title}</h3>
      {data.length === 0 ? (
        <p className="flex h-[170px] items-center justify-center text-[11px] text-neutral-400">
          No orders
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart
            data={data.slice(0, 8)}
            layout="vertical"
            margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
          >
            <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmt.compact} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 9 }}
              width={90}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v, _k, item) => [
                `${fmt.num(Number(v))} orders · ${fmt.money((item?.payload as { revenue?: number })?.revenue ?? 0)}`,
                "",
              ]}
            />
            <Bar dataKey="orders" radius={[0, 3, 3, 0]}>
              {data.slice(0, 8).map((d) => (
                <Cell key={d.name} fill={colorBy?.(d.name) ?? "#6366f1"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function Ratio({
  label,
  value,
  total,
  color,
  fmt,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  fmt: Formatters;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-neutral-600">
        <span>{label}</span>
        <span className="tabular-nums">
          {fmt.num(value)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-3 rounded bg-neutral-100">
        <div className="h-3 rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function AdvancedGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[11px] font-semibold text-neutral-800">{title}</h3>
        <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
          {description}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function NumField({
  label,
  unit,
  help,
  value,
  onChange,
  step,
  small,
}: {
  label: string;
  unit?: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  small?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full rounded-lg border border-neutral-300 px-2.5 outline-none focus:border-indigo-500 ${
            unit ? "pr-24" : ""
          } ${small ? "py-1 text-xs" : "py-1.5 text-sm"}`}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex max-w-20 items-center truncate text-[10px] font-medium text-neutral-400">
            {unit}
          </span>
        )}
      </div>
      {help && (
        <p className="mt-1 text-[10px] leading-snug text-neutral-400">
          {help}
        </p>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

type Formatters = {
  money: (n: number) => string;
  num: (n: number) => string;
  compact: (n: number) => string;
};

function makeFormatters(currency: string): Formatters {
  let money: (n: number) => string;
  try {
    const f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    money = (n) => f.format(n);
  } catch {
    money = (n) => `${currency} ${Math.round(n).toLocaleString()}`;
  }
  const compactF = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    money,
    num: (n) => Math.round(n).toLocaleString(),
    compact: (n) => compactF.format(n),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pctToRatio = (v: number) => clamp01(v / 100);

function nextName(scenarios: LaunchSimRecord[]): string {
  return `Scenario ${scenarios.length + 1}`;
}

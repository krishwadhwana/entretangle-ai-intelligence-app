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
  Globe,
  FileDown,
  Trash2,
} from "lucide-react";
import { SEGMENT_COLORS } from "./segments";
import { ValueTooltip } from "./ValueTooltip";
import { downloadDossier, slug, type DossierSection } from "./pdf";
import type {
  AssumptionUpdate,
  LaunchSimInputs,
  LaunchSimRecord,
} from "@/lib/schema";

// ---------------------------------------------------------------------------
// Launch Simulation view. Feed cost / sale price / ad spend, fast-forward the
// launch day-by-day (or month-by-month), and read the full trajectory: orders
// by channel, scroll-past, refunds, P&L, deadstock, demographics, returning
// customers. Reruns with identical inputs reproduce identical results — the
// engine (lib/launchSim.ts) is a pure function of its inputs.
// ---------------------------------------------------------------------------

type Defaults = {
  currency: string;
  suggestedBusinessModel: LaunchSimInputs["businessModel"];
  suggestedCostPrice: number | null;
  suggestedSalePrice: number | null;
  suggestedAdSpendPerMonth: number | null;
  reachableProspectsPerMonth: number | null;
  availableRegions?: string[];
  regionShares?: Record<string, number>;
  fixedCostsPerMonth: number | null;
  benchmarks?: {
    suggestedCpm: number;
    suggestedShippingPerOrder: number;
    returnRatePct: number;
    repeatRatePct: number;
    codSharePct: number;
    peakMonths: string[];
    confidence: number;
    sources: string[];
  } | null;
};

const DEFAULT_INPUTS: LaunchSimInputs = {
  currency: "INR",
  businessModel: "generic",
  costPrice: 0,
  salePrice: 0,
  adSpendPerMonth: 0,
  region: null, // null → whole audience; or a GoI zone to scope the launch
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
  launchStartMonth: null, // null → server pins to current month on run
  demandMomentumPct: 0, // null/0 → server fills from attention/hype momentum
  shippingPerOrder: 120,
  paymentFeePct: 0.02,
  fixedCostsPerMonth: 0,
  returnWindowDays: 30,
  refundRateMult: 1,
  targetRefundRatePct: null, // null → server anchors to the benchmark returns rate
  resellablePct: 0.7,
  returnShippingPerOrder: null,
  initialInventoryUnits: null,
  reorderLeadTimeDays: 30,
  reorderEnabled: true,
  repeatRateMult: 1,
  jitterAmplitude: 0.06,
  channels: [],
};

const BUSINESS_MODEL_OPTIONS: {
  value: LaunchSimInputs["businessModel"];
  label: string;
}[] = [
  { value: "generic", label: "Generic" },
  { value: "apparel", label: "Apparel" },
  { value: "furniture", label: "Furniture" },
  { value: "consumable", label: "Consumable" },
  { value: "saas", label: "SaaS" },
  { value: "services", label: "Services" },
  { value: "marketplace", label: "Marketplace" },
];

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
  // Live market-data sourcing (web-grounded, cited): refreshes the benchmark
  // priors for this venture's country × category. Applied on the next run.
  const [sourcing, setSourcing] = useState(false);
  const [sourced, setSourced] = useState<string | null>(null);

  const currency = inputs.currency || defaults?.currency || "INR";

  const sourceMarketData = useCallback(async () => {
    if (!projectId || sourcing) return;
    setSourcing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/market-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `sourcing failed (${res.status})`);
      const n = data?.datum?.sources?.length ?? 0;
      setSourced(
        n > 0
          ? `Sourced ${data.datum.country} ${data.datum.category} data (${n} source${n === 1 ? "" : "s"}) — re-run to apply.`
          : "No new figures found; keeping curated priors."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "market data sourcing failed");
    } finally {
      setSourcing(false);
    }
  }, [projectId, sourcing]);
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
          businessModel:
            cur.businessModel === "generic"
              ? data.defaults.suggestedBusinessModel
              : cur.businessModel,
          costPrice: cur.costPrice || data.defaults.suggestedCostPrice || 0,
          salePrice: cur.salePrice || data.defaults.suggestedSalePrice || 0,
          adSpendPerMonth:
            cur.adSpendPerMonth || data.defaults.suggestedAdSpendPerMonth || 0,
          fixedCostsPerMonth:
            cur.fixedCostsPerMonth || data.defaults.fixedCostsPerMonth || 0,
          // Prefill CPM / shipping with category × geo benchmark numbers, but
          // only while they're still at the universal defaults (don't clobber
          // a value the founder has already changed).
          cpm:
            cur.cpm === DEFAULT_INPUTS.cpm && data.defaults.benchmarks
              ? data.defaults.benchmarks.suggestedCpm
              : cur.cpm,
          shippingPerOrder:
            cur.shippingPerOrder === DEFAULT_INPUTS.shippingPerOrder &&
            data.defaults.benchmarks
              ? data.defaults.benchmarks.suggestedShippingPerOrder
              : cur.shippingPerOrder,
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

  // A knowledge-driven re-run produced a new scenario — surface it like any run.
  const onRerun = useCallback(
    (record: LaunchSimRecord) => {
      setScenarios((s) => [record, ...s]);
      setActive(record);
      setInputs(record.inputs);
      setName(nextName([record, ...scenarios]));
    },
    [scenarios]
  );

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
                  title={`${fmt.money(s.result.summary.netProfit)} net profit${
                    s.inputs.region ? ` · ${s.inputs.region} region` : ""
                  }`}
                >
                  {s.name}
                  {s.inputs.region && (
                    <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-px text-[9px] font-semibold text-indigo-600">
                      {s.inputs.region}
                    </span>
                  )}
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
                Product model
              </label>
              <select
                value={inputs.businessModel}
                onChange={(e) => {
                  set("businessModel", e.target.value as LaunchSimInputs["businessModel"]);
                  set("channels", []);
                }}
                className="h-[31px] rounded-lg border border-neutral-300 bg-white px-2.5 text-xs outline-none focus:border-indigo-500"
              >
                {BUSINESS_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {(defaults?.availableRegions?.length ?? 0) > 1 && (
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Audience
                </label>
                <select
                  value={inputs.region ?? ""}
                  onChange={(e) => set("region", e.target.value || null)}
                  className="h-[31px] rounded-lg border border-neutral-300 bg-white px-2.5 text-xs outline-none focus:border-indigo-500"
                  title="Run this launch for the whole audience or one region only"
                >
                  <option value="">Whole audience</option>
                  {defaults?.availableRegions?.map((r) => (
                    <option key={r} value={r}>
                      {r} region only
                    </option>
                  ))}
                </select>
                {inputs.region && (
                  <p className="mt-1 max-w-[200px] text-[10px] leading-snug text-neutral-400">
                    {inputs.region} ≈{" "}
                    {Math.round(
                      (defaults?.regionShares?.[inputs.region] ?? 0) * 100
                    )}
                    % of the audience — this run uses that share of your reach, ad
                    spend &amp; fixed costs, so regions add up to the whole.
                  </p>
                )}
              </div>
            )}
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
                  help="Unique prospects available over the scenario. Use 0 to auto-size. Small test: 5k-25k; niche launch: 50k-250k; broad market: 1M+."
                  value={inputs.reachablePool ?? 0}
                  onChange={(v) => set("reachablePool", v || null)}
                  small
                />
                <NumField
                  label="CPM"
                  unit={`${currency}/1k`}
                  help={`Cost per 1,000 paid impressions. Cheap reach: ${currency}100-250; premium/niche: ${currency}500-1,500+.`}
                  value={inputs.cpm}
                  onChange={(v) => set("cpm", v)}
                  small
                />
                <NumField
                  label="Frequency cap"
                  unit="impr./person"
                  help="Impressions needed before notice. 1-2 = light touch; 3-5 = normal launch; 6+ = heavy retargeting."
                  value={inputs.frequencyCap}
                  onChange={(v) => set("frequencyCap", v)}
                  small
                />
                <NumField
                  label="Organic reach/step"
                  unit="people/step"
                  help="Non-paid people reached per day or month. 0 = no organic channel; 100-1k = early audience; 10k+ = strong owned/creator reach."
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
                  help="0% = broad delivery; 50% = decent targeting; 80%+ = tightly aimed at high-intent personas."
                  value={inputs.targetingQuality * 100}
                  onChange={(v) => set("targetingQuality", pctToRatio(v))}
                  step={5}
                  small
                />
                <NumField
                  label="Virality k"
                  unit="people/buyer"
                  help="Extra people reached per buyer. 0.00 = no word of mouth; 0.05-0.20 = modest sharing; 0.50+ = unusually viral."
                  value={inputs.viralityK}
                  onChange={(v) => set("viralityK", v)}
                  step={0.05}
                  small
                />
                <NumField
                  label="Abandon rate"
                  unit="%"
                  help="Percent of considerers who lose interest each step. 2-5% = sticky demand; 10-20% = weak urgency or unclear offer."
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
                  help="Payment gateway or marketplace fee. Cards/direct checkout: 1.5-3%; marketplaces can be 8-25%."
                  value={inputs.paymentFeePct * 100}
                  onChange={(v) => set("paymentFeePct", pctToRatio(v))}
                  step={0.5}
                  small
                />
                <NumField
                  label="Fixed costs"
                  unit={`${currency}/month`}
                  help="Monthly overhead before variable costs: tools, retainers, salaries, rent, storage, and production admin."
                  value={inputs.fixedCostsPerMonth}
                  onChange={(v) => set("fixedCostsPerMonth", v)}
                  small
                />
                <NumField
                  label="Initial inventory"
                  unit="units"
                  help="Opening sellable units. Use 0 to auto-size from expected first wave demand."
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
                  help="Scales persona refund risk. 1.0 = model baseline; 0.5 = half as many refunds; 2.0 = twice as many."
                  value={inputs.refundRateMult}
                  onChange={(v) => set("refundRateMult", v)}
                  step={0.1}
                  small
                />
                <NumField
                  label="Resellable returns"
                  unit="%"
                  help="Returned units that can be sold again. Apparel often 50-80%; custom or damaged goods can be much lower."
                  value={inputs.resellablePct * 100}
                  onChange={(v) => set("resellablePct", pctToRatio(v))}
                  step={5}
                  small
                />
                <NumField
                  label="Repeat rate ×"
                  unit="multiplier"
                  help="Scales repeat purchase behavior. 1.0 = segment baseline; 0.5 = weak retention; 2.0 = strong repeat demand."
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
            {projectId && (
              <button
                type="button"
                onClick={() => void sourceMarketData()}
                disabled={sourcing}
                title="Web-search current, cited benchmarks for this venture's market & category, then apply them to the priors"
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-60"
              >
                {sourcing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
                {sourcing ? "Sourcing…" : "Source live market data"}
              </button>
            )}
            {error && <span className="text-[11px] text-red-600">{error}</span>}
            {sourced && !error && (
              <span className="text-[11px] text-emerald-600">{sourced}</span>
            )}
          </div>
        </section>

        {active && (
          <Results record={active} fmt={fmt} runId={runId} onRerun={onRerun} />
        )}

        <OutcomeCapture
          runId={runId}
          activeScenarioId={active?.id ?? null}
          fmt={fmt}
        />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutcomeCapture: record a REAL launch outcome (the first-party moat) and show
// the backtest score — predicted-vs-actual + the benchmark refund-calibration
// A/B. POSTs to /api/runs/[id]/launch-outcome (which freezes the audience).
// Requires the launch_outcomes table (npm run db:migrate); degrades to a note
// if the endpoint is unavailable.
// ---------------------------------------------------------------------------

type OutcomeScore = {
  mapePct: number | null;
  errors: { metric: string; predicted: number; actual: number; absPctError: number }[];
  refundAb: {
    actual: number | null;
    calibratedPred: number;
    uncalibratedPred: number;
    winner: "calibrated" | "uncalibrated" | "tie" | "n/a";
  };
};
type CapturedOutcome = {
  id: string;
  label: string;
  createdAt: string;
  score: OutcomeScore | null;
  error: string | null;
};

const OUTCOME_FIELDS: { key: string; label: string }[] = [
  { key: "refundRatePct", label: "Returns/RTO %" },
  { key: "totalOrders", label: "Total orders" },
  { key: "unitsSold", label: "Units sold" },
  { key: "grossRevenue", label: "Gross revenue" },
  { key: "blendedCac", label: "Blended CAC" },
];

function OutcomeCapture({
  runId,
  activeScenarioId,
  fmt,
}: {
  runId: string;
  activeScenarioId: string | null;
  fmt: Formatters;
}) {
  const [outcomes, setOutcomes] = useState<CapturedOutcome[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/launch-outcome`);
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = (await res.json()) as { outcomes: CapturedOutcome[] };
      setOutcomes(data.outcomes ?? []);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(async () => {
    if (busy) return;
    const actual: Record<string, number> = {};
    for (const f of OUTCOME_FIELDS) {
      const v = form[f.key];
      if (v != null && v.trim() !== "" && Number.isFinite(Number(v))) {
        actual[f.key] = Number(v);
      }
    }
    if (Object.keys(actual).length === 0) {
      setErr("Enter at least one actual metric.");
      return;
    }
    if (!activeScenarioId) {
      setErr("Run or select a scenario first — its inputs are replayed for the backtest.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/launch-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual,
          scenarioId: activeScenarioId,
          label: `Outcome ${new Date().toISOString().slice(0, 10)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `failed (${res.status})`);
      setForm({});
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to record outcome");
    } finally {
      setBusy(false);
    }
  }, [busy, form, activeScenarioId, runId, load]);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="text-xs font-semibold text-neutral-700">
        Actual outcome & backtest
      </h3>
      <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
        Record what really happened to score the simulation against reality. The
        audience is frozen on capture and replayed through the engine.
      </p>

      {unavailable ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Outcome capture isn’t available yet — run <code>npm run db:migrate</code>{" "}
          to create the <code>launch_outcomes</code> table.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {OUTCOME_FIELDS.map((f) => (
              <label key={f.key} className="text-[10px] text-neutral-500">
                {f.label}
                <input
                  type="number"
                  value={form[f.key] ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, [f.key]: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2 py-1 text-[11px] tabular-nums"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {busy ? "Recording…" : "Record outcome"}
            </button>
            {err && <span className="text-[11px] text-red-600">{err}</span>}
          </div>

          {outcomes.length > 0 && (
            <div className="mt-4 space-y-3">
              {outcomes.map((o) => (
                <OutcomeRow key={o.id} outcome={o} fmt={fmt} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OutcomeRow({
  outcome,
  fmt,
}: {
  outcome: CapturedOutcome;
  fmt: Formatters;
}) {
  const s = outcome.score;
  const ab = s?.refundAb;
  return (
    <div className="rounded-lg border border-neutral-100 p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-neutral-700">{outcome.label}</span>
        <span className="text-neutral-400">
          {s?.mapePct != null ? `MAPE ${s.mapePct}%` : outcome.error ?? "—"}
        </span>
      </div>
      {s && s.errors.length > 0 && (
        <table className="mt-2 w-full text-[10px] tabular-nums">
          <thead>
            <tr className="text-neutral-400">
              <td className="text-left font-normal">metric</td>
              <td className="text-right font-normal">predicted</td>
              <td className="text-right font-normal">actual</td>
              <td className="text-right font-normal">err</td>
            </tr>
          </thead>
          <tbody>
            {s.errors.map((e) => (
              <tr key={e.metric} className="text-neutral-600">
                <td className="text-left">{e.metric}</td>
                <td className="text-right">{fmt.num(e.predicted)}</td>
                <td className="text-right">{fmt.num(e.actual)}</td>
                <td className="text-right">{e.absPctError}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ab && ab.actual != null && (
        <p className="mt-2 text-[10px] text-neutral-500">
          Refund calibration: actual {ab.actual}% · benchmark-calibrated{" "}
          {ab.calibratedPred}% · uncalibrated {ab.uncalibratedPred}% →{" "}
          <span
            className={
              ab.winner === "calibrated"
                ? "font-medium text-emerald-600"
                : "text-neutral-500"
            }
          >
            {ab.winner} closer
          </span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: animated playback + stat cards + P&L + breakdowns.
// ---------------------------------------------------------------------------

function Results({
  record,
  fmt,
  runId,
  onRerun,
}: {
  record: LaunchSimRecord;
  fmt: Formatters;
  runId: string;
  onRerun: (record: LaunchSimRecord) => void;
}) {
  const { result } = record;
  const { summary: s, timeline, breakdowns: b } = result;
  const [visible, setVisible] = useState(timeline.length);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // "Ask about this scenario" follow-up Q&A (persisted on the scenario).
  const [followUp, setFollowUp] = useState(record.followUp ?? []);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  useEffect(() => {
    setFollowUp(record.followUp ?? []);
  }, [record.id, record.followUp]);
  // Knowledge-driven re-run: add a real fact → propose justified deltas → approve
  // → merge into THIS scenario's inputs → deterministic re-run as a new scenario.
  const [knowledge, setKnowledge] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<AssumptionUpdate | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [rerunning, setRerunning] = useState(false);
  const [kError, setKError] = useState<string | null>(null);

  const propose = async () => {
    const k = knowledge.trim();
    if (!k || proposing) return;
    setProposing(true);
    setKError(null);
    setProposal(null);
    try {
      const res = await fetch(`/api/runs/${runId}/launch-sim/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: record.id, knowledge: k }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `propose failed (${res.status})`);
      const update = data.update as AssumptionUpdate;
      setProposal(update);
      setAccepted(new Set(update.changes.map((_, i) => i))); // default: accept all
    } catch (e) {
      setKError(e instanceof Error ? e.message : "propose failed");
    } finally {
      setProposing(false);
    }
  };

  const applyAndRerun = async () => {
    if (!proposal || rerunning) return;
    setRerunning(true);
    setKError(null);
    try {
      const mergedInputs: LaunchSimInputs = { ...record.inputs };
      proposal.changes.forEach((c, i) => {
        if (accepted.has(i)) {
          (mergedInputs as Record<string, unknown>)[c.field] = c.proposedValue;
        }
      });
      const res = await fetch(`/api/runs/${runId}/launch-sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: mergedInputs,
          name: `${record.name} + knowledge`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `re-run failed (${res.status})`);
      onRerun(data as LaunchSimRecord);
      setProposal(null);
      setKnowledge("");
    } catch (e) {
      setKError(e instanceof Error ? e.message : "re-run failed");
    } finally {
      setRerunning(false);
    }
  };

  const ask = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true);
    setQaError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/launch-sim/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: record.id, question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `ask failed (${res.status})`);
      setFollowUp(data.followUp ?? []);
      setQ("");
    } catch (e) {
      setQaError(e instanceof Error ? e.message : "ask failed");
    } finally {
      setAsking(false);
    }
  };

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

  const exportPdf = () => {
    const d = result.diagnostics;
    const cur = record.inputs.currency;
    const sections: DossierSection[] = [];
    if (d.headline) sections.push({ heading: "Verdict", body: d.headline });
    sections.push({
      heading: "Key metrics",
      bullets: [
        `Net profit: ${fmt.money(s.netProfit)} (${s.netMarginPct}% net margin)`,
        `Net revenue: ${fmt.money(s.netRevenue)} (gross ${fmt.money(s.grossRevenue)})`,
        `Orders: ${fmt.num(s.totalOrders)} · ${s.returningCustomerSharePct}% returning`,
        `Refund rate: ${s.refundRatePct}% (${fmt.num(s.refunds)} refunds)`,
        `Blended CAC: ${fmt.money(s.blendedCac)}`,
        `Break-even: ${s.breakEvenLabel ?? "Never"}`,
      ],
    });
    if (d.drivers.length) sections.push({ heading: "What's driving it", bullets: d.drivers });
    if (d.risks.length) sections.push({ heading: "Risks", bullets: d.risks });
    if (d.nextMoves.length) sections.push({ heading: "Next moves", bullets: d.nextMoves });
    if (followUp.length)
      sections.push(
        { heading: "Follow-up — Q&A" },
        ...followUp.map((t, i) => ({ heading: `${i + 1}. ${t.question}`, body: t.answer }))
      );
    downloadDossier(
      {
        title: `Launch simulation — ${record.name}`,
        subtitle: record.inputs.region
          ? `${record.inputs.region} region`
          : "Whole audience",
        meta: [
          `${record.inputs.horizon} ${record.inputs.granularity === "day" ? "days" : "months"}`,
          cur,
          new Date().toLocaleDateString(),
        ],
        sections,
      },
      `launch-${slug(record.name)}-dossier`
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Readout diagnostics={result.diagnostics} />
        </div>
        <button
          onClick={exportPdf}
          title="Export this launch scenario's conclusion as a PDF"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-400"
        >
          <FileDown className="h-3.5 w-3.5" /> Create PDF
        </button>
      </div>

      {/* Ask about this scenario */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <p className="mb-2 text-xs font-semibold text-neutral-800">
          Ask about this scenario
        </p>
        {followUp.length > 0 && (
          <ul className="mb-2 space-y-2">
            {followUp.map((t, i) => (
              <li key={i} className="text-[11px] leading-snug">
                <p className="font-medium text-neutral-700">{t.question}</p>
                <p className="mt-0.5 text-neutral-600">{t.answer}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder="e.g. why does profit dip after month 6? what lifts CAC?"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => void ask()}
            disabled={asking || !q.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Ask
          </button>
        </div>
        {qaError && <p className="mt-1 text-[11px] text-red-600">{qaError}</p>}
      </div>

      {/* Add knowledge & re-run */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-800">
          <Settings2 className="h-3.5 w-3.5 text-indigo-600" /> Add knowledge &amp; re-run
        </p>
        <p className="mb-2 text-[11px] text-neutral-500">
          Tell the model something it didn&apos;t know (e.g. &ldquo;essential everyday
          wear, customers rebuy every ~4 months, our real return rate is ~9%&rdquo;). It
          proposes justified assumption changes — you approve before it re-runs.
        </p>
        <div className="flex gap-2">
          <textarea
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
            rows={2}
            placeholder="What's true about this product that the simulation didn't capture?"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => void propose()}
            disabled={proposing || !knowledge.trim()}
            className="flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Propose updates
          </button>
        </div>

        {proposal && (
          <div className="mt-3 space-y-2">
            {proposal.summary && (
              <p className="text-[11px] text-neutral-600">{proposal.summary}</p>
            )}
            {proposal.changes.length === 0 ? (
              <p className="text-[11px] text-neutral-500">
                No assumption changes are justified by this — the current result stands.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {proposal.changes.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-neutral-200 bg-white p-2"
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={accepted.has(i)}
                        onChange={(e) =>
                          setAccepted((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-neutral-800">
                          {c.label}:{" "}
                          <span className="tabular-nums text-neutral-500">
                            {c.currentValue ?? "—"}
                          </span>
                          {" → "}
                          <span className="tabular-nums font-semibold text-indigo-700">
                            {c.proposedValue}
                          </span>
                          <span className="ml-1 text-[10px] font-normal text-neutral-400">
                            ({Math.round(c.confidence * 100)}% conf)
                          </span>
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
                          {c.rationale}
                        </p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {proposal.caveats.length > 0 && (
              <ul className="space-y-0.5 text-[10px] text-amber-700">
                {proposal.caveats.map((cv, i) => (
                  <li key={i}>⚠ {cv}</li>
                ))}
              </ul>
            )}
            {proposal.changes.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void applyAndRerun()}
                  disabled={rerunning || accepted.size === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {rerunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Re-run with {accepted.size} change{accepted.size === 1 ? "" : "s"}
                </button>
                <button
                  onClick={() => setProposal(null)}
                  disabled={rerunning}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        )}
        {kError && <p className="mt-1 text-[11px] text-red-600">{kError}</p>}
      </div>

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
          label="Product visits"
          value={fmt.num(s.totalProductVisits)}
          sub={`${fmt.num(s.totalCheckoutsStarted)} checkout starts`}
        />
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
            Acquisition funnel
          </h3>
          <Funnel
            fmt={fmt}
            impressions={s.totalImpressions}
            reached={s.totalReached}
            engaged={s.totalEngaged}
            productVisits={s.totalProductVisits}
            checkoutsStarted={s.totalCheckoutsStarted}
            scrolledPast={s.totalScrolledPast}
            orders={s.totalOrders}
          />
        </section>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AcquisitionChannelTable
          data={b.byAcquisitionChannel}
          fmt={fmt}
        />
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

      <Assumptions assumptions={result.assumptions} fmt={fmt} />

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
            <ValueTooltip content={`${r.name}: ${fmt.money(r.value)}`}>
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
            </ValueTooltip>
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
  engaged,
  productVisits,
  checkoutsStarted,
  scrolledPast,
  orders,
}: {
  fmt: Formatters;
  impressions: number;
  reached: number;
  engaged: number;
  productVisits: number;
  checkoutsStarted: number;
  scrolledPast: number;
  orders: number;
}) {
  const steps = [
    { name: "Impressions", value: impressions, color: "#c7d2fe" },
    { name: "People reached", value: reached, color: "#a5b4fc" },
    { name: "Engaged", value: engaged, color: "#93c5fd" },
    { name: "Product visits", value: productVisits, color: "#67e8f9" },
    { name: "Checkout starts", value: checkoutsStarted, color: "#5eead4" },
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
            <ValueTooltip
              content={`${st.name}: ${fmt.num(st.value)} (${((st.value / max) * 100).toFixed(1)}% of impressions)`}
            >
              <div
                className="flex h-5 items-center rounded px-1.5 text-[10px] font-medium text-neutral-700"
                style={{
                  width: `${Math.max(2, (st.value / max) * 100)}%`,
                  backgroundColor: st.color,
                }}
              >
                {fmt.num(st.value)}
              </div>
            </ValueTooltip>
          </div>
        </div>
      ))}
    </div>
  );
}

function AcquisitionChannelTable({
  data,
  fmt,
}: {
  data: {
    id: string;
    name: string;
    kind: string;
    impressions: number;
    reached: number;
    productVisits: number;
    checkoutsStarted: number;
    orders: number;
    revenue: number;
    adSpend: number;
    cac: number;
  }[];
  fmt: Formatters;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold text-neutral-700">
        Acquisition by channel
      </h3>
      {data.length === 0 ? (
        <p className="flex h-[170px] items-center justify-center text-[11px] text-neutral-400">
          No channel activity
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">Channel</th>
                <th className="pb-2 text-right font-medium">Visits</th>
                <th className="pb-2 text-right font-medium">Checkouts</th>
                <th className="pb-2 text-right font-medium">Orders</th>
                <th className="pb-2 text-right font-medium">Spend</th>
                <th className="pb-2 text-right font-medium">CAC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.slice(0, 6).map((row) => (
                <tr key={row.id}>
                  <td className="py-2">
                    <div className="font-medium text-neutral-700">{row.name}</div>
                    <div className="text-[10px] text-neutral-400">
                      {row.kind} · {fmt.num(row.reached)} reached
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">
                    {fmt.num(row.productVisits)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">
                    {fmt.num(row.checkoutsStarted)}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium text-neutral-800">
                    {fmt.num(row.orders)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">
                    {fmt.money(row.adSpend)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">
                    {row.cac > 0 ? fmt.money(row.cac) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
        <ValueTooltip content={`${label}: ${fmt.num(value)} (${pct.toFixed(1)}%)`}>
          <div className="h-3 rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
        </ValueTooltip>
      </div>
    </div>
  );
}

function Assumptions({
  assumptions,
  fmt,
}: {
  assumptions: LaunchSimRecord["result"]["assumptions"];
  fmt: Formatters;
}) {
  if (!assumptions || assumptions.length === 0) return null;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="text-xs font-semibold text-neutral-700">
        Assumptions & confidence
      </h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {assumptions.map((a) => (
          <div key={a.key} className="border-t border-neutral-100 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-neutral-700">
                  {a.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-neutral-400">
                  {a.basis}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-semibold text-neutral-800">
                  {formatAssumptionValue(a.value, a.unit, fmt)}
                </p>
                <p className="text-[10px] text-neutral-400">
                  {a.source.replace("_", " ")} · {(a.confidence * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatAssumptionValue(
  value: string | number,
  unit: string,
  fmt: Formatters
): string {
  if (typeof value === "string") return value;
  const formatted =
    Math.abs(value) < 10 && !Number.isInteger(value)
      ? value.toFixed(2).replace(/\.?0+$/, "")
      : fmt.num(value);
  return unit ? `${formatted} ${unit}` : formatted;
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
  // Local text buffer so the field can be emptied while typing — the parent
  // still holds a number. Without this, backspacing to "" snaps back to 0 and
  // the 0 acts like un-deletable text instead of a placeholder.
  const [text, setText] = useState(
    Number.isFinite(value) ? String(value) : ""
  );
  const editing = useRef(false);

  // Reflect external value changes (recompute, reset, scenario load) only when
  // the user isn't actively editing this field.
  useEffect(() => {
    if (!editing.current) setText(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          placeholder="0"
          step={step}
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={() => {
            editing.current = false;
            // Normalise the display to the canonical value on blur.
            setText(Number.isFinite(value) ? String(value) : "");
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            // Empty / partial ("-", ".") report 0 to the parent but keep the raw
            // text so the user can keep typing.
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? n : 0);
          }}
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

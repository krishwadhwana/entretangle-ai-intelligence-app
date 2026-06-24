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
  Pencil,
  Check,
  X,
} from "lucide-react";
import { SEGMENT_COLORS } from "./segments";
import { ValueTooltip } from "./ValueTooltip";
import {
  downloadDossier,
  slug,
  type Bar as PdfBar,
  type DossierSection,
  type KPI as PdfKPI,
  type Series as PdfSeries,
} from "./pdf";
import type {
  AssumptionUpdate,
  LaunchModelBenchmarkInputs,
  LaunchSimInputs,
  LaunchSimRecord,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";

// ---------------------------------------------------------------------------
// Launch Simulation view. Feed cost / sale price / ad spend, fast-forward the
// launch day-by-day (or month-by-month), and read the full trajectory: orders
// by channel, scroll-past, refunds, P&L, deadstock, demographics, returning
// customers. Reruns with identical inputs reproduce identical results — the
// engine (lib/launchSim.ts) is a pure function of its inputs.
// ---------------------------------------------------------------------------

type Defaults = {
  currency: string;
  displayCurrency?: string;
  displayFxRate?: number;
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
  modelBenchmarks?: LaunchModelBenchmarkInputs | null;
};

// Turn an API error payload into a readable string. A 400 returns Zod issues as
// an ARRAY of objects; `new Error(array)` would stringify to "[object Object]".
function apiErrorMessage(err: unknown, fallback: string): string {
  const providerMessage = providerErrorMessage(err, "");
  if (providerMessage) return providerMessage;
  if (typeof err === "string") return err;
  if (Array.isArray(err)) {
    const msgs = err
      .map((i) => {
        const issue = i as { path?: (string | number)[]; message?: string };
        const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
        return issue?.message ? `${path}${issue.message}` : null;
      })
      .filter(Boolean) as string[];
    return msgs.length ? msgs.join("; ") : fallback;
  }
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : JSON.stringify(err).slice(0, 240);
  }
  return fallback;
}

const DEFAULT_INPUTS: LaunchSimInputs = {
  currency: "INR",
  businessModel: "generic",
  costPrice: 0,
  salePrice: 0,
  adSpendPerMonth: 0,
  paidCac: null,
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
  monthlyGrowthPct: null,
  shippingPerOrder: 120,
  paymentFeePct: 0.02,
  fixedCostsPerMonth: 0,
  launchInvestmentReserve: null,
  rentalAssetCount: 3,
  rentalAssetCost: 0,
  rentalRentableDaysPerMonth: 24,
  rentalAvgDurationDays: 1,
  rentalMaintenancePerOrder: 0,
  rentalDamageLossPct: 0,
  rentalDepositAmount: 0,
  subscriptionMonthlyChurnPct: 5,
  bookingCapacityPerMonth: 120,
  usageEventsPerCustomerPerMonth: 4,
  usageMonthlyChurnPct: 8,
  projectCapacityPerMonth: 4,
  returnWindowDays: 30,
  refundRateMult: 1,
  targetRefundRatePct: null, // null → server anchors to the benchmark returns rate
  resellablePct: 0.7,
  returnShippingPerOrder: null,
  initialInventoryUnits: null,
  reorderLeadTimeDays: 30,
  reorderEnabled: true,
  minOrderQtyUnits: null,
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
  { value: "rental", label: "Rental / asset" },
  { value: "subscription", label: "Subscription" },
  { value: "booking", label: "Booking / capacity" },
  { value: "usage_based", label: "Usage-based" },
  { value: "lead_gen", label: "Lead-gen / commission" },
  { value: "project_services", label: "Project services" },
  { value: "marketplace", label: "Marketplace" },
];

function benchmarkMid(
  range: { mid: number } | null | undefined
): number | null {
  return range && Number.isFinite(range.mid) ? range.mid : null;
}

function applyNumberBenchmark<K extends keyof LaunchSimInputs & keyof LaunchModelBenchmarkInputs>(
  inputs: LaunchSimInputs,
  key: K,
  defaultValue: number,
  benchmarks: LaunchModelBenchmarkInputs | null | undefined,
  transform: (n: number) => number = (n) => n
): LaunchSimInputs {
  const mid = benchmarkMid(benchmarks?.[key]);
  const current = inputs[key];
  if (mid == null || typeof current !== "number" || current !== defaultValue) {
    return inputs;
  }
  return { ...inputs, [key]: transform(mid) } as LaunchSimInputs;
}

function applyModelDefaults(
  inputs: LaunchSimInputs,
  previousModel: LaunchSimInputs["businessModel"],
  defaults: Defaults | null
): LaunchSimInputs {
  const modelChanged = previousModel !== inputs.businessModel;
  const benchmarks = defaults?.modelBenchmarks ?? null;
  let next: LaunchSimInputs = { ...inputs };

  if (inventorylessModel(next.businessModel)) {
    next = {
      ...next,
      initialInventoryUnits: null,
      minOrderQtyUnits: null,
    };
  }

  if (next.businessModel === "rental") {
    if (
      modelChanged ||
      next.costPrice === DEFAULT_INPUTS.costPrice ||
      next.costPrice === defaults?.suggestedCostPrice
    ) {
      next = { ...next, costPrice: 0 };
    }
    next = applyNumberBenchmark(
      next,
      "rentalRentableDaysPerMonth",
      DEFAULT_INPUTS.rentalRentableDaysPerMonth,
      benchmarks,
      (n) => Math.max(1, Math.min(31, Math.round(n)))
    );
    next = applyNumberBenchmark(
      next,
      "rentalAvgDurationDays",
      DEFAULT_INPUTS.rentalAvgDurationDays,
      benchmarks,
      (n) => Math.max(0.25, n)
    );
    next = applyNumberBenchmark(
      next,
      "rentalMaintenancePerOrder",
      DEFAULT_INPUTS.rentalMaintenancePerOrder,
      benchmarks,
      (n) => Math.max(0, Math.round(n))
    );
    next = applyNumberBenchmark(
      next,
      "rentalDamageLossPct",
      DEFAULT_INPUTS.rentalDamageLossPct,
      benchmarks,
      (n) => Math.max(0, Math.min(100, n))
    );
    next = applyNumberBenchmark(
      next,
      "rentalDepositAmount",
      DEFAULT_INPUTS.rentalDepositAmount,
      benchmarks,
      (n) => Math.max(0, Math.round(n))
    );
  } else if (modelChanged && next.costPrice === 0 && defaults?.suggestedCostPrice) {
    next = { ...next, costPrice: defaults.suggestedCostPrice };
  }

  if (next.paidCac == null) {
    const paidCac = benchmarkMid(benchmarks?.paidCac);
    if (paidCac != null && paidCac > 0) next = { ...next, paidCac: paidCac };
  }

  if (next.businessModel === "subscription") {
    next = applyNumberBenchmark(
      next,
      "subscriptionMonthlyChurnPct",
      DEFAULT_INPUTS.subscriptionMonthlyChurnPct,
      benchmarks,
      (n) => Math.max(0, Math.min(100, n))
    );
  }
  if (next.businessModel === "booking") {
    next = applyNumberBenchmark(
      next,
      "bookingCapacityPerMonth",
      DEFAULT_INPUTS.bookingCapacityPerMonth,
      benchmarks,
      (n) => Math.max(0, Math.round(n))
    );
  }
  if (next.businessModel === "usage_based") {
    next = applyNumberBenchmark(
      next,
      "usageEventsPerCustomerPerMonth",
      DEFAULT_INPUTS.usageEventsPerCustomerPerMonth,
      benchmarks,
      (n) => Math.max(0, n)
    );
    next = applyNumberBenchmark(
      next,
      "usageMonthlyChurnPct",
      DEFAULT_INPUTS.usageMonthlyChurnPct,
      benchmarks,
      (n) => Math.max(0, Math.min(100, n))
    );
  }
  if (next.businessModel === "project_services") {
    next = applyNumberBenchmark(
      next,
      "projectCapacityPerMonth",
      DEFAULT_INPUTS.projectCapacityPerMonth,
      benchmarks,
      (n) => Math.max(0, n)
    );
  }

  return next;
}

function inventorylessModel(businessModel: LaunchSimInputs["businessModel"]): boolean {
  return [
    "services",
    "saas",
    "rental",
    "subscription",
    "booking",
    "usage_based",
    "lead_gen",
    "project_services",
  ].includes(businessModel);
}

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
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState("");
  // Live market-data sourcing (web-grounded, cited): refreshes the benchmark
  // priors for this venture's country × category. Applied on the next run.
  const [sourcing, setSourcing] = useState(false);
  const [sourced, setSourced] = useState<string | null>(null);

  const engineCurrency = inputs.currency || defaults?.currency || "INR";
  // Service / SaaS launches hold no sellable stock. Rental also holds no
  // disposable inventory, but it is capped by reusable asset-days.
  const rentalModel = inputs.businessModel === "rental";
  const subscriptionModel = inputs.businessModel === "subscription";
  const bookingModel = inputs.businessModel === "booking";
  const usageModel = inputs.businessModel === "usage_based";
  const projectModel = inputs.businessModel === "project_services";
  const inventoryless = inventorylessModel(inputs.businessModel);
  const displayCurrency = defaults?.displayCurrency || engineCurrency;
  const displayFxRate = defaults?.displayFxRate ?? 1;

  const sourceMarketData = useCallback(async () => {
    if (!projectId || sourcing) return;
    setSourcing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/market-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessModel: inputs.businessModel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(apiErrorMessage(data?.error, `sourcing failed (${res.status})`));
      const n = data?.datum?.sources?.length ?? 0;
      setSourced(
        n > 0
          ? `Sourced ${data.datum.country} ${data.datum.category} data (${n} source${n === 1 ? "" : "s"}) — re-run to apply.`
          : "No new figures found; keeping curated priors."
      );
    } catch (e) {
      setError(providerErrorMessage(e, "market data sourcing failed"));
    } finally {
      setSourcing(false);
    }
  }, [inputs.businessModel, projectId, sourcing]);
  const fmt = useMemo(
    () => makeFormatters(displayCurrency, displayFxRate, engineCurrency),
    [displayCurrency, displayFxRate, engineCurrency]
  );
  const unitLabel = unitLabelFor(inputs.businessModel);
  const salePriceLabel = salePriceLabelFor(inputs.businessModel);
  const costPriceLabel = costPriceLabelFor(inputs.businessModel);
  const businessModelLabel =
    BUSINESS_MODEL_OPTIONS.find((opt) => opt.value === inputs.businessModel)?.label ??
    "This model";

  // Load defaults + saved scenarios once.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/launch-sim`);
        const data = (await res.json().catch(() => ({}))) as {
          scenarios: LaunchSimRecord[];
          defaults: Defaults;
          error?: unknown;
        };
        if (!res.ok) {
          throw new Error(
            providerErrorMessage(data?.error ?? data, `failed to load (${res.status})`)
          );
        }
        if (!alive) return;
        setScenarios(data.scenarios);
        setDefaults(data.defaults);
        setInputs((cur) => {
          const businessModel =
            cur.businessModel === "generic"
              ? data.defaults.suggestedBusinessModel
              : cur.businessModel;
          const next = {
            ...cur,
            currency: data.defaults.currency ?? cur.currency,
            businessModel,
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
            // Prefill the refund rate from the category benchmark so the field
            // shows a real number (e.g. ~10% for hygiene) instead of an empty
            // target the server silently fills. Founder edits it directly.
            targetRefundRatePct:
              cur.targetRefundRatePct == null && data.defaults.benchmarks
                ? data.defaults.benchmarks.returnRatePct
                : cur.targetRefundRatePct,
          };
          return applyModelDefaults(next, cur.businessModel, data.defaults);
        });
        if (data.scenarios[0]) {
          setActive(data.scenarios[0]);
          setInputs(data.scenarios[0].inputs);
          setName(nextName(data.scenarios));
        }
      } catch (e) {
        if (alive)
          setError(providerErrorMessage(e, "Failed to load defaults"));
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(apiErrorMessage(data?.error, `failed (${res.status})`));
      const record = data as LaunchSimRecord;
      setScenarios((s) => [record, ...s]);
      setActive(record);
      setName(nextName([record, ...scenarios]));
    } catch (e) {
      setError(providerErrorMessage(e, "Simulation failed"));
    } finally {
      setBusy(false);
    }
  }, [busy, inputs, name, projectId, runId, scenarios]);

  const onDelete = useCallback(
    async (id: string) => {
      const target = scenarios.find((s) => s.id === id);
      if (
        target &&
        !window.confirm(`Delete "${target.name}"? This launch simulation will be removed.`)
      )
        return;
      const previous = scenarios;
      setScenarios((s) => s.filter((x) => x.id !== id));
      if (active?.id === id) setActive(null);
      try {
        const res = await fetch(`/api/runs/${runId}/launch-sim?scenarioId=${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
      } catch (e) {
        setScenarios(previous);
        if (target && active?.id === id) setActive(target);
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [active?.id, runId, scenarios]
  );

  const startScenarioEdit = useCallback((scenario: LaunchSimRecord) => {
    setEditingScenarioId(scenario.id);
    setScenarioDraft(scenario.name);
  }, []);

  const renameScenarioLocal = useCallback((id: string, nextName: string) => {
    setScenarios((s) =>
      s.map((scenario) =>
        scenario.id === id ? { ...scenario, name: nextName } : scenario
      )
    );
    setActive((cur) => (cur?.id === id ? { ...cur, name: nextName } : cur));
  }, []);

  const commitScenarioEdit = useCallback(async () => {
    if (!editingScenarioId) return;
    const nextName = scenarioDraft.trim();
    const target = scenarios.find((s) => s.id === editingScenarioId);
    if (!target || !nextName) {
      setEditingScenarioId(null);
      return;
    }
    setEditingScenarioId(null);
    if (target.name === nextName) return;

    renameScenarioLocal(target.id, nextName);
    try {
      const res = await fetch(
        `/api/runs/${runId}/launch-sim?scenarioId=${target.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(apiErrorMessage(data?.error, `rename failed (${res.status})`));
    } catch (e) {
      renameScenarioLocal(target.id, target.name);
      setError(providerErrorMessage(e, "Rename failed"));
    }
  }, [editingScenarioId, renameScenarioLocal, runId, scenarioDraft, scenarios]);

  const set = <K extends keyof LaunchSimInputs>(
    key: K,
    value: LaunchSimInputs[K]
  ) => {
    // Once the founder overrides a saved scenario, the form is a new draft.
    setActive(null);
    setInputs((cur) => ({ ...cur, [key]: value }));
  };

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
                {editingScenarioId === s.id ? (
                  <>
                    <input
                      value={scenarioDraft}
                      onChange={(e) => setScenarioDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitScenarioEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingScenarioId(null);
                        }
                      }}
                      maxLength={80}
                      autoFocus
                      className="w-32 bg-transparent font-medium text-neutral-800 outline-none"
                    />
                    <button
                      onClick={() => void commitScenarioEdit()}
                      title="Save scenario name"
                    >
                      <Check className="h-3 w-3 text-emerald-600" />
                    </button>
                    <button
                      onClick={() => setEditingScenarioId(null)}
                      title="Cancel rename"
                    >
                      <X className="h-3 w-3 text-neutral-400 hover:text-neutral-700" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setActive(s);
                        setInputs(s.inputs);
                      }}
                      className="min-w-0 truncate"
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
                      onClick={() => startScenarioEdit(s)}
                      className="opacity-0 transition group-hover:opacity-100"
                      title="Rename scenario"
                    >
                      <Pencil className="h-3 w-3 text-neutral-400 hover:text-indigo-600" />
                    </button>
                    <button
                      onClick={() => onDelete(s.id)}
                      className="opacity-0 transition group-hover:opacity-100"
                      title="Delete scenario"
                    >
                      <Trash2 className="h-3 w-3 text-neutral-400 hover:text-red-500" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input form */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumField
              label={costPriceLabel}
              unit={`${engineCurrency}/${unitLabel}`}
              value={inputs.costPrice}
              onChange={(v) => set("costPrice", v)}
            />
            <NumField
              label={salePriceLabel}
              unit={`${engineCurrency}/${unitLabel}`}
              value={inputs.salePrice}
              onChange={(v) => set("salePrice", v)}
            />
            <NumField
              label="Ad spend"
              unit={`${engineCurrency}/month`}
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
                  const businessModel = e.target
                    .value as LaunchSimInputs["businessModel"];
                  setActive(null);
                  setInputs((cur) =>
                    applyModelDefaults(
                      { ...cur, businessModel, channels: [] },
                      cur.businessModel,
                      defaults
                    )
                  );
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
                  unit={`${engineCurrency}/1k`}
                  help={`Cost per 1,000 paid impressions. Cheap reach: ${engineCurrency}100-250; premium/niche: ${engineCurrency}500-1,500+.`}
                  value={inputs.cpm}
                  onChange={(v) => set("cpm", v)}
                  small
                />
                <NullableNumField
                  label="Paid CAC"
                  unit={engineCurrency}
                  help="Optional cap for paid first-time customers. Blank = use benchmark/model CAC; enter your real local CAC if you know it."
                  value={inputs.paidCac}
                  onChange={(v) => set("paidCac", v && v > 0 ? v : null)}
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
                <NumField
                  label="Growth / month"
                  unit="%"
                  help="Net month-over-month growth in demand/acquisition. Leave on auto to derive from the simulated audience; negative values model cooling demand."
                  value={inputs.monthlyGrowthPct ?? 0}
                  onChange={(v) => set("monthlyGrowthPct", v)}
                  step={1}
                  small
                />
                <button
                  type="button"
                  onClick={() => set("monthlyGrowthPct", null)}
                  className={`self-end rounded-lg border px-3 py-2 text-xs font-medium ${
                    inputs.monthlyGrowthPct == null
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  Auto
                </button>
              </AdvancedGroup>

              <AdvancedGroup
                title="Operations & costs"
                description="Controls fulfillment economics, working capital, and inventory constraints."
              >
                <NumField
                  label="Shipping/order"
                  unit={`${engineCurrency}/order`}
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
                  unit={`${engineCurrency}/month`}
                  help="Monthly overhead before variable costs: tools, retainers, salaries, rent, storage, and production admin."
                  value={inputs.fixedCostsPerMonth}
                  onChange={(v) => set("fixedCostsPerMonth", v)}
                  small
                />
                <NullableNumField
                  label="Launch reserve"
                  unit={engineCurrency}
                  help="Blank = auto reserve. Enter 0 to remove it, or enter your actual setup/runway cash."
                  value={inputs.launchInvestmentReserve}
                  onChange={(v) => set("launchInvestmentReserve", v)}
                  small
                />
                {rentalModel && (
                  <>
                    <NumField
                      label="Rental assets"
                      unit="assets"
                      help="Reusable assets available to rent, e.g. PS5 consoles, cameras, tools, or vehicles."
                      value={inputs.rentalAssetCount}
                      onChange={(v) => set("rentalAssetCount", Math.round(v))}
                      small
                    />
                    <NumField
                      label="Asset cost"
                      unit={`${engineCurrency}/asset`}
                      help="Purchase value per asset. If you already included this in fixed costs, keep this at 0 to avoid double-counting cash payback."
                      value={inputs.rentalAssetCost}
                      onChange={(v) => set("rentalAssetCost", v)}
                      small
                    />
                    <NumField
                      label="Rentable days"
                      unit="days/mo"
                      help="How many days per month each asset can realistically be rented after downtime, pickup, testing, and rest days."
                      value={inputs.rentalRentableDaysPerMonth}
                      onChange={(v) =>
                        set("rentalRentableDaysPerMonth", Math.max(1, Math.min(31, v)))
                      }
                      small
                    />
                    <NumField
                      label="Avg duration"
                      unit="days"
                      help="Average booking length. A 2-day weekend rental consumes twice the asset capacity of a 1-day rental."
                      value={inputs.rentalAvgDurationDays}
                      onChange={(v) => set("rentalAvgDurationDays", Math.max(0.25, v))}
                      step={0.25}
                      small
                    />
                    <NumField
                      label="Maintenance"
                      unit={`${engineCurrency}/booking`}
                      help="Variable checking, cleaning, controller wear, packaging, setup, or repair provision per booking."
                      value={inputs.rentalMaintenancePerOrder}
                      onChange={(v) => set("rentalMaintenancePerOrder", v)}
                      small
                    />
                    <NumField
                      label="Damage/loss"
                      unit="%"
                      help="Expected per-booking damage/loss rate, applied only to asset value not covered by deposit."
                      value={inputs.rentalDamageLossPct}
                      onChange={(v) => set("rentalDamageLossPct", Math.max(0, Math.min(100, v)))}
                      step={0.1}
                      small
                    />
                    <NumField
                      label="Deposit"
                      unit={engineCurrency}
                      help="Refundable customer deposit. It is not counted as revenue, but offsets expected damage/loss exposure."
                      value={inputs.rentalDepositAmount}
                      onChange={(v) => set("rentalDepositAmount", v)}
                      small
                    />
                  </>
                )}
                {subscriptionModel && (
                  <NumField
                    label="Monthly churn"
                    unit="%"
                    help="Percent of active subscribers who cancel each month. Lower churn increases recurring revenue and payback."
                    value={inputs.subscriptionMonthlyChurnPct}
                    onChange={(v) =>
                      set("subscriptionMonthlyChurnPct", Math.max(0, Math.min(100, v)))
                    }
                    step={0.5}
                    small
                  />
                )}
                {bookingModel && (
                  <NumField
                    label="Booking capacity"
                    unit="bookings/mo"
                    help="Maximum service slots you can fulfill each month with your current staff, rooms, equipment, or calendar."
                    value={inputs.bookingCapacityPerMonth}
                    onChange={(v) => set("bookingCapacityPerMonth", Math.max(0, v))}
                    small
                  />
                )}
                {usageModel && (
                  <>
                    <NumField
                      label="Usage frequency"
                      unit="uses/customer/mo"
                      help="Paid uses each active customer generates per month after acquisition."
                      value={inputs.usageEventsPerCustomerPerMonth}
                      onChange={(v) =>
                        set("usageEventsPerCustomerPerMonth", Math.max(0, v))
                      }
                      step={0.5}
                      small
                    />
                    <NumField
                      label="Usage churn"
                      unit="%"
                      help="Percent of active usage customers who stop using each month."
                      value={inputs.usageMonthlyChurnPct}
                      onChange={(v) =>
                        set("usageMonthlyChurnPct", Math.max(0, Math.min(100, v)))
                      }
                      step={0.5}
                      small
                    />
                  </>
                )}
                {projectModel && (
                  <NumField
                    label="Project capacity"
                    unit="projects/mo"
                    help="Maximum client projects the team can sell and deliver per month."
                    value={inputs.projectCapacityPerMonth}
                    onChange={(v) => set("projectCapacityPerMonth", Math.max(0, v))}
                    step={0.5}
                    small
                  />
                )}
                {inventoryless ? (
                  <p className="col-span-full text-xs text-neutral-500">
                    {rentalModel
                      ? "Rental bookings are capped by reusable asset-days, not sellable inventory; normal stock, reorder lead and MOQ do not apply."
                      : `${businessModelLabel} scenarios do not use sellable inventory; normal stock, reorder lead and MOQ do not apply.`}
                  </p>
                ) : (
                  <>
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
                    <NumField
                      label="Min order qty"
                      unit="units/batch"
                      help="Manufacturer minimum order quantity. Reorders are placed in whole batches, so you end holding a leftover partial batch (realistic deadstock). 0 = auto (~1 month of demand); 1 = continuous/JIT reordering."
                      value={inputs.minOrderQtyUnits ?? 0}
                      onChange={(v) =>
                        set("minOrderQtyUnits", v ? Math.round(v) : null)
                      }
                      small
                    />
                  </>
                )}
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
                  label="Refund rate %"
                  unit="%"
                  help="Share of orders refunded/returned — the engine calibrates to exactly this. Anchored to the category benchmark; set it to your real rate (e.g. ~0 for non-returnable hygiene products like period underwear)."
                  value={
                    inputs.targetRefundRatePct ??
                    defaults?.benchmarks?.returnRatePct ??
                    10
                  }
                  onChange={(v) =>
                    set(
                      "targetRefundRatePct",
                      Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null
                    )
                  }
                  step={1}
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
  const isRental =
    record.inputs.businessModel === "rental" ||
    result.resolvedInputs.businessModel === "rental";
  const isCapacityModel =
    isRental ||
    record.inputs.businessModel === "booking" ||
    result.resolvedInputs.businessModel === "booking" ||
    record.inputs.businessModel === "project_services" ||
    result.resolvedInputs.businessModel === "project_services";
  const convertedDisplay =
    fmt.sourceCurrency !== fmt.displayCurrency && fmt.moneyRate !== 1;
  const growthAssumption = result.assumptions.find(
    (a) => a.key === "monthlyGrowthPct"
  );
  const growthPct = result.resolvedInputs.monthlyGrowthPct ?? 0;
  const growthLabel = `${growthPct > 0 ? "+" : ""}${fmt.num(growthPct)}%`;
  const growthSource = growthAssumption
    ? sourceLabel(growthAssumption.source)
    : "computed";
  const fixedCostAssumption = result.assumptions.find(
    (a) => a.key === "fixedCostsPerMonth"
  );
  const launchReserveAssumption = result.assumptions.find(
    (a) =>
      a.key === "launchInvestmentReserve" ||
      a.key === "launchInvestmentFloor"
  );
  const openingInventoryAssumption = result.assumptions.find(
    (a) => a.key === "initialInventoryUnits"
  );
  const paybackTooltip = [
    "Cash payback is cumulative cash, not cumulative net profit.",
    fixedCostAssumption
      ? `Fixed costs: ${formatAssumptionValue(
          fixedCostAssumption.value,
          fixedCostAssumption.unit,
          fmt
        )}`
      : null,
    launchReserveAssumption
      ? `Launch reserve: ${formatAssumptionValue(
          launchReserveAssumption.value,
          launchReserveAssumption.unit,
          fmt
        )}`
      : null,
    openingInventoryAssumption
      ? `${isRental ? "Rental stock mode" : "Opening inventory"}: ${formatAssumptionValue(
          openingInventoryAssumption.value,
          openingInventoryAssumption.unit,
          fmt
        )}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const paybackSensitivity = useMemo(
    () => buildPaybackSensitivityRows(record, result, fmt),
    [record, result, fmt]
  );
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
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(
            data?.error ?? data,
            `propose failed (${res.status})`
          )
        );
      }
      const update = data.update as AssumptionUpdate;
      setProposal(update);
      setAccepted(new Set(update.changes.map((_, i) => i))); // default: accept all
    } catch (e) {
      setKError(providerErrorMessage(e, "propose failed"));
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
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `re-run failed (${res.status})`)
        );
      }
      onRerun(data as LaunchSimRecord);
      setProposal(null);
      setKnowledge("");
    } catch (e) {
      setKError(providerErrorMessage(e, "re-run failed"));
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
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `ask failed (${res.status})`)
        );
      }
      setFollowUp(data.followUp ?? []);
      setQ("");
    } catch (e) {
      setQaError(providerErrorMessage(e, "ask failed"));
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
    const usedInputs = result.resolvedInputs ?? record.inputs;
    const cur = usedInputs.currency;
    const moneyPoint = (n: number) => n * fmt.moneyRate;
    const sampledTimeline = sampleLaunchTimeline(timeline, 60);
    const timelineLabels = sampledTimeline.map((t) => t.label);
    const headlineKpis: PdfKPI[] = [
      {
        label: "Net profit",
        value: fmt.money(s.netProfit),
        sub: `${s.netMarginPct}% net margin`,
        tone: s.netProfit >= 0 ? "good" : "bad",
      },
      {
        label: "Net revenue",
        value: fmt.money(s.netRevenue),
        sub: `${fmt.money(s.grossRevenue)} gross`,
      },
      {
        label: "Orders",
        value: fmt.num(s.totalOrders),
        sub: `${s.returningCustomerSharePct}% returning`,
      },
      {
        label: "Cash payback",
        value: s.breakEvenLabel ?? "Never",
        sub: `peak cash need ${fmt.money(s.peakCapitalNeeded)}`,
        tone: s.breakEvenLabel ? "good" : "bad",
      },
      {
        label: "Refund rate",
        value: `${s.refundRatePct}%`,
        sub: `${fmt.num(s.refunds)} refunds`,
        tone: s.refundRatePct > 15 ? "bad" : "neutral",
      },
      {
        label: "Blended CAC",
        value: fmt.money(s.blendedCac),
        sub: `${fmt.money(s.adSpendPerConversion)} ad spend / conversion`,
      },
      {
        label: isRental ? "Unused stock" : "Deadstock",
        value: fmt.num(s.deadstockUnits),
        sub: `${fmt.money(s.deadstockValue)} tied up`,
        tone: s.deadstockValue > s.grossRevenue * 0.2 ? "bad" : "neutral",
      },
      {
        label: isCapacityModel ? "Capacity misses" : "Stockouts",
        value: fmt.num(s.stockoutUnits),
        sub: isCapacityModel ? "unserved demand" : "lost sales units",
        tone: s.stockoutUnits > s.unitsSold * 0.1 ? "bad" : "neutral",
      },
    ];
    const pnlRows = [
      {
        name: "Gross revenue",
        value: s.grossRevenue,
        color: PDF_CHART_COLORS.emerald,
      },
      {
        name: "Refunded revenue",
        value: -(s.grossRevenue - s.netRevenue),
        color: PDF_CHART_COLORS.red,
      },
      ...costStack.map((c) => ({
        name: c.name,
        value: -c.value,
        color: PDF_CHART_COLORS.rose,
      })),
      {
        name: "Net profit",
        value: s.netProfit,
        color: s.netProfit >= 0 ? PDF_CHART_COLORS.green : PDF_CHART_COLORS.red,
      },
    ].filter((row) => row.name === "Net profit" || Math.abs(row.value) > 0);
    const funnelBars: PdfBar[] = [
      { label: "Impressions", value: s.totalImpressions, color: PDF_CHART_COLORS.indigoSoft },
      { label: "Reached", value: s.totalReached, color: PDF_CHART_COLORS.indigo },
      { label: "Engaged", value: s.totalEngaged, color: PDF_CHART_COLORS.sky },
      { label: "Product visits", value: s.totalProductVisits, color: PDF_CHART_COLORS.cyan },
      { label: "Checkout starts", value: s.totalCheckoutsStarted, color: PDF_CHART_COLORS.teal },
      { label: "Scrolled past", value: s.totalScrolledPast, color: PDF_CHART_COLORS.rose },
      { label: "Orders", value: s.totalOrders, color: PDF_CHART_COLORS.violet },
    ];
    const orderTrajectory: PdfSeries[] = [
      {
        name: "Orders",
        color: PDF_CHART_COLORS.indigo,
        points: sampledTimeline.map((t) => t.newOrders + t.repeatOrders),
      },
      {
        name: "Refunds",
        color: PDF_CHART_COLORS.red,
        points: sampledTimeline.map((t) => t.refunds),
      },
    ];
    const cashTrajectory: PdfSeries[] = [
      {
        name: "Cumulative net profit",
        color: PDF_CHART_COLORS.green,
        points: sampledTimeline.map((t) => moneyPoint(t.cumulativeNetProfit)),
      },
      {
        name: "Cumulative cash",
        color: PDF_CHART_COLORS.amber,
        points: sampledTimeline.map((t) => moneyPoint(t.cumulativeCash)),
      },
    ];
    const inventoryTrajectory: PdfSeries[] = [
      {
        name: "Inventory on hand",
        color: PDF_CHART_COLORS.teal,
        points: sampledTimeline.map((t) => t.inventoryOnHand),
      },
      {
        name: "Stockouts",
        color: PDF_CHART_COLORS.red,
        points: sampledTimeline.map((t) => t.unitsStockedOut),
      },
      {
        name: "Refunds",
        color: PDF_CHART_COLORS.amber,
        points: sampledTimeline.map((t) => t.refunds),
      },
    ];
    const acquiredBars = orderBars(
      b.byAcquisitionChannel.map((row) => ({ name: row.name, orders: row.orders }))
    );
    const unitsPurchased =
      s.unitsPurchased > 0 ? s.unitsPurchased : s.unitsSold + s.deadstockUnits;
    const sections: DossierSection[] = [];
    sections.push({
      heading: "Key metrics",
      kpis: headlineKpis,
      bullets: [
        `MoM growth assumed: ${growthLabel} (${growthSource} assumption)`,
        `Deterministic seed #${result.seed}; each persona represents ${fmt.num(result.scaleFactor)} prospects.`,
      ],
    });
    if (d.headline) sections.push({ heading: "Verdict", body: d.headline });
    if (sampledTimeline.length > 1) {
      sections.push(
        {
          heading: "Demand trajectory",
          body: `Matches the website trajectory chart's demand series, sampled from the full ${fmt.num(timeline.length)}-${usedInputs.granularity} timeline for PDF readability.`,
          line: {
            title: "Orders and refunds over time",
            xLabels: timelineLabels,
            series: orderTrajectory,
          },
        },
        {
          heading: "Cash payback trajectory",
          body: `Money charted in ${fmt.displayCurrency}. Cumulative cash includes launch reserve and working-capital inventory outflows.`,
          line: {
            title: "Cumulative net profit vs cumulative cash",
            xLabels: timelineLabels,
            series: cashTrajectory,
            money: true,
          },
        }
      );
    }
    sections.push({
      heading: "Revenue, costs, and profit",
      bars: {
        title: `P&L bridge (${fmt.displayCurrency})`,
        data: pnlRows.map((row) => ({
          label: row.name,
          value: moneyPoint(row.value),
          color: row.color,
        })),
        money: true,
      },
      table: {
        columns: ["Line", "Value"],
        rows: pnlRows.map((row) => [row.name, fmt.money(row.value)]),
      },
    });
    sections.push({
      heading: "Acquisition funnel",
      bars: {
        title: "Impressions to orders",
        data: funnelBars,
      },
      table: {
        columns: ["Step", "Count"],
        rows: funnelBars.map((row) => [row.label, fmt.num(row.value)]),
      },
    });
    if (acquiredBars.length) {
      sections.push({
        heading: "Acquisition by channel",
        bars: {
          title: "Orders by acquisition channel",
          data: acquiredBars,
        },
        table: {
          columns: ["Channel", "Kind", "Visits", "Orders", "Spend", "CAC"],
          rows: b.byAcquisitionChannel.slice(0, 8).map((row) => [
            row.name,
            row.kind,
            fmt.num(row.productVisits),
            fmt.num(row.orders),
            fmt.money(row.adSpend),
            row.cac > 0 ? fmt.money(row.cac) : "-",
          ]),
        },
      });
    }
    sections.push({
      heading: "New vs returning",
      share: {
        title: "Order mix",
        data: [
          {
            label: "New customers",
            value: b.newVsReturning.newCustomers,
            color: PDF_CHART_COLORS.indigo,
          },
          {
            label: "Returning orders",
            value: b.newVsReturning.returningOrders,
            color: PDF_CHART_COLORS.green,
          },
        ],
      },
      bullets: [
        `${s.returningCustomerSharePct}% of all orders came from repeat buyers.`,
      ],
    });
    addBreakdownSection(sections, "Orders by channel", b.byChannel, fmt);
    addBreakdownSection(sections, "Orders by segment", b.bySegment, fmt, (name) =>
      hexRgb(SEGMENT_COLORS[name] ?? "#6366f1")
    );
    addBreakdownSection(sections, "Buyers by location", b.byLocality, fmt);
    addBreakdownSection(sections, "Buyers by age", b.byAgeBand, fmt);
    addBreakdownSection(sections, "Buyers by gender", b.byGender, fmt);
    sections.push({
      heading: "Inventory and returns",
      kpis: [
        { label: "Units purchased", value: fmt.num(unitsPurchased) },
        { label: "Units sold", value: fmt.num(s.unitsSold) },
        { label: "Deadstock", value: fmt.num(s.deadstockUnits), sub: fmt.money(s.deadstockValue) },
        { label: "In transit", value: fmt.num(s.unitsInTransitEnd) },
        { label: "Refunds", value: fmt.num(s.refunds), sub: `${s.refundRatePct}% refund rate` },
        { label: "Stockouts", value: fmt.num(s.stockoutUnits), sub: "lost sales units" },
      ],
      bars: {
        title: "Unit reconciliation",
        data: [
          { label: "Units purchased", value: unitsPurchased, color: PDF_CHART_COLORS.teal },
          { label: "Units sold", value: s.unitsSold, color: PDF_CHART_COLORS.green },
          { label: "Deadstock", value: s.deadstockUnits, color: PDF_CHART_COLORS.amber },
          { label: "In transit", value: s.unitsInTransitEnd, color: PDF_CHART_COLORS.sky },
          { label: "Refunds", value: s.refunds, color: PDF_CHART_COLORS.rose },
          { label: "Stockouts", value: s.stockoutUnits, color: PDF_CHART_COLORS.red },
        ],
      },
    });
    if (sampledTimeline.length > 1) {
      sections.push({
        heading: "Inventory trajectory",
        line: {
          title: "Inventory, refunds, and stockouts over time",
          xLabels: timelineLabels,
          series: inventoryTrajectory,
        },
      });
    }
    sections.push({
      heading: "Advanced settings used",
      body: "Final values reflect the settings the simulation actually ran with after Auto/default fields were resolved.",
      bullets: buildAdvancedSettingsBullets(record.inputs, usedInputs, fmt),
    });
    if (result.assumptions.length) {
      sections.push({
        heading: "Assumptions",
        bullets: result.assumptions.map(
          (a) =>
            `${a.label}: ${formatAssumptionValue(a.value, a.unit, fmt)} · ${sourceLabel(
              a.source
            )} · ${(a.confidence * 100).toFixed(0)}% confidence — ${a.basis}`
        ),
      });
    }
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
        title: `Launch simulation - ${record.name}`,
        subtitle: record.inputs.region
          ? `${record.inputs.region} region`
          : "Whole audience",
        meta: [
          `${record.inputs.horizon} ${record.inputs.granularity === "day" ? "days" : "months"}`,
          convertedDisplay
            ? `${fmt.displayCurrency} display, ${cur} simulation`
            : cur,
          new Date().toLocaleDateString(),
        ],
        accent: PDF_CHART_COLORS.indigo,
        cover: {
          verdict: d.headline,
          kpis: headlineKpis.slice(0, 4),
        },
        sections,
      },
      `launch-${slug(record.name)}-dossier`
    );
  };

  const exportAnimatedReport = () => {
    const usedInputs = result.resolvedInputs ?? record.inputs;
    const moneyPoint = (n: number) => n * fmt.moneyRate;
    const timelinePoints = sampleLaunchTimeline(timeline, 96).map((t) => ({
      label: t.label,
      orders: t.newOrders + t.repeatOrders,
      refunds: t.refunds,
      cumulativeNetProfit: moneyPoint(t.cumulativeNetProfit),
      cumulativeCash: moneyPoint(t.cumulativeCash),
      inventoryOnHand: t.inventoryOnHand,
      stockouts: t.unitsStockedOut,
    }));
    const pnlRows = [
      { label: "Gross revenue", value: moneyPoint(s.grossRevenue), text: fmt.money(s.grossRevenue), tone: "good" as const },
      {
        label: "Refunded revenue",
        value: -moneyPoint(s.grossRevenue - s.netRevenue),
        text: fmt.money(-(s.grossRevenue - s.netRevenue)),
        tone: "bad" as const,
      },
      ...costStack.map((c) => ({
        label: c.name,
        value: -moneyPoint(c.value),
        text: fmt.money(-c.value),
        tone: "bad" as const,
      })),
      {
        label: "Net profit",
        value: moneyPoint(s.netProfit),
        text: fmt.money(s.netProfit),
        tone: s.netProfit >= 0 ? ("good" as const) : ("bad" as const),
      },
    ].filter((row) => row.label === "Net profit" || Math.abs(row.value) > 0);
    const funnelRows = [
      { label: "Impressions", value: s.totalImpressions, text: fmt.num(s.totalImpressions) },
      { label: "Reached", value: s.totalReached, text: fmt.num(s.totalReached) },
      { label: "Engaged", value: s.totalEngaged, text: fmt.num(s.totalEngaged) },
      { label: "Product visits", value: s.totalProductVisits, text: fmt.num(s.totalProductVisits) },
      { label: "Checkout starts", value: s.totalCheckoutsStarted, text: fmt.num(s.totalCheckoutsStarted) },
      { label: "Scrolled past", value: s.totalScrolledPast, text: fmt.num(s.totalScrolledPast) },
      { label: "Orders", value: s.totalOrders, text: fmt.num(s.totalOrders) },
    ];
    const breakdownRows = (data: { name: string; orders: number; revenue: number }[]) =>
      data.slice(0, 8).map((row) => ({
        label: row.name,
        value: row.orders,
        text: fmt.num(row.orders),
        sub: fmt.money(row.revenue),
      }));
    const unitsPurchased =
      s.unitsPurchased > 0 ? s.unitsPurchased : s.unitsSold + s.deadstockUnits;
    downloadAnimatedLaunchReport(
      {
        title: `Launch simulation - ${record.name}`,
        subtitle: record.inputs.region
          ? `${record.inputs.region} region`
          : "Whole audience",
        verdict: result.diagnostics.headline,
        meta: [
          `${record.inputs.horizon} ${record.inputs.granularity === "day" ? "days" : "months"}`,
          convertedDisplay
            ? `${fmt.displayCurrency} display, ${usedInputs.currency} simulation`
            : usedInputs.currency,
          new Date().toLocaleDateString(),
        ],
        kpis: [
          {
            label: "Net profit",
            value: fmt.money(s.netProfit),
            sub: `${s.netMarginPct}% net margin`,
            tone: s.netProfit >= 0 ? "good" : "bad",
          },
          {
            label: "Net revenue",
            value: fmt.money(s.netRevenue),
            sub: `${fmt.money(s.grossRevenue)} gross`,
            tone: "neutral",
          },
          {
            label: "Orders",
            value: fmt.num(s.totalOrders),
            sub: `${s.returningCustomerSharePct}% returning`,
            tone: "neutral",
          },
          {
            label: "Cash payback",
            value: s.breakEvenLabel ?? "Never",
            sub: `peak cash need ${fmt.money(s.peakCapitalNeeded)}`,
            tone: s.breakEvenLabel ? "good" : "bad",
          },
          {
            label: "Refund rate",
            value: `${s.refundRatePct}%`,
            sub: `${fmt.num(s.refunds)} refunds`,
            tone: s.refundRatePct > 15 ? "bad" : "neutral",
          },
          {
            label: "Blended CAC",
            value: fmt.money(s.blendedCac),
            sub: `${fmt.money(s.adSpendPerConversion)} ad spend / conversion`,
            tone: "neutral",
          },
        ],
        timeline: timelinePoints,
        pnl: pnlRows,
        funnel: funnelRows,
        acquisition: b.byAcquisitionChannel.slice(0, 8).map((row) => ({
          label: row.name,
          value: row.orders,
          text: fmt.num(row.orders),
          sub: `${row.kind} - ${fmt.money(row.adSpend)} spend - CAC ${
            row.cac > 0 ? fmt.money(row.cac) : "-"
          }`,
        })),
        mix: [
          {
            label: "New customers",
            value: b.newVsReturning.newCustomers,
            text: fmt.num(b.newVsReturning.newCustomers),
          },
          {
            label: "Returning orders",
            value: b.newVsReturning.returningOrders,
            text: fmt.num(b.newVsReturning.returningOrders),
          },
        ],
        breakdowns: [
          { title: "Orders by channel", rows: breakdownRows(b.byChannel) },
          { title: "Orders by segment", rows: breakdownRows(b.bySegment) },
          { title: "Buyers by location", rows: breakdownRows(b.byLocality) },
          { title: "Buyers by age", rows: breakdownRows(b.byAgeBand) },
          { title: "Buyers by gender", rows: breakdownRows(b.byGender) },
        ],
        inventory: [
          { label: "Units purchased", value: unitsPurchased, text: fmt.num(unitsPurchased) },
          { label: "Units sold", value: s.unitsSold, text: fmt.num(s.unitsSold) },
          { label: "Deadstock", value: s.deadstockUnits, text: fmt.num(s.deadstockUnits), sub: fmt.money(s.deadstockValue) },
          { label: "In transit", value: s.unitsInTransitEnd, text: fmt.num(s.unitsInTransitEnd) },
          { label: "Refunds", value: s.refunds, text: fmt.num(s.refunds), sub: `${s.refundRatePct}% refund rate` },
          { label: "Stockouts", value: s.stockoutUnits, text: fmt.num(s.stockoutUnits) },
        ],
        diagnostics: {
          drivers: result.diagnostics.drivers,
          risks: result.diagnostics.risks,
          nextMoves: result.diagnostics.nextMoves,
        },
        assumptions: result.assumptions.map(
          (a) =>
            `${a.label}: ${formatAssumptionValue(a.value, a.unit, fmt)} - ${sourceLabel(
              a.source
            )} - ${(a.confidence * 100).toFixed(0)}% confidence`
        ),
      },
      `launch-${slug(record.name)}-animated-report`
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Readout diagnostics={result.diagnostics} />
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            onClick={exportAnimatedReport}
            title="Export an animated launch report as a self-contained HTML file"
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            <Play className="h-3.5 w-3.5" /> Animated report
          </button>
          <button
            onClick={exportPdf}
            title="Export this launch scenario's charts and conclusions as a PDF"
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-400"
          >
            <FileDown className="h-3.5 w-3.5" /> Create PDF
          </button>
        </div>
      </div>
      {convertedDisplay && (
        <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-500">
          Money shown in {fmt.displayCurrency}; simulation math runs in{" "}
          {fmt.sourceCurrency} at 1 {fmt.sourceCurrency} ={" "}
          {fmt.moneyRate.toLocaleString()} {fmt.displayCurrency}.
        </p>
      )}

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
          label="MoM growth"
          value={growthLabel}
          tone={growthPct > 0 ? "good" : growthPct < 0 ? "bad" : "neutral"}
          sub={`${growthSource} assumption`}
        />
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
          label="Cash payback"
          value={s.breakEvenLabel ?? "Never"}
          tone={s.breakEvenLabel ? "good" : "bad"}
          sub={`peak cash need ${fmt.money(s.peakCapitalNeeded)}`}
          title={paybackTooltip}
        />
        <Stat
          label={isRental ? "Unused stock" : "Deadstock"}
          value={fmt.num(s.deadstockUnits)}
          tone={s.deadstockValue > s.grossRevenue * 0.2 ? "bad" : "neutral"}
          sub={`${fmt.money(s.deadstockValue)} tied up`}
        />
        <Stat
          label={isCapacityModel ? "Capacity misses" : "Stockouts"}
          value={fmt.num(s.stockoutUnits)}
          tone={s.stockoutUnits > s.unitsSold * 0.1 ? "bad" : "neutral"}
          sub={isCapacityModel ? "unserved demand" : "lost sales (units)"}
        />
      </div>

      <PaybackSensitivityStrip rows={paybackSensitivity} />

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
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={fmt.compactMoney} />
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
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
  title?: string;
}) {
  const color =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-red-600"
        : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3" title={title}>
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

type PaybackSensitivityRow = {
  label: string;
  value: string;
  sub: string;
  tone: "good" | "bad" | "neutral";
  title: string;
};

function PaybackSensitivityStrip({
  rows,
}: {
  rows: PaybackSensitivityRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-neutral-700">
          Cash payback sensitivity
        </h3>
        <span className="text-[10px] text-neutral-400">
          same demand curve
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {rows.map((row) => (
          <div
            key={row.label}
            title={row.title}
            className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
          >
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              {row.label}
            </p>
            <p
              className={`mt-0.5 text-sm font-semibold tabular-nums ${
                row.tone === "good"
                  ? "text-emerald-600"
                  : row.tone === "bad"
                    ? "text-red-600"
                    : "text-neutral-900"
              }`}
            >
              {row.value}
            </p>
            <p className="truncate text-[10px] text-neutral-400">{row.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildPaybackSensitivityRows(
  record: LaunchSimRecord,
  result: LaunchSimRecord["result"],
  fmt: Formatters
): PaybackSensitivityRow[] {
  const inputs = result.resolvedInputs;
  const raw = record.inputs;
  const currentReserve = assumptionNumber(
    result.assumptions,
    "launchInvestmentReserve",
    "launchInvestmentFloor"
  );
  const currentFixed = inputs.fixedCostsPerMonth ?? 0;
  const baseFixed = launchBaseFixedCost(inputs.currency, inputs.businessModel);
  const baseReserve =
    raw.launchInvestmentReserve == null
      ? launchReserveFor(inputs.businessModel, inputs.adSpendPerMonth, baseFixed)
      : raw.launchInvestmentReserve;
  const hasFounderActuals =
    raw.fixedCostsPerMonth > 0 || raw.launchInvestmentReserve != null;

  const currentStep = result.summary.breakEvenStep;
  const currentTone = result.summary.breakEvenLabel ? "neutral" : "bad";
  const rows: PaybackSensitivityRow[] = [
    {
      label: "Current",
      value: result.summary.breakEvenLabel ?? "Never",
      sub: `peak ${fmt.money(result.summary.peakCapitalNeeded)}`,
      tone: currentTone,
      title: `Current fixed costs ${fmt.money(currentFixed)}/month; launch reserve ${fmt.money(currentReserve)}.`,
    },
  ];

  rows.push(
    sensitivityRow(
      "No reserve",
      adjustedPayback(result, currentFixed, 0, currentReserve),
      currentStep,
      fmt,
      `Launch reserve removed; fixed costs stay at ${fmt.money(currentFixed)}/month.`
    )
  );

  rows.push(
    sensitivityRow(
      "Base overhead",
      adjustedPayback(result, baseFixed, baseReserve, currentReserve),
      currentStep,
      fmt,
      `Fixed costs set to ${fmt.money(baseFixed)}/month; reserve recalculated to ${fmt.money(baseReserve)}.`
    )
  );

  rows.push(
    hasFounderActuals
      ? {
          label: "Founder actuals",
          value: result.summary.breakEvenLabel ?? "Never",
          sub: `peak ${fmt.money(result.summary.peakCapitalNeeded)}`,
          tone: currentTone,
          title: `Using entered fixed costs ${fmt.money(raw.fixedCostsPerMonth)}/month and ${
            raw.launchInvestmentReserve == null
              ? "auto launch reserve"
              : `${fmt.money(raw.launchInvestmentReserve)} launch reserve`
          }.`,
        }
      : {
          label: "Founder actuals",
          value: "Not set",
          sub: "fixed/reserve blank",
          tone: "neutral",
          title: "No founder-entered fixed costs or launch reserve are stored on this scenario.",
        }
  );

  return rows;
}

function sensitivityRow(
  label: string,
  payback: { label: string | null; step: number | null; peakCapitalNeeded: number },
  currentStep: number | null,
  fmt: Formatters,
  title: string
): PaybackSensitivityRow {
  return {
    label,
    value: payback.label ?? "Never",
    sub: `peak ${fmt.money(payback.peakCapitalNeeded)}`,
    tone: paybackTone(payback.step, currentStep),
    title,
  };
}

function paybackTone(
  step: number | null,
  currentStep: number | null
): "good" | "bad" | "neutral" {
  if (step == null && currentStep == null) return "neutral";
  if (step == null) return "bad";
  if (currentStep == null) return "good";
  if (step < currentStep) return "good";
  if (step > currentStep) return "bad";
  return "neutral";
}

function adjustedPayback(
  result: LaunchSimRecord["result"],
  fixedCostsPerMonth: number,
  launchReserve: number,
  currentReserve: number
): { label: string | null; step: number | null; peakCapitalNeeded: number } {
  const currentFixed = result.resolvedInputs.fixedCostsPerMonth ?? 0;
  const stepsPerMonth = result.resolvedInputs.granularity === "day" ? 30 : 1;
  let fixedDelta = 0;
  let minCash = Infinity;
  let breakEvenStep: number | null = null;

  result.timeline.forEach((step, index) => {
    const targetFixedStep =
      currentFixed > 0
        ? step.fixedCosts * (fixedCostsPerMonth / currentFixed)
        : fixedCostsPerMonth / stepsPerMonth;
    fixedDelta += step.fixedCosts - targetFixedStep;
    const adjustedCash =
      step.cumulativeCash + (currentReserve - launchReserve) + fixedDelta;
    if (adjustedCash < minCash) minCash = adjustedCash;
    if (breakEvenStep == null && adjustedCash >= 0 && index > 0) {
      breakEvenStep = index;
    }
  });

  return {
    label:
      breakEvenStep == null
        ? null
        : result.timeline[breakEvenStep]?.label ?? `Step ${breakEvenStep + 1}`,
    step: breakEvenStep,
    peakCapitalNeeded: Math.max(0, -minCash),
  };
}

function launchBaseFixedCost(
  currency: string,
  businessModel: LaunchSimInputs["businessModel"]
): number {
  if (usesFounderCostFloor(businessModel)) return 0;
  const base = currency.trim().toUpperCase() === "INR" ? 100_000 : 2_500;
  const modelMultiplier =
    businessModel === "saas" || businessModel === "services" ? 0.8 : 1;
  return Math.round(base * modelMultiplier);
}

function launchReserveFor(
  businessModel: LaunchSimInputs["businessModel"],
  adSpendPerMonth: number,
  fixedCostsPerMonth: number
): number {
  if (usesFounderCostFloor(businessModel)) return 0;
  const runwayMonths =
    businessModel === "saas" || businessModel === "services" ? 4 : 6;
  const launchMediaMonths = adSpendPerMonth > 0 ? 3 : 0;
  return Math.round(
    Math.max(0, fixedCostsPerMonth) * runwayMonths +
      Math.max(0, adSpendPerMonth) * launchMediaMonths
  );
}

function usesFounderCostFloor(businessModel: LaunchSimInputs["businessModel"]): boolean {
  return [
    "rental",
    "subscription",
    "booking",
    "usage_based",
    "lead_gen",
    "project_services",
  ].includes(businessModel);
}

function unitLabelFor(businessModel: LaunchSimInputs["businessModel"]): string {
  switch (businessModel) {
    case "subscription":
      return "subscriber/mo";
    case "booking":
      return "booking";
    case "usage_based":
      return "use";
    case "lead_gen":
      return "lead";
    case "project_services":
      return "project";
    case "rental":
      return "booking";
    default:
      return "unit";
  }
}

function salePriceLabelFor(businessModel: LaunchSimInputs["businessModel"]): string {
  switch (businessModel) {
    case "subscription":
      return "Monthly price";
    case "booking":
      return "Booking price";
    case "usage_based":
      return "Price/use";
    case "lead_gen":
      return "Revenue/lead";
    case "project_services":
      return "Project fee";
    case "rental":
      return "Rental price";
    default:
      return "Sale price";
  }
}

function costPriceLabelFor(businessModel: LaunchSimInputs["businessModel"]): string {
  switch (businessModel) {
    case "subscription":
      return "Service cost";
    case "booking":
      return "Cost/booking";
    case "usage_based":
      return "Cost/use";
    case "lead_gen":
      return "Cost/lead";
    case "project_services":
      return "Delivery cost";
    case "rental":
      return "Cost/booking";
    default:
      return "Cost price";
  }
}

function assumptionNumber(
  assumptions: LaunchSimRecord["result"]["assumptions"],
  ...keys: string[]
): number {
  const row = assumptions.find((a) => keys.includes(a.key));
  return typeof row?.value === "number" && Number.isFinite(row.value)
    ? row.value
    : 0;
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
                  {sourceLabel(a.source)} · {(a.confidence * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type PdfRgb = [number, number, number];

const PDF_CHART_COLORS = {
  indigo: [99, 102, 241] as PdfRgb,
  indigoSoft: [199, 210, 254] as PdfRgb,
  violet: [139, 92, 246] as PdfRgb,
  sky: [14, 165, 233] as PdfRgb,
  cyan: [6, 182, 212] as PdfRgb,
  teal: [20, 184, 166] as PdfRgb,
  emerald: [16, 185, 129] as PdfRgb,
  green: [16, 150, 105] as PdfRgb,
  amber: [245, 158, 11] as PdfRgb,
  rose: [244, 114, 182] as PdfRgb,
  red: [220, 38, 38] as PdfRgb,
  slate: [100, 116, 139] as PdfRgb,
};

const PDF_CHART_PALETTE: PdfRgb[] = [
  PDF_CHART_COLORS.indigo,
  PDF_CHART_COLORS.green,
  PDF_CHART_COLORS.sky,
  PDF_CHART_COLORS.amber,
  PDF_CHART_COLORS.violet,
  PDF_CHART_COLORS.teal,
  PDF_CHART_COLORS.rose,
  PDF_CHART_COLORS.slate,
];

function sampleLaunchTimeline<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints || maxPoints < 2) return items;
  const lastIndex = items.length - 1;
  const sampled: T[] = [];
  let previous = -1;
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i / (maxPoints - 1)) * lastIndex);
    if (index !== previous) sampled.push(items[index]);
    previous = index;
  }
  return sampled;
}

function orderBars(
  data: { name: string; orders: number }[],
  colorBy?: (name: string, index: number) => PdfRgb
): PdfBar[] {
  return data
    .slice(0, 8)
    .filter((row) => row.orders > 0)
    .map((row, index) => ({
      label: row.name,
      value: row.orders,
      color: colorBy?.(row.name, index) ?? PDF_CHART_PALETTE[index % PDF_CHART_PALETTE.length],
    }));
}

function addBreakdownSection(
  sections: DossierSection[],
  heading: string,
  data: { name: string; orders: number; revenue: number }[],
  fmt: Formatters,
  colorBy?: (name: string, index: number) => PdfRgb
) {
  const bars = orderBars(data, colorBy);
  if (!bars.length) return;
  sections.push({
    heading,
    bars: {
      title: "Orders",
      data: bars,
    },
    table: {
      columns: ["Group", "Orders", "Revenue"],
      rows: data.slice(0, 8).map((row) => [
        row.name,
        fmt.num(row.orders),
        fmt.money(row.revenue),
      ]),
    },
  });
}

function hexRgb(hex: string, fallback = PDF_CHART_COLORS.indigo): PdfRgb {
  const raw = hex.replace("#", "").trim();
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return fallback;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

type AnimatedReportTone = "good" | "bad" | "neutral";
type AnimatedReportRow = {
  label: string;
  value: number;
  text: string;
  sub?: string;
  tone?: AnimatedReportTone;
};
type AnimatedTimelinePoint = {
  label: string;
  orders: number;
  refunds: number;
  cumulativeNetProfit: number;
  cumulativeCash: number;
  inventoryOnHand: number;
  stockouts: number;
};
type AnimatedLaunchReportData = {
  title: string;
  subtitle: string;
  verdict: string;
  meta: string[];
  kpis: {
    label: string;
    value: string;
    sub?: string;
    tone: AnimatedReportTone;
  }[];
  timeline: AnimatedTimelinePoint[];
  pnl: AnimatedReportRow[];
  funnel: AnimatedReportRow[];
  acquisition: AnimatedReportRow[];
  mix: AnimatedReportRow[];
  breakdowns: { title: string; rows: AnimatedReportRow[] }[];
  inventory: AnimatedReportRow[];
  diagnostics: { drivers: string[]; risks: string[]; nextMoves: string[] };
  assumptions: string[];
};

function downloadAnimatedLaunchReport(
  report: AnimatedLaunchReportData,
  filename: string
) {
  const html = buildAnimatedLaunchReportHtml(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".html") ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildAnimatedLaunchReportHtml(report: AnimatedLaunchReportData): string {
  const safeJson = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const maxAbs = (rows: AnimatedReportRow[]) =>
    Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const barList = (title: string, rows: AnimatedReportRow[], extra = "") => {
    const max = maxAbs(rows);
    return `
      <section class="panel reveal ${extra}">
        <div class="section-head">
          <h2>${esc(title)}</h2>
        </div>
        <div class="bar-list">
          ${rows
            .map((row, index) => {
              const width = Math.max(2, (Math.abs(row.value) / max) * 100);
              const tone = row.tone ?? (row.value < 0 ? "bad" : "neutral");
              return `
                <div class="bar-row" style="--i:${index};--w:${width}%">
                  <div class="bar-label">
                    <strong>${esc(row.label)}</strong>
                    ${row.sub ? `<span>${esc(row.sub)}</span>` : ""}
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill tone-${tone}"></div>
                  </div>
                  <div class="bar-value tone-text-${tone}">${esc(row.text)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  };
  const listBlock = (title: string, items: string[]) =>
    items.length
      ? `
        <section class="panel reveal">
          <div class="section-head"><h2>${esc(title)}</h2></div>
          <ul class="note-list">
            ${items.map((item) => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </section>
      `
      : "";
  const breakdowns = report.breakdowns
    .filter((section) => section.rows.length)
    .map((section) => barList(section.title, section.rows, "compact-panel"))
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(report.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171717;
      --muted: #737373;
      --line: #e5e7eb;
      --panel: rgba(255,255,255,0.92);
      --indigo: #6366f1;
      --green: #10b981;
      --red: #dc2626;
      --amber: #f59e0b;
      --sky: #0ea5e9;
      --teal: #14b8a6;
      --rose: #f472b6;
      --shadow: 0 20px 70px rgba(15,23,42,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        linear-gradient(120deg, rgba(99,102,241,0.10), transparent 32%),
        linear-gradient(240deg, rgba(20,184,166,0.12), transparent 30%),
        linear-gradient(180deg, #fafafa, #f8fafc 44%, #fff7ed);
      min-height: 100vh;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(15,23,42,0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15,23,42,0.045) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.55), transparent 74%);
      animation: grid-drift 18s linear infinite;
    }
    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 36px 0 64px;
      position: relative;
    }
    .hero {
      min-height: 88vh;
      display: grid;
      align-content: center;
      gap: 26px;
      padding-bottom: 28px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      gap: 24px;
      align-items: stretch;
    }
    .eyebrow {
      color: var(--indigo);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      font-size: clamp(42px, 8vw, 92px);
      line-height: 0.92;
      letter-spacing: 0;
      margin: 10px 0 16px;
      max-width: 920px;
    }
    h2 {
      font-size: 15px;
      line-height: 1.2;
      margin: 0;
    }
    p { margin: 0; }
    .subtitle {
      max-width: 760px;
      color: #404040;
      font-size: 17px;
      line-height: 1.65;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .pill {
      border: 1px solid rgba(99,102,241,0.22);
      background: rgba(255,255,255,0.72);
      border-radius: 999px;
      padding: 7px 11px;
      color: #4b5563;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(12px);
    }
    .verdict {
      border-left: 4px solid var(--indigo);
      background: rgba(255,255,255,0.76);
      border-radius: 8px;
      padding: 18px 20px;
      color: #27272a;
      line-height: 1.55;
      box-shadow: var(--shadow);
      animation: rise .7s ease both .12s;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .kpi {
      min-height: 124px;
      border: 1px solid rgba(229,231,235,0.9);
      background: rgba(255,255,255,0.82);
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 12px 40px rgba(15,23,42,0.08);
      animation: rise .7s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 80ms + 160ms);
      position: relative;
      overflow: hidden;
    }
    .kpi::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(110deg, transparent, rgba(255,255,255,.68), transparent);
      transform: translateX(-120%);
      animation: shimmer 4s ease-in-out infinite;
      animation-delay: calc(var(--i) * 220ms + 1s);
    }
    .kpi span {
      color: #a3a3a3;
      display: block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .kpi strong {
      display: block;
      margin-top: 8px;
      font-size: clamp(24px, 3vw, 38px);
      line-height: 1;
    }
    .kpi em {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      font-style: normal;
    }
    .tone-good strong, .tone-text-good { color: var(--green); }
    .tone-bad strong, .tone-text-bad { color: var(--red); }
    .tone-neutral strong, .tone-text-neutral { color: var(--ink); }
    .playback {
      position: sticky;
      top: 12px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid rgba(229,231,235,0.9);
      background: rgba(255,255,255,0.82);
      border-radius: 12px;
      padding: 10px;
      box-shadow: 0 10px 40px rgba(15,23,42,0.10);
      backdrop-filter: blur(18px);
      margin-bottom: 20px;
    }
    button {
      border: 0;
      border-radius: 9px;
      background: var(--indigo);
      color: white;
      font-weight: 800;
      padding: 10px 13px;
      cursor: pointer;
    }
    button.secondary {
      color: #374151;
      background: #f3f4f6;
    }
    .progress-shell {
      height: 9px;
      background: #eef2ff;
      border-radius: 999px;
      flex: 1;
      overflow: hidden;
    }
    #progressBar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--indigo), var(--teal), var(--amber));
      border-radius: inherit;
      transition: width .12s linear;
    }
    #clock {
      min-width: 84px;
      text-align: right;
      color: #4b5563;
      font-size: 12px;
      font-weight: 800;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .panel {
      border: 1px solid rgba(229,231,235,0.95);
      background: var(--panel);
      border-radius: 10px;
      padding: 18px;
      box-shadow: 0 12px 42px rgba(15,23,42,0.08);
      overflow: hidden;
    }
    .wide { grid-column: 1 / -1; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-head small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    svg.chart {
      width: 100%;
      height: 310px;
      display: block;
      overflow: visible;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: #525252;
      font-size: 12px;
      font-weight: 700;
    }
    .legend i {
      display: inline-block;
      width: 22px;
      height: 4px;
      border-radius: 999px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .bar-list {
      display: grid;
      gap: 11px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(116px, 1fr) minmax(140px, 2fr) minmax(76px, auto);
      align-items: center;
      gap: 12px;
      animation: rise .55s ease both;
      animation-delay: calc(var(--i) * 55ms);
    }
    .bar-label strong {
      display: block;
      color: #404040;
      font-size: 12px;
      line-height: 1.2;
    }
    .bar-label span {
      color: #8b8b8b;
      display: block;
      font-size: 11px;
      line-height: 1.3;
      margin-top: 2px;
    }
    .bar-track {
      height: 13px;
      border-radius: 999px;
      background: #f1f5f9;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      width: var(--w);
      min-width: 2px;
      border-radius: inherit;
      transform-origin: left center;
      animation: grow 1.1s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 55ms + .22s);
    }
    .bar-value {
      color: #404040;
      font-size: 12px;
      font-weight: 800;
      text-align: right;
      white-space: nowrap;
    }
    .bar-fill.tone-good { background: linear-gradient(90deg, #34d399, #10b981); }
    .bar-fill.tone-bad { background: linear-gradient(90deg, #fda4af, #dc2626); }
    .bar-fill.tone-neutral { background: linear-gradient(90deg, #a5b4fc, #6366f1); }
    .note-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }
    .note-list li {
      border-left: 3px solid var(--indigo);
      background: #f8fafc;
      border-radius: 7px;
      color: #404040;
      line-height: 1.45;
      padding: 10px 12px;
      animation: rise .55s ease both;
    }
    .footer {
      color: #737373;
      font-size: 12px;
      text-align: center;
      padding: 32px 0 0;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(18px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes grow {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    @keyframes shimmer {
      0%, 38% { transform: translateX(-120%); }
      62%, 100% { transform: translateX(120%); }
    }
    @keyframes grid-drift {
      from { background-position: 0 0, 0 0; }
      to { background-position: 44px 44px, 44px 44px; }
    }
    @media (max-width: 820px) {
      .hero { min-height: auto; padding-top: 34px; }
      .hero-grid, .grid { grid-template-columns: 1fr; }
      .kpi-grid { grid-template-columns: 1fr; }
      .playback { align-items: stretch; flex-wrap: wrap; }
      .progress-shell { flex-basis: 100%; order: 3; }
      #clock { text-align: left; }
      .bar-row { grid-template-columns: 1fr; gap: 6px; }
      .bar-value { text-align: left; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <div class="eyebrow">Animated Launch Report</div>
        <h1>${esc(report.title)}</h1>
        <p class="subtitle">${esc(report.subtitle)}</p>
        <div class="meta">${report.meta.map((item) => `<span class="pill">${esc(item)}</span>`).join("")}</div>
      </div>
      <div class="hero-grid">
        <div class="verdict">${esc(report.verdict || "No verdict generated for this scenario.")}</div>
        <div class="kpi-grid">
          ${report.kpis
            .map(
              (kpi, index) => `
                <article class="kpi tone-${kpi.tone}" style="--i:${index}">
                  <span>${esc(kpi.label)}</span>
                  <strong>${esc(kpi.value)}</strong>
                  ${kpi.sub ? `<em>${esc(kpi.sub)}</em>` : ""}
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>

    <div class="playback">
      <button id="playToggle">Pause</button>
      <button id="replay" class="secondary">Replay</button>
      <div class="progress-shell"><div id="progressBar"></div></div>
      <div id="clock">Start</div>
    </div>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Demand playback</h2>
        <small>orders and refunds</small>
      </div>
      <svg id="demandChart" class="chart" role="img" aria-label="Animated demand chart"></svg>
      <div class="legend"><span><i style="background:#6366f1"></i>Orders</span><span><i style="background:#dc2626"></i>Refunds</span></div>
    </section>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Cash payback playback</h2>
        <small>cumulative profit and cash</small>
      </div>
      <svg id="cashChart" class="chart" role="img" aria-label="Animated cash payback chart"></svg>
      <div class="legend"><span><i style="background:#10b981"></i>Cumulative net profit</span><span><i style="background:#f59e0b"></i>Cumulative cash</span></div>
    </section>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Inventory playback</h2>
        <small>inventory and stockouts</small>
      </div>
      <svg id="inventoryChart" class="chart" role="img" aria-label="Animated inventory chart"></svg>
      <div class="legend"><span><i style="background:#14b8a6"></i>Inventory on hand</span><span><i style="background:#dc2626"></i>Stockouts</span></div>
    </section>

    <div class="grid">
      ${barList("Revenue, costs, and profit", report.pnl)}
      ${barList("Acquisition funnel", report.funnel)}
      ${report.acquisition.length ? barList("Acquisition by channel", report.acquisition) : ""}
      ${barList("New vs returning", report.mix)}
      ${barList("Inventory and returns", report.inventory)}
      ${breakdowns}
      ${listBlock("What's driving it", report.diagnostics.drivers)}
      ${listBlock("Risks", report.diagnostics.risks)}
      ${listBlock("Next moves", report.diagnostics.nextMoves)}
      ${listBlock("Assumptions", report.assumptions)}
    </div>
    <p class="footer">Generated by EntreTangle - open this HTML file in any modern browser to replay the launch.</p>
  </main>
  <script>
    const report = ${safeJson};
    const timeline = report.timeline.length ? report.timeline : [{label:"Start",orders:0,refunds:0,cumulativeNetProfit:0,cumulativeCash:0,inventoryOnHand:0,stockouts:0}];
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ns = "http://www.w3.org/2000/svg";
    let playing = !reduceMotion;
    let progress = reduceMotion ? 1 : 0;
    let startedAt = 0;
    const duration = Math.min(Math.max(timeline.length * 130, 5200), 14000);
    const progressBar = document.getElementById("progressBar");
    const clock = document.getElementById("clock");
    const playToggle = document.getElementById("playToggle");

    function compact(n) {
      const value = Number(n) || 0;
      const abs = Math.abs(value);
      if (abs >= 10000000) return (value / 10000000).toFixed(1) + "Cr";
      if (abs >= 100000) return (value / 100000).toFixed(1) + "L";
      if (abs >= 1000) return (value / 1000).toFixed(1) + "k";
      return Math.round(value).toLocaleString();
    }
    function make(tag, attrs) {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs || {}).forEach(function(entry) {
        el.setAttribute(entry[0], String(entry[1]));
      });
      return el;
    }
    function text(svg, value, x, y, attrs) {
      const el = make("text", Object.assign({ x, y, fill: "#9ca3af", "font-size": 10, "font-weight": 700 }, attrs || {}));
      el.textContent = value;
      svg.appendChild(el);
    }
    function dimensions(svg) {
      const rect = svg.getBoundingClientRect();
      const width = Math.max(620, Math.round(rect.width || 900));
      const height = 310;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      svg.innerHTML = "";
      return { width, height, left: 58, right: 18, top: 16, bottom: 42 };
    }
    function scaleFor(fields) {
      const values = [];
      timeline.forEach(function(point) {
        fields.forEach(function(field) { values.push(Number(point[field]) || 0); });
      });
      let min = Math.min(0, ...values);
      let max = Math.max(0, ...values);
      if (min === max) max = min + 1;
      return { min, max };
    }
    function drawGrid(svg, box, scale) {
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      for (let i = 0; i <= 4; i += 1) {
        const y = box.top + (i / 4) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: y, x2: box.left + plotW, y2: y, stroke: "#e5e7eb", "stroke-width": 1 }));
        const val = scale.max - (i / 4) * (scale.max - scale.min);
        text(svg, compact(val), box.left - 10, y + 4, { "text-anchor": "end" });
      }
      if (scale.min < 0 && scale.max > 0) {
        const zeroY = box.top + plotH - ((0 - scale.min) / (scale.max - scale.min)) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: zeroY, x2: box.left + plotW, y2: zeroY, stroke: "#94a3b8", "stroke-width": 1.2 }));
      }
      text(svg, timeline[0].label, box.left, box.height - 14, {});
      text(svg, timeline[timeline.length - 1].label, box.left + plotW, box.height - 14, { "text-anchor": "end" });
    }
    function drawLineChart(id, series, p) {
      const svg = document.getElementById(id);
      const box = dimensions(svg);
      const fields = series.map(function(item) { return item.field; });
      const scale = scaleFor(fields);
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      const visible = Math.max(2, Math.ceil(timeline.length * p));
      drawGrid(svg, box, scale);
      function x(i) {
        return box.left + (timeline.length <= 1 ? 0 : (i / (timeline.length - 1)) * plotW);
      }
      function y(v) {
        return box.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
      }
      series.forEach(function(item) {
        let d = "";
        for (let i = 0; i < visible; i += 1) {
          const cmd = i === 0 ? "M" : "L";
          d += cmd + x(i).toFixed(2) + " " + y(Number(timeline[i][item.field]) || 0).toFixed(2) + " ";
        }
        svg.appendChild(make("path", { d, fill: "none", stroke: item.color, "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      });
    }
    function drawDemand(p) {
      const svg = document.getElementById("demandChart");
      const box = dimensions(svg);
      const scale = scaleFor(["orders", "refunds"]);
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      const visible = Math.max(1, Math.ceil(timeline.length * p));
      drawGrid(svg, box, scale);
      const slot = plotW / Math.max(timeline.length, 1);
      const barW = Math.max(2, slot * 0.58);
      function y(v) {
        return box.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
      }
      for (let i = 0; i < visible; i += 1) {
        const point = timeline[i];
        const x = box.left + i * slot + (slot - barW) / 2;
        const orderH = Math.max(1, box.top + plotH - y(point.orders));
        svg.appendChild(make("rect", { x, y: y(point.orders), width: barW, height: orderH, rx: 4, fill: "#6366f1", opacity: .86 }));
        if (point.refunds > 0) {
          const refundH = Math.max(1, box.top + plotH - y(point.refunds));
          svg.appendChild(make("rect", { x: x + barW * .56, y: y(point.refunds), width: barW * .38, height: refundH, rx: 4, fill: "#dc2626", opacity: .86 }));
        }
      }
    }
    function render(p) {
      progress = Math.max(0, Math.min(1, p));
      drawDemand(progress);
      drawLineChart("cashChart", [
        { field: "cumulativeNetProfit", color: "#10b981" },
        { field: "cumulativeCash", color: "#f59e0b" }
      ], progress);
      drawLineChart("inventoryChart", [
        { field: "inventoryOnHand", color: "#14b8a6" },
        { field: "stockouts", color: "#dc2626" }
      ], progress);
      const idx = Math.min(timeline.length - 1, Math.max(0, Math.ceil(timeline.length * progress) - 1));
      progressBar.style.width = Math.round(progress * 100) + "%";
      clock.textContent = timeline[idx].label;
    }
    function tick(ts) {
      if (!playing) return;
      if (!startedAt) startedAt = ts;
      const p = ((ts - startedAt) % duration) / duration;
      render(p);
      window.requestAnimationFrame(tick);
    }
    playToggle.addEventListener("click", function() {
      playing = !playing;
      playToggle.textContent = playing ? "Pause" : "Play";
      if (playing) {
        startedAt = performance.now() - progress * duration;
        window.requestAnimationFrame(tick);
      }
    });
    document.getElementById("replay").addEventListener("click", function() {
      progress = 0;
      playing = true;
      playToggle.textContent = "Pause";
      startedAt = 0;
      window.requestAnimationFrame(tick);
    });
    window.addEventListener("resize", function() { render(progress); });
    render(progress);
    if (playing) window.requestAnimationFrame(tick);
  </script>
</body>
</html>`;
}

function esc(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, " ");
}

function formatAssumptionValue(
  value: string | number,
  unit: string,
  fmt: Formatters
): string {
  if (typeof value === "string") return value;
  const unitCurrency =
    unit === fmt.sourceCurrency || unit.startsWith(`${fmt.sourceCurrency}/`);
  const formatted =
    Math.abs(value) < 10 && !Number.isInteger(value)
      ? value.toFixed(2).replace(/\.?0+$/, "")
      : fmt.num(value);
  if (
    unitCurrency &&
    fmt.displayCurrency !== fmt.sourceCurrency &&
    fmt.moneyRate !== 1
  ) {
    return `${fmt.money(value)} (${formatted} ${unit})`;
  }
  return unit ? `${formatted} ${unit}` : formatted;
}

function buildAdvancedSettingsBullets(
  raw: LaunchSimInputs,
  used: LaunchSimInputs,
  fmt: Formatters
): string[] {
  const stepUnit = used.granularity === "day" ? "day" : "month";
  const moneyPer = (value: number, unit: string) => `${fmt.money(value)}/${unit}`;
  const auto = (isAuto: boolean, label = "auto-resolved") =>
    isAuto ? ` (${label})` : "";
  const channels =
    used.channels.length > 0
      ? used.channels
          .map((c) => {
            const paid =
              c.kind === "paid" || c.kind === "marketplace" || c.kind === "retail";
            const spend = paid ? `, ${pctLabel(c.spendPct)} spend` : "";
            return `${c.label} (${c.kind}${spend}, ${fmt.money(c.cpm)} CPM, ${smartNumber(c.frequencyCap)} freq)`;
          })
          .join("; ")
      : "None";
  const rentalLines =
    used.businessModel === "rental"
      ? [
          `Rental - Assets: ${fmt.num(used.rentalAssetCount)} reusable assets`,
          `Rental - Asset cost: ${moneyPer(used.rentalAssetCost, "asset")}`,
          `Rental - Rentable days: ${smartNumber(used.rentalRentableDaysPerMonth)} days/asset/month`,
          `Rental - Avg duration: ${smartNumber(used.rentalAvgDurationDays)} days/booking`,
          `Rental - Capacity: ${fmt.num(
            (used.rentalAssetCount * used.rentalRentableDaysPerMonth) /
              Math.max(used.rentalAvgDurationDays, 1 / 30)
          )} bookings/month`,
          `Rental - Maintenance: ${moneyPer(used.rentalMaintenancePerOrder, "booking")}`,
          `Rental - Damage/loss risk: ${smartNumber(used.rentalDamageLossPct)}%`,
          `Rental - Deposit cover: ${fmt.money(used.rentalDepositAmount)}`,
        ]
      : [];
  const modelLines =
    used.businessModel === "subscription"
      ? [
          `Subscription - Monthly churn: ${smartNumber(
            used.subscriptionMonthlyChurnPct
          )}%`,
        ]
      : used.businessModel === "booking"
        ? [
            `Booking - Capacity: ${fmt.num(
              used.bookingCapacityPerMonth
            )} bookings/month`,
          ]
        : used.businessModel === "usage_based"
          ? [
              `Usage - Frequency: ${smartNumber(
                used.usageEventsPerCustomerPerMonth
              )} uses/customer/month`,
              `Usage - Monthly churn: ${smartNumber(used.usageMonthlyChurnPct)}%`,
            ]
          : used.businessModel === "lead_gen"
            ? [
                "Lead-gen - Monetized unit: qualified lead / commission event",
              ]
            : used.businessModel === "project_services"
              ? [
                  `Project services - Capacity: ${smartNumber(
                    used.projectCapacityPerMonth
                  )} projects/month`,
                ]
              : [];

  return [
    `Acquisition - Reachable pool: ${fmt.num(used.reachablePool ?? 0)} people${auto(raw.reachablePool == null, "auto-sized")}`,
    `Acquisition - CPM: ${moneyPer(used.cpm, "1k impressions")}`,
    `Acquisition - Paid CAC: ${
      used.paidCac == null ? "Benchmark/model cap" : fmt.money(used.paidCac)
    }${auto(raw.paidCac == null, "benchmark/model")}`,
    `Acquisition - Frequency cap: ${smartNumber(used.frequencyCap)} impressions/person`,
    `Acquisition - Organic reach: ${fmt.num(used.organicReachPerStep)} people/${stepUnit}`,
    `Acquisition - Paid platforms: ${used.adPlatforms.join(", ") || "None"}`,
    `Acquisition - Channels: ${channels}`,
    `Funnel behavior - Targeting quality: ${pctLabel(used.targetingQuality)}`,
    `Funnel behavior - Virality k: ${smartNumber(used.viralityK)} people/buyer`,
    `Funnel behavior - Decision speed: ${pctLabel(used.decisionSpeed ?? 0)}/${stepUnit}${auto(raw.decisionSpeed == null)}`,
    `Funnel behavior - Abandon rate: ${pctLabel(used.abandonRate)}/${stepUnit}`,
    `Funnel behavior - Launch month: ${used.launchStartMonth ? monthLabel(used.launchStartMonth) : "Seasonality off"}${auto(raw.launchStartMonth == null, "seasonality default")}`,
    `Funnel behavior - Attention momentum: ${signedPercent(used.demandMomentumPct)} demand tilt`,
    `Funnel behavior - Growth / month: ${signedPercent(used.monthlyGrowthPct ?? 0)}${auto(raw.monthlyGrowthPct == null, "audience-derived")}`,
    `Operations & costs - Shipping/order: ${moneyPer(used.shippingPerOrder, "order")}`,
    `Operations & costs - Payment fee: ${pctLabel(used.paymentFeePct)}`,
    `Operations & costs - Fixed costs: ${moneyPer(used.fixedCostsPerMonth, "month")}`,
    `Operations & costs - Launch reserve: ${
      used.launchInvestmentReserve == null
        ? "Auto"
        : fmt.money(used.launchInvestmentReserve)
    }${auto(raw.launchInvestmentReserve == null, "auto-resolved")}`,
    `Operations & costs - Initial inventory: ${fmt.num(used.initialInventoryUnits ?? 0)} units${auto(raw.initialInventoryUnits == null, "auto-sized")}`,
    `Operations & costs - Reordering: ${used.reorderEnabled ? "On" : "Off"}`,
    `Operations & costs - Reorder lead: ${fmt.num(used.reorderLeadTimeDays)} days`,
    `Operations & costs - Minimum order quantity: ${fmt.num(used.minOrderQtyUnits ?? 0)} units/batch${auto(raw.minOrderQtyUnits == null, "auto-sized")}`,
    ...rentalLines,
    ...modelLines,
    `Returns & retention - Return window: ${fmt.num(used.returnWindowDays)} days`,
    `Returns & retention - Target refund rate: ${
      used.targetRefundRatePct == null
        ? "Persona baseline"
        : `${smartNumber(used.targetRefundRatePct)}%`
    }${auto(raw.targetRefundRatePct == null, "benchmark/default")}`,
    `Returns & retention - Refund multiplier: ${smartNumber(used.refundRateMult)}x`,
    `Returns & retention - Resellable returns: ${pctLabel(used.resellablePct)}`,
    `Returns & retention - Return shipping/order: ${moneyPer(
      used.returnShippingPerOrder ?? used.shippingPerOrder,
      "return"
    )}${auto(raw.returnShippingPerOrder == null, "same as outbound")}`,
    `Returns & retention - Repeat rate multiplier: ${smartNumber(used.repeatRateMult)}x`,
    `Engine - Trajectory jitter: ${pctLabel(used.jitterAmplitude)}`,
  ];
}

function pctLabel(value: number): string {
  return `${smartNumber(value * 100)}%`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${smartNumber(value)}%`;
}

function smartNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const maxFractionDigits = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 1;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function monthLabel(month: number): string {
  return (
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][month - 1] ?? `Month ${month}`
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
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="0"
          step={step}
          autoComplete="off"
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={(e) => {
            editing.current = false;
            const n = parseNumericText(e.currentTarget.value);
            onChange(n);
            // Normalise the display; clamped/rounded parent values will flow in
            // immediately through the effect above.
            setText(Number.isFinite(n) ? String(n) : "");
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            // Empty / partial ("-", ".") report 0 to the parent but keep the raw
            // text so the user can keep typing. Commas/currency symbols pasted
            // from spreadsheets or dashboards are accepted and normalised later.
            onChange(parseNumericText(raw));
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

function NullableNumField({
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
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  small?: boolean;
}) {
  const [text, setText] = useState(
    value != null && Number.isFinite(value) ? String(value) : ""
  );
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(value != null && Number.isFinite(value) ? String(value) : "");
    }
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      setText("");
      return;
    }
    const n = parseNumericText(raw);
    onChange(n);
    setText(Number.isFinite(n) ? String(n) : "");
  };

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="Auto"
          step={step}
          autoComplete="off"
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={(e) => {
            editing.current = false;
            commit(e.currentTarget.value);
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            onChange(raw.trim() === "" ? null : parseNumericText(raw));
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

function parseNumericText(raw: string): number {
  const currencyStripped = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const minusNormalized = currencyStripped.startsWith("-")
    ? `-${currencyStripped.slice(1).replace(/-/g, "")}`
    : currencyStripped.replace(/-/g, "");
  const firstDecimal = minusNormalized.indexOf(".");
  const normalized =
    firstDecimal === -1
      ? minusNormalized
      : `${minusNormalized.slice(0, firstDecimal + 1)}${minusNormalized
          .slice(firstDecimal + 1)
          .replace(/\./g, "")}`;

  if (
    !normalized ||
    normalized === "-" ||
    normalized === "." ||
    normalized === "-."
  ) {
    return 0;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

type Formatters = {
  money: (n: number) => string;
  num: (n: number) => string;
  compact: (n: number) => string;
  compactMoney: (n: number) => string;
  displayCurrency: string;
  sourceCurrency: string;
  moneyRate: number;
};

function makeFormatters(
  displayCurrency: string,
  moneyRate = 1,
  sourceCurrency = displayCurrency
): Formatters {
  let money: (n: number) => string;
  const convert = (n: number) => n * moneyRate;
  try {
    const f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: 0,
    });
    money = (n) => f.format(convert(n));
  } catch {
    money = (n) =>
      `${displayCurrency} ${Math.round(convert(n)).toLocaleString()}`;
  }
  const compactF = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    money,
    num: (n) => Math.round(n).toLocaleString(),
    compact: (n) => compactF.format(n),
    compactMoney: (n) => compactF.format(convert(n)),
    displayCurrency,
    sourceCurrency,
    moneyRate,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pctToRatio = (v: number) => clamp01(v / 100);

function nextName(scenarios: LaunchSimRecord[]): string {
  return `Scenario ${scenarios.length + 1}`;
}

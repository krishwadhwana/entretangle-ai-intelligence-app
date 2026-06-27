"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  Scale,
  Wallet,
  Target,
  FileDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from "recharts";
import type {
  FinancialModel,
  FinancialInputs,
  FinNum,
  FinSource,
  FinancialsSection as FinancialsState,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { ValueTooltip } from "./ValueTooltip";
import { downloadDossier, type DossierSection } from "./pdf";
import { providerErrorMessage } from "@/lib/providerErrors";

// Provenance dot — the visible signal of "hybrid by stage": ai estimates firm
// up to founder/data numbers over the journey.
const SOURCE_META: Record<FinSource, { dot: string; label: string }> = {
  ai_estimated: { dot: "bg-amber-400", label: "AI estimate" },
  founder_entered: { dot: "bg-emerald-500", label: "You entered this" },
  derived_from_data: { dot: "bg-sky-500", label: "From your data" },
  computed: { dot: "bg-neutral-400", label: "Computed" },
};

const METRIC_HELP: Record<string, string> = {
  "TAM / yr":
    "Total addressable market: the broad annual revenue pool if the business could sell to the entire relevant market.",
  "SAM / yr":
    "Serviceable addressable market: the annual revenue pool reachable by this business model, geography, channel and product scope.",
  "SOM / yr (top-down)":
    "Serviceable obtainable market: a conservative annual revenue target from the top-down market model.",
  "Bottom-up / yr":
    "Annual revenue implied by this model's base price tier, reachable prospects and simulated-buyer conversion.",
  Price:
    "Retail price per unit for this tier. Editing it recomputes demand, revenue, gross profit and break-even.",
  margin:
    "Gross margin percentage: contribution per unit divided by retail price.",
  "units/mo":
    "Estimated monthly units sold: reachable prospects multiplied by simulated buyers who can afford this price and intend to buy.",
  "Revenue/mo":
    "Estimated monthly revenue for this price tier: units per month multiplied by price.",
  "Gross profit/mo":
    "Estimated monthly gross profit for this price tier: units per month multiplied by contribution per unit.",
  "Per-unit landed cost":
    "All variable costs required to get one sellable unit ready for sale, including production and logistics assumptions.",
  "Landed cost / unit":
    "Total per-unit landed cost, computed as the sum of the cost-structure line items.",
  "Blended CAC":
    "Customer acquisition cost weighted across channels when channel share is available, otherwise the mean of channel CAC assumptions.",
  LTV: "Lifetime value. Uses the provided LTV estimate when available, otherwise a single-purchase contribution proxy.",
  "LTV : CAC":
    "Ratio of lifetime value to blended CAC. Higher means each acquired customer produces more value relative to acquisition cost.",
  "Break-even units/mo":
    "Monthly unit sales needed for contribution profit to cover fixed monthly costs.",
  "Months to break even":
    "Estimated months for cumulative net gross profit to repay the MOQ cash requirement.",
  Runway:
    "Months the available capital can cover fixed monthly burn before additional financing or revenue is needed.",
  "Fixed costs / mo":
    "Monthly operating costs that do not vary directly with unit sales, such as salaries, rent, software, retainers and baseline marketing.",
  "Reachable prospects / mo":
    "Prospects this business can realistically reach each month through its intended channels.",
  "MOQ cash required":
    "Cash needed to fund one minimum-order-quantity cycle before sales proceeds come back.",
};

function fmt(v: number, currency: string, unit?: string): string {
  if (!isFinite(v)) return "—";
  const compact = new Intl.NumberFormat(undefined, {
    notation: Math.abs(v) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(v);
  if (unit === "%") return `${compact}%`;
  if (unit === "x") return `${compact}×`;
  if (!unit || unit.startsWith(currency)) return `${currency} ${compact}`;
  return `${compact} ${unit}`; // units/mo, months, prospects/mo, purchases
}

function MetricLabel({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  const help = METRIC_HELP[label];
  return (
    <span
      className={`${help ? "cursor-help decoration-dotted underline-offset-2 hover:underline" : ""} ${className}`}
      title={help}
    >
      {label}
    </span>
  );
}

function Dot({ source, basis }: { source: FinSource; basis?: string }) {
  const m = SOURCE_META[source];
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`}
      title={basis ? `${m.label} — ${basis}` : m.label}
    />
  );
}

// A labelled figure with its provenance dot.
function Stat({
  label,
  n,
  currency,
  big = false,
}: {
  label: string;
  n: FinNum | null;
  currency: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        <MetricLabel label={label} />
      </p>
      <p
        className={`mt-0.5 flex items-center gap-1.5 font-semibold text-neutral-900 ${
          big ? "text-lg" : "text-[13px]"
        }`}
      >
        {n ? fmt(n.value, currency, n.unit) : "—"}
        {n && <Dot source={n.source} basis={n.basis} />}
      </p>
      {n?.basis && (
        <p className="mt-0.5 text-[10px] leading-tight text-neutral-400">{n.basis}</p>
      )}
    </div>
  );
}

// An editable numeric input that recomputes the model on commit.
function NumField({
  label,
  value,
  currency,
  unit,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  currency: string;
  unit?: string;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const dirty = draft !== String(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        <MetricLabel label={label} />{" "}
        {unit ? `(${unit === "INR" ? currency : unit})` : ""}
      </span>
      <input
        type="number"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = Number(draft);
          if (dirty && isFinite(v)) onCommit(v);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px] text-neutral-900 focus:border-indigo-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
      />
    </label>
  );
}

function MiniNumField({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const dirty = draft !== String(value);
  return (
    <input
      aria-label={label}
      title={label}
      type="number"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = Number(draft);
        if (dirty && isFinite(v)) onCommit(v);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-28 rounded-lg border border-neutral-200 px-2 py-1.5 text-right text-[12px] font-medium tabular-nums text-neutral-900 focus:border-indigo-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
    />
  );
}

export default function FinancialsSection({
  runId,
  projectId,
  state,
  initial,
  onSaved,
}: {
  runId: string;
  projectId: string | null;
  state: CanvasState;
  initial: FinancialsState | null;
  onSaved?: (section: FinancialsState) => void;
}) {
  const ready = state.status === "complete" || state.status === "capped";

  const [model, setModel] = useState<FinancialModel | null>(initial?.model ?? null);
  const [inputs, setInputs] = useState<FinancialInputs | null>(
    initial?.inputs ?? null
  );
  const [editedKeys, setEditedKeys] = useState<string[]>(initial?.editedKeys ?? []);
  const [generatedAt, setGeneratedAt] = useState<string | null>(
    initial?.generatedAt ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Ask about these financials" follow-up Q&A (persisted with the section).
  const [followUp, setFollowUp] = useState(initial?.followUp ?? []);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);

  const currency = model?.currency ?? "INR";
  const sourceRunId = model?.sourceRunId ?? initial?.sourceRunId ?? null;
  const showingCurrentRun = !sourceRunId || sourceRunId === runId;
  const shortRunId = (sourceRunId ?? runId).slice(-6);

  const askFinancials = async () => {
    const question = q.trim();
    if (!question || asking || !model) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/financials/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
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
      setError(providerErrorMessage(e, "ask failed"));
    } finally {
      setAsking(false);
    }
  };

  const exportPdf = () => {
    if (!model) return;
    if (!showingCurrentRun) {
      setError(
        "This financial model belongs to another run. Wait for this run's financials to finish loading, then export again."
      );
      return;
    }
    const m = model;
    const metric = (n: FinNum | null | undefined) =>
      n && Number.isFinite(n.value) ? fmt(n.value, currency, n.unit) : "—";
    const sourceLine = (n: FinNum | null | undefined) => {
      if (!n) return "";
      const label = SOURCE_META[n.source]?.label ?? n.source;
      return [label, n.basis].filter(Boolean).join(" - ");
    };
    const inputMoney = (v: number, unit?: string) =>
      Number.isFinite(v) ? fmt(v, currency, unit) : "—";
    const landedCost = m.costStructure.reduce((s, c) => s + c.amount.value, 0);
    const generatedLabel =
      m.generatedAt ?? generatedAt
        ? new Date(m.generatedAt ?? generatedAt ?? "").toLocaleDateString()
        : new Date().toLocaleDateString();
    const sections: DossierSection[] = [];
    sections.push({
      heading: "Model snapshot",
      kpis: [
        { label: "Currency", value: currency },
        { label: "Run", value: shortRunId },
        { label: "Data maturity", value: `${m.dataMaturityPct}% real` },
        { label: "Generated", value: generatedLabel },
      ],
      body: m.runwayFit.verdict || undefined,
    });
    sections.push({
      heading: "Market size: top-down vs your buyers",
      body: m.marketSizing.reconciliationNote,
      kpis: [
        {
          label: "TAM / yr",
          value: metric(m.marketSizing.tam),
          sub: sourceLine(m.marketSizing.tam),
        },
        {
          label: "SAM / yr",
          value: metric(m.marketSizing.sam),
          sub: sourceLine(m.marketSizing.sam),
        },
        {
          label: "SOM / yr",
          value: metric(m.marketSizing.som),
          sub: sourceLine(m.marketSizing.som),
        },
        {
          label: "Bottom-up / yr",
          value: metric(m.marketSizing.bottomUpAnnualRevenue),
          sub: sourceLine(m.marketSizing.bottomUpAnnualRevenue),
        },
        {
          label: "Reachable prospects / mo",
          value: metric(m.marketSizing.reachableProspectsPerMonth),
          sub: sourceLine(m.marketSizing.reachableProspectsPerMonth),
        },
      ],
      bars: {
        title: "Annual market sizing",
        money: true,
        data: [
          { label: "TAM", value: m.marketSizing.tam.value },
          { label: "SAM", value: m.marketSizing.sam.value },
          { label: "SOM", value: m.marketSizing.som.value },
          {
            label: "Bottom-up",
            value: m.marketSizing.bottomUpAnnualRevenue.value,
          },
        ],
      },
    });
    if (m.priceTiers.length) {
      sections.push({
        heading: "Price tiers & monthly economics",
        body:
          "Demand at each price is reachable prospects multiplied by the share of simulated buyers who can afford it and intend to buy.",
        table: {
          columns: [
            "Tier",
            "Segment",
            "Price",
            "COGS",
            "Contribution",
            "Margin",
            "Units/mo",
            "Revenue/mo",
            "Gross profit/mo",
            "Basis",
          ],
          rows: m.priceTiers.map((t) => [
            `${t.label}${t.label === inputs?.baseTierLabel ? " (go-to-market)" : ""}`,
            t.segment ?? "—",
            metric(t.price),
            metric(t.landedCogs),
            metric(t.contributionPerUnit),
            metric(t.grossMarginPct),
            metric(t.estUnitsPerMonth),
            metric(t.estRevenuePerMonth),
            metric(t.estGrossProfitPerMonth),
            sourceLine(t.estUnitsPerMonth),
          ]),
        },
      });
      sections.push({
        heading: "Tier revenue and gross profit",
        bars: {
          title: "Revenue / month",
          money: true,
          data: m.priceTiers.map((t) => ({
            label: t.label,
            value: t.estRevenuePerMonth.value,
          })),
        },
      });
      sections.push({
        bars: {
          title: "Gross profit / month",
          money: true,
          data: m.priceTiers.map((t) => ({
            label: t.label,
            value: t.estGrossProfitPerMonth.value,
          })),
        },
      });
    }
    if (m.costStructure.length) {
      sections.push({
        heading: "Per-unit landed cost",
        kpis: [
          {
            label: "Landed cost / unit",
            value: inputMoney(landedCost, `${currency}/unit`),
          },
        ],
        table: {
          columns: ["Line item", "Amount", "Source / basis", "Note"],
          rows: m.costStructure.map((c) => [
            c.label,
            metric(c.amount),
            sourceLine(c.amount),
            c.note || "—",
          ]),
        },
      });
    }
    sections.push({
      heading: "Unit economics",
      kpis: [
        {
          label: "Blended CAC",
          value: metric(m.unitEconomics.blendedCac),
          sub: sourceLine(m.unitEconomics.blendedCac),
        },
        {
          label: "LTV",
          value: metric(m.unitEconomics.ltv),
          sub: sourceLine(m.unitEconomics.ltv),
        },
        {
          label: "LTV : CAC",
          value: metric(m.unitEconomics.ltvCacRatio),
          sub: sourceLine(m.unitEconomics.ltvCacRatio),
        },
        {
          label: "Payback",
          value: metric(m.unitEconomics.paybackMonths),
          sub: sourceLine(m.unitEconomics.paybackMonths),
        },
      ],
    });
    if (m.unitEconomics.cacByChannel.length) {
      sections.push({
        heading: "CAC by channel",
        table: {
          columns: ["Channel", "CAC", "Source / basis"],
          rows: m.unitEconomics.cacByChannel.map((c) => [
            c.channel,
            metric(c.cac),
            sourceLine(c.cac),
          ]),
        },
      });
    }
    sections.push({
      heading: "Break-even & runway",
      body: m.runwayFit.verdict,
      kpis: [
        {
          label: "Fixed costs / mo",
          value: metric(m.breakEven.fixedCostsPerMonth),
          sub: sourceLine(m.breakEven.fixedCostsPerMonth),
        },
        {
          label: "Contribution / unit",
          value: metric(m.breakEven.contributionPerUnit),
          sub: sourceLine(m.breakEven.contributionPerUnit),
        },
        {
          label: "Break-even units/mo",
          value: metric(m.breakEven.breakEvenUnitsPerMonth),
          sub: sourceLine(m.breakEven.breakEvenUnitsPerMonth),
        },
        {
          label: "Break-even revenue/mo",
          value: metric(m.breakEven.breakEvenRevenuePerMonth),
          sub: sourceLine(m.breakEven.breakEvenRevenuePerMonth),
        },
        {
          label: "Months to break even",
          value: metric(m.breakEven.monthsToBreakEven),
          sub: sourceLine(m.breakEven.monthsToBreakEven),
        },
        {
          label: "Capital available",
          value: metric(m.runwayFit.capitalAvailable),
          sub: sourceLine(m.runwayFit.capitalAvailable),
        },
        {
          label: "Monthly burn",
          value: metric(m.runwayFit.monthlyBurn),
          sub: sourceLine(m.runwayFit.monthlyBurn),
        },
        {
          label: "MOQ cash required",
          value: metric(m.runwayFit.moqCashRequired),
          sub: sourceLine(m.runwayFit.moqCashRequired),
        },
        {
          label: "Runway",
          value: metric(m.runwayFit.runwayMonths),
          sub: sourceLine(m.runwayFit.runwayMonths),
          tone: m.runwayFit.fundsMoq ? "good" : "bad",
        },
      ],
    });
    if (inputs) {
      sections.push({
        heading: "Editable assumptions",
        table: {
          columns: ["Assumption", "Value"],
          rows: [
            ["Fixed costs / mo", inputMoney(inputs.fixedCostsPerMonth, `${currency}/mo`)],
            [
              "Reachable prospects / mo",
              inputMoney(inputs.reachableProspectsPerMonth, "prospects/mo"),
            ],
            ["MOQ cash required", inputMoney(inputs.moqCashRequired, currency)],
            ["Base price tier", inputs.baseTierLabel],
            ["Founder edits", editedKeys.length ? editedKeys.join(", ") : "None"],
          ],
        },
      });
    }
    if (m.assumptions.length)
      sections.push({
        heading: "Key assumptions",
        bullets: m.assumptions,
      });
    // Follow-up: the "ask about these financials" Q&A, appended as a supplement.
    if (followUp.length)
      sections.push(
        { heading: "Follow-up — Q&A" },
        ...followUp.map((t, i) => ({
          heading: `${i + 1}. ${t.question}`,
          body: t.answer,
        }))
      );
    downloadDossier(
      {
        title: "Financial model",
        subtitle: "Costs, margins, market size and runway",
        meta: [
          currency,
          `run ${shortRunId}`,
          `${model.dataMaturityPct}% real data`,
          generatedLabel,
        ],
        cover: {
          verdict: m.runwayFit.verdict || m.marketSizing.reconciliationNote,
          kpis: [
            { label: "TAM / yr", value: metric(m.marketSizing.tam) },
            { label: "SAM / yr", value: metric(m.marketSizing.sam) },
            { label: "SOM / yr", value: metric(m.marketSizing.som) },
            {
              label: "Bottom-up / yr",
              value: metric(m.marketSizing.bottomUpAnnualRevenue),
            },
          ],
        },
        sections,
      },
      `financials-${currency.toLowerCase()}-${shortRunId}-dossier`
    );
  };

  useEffect(() => {
    setModel(initial?.model ?? null);
    setInputs(initial?.inputs ?? null);
    setEditedKeys(initial?.editedKeys ?? []);
    setGeneratedAt(initial?.generatedAt ?? null);
    setFollowUp(initial?.followUp ?? []);
    setQ("");
    setError(null);
  }, [initial, runId]);

  // POST to the route. With no body → LLM generates; with { inputs, editedKeys }
  // → pure server-side recompute against the same persona audience.
  async function post(
    body?: { inputs: FinancialInputs; editedKeys: string[] }
  ) {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(body ?? {}), projectId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(
          providerErrorMessage(b.error ?? b, `failed (${res.status})`)
        );
      }
      const data = (await res.json()) as FinancialsState;
      setModel(data.model);
      setInputs(data.inputs);
      setEditedKeys(data.editedKeys ?? []);
      setGeneratedAt(data.generatedAt ?? null);
      onSaved?.(data);
    } catch (e) {
      setError(providerErrorMessage(e, "Generation failed."));
    } finally {
      setBusy(false);
    }
  }

  // Apply a founder override to one input, mark its key edited, recompute.
  function override(patch: (i: FinancialInputs) => void, key: string | string[]) {
    if (!inputs) return;
    const next: FinancialInputs = structuredClone(inputs);
    patch(next);
    const incoming = Array.isArray(key) ? key : [key];
    const keys = incoming.reduce(
      (acc, k) => (acc.includes(k) ? acc : [...acc, k]),
      editedKeys
    );
    setInputs(next);
    setEditedKeys(keys);
    void post({ inputs: next, editedKeys: keys });
  }

  const tierChart = useMemo(
    () =>
      (model?.priceTiers ?? []).map((t) => ({
        label: t.label,
        revenue: t.estRevenuePerMonth.value,
        profit: t.estGrossProfitPerMonth.value,
        margin: t.grossMarginPct.value,
        isBase: t.label === inputs?.baseTierLabel,
      })),
    [model, inputs]
  );

  const ms = model?.marketSizing;
  const reconcileTone = useMemo(() => {
    if (!ms) return "neutral";
    const r = ms.bottomUpAnnualRevenue.value / (ms.som.value || 1);
    if (r < 0.5) return "warn";
    if (r > 2) return "warn";
    return "good";
  }, [ms]);

  return (
    <div className="px-4 pb-12 pt-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-500" />
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
                Financial model
              </h2>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Costs, margins, market size and runway — the demand curve comes
              from this venture&apos;s simulated buyers. Override any figure and
              it recomputes.
              {generatedAt && (
                <span className="ml-1 text-neutral-400">
                  · generated {new Date(generatedAt).toLocaleDateString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => post()}
            disabled={busy || !ready}
            title={ready ? undefined : "Available once the run converges"}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : model ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {busy ? "Working…" : model ? "Regenerate" : "Build financial model"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </p>
        )}

        {!model ? (
          <div className="mt-8 rounded-2xl border border-dashed border-neutral-200 p-10 text-center">
            <Lightbulb className="mx-auto h-6 w-6 text-neutral-300" />
            <p className="mt-2 text-sm font-medium text-neutral-600">
              No financial model yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-neutral-400">
              {ready
                ? "Build a full model from the research: cost structure, price-tier margins, market sizing reconciled against your simulated buyers, break-even and runway."
                : "The model is built from the converged research — available once this run finishes."}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Data-maturity meter — the "firming up" signal */}
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-500">
                Data maturity
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                <ValueTooltip content={`Data maturity: ${model.dataMaturityPct}% real`}>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${model.dataMaturityPct}%` }}
                  />
                </ValueTooltip>
              </div>
              <span className="text-[11px] font-semibold text-neutral-600">
                {model.dataMaturityPct}% real
              </span>
              <span className="flex items-center gap-2 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1"><Dot source="ai_estimated" /> AI</span>
                <span className="flex items-center gap-1"><Dot source="founder_entered" /> you</span>
                <span className="flex items-center gap-1"><Dot source="computed" /> computed</span>
              </span>
              <button
                onClick={exportPdf}
                title="Export the financial model (+ follow-up Q&A) as a PDF"
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:border-neutral-400"
              >
                <FileDown className="h-3.5 w-3.5" /> Create PDF
              </button>
            </div>

            {/* Ask about these financials */}
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-neutral-800">
                Ask about these financials
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
                      void askFinancials();
                    }
                  }}
                  placeholder="e.g. what breaks even fastest? is the LTV:CAC healthy?"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => void askFinancials()}
                  disabled={asking || !q.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Ask
                </button>
              </div>
            </div>

            {/* HERO: top-down vs bottom-up reconciliation */}
            {ms && (
              <section
                className={`rounded-2xl border p-4 ${
                  reconcileTone === "good"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-amber-200 bg-amber-50/40"
                }`}
              >
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                  <Target className="h-4 w-4 text-indigo-500" /> Market size: top-down
                  vs your buyers
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="TAM / yr" n={ms.tam} currency={currency} />
                  <Stat label="SAM / yr" n={ms.sam} currency={currency} />
                  <Stat label="SOM / yr (top-down)" n={ms.som} currency={currency} />
                  <Stat
                    label="Bottom-up / yr"
                    n={ms.bottomUpAnnualRevenue}
                    currency={currency}
                    big
                  />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-neutral-700">
                  {ms.reconciliationNote}
                </p>
              </section>
            )}

            {/* Price tiers — revenue & gross profit per month, editable price */}
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                <Scale className="h-4 w-4 text-indigo-500" /> Price tiers & monthly
                economics
              </h3>
              <p className="text-[11px] text-neutral-500">
                Demand at each price = your reachable prospects × the share of
                simulated buyers who can afford it and intend to buy.
              </p>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => fmt(Number(v), currency)}
                      width={64}
                    />
                    <Tooltip
                      formatter={(v, name) => [fmt(Number(v), currency), String(name)]}
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                    />
                    {/* fill drives the Legend swatch; per-Cell fills override the
                        actual bars (base tier highlighted). Without it the legend
                        defaults to black while the bars are indigo. */}
                    <Bar dataKey="revenue" name="Revenue/mo" radius={[3, 3, 0, 0]} fill="#a5b4fc">
                      {tierChart.map((d, i) => (
                        <Cell key={i} fill={d.isBase ? "#4f46e5" : "#a5b4fc"} />
                      ))}
                    </Bar>
                    <Bar dataKey="profit" name="Gross profit/mo" radius={[3, 3, 0, 0]} fill="#34d399" />
                    {model.breakEven.breakEvenRevenuePerMonth &&
                      isFinite(model.breakEven.breakEvenRevenuePerMonth.value) && (
                        <ReferenceLine
                          y={model.breakEven.breakEvenRevenuePerMonth.value}
                          stroke="#f43f5e"
                          strokeDasharray="4 4"
                          label={{ value: "break-even", fontSize: 9, fill: "#f43f5e", position: "insideTopRight" }}
                        />
                      )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Per-tier rows with editable price + computed margin/units */}
              <div className="mt-3 space-y-2">
                {model.priceTiers.map((t) => (
                  <div
                    key={t.label}
                    className={`grid grid-cols-2 items-center gap-3 rounded-xl border p-3 sm:grid-cols-5 ${
                      t.label === inputs?.baseTierLabel
                        ? "border-indigo-200 bg-indigo-50/40"
                        : "border-neutral-200 bg-white"
                    }`}
                  >
                    <div>
                      <p className="text-[12px] font-semibold text-neutral-900">
                        {t.label}
                        {t.label === inputs?.baseTierLabel && (
                          <span className="ml-1 text-[9px] font-medium text-indigo-500">
                            · go-to-market
                          </span>
                        )}
                      </p>
                      {t.segment && (
                        <p className="text-[10px] text-neutral-400">{t.segment}</p>
                      )}
                    </div>
                    <NumField
                      label="Price"
                      value={t.price.value}
                      currency={currency}
                      onCommit={(v) =>
                        override((i) => {
                          const tier = i.priceTiers.find((x) => x.label === t.label);
                          if (tier) tier.price = v;
                        }, `tier:${t.label}:price`)
                      }
                      disabled={busy}
                    />
                    <div className="flex items-center gap-1 text-[12px] text-neutral-700">
                      <MetricLabel label="margin" className="text-neutral-400" />
                      {fmt(t.grossMarginPct.value, currency, "%")}
                      <Dot source={t.grossMarginPct.source} basis={t.grossMarginPct.basis} />
                    </div>
                    <div className="flex items-center gap-1 text-[12px] text-neutral-700">
                      <MetricLabel label="units/mo" className="text-neutral-400" />
                      {fmt(t.estUnitsPerMonth.value, currency, "units/mo")}
                      <Dot source={t.estUnitsPerMonth.source} basis={t.estUnitsPerMonth.basis} />
                    </div>
                    <div className="flex items-center gap-1 text-[12px] font-medium text-neutral-900">
                      <MetricLabel label="Revenue/mo" className="text-neutral-400" />
                      {fmt(t.estRevenuePerMonth.value, currency)}
                      <span className="text-[10px] font-normal text-neutral-400">/mo</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Cost structure */}
            <section className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-4">
              <h3 className="text-sm font-semibold text-neutral-900">
                <MetricLabel label="Per-unit landed cost" />
              </h3>
              <div className="mt-2 divide-y divide-neutral-200/70">
                {model.costStructure.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 py-2">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span className="mt-[5px]">
                        <Dot source={c.amount.source} basis={c.amount.basis} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-neutral-700">
                          {c.label}
                        </p>
                        {c.note && (
                          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                            {c.note}
                          </p>
                        )}
                      </div>
                    </div>
                    {inputs?.costStructure[i] ? (
                      <MiniNumField
                        label={`${c.label} cost`}
                        value={inputs.costStructure[i].amount}
                        onCommit={(v) =>
                          override((next) => {
                            if (next.costStructure[i]) next.costStructure[i].amount = v;
                          }, `cost:${i}:amount`)
                        }
                        disabled={busy}
                      />
                    ) : (
                      <span className="shrink-0 whitespace-nowrap text-[12px] font-medium tabular-nums text-neutral-900">
                        {fmt(c.amount.value, currency)}
                      </span>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 pt-2">
                  <span className="text-[12px] font-semibold text-neutral-900">
                    <MetricLabel label="Landed cost / unit" />
                  </span>
                  {inputs?.costStructure.length ? (
                    <MiniNumField
                      label="Total landed cost per unit"
                      value={inputs.costStructure.reduce((s, c) => s + c.amount, 0)}
                      onCommit={(v) =>
                        override((next) => {
                          const current = next.costStructure.reduce(
                            (s, c) => s + c.amount,
                            0
                          );
                          if (current > 0) {
                            const ratio = v / current;
                            next.costStructure.forEach((c) => {
                              c.amount = Number((c.amount * ratio).toFixed(2));
                            });
                            return;
                          }
                          if (next.costStructure[0]) next.costStructure[0].amount = v;
                        }, inputs.costStructure.map((_, idx) => `cost:${idx}:amount`))
                      }
                      disabled={busy}
                    />
                  ) : (
                    <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold tabular-nums text-neutral-900">
                      {fmt(
                        model.costStructure.reduce((s, c) => s + c.amount.value, 0),
                        currency
                      )}
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* Unit economics + break-even + runway */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Blended CAC" n={model.unitEconomics.blendedCac} currency={currency} />
              <Stat label="LTV" n={model.unitEconomics.ltv} currency={currency} />
              <Stat label="LTV : CAC" n={model.unitEconomics.ltvCacRatio} currency={currency} />
              <Stat
                label="Break-even units/mo"
                n={model.breakEven.breakEvenUnitsPerMonth}
                currency={currency}
              />
              <Stat
                label="Months to break even"
                n={model.breakEven.monthsToBreakEven}
                currency={currency}
              />
              <Stat label="Runway" n={model.runwayFit.runwayMonths} currency={currency} />
            </section>

            {/* Editable scale + cost knobs */}
            {inputs && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                  <Wallet className="h-4 w-4 text-indigo-500" /> Assumptions you can
                  override
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <NumField
                    label="Fixed costs / mo"
                    value={inputs.fixedCostsPerMonth}
                    currency={currency}
                    onCommit={(v) =>
                      override((i) => (i.fixedCostsPerMonth = v), "fixedCostsPerMonth")
                    }
                    disabled={busy}
                  />
                  <NumField
                    label="Reachable prospects / mo"
                    value={inputs.reachableProspectsPerMonth}
                    currency={currency}
                    unit="count"
                    onCommit={(v) =>
                      override(
                        (i) => (i.reachableProspectsPerMonth = v),
                        "reachableProspectsPerMonth"
                      )
                    }
                    disabled={busy}
                  />
                  <NumField
                    label="MOQ cash required"
                    value={inputs.moqCashRequired}
                    currency={currency}
                    onCommit={(v) =>
                      override((i) => (i.moqCashRequired = v), "moqCashRequired")
                    }
                    disabled={busy}
                  />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-neutral-700">
                  <span className="font-medium">Funding fit: </span>
                  {model.runwayFit.verdict}
                </p>
              </section>
            )}

            {/* Assumptions / caveats */}
            {model.assumptions.length > 0 && (
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Key assumptions
                </p>
                <ul className="mt-1 space-y-1">
                  {model.assumptions.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-neutral-500">
                      • {a}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

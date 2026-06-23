"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Calculator,
  MessageCircleQuestion,
  FlaskConical,
  Loader2,
  Sparkles,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import type { KnowHowModule } from "@/lib/knowHow";
import type {
  FinancialInputs,
  FinancialModel,
  FollowUpTurn,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";

type Tab = "calculate" | "ask" | "scenarios";

type Props = {
  runId: string;
  projectId: string | null;
  module: KnowHowModule;
  nodeLabel: string;
  onClose: () => void;
};

// A saved what-if: the inputs that produced it plus the headline outputs, so
// the founder can try a change, see the result, and come back to compare.
type Scenario = {
  id: string;
  name: string;
  inputs: FinancialInputs;
  metrics: { label: string; value: string }[];
  ts: string;
};

function fmtMoney(v: number, currency: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const compact =
    abs >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${(v / 1_000).toFixed(1)}k`
        : `${Math.round(v)}`;
  return `${currency} ${compact}`;
}

// The headline outputs we surface for a financial model, recomputed live.
function headlineMetrics(model: FinancialModel): { label: string; value: string }[] {
  const cur = model.currency;
  const base =
    model.priceTiers.find((t) => t.grossMarginPct.value >= 0) ??
    model.priceTiers[0];
  return [
    { label: "Base price", value: base ? fmtMoney(base.price.value, cur) : "—" },
    {
      label: "Gross margin",
      value: base ? `${Math.round(base.grossMarginPct.value)}%` : "—",
    },
    {
      label: "Units / mo",
      value: base ? Math.round(base.estUnitsPerMonth.value).toLocaleString() : "—",
    },
    {
      label: "Revenue / mo",
      value: base ? fmtMoney(base.estRevenuePerMonth.value, cur) : "—",
    },
    {
      label: "Break-even units / mo",
      value: model.breakEven.breakEvenUnitsPerMonth
        ? Math.round(
            model.breakEven.breakEvenUnitsPerMonth.value
          ).toLocaleString()
        : "never",
    },
    {
      label: "Months to break even",
      value: model.breakEven.monthsToBreakEven
        ? `${model.breakEven.monthsToBreakEven.value.toFixed(1)}`
        : "—",
    },
    {
      label: "LTV : CAC",
      value: model.unitEconomics.ltvCacRatio
        ? `${model.unitEconomics.ltvCacRatio.value.toFixed(2)}×`
        : "—",
    },
    {
      label: "Runway",
      value: model.runwayFit.runwayMonths
        ? `${model.runwayFit.runwayMonths.value.toFixed(1)} mo`
        : "—",
    },
  ];
}

export default function KnowHowDrawer({
  runId,
  projectId,
  module,
  nodeLabel,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>(
    module.calculator === "financials" ? "calculate" : "ask"
  );
  const isFinancials = module.calculator === "financials";

  // ----- Financial model state (Calculate tab) -----------------------------
  const [model, setModel] = useState<FinancialModel | null>(null);
  const [inputs, setInputs] = useState<FinancialInputs | null>(null);
  const [loadingModel, setLoadingModel] = useState(isFinancials);
  const [recomputing, setRecomputing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // ----- Q&A state (Ask tab) -----------------------------------------------
  const [history, setHistory] = useState<FollowUpTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const askEndRef = useRef<HTMLDivElement>(null);

  // ----- Scenarios (in-session what-ifs) -----------------------------------
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  // Load the saved financial model (no LLM cost) for financials modules.
  useEffect(() => {
    if (!isFinancials || !projectId) {
      setLoadingModel(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/owner-dashboard?runId=${runId}`
        );
        const json = await res.json();
        const fin = json?.ownerDashboard?.financials ?? null;
        if (cancelled) return;
        if (fin?.model) {
          setModel(fin.model);
          setInputs(fin.inputs ?? null);
          setHistory(fin.followUp ?? []);
        }
      } catch {
        /* leave empty — the "Build the model" CTA covers it */
      } finally {
        if (!cancelled) setLoadingModel(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFinancials, projectId, runId]);

  useEffect(() => {
    askEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length, asking]);

  // The high-leverage knobs the founder can edit, derived from current inputs.
  const baseTier = useMemo(() => {
    if (!inputs) return null;
    return (
      inputs.priceTiers.find((t) => t.label === inputs.baseTierLabel) ??
      inputs.priceTiers[0] ??
      null
    );
  }, [inputs]);

  const editInputs = useCallback(
    (patch: (draft: FinancialInputs) => void): string[] => {
      if (!inputs) return [];
      const draft: FinancialInputs = structuredClone(inputs);
      patch(draft);
      setInputs(draft);
      return [];
    },
    [inputs]
  );

  const recompute = useCallback(async () => {
    if (!inputs || recomputing) return;
    setRecomputing(true);
    setCalcError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs,
          editedKeys: ["knowHowEdit"],
          projectId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCalcError(providerErrorMessage(json.error ?? json, "Recompute failed"));
        return;
      }
      setModel(json.model);
      setInputs(json.inputs ?? inputs);
    } catch (e) {
      setCalcError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }, [inputs, recomputing, runId, projectId]);

  const buildModel = useCallback(async () => {
    if (building) return;
    setBuilding(true);
    setCalcError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCalcError(providerErrorMessage(json.error ?? json, "Could not build the model"));
        return;
      }
      setModel(json.model);
      setInputs(json.inputs ?? null);
      setHistory(json.followUp ?? []);
    } catch (e) {
      setCalcError(e instanceof Error ? e.message : "Could not build the model");
    } finally {
      setBuilding(false);
    }
  }, [building, runId, projectId]);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    setQuestion("");
    // Financials modules ask against the saved model; everything else queries
    // the converged world model, scoped to this module's domains.
    const useFinancials = isFinancials && model;
    const url = useFinancials
      ? `/api/runs/${runId}/financials/ask`
      : `/api/runs/${runId}/query`;
    const payload = useFinancials
      ? { question: q }
      : { question: q, domains: module.domains };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setAskError(providerErrorMessage(json.error ?? json, "Could not answer that"));
        setQuestion(q);
        return;
      }
      const turn: FollowUpTurn = {
        question: q,
        answer: json.answer,
        ts: new Date().toISOString(),
      };
      // financials/ask returns the full followUp; query returns just an answer.
      setHistory(json.followUp ?? [...history, turn]);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "Could not answer that");
      setQuestion(q);
    } finally {
      setAsking(false);
    }
  }, [question, asking, isFinancials, model, runId, module.domains, history]);

  const saveScenario = useCallback(() => {
    if (!model || !inputs) return;
    const n = scenarios.length + 1;
    setScenarios((prev) => [
      ...prev,
      {
        id: `s${n}-${prev.length}`,
        name: `Scenario ${n}`,
        inputs: structuredClone(inputs),
        metrics: headlineMetrics(model),
        ts: new Date().toISOString(),
      },
    ]);
  }, [model, inputs, scenarios.length]);

  const tabs: { id: Tab; label: string; icon: typeof Calculator; show: boolean }[] =
    [
      { id: "calculate", label: "Calculate", icon: Calculator, show: isFinancials },
      { id: "ask", label: "Ask", icon: MessageCircleQuestion, show: true },
      {
        id: "scenarios",
        label: "Scenarios",
        icon: FlaskConical,
        show: isFinancials,
      },
    ];

  return (
    <div className="absolute inset-y-0 right-0 z-[1100] flex w-full max-w-xl flex-col border-l border-neutral-200 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
        <div className="pr-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
            Know-How · {nodeLabel}
          </div>
          <h2 className="mt-0.5 text-lg font-semibold text-neutral-900">
            {module.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            {module.blurb}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200 px-3 py-2">
        {tabs
          .filter((t) => t.show)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === id
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === "calculate" && (
          <CalculateTab
            loading={loadingModel}
            building={building}
            recomputing={recomputing}
            error={calcError}
            model={model}
            inputs={inputs}
            baseTier={baseTier}
            onBuild={buildModel}
            onRecompute={recompute}
            onEdit={editInputs}
          />
        )}

        {tab === "ask" && (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-3">
              {history.length === 0 && (
                <p className="text-sm text-neutral-500">
                  Ask anything about {module.askSubject}. Answers are grounded in
                  this run's research and simulated audience — follow up to go
                  deeper.
                </p>
              )}
              {history.map((turn, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
                      {turn.question}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-2 text-sm text-neutral-800">
                      {turn.answer}
                    </div>
                  </div>
                </div>
              ))}
              {asking && (
                <div className="flex items-center gap-2 text-sm text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
              {askError && (
                <p className="text-sm text-rose-600">{askError}</p>
              )}
              <div ref={askEndRef} />
            </div>
            <div className="sticky bottom-0 mt-3 flex items-end gap-2 bg-white pt-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
                rows={2}
                placeholder={`Ask about ${module.askSubject}…`}
                className="flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              />
              <button
                onClick={ask}
                disabled={!question.trim() || asking}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {asking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        )}

        {tab === "scenarios" && (
          <ScenariosTab
            scenarios={scenarios}
            canSave={Boolean(model && inputs)}
            onSave={saveScenario}
            onRemove={(id) =>
              setScenarios((prev) => prev.filter((s) => s.id !== id))
            }
          />
        )}
      </div>
    </div>
  );
}

// --- Calculate tab: edit high-leverage assumptions, recompute deterministically.
function CalculateTab({
  loading,
  building,
  recomputing,
  error,
  model,
  inputs,
  baseTier,
  onBuild,
  onRecompute,
  onEdit,
}: {
  loading: boolean;
  building: boolean;
  recomputing: boolean;
  error: string | null;
  model: FinancialModel | null;
  inputs: FinancialInputs | null;
  baseTier: FinancialInputs["priceTiers"][number] | null;
  onBuild: () => void;
  onRecompute: () => void;
  onEdit: (patch: (draft: FinancialInputs) => void) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading model…
      </div>
    );
  }

  if (!model || !inputs) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-indigo-400" />
        <p className="mt-2 text-sm font-medium text-neutral-700">
          No financial model yet
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Build one from this run's research and simulated audience, then edit
          any assumption to see how the numbers move.
        </p>
        <button
          onClick={onBuild}
          disabled={building}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {building ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {building ? "Building…" : "Build the model"}
        </button>
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  const cur = model.currency;

  return (
    <div className="space-y-5">
      {/* Headline outputs */}
      <div className="grid grid-cols-2 gap-2">
        {headlineMetrics(model).map((m) => (
          <div
            key={m.label}
            className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-neutral-400">
              {m.label}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-neutral-900">
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Editable knobs */}
      <div className="space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Try a change
        </div>
        {baseTier && (
          <NumberKnob
            label={`Base price (${baseTier.label})`}
            unit={cur}
            value={baseTier.price}
            onChange={(v) =>
              onEdit((d) => {
                const t =
                  d.priceTiers.find((x) => x.label === baseTier.label) ??
                  d.priceTiers[0];
                if (t) t.price = v;
              })
            }
          />
        )}
        <NumberKnob
          label="Fixed costs / mo"
          unit={cur}
          value={inputs.fixedCostsPerMonth}
          onChange={(v) => onEdit((d) => (d.fixedCostsPerMonth = v))}
        />
        <NumberKnob
          label="Reachable prospects / mo"
          unit=""
          value={inputs.reachableProspectsPerMonth}
          onChange={(v) => onEdit((d) => (d.reachableProspectsPerMonth = v))}
        />
        <NumberKnob
          label="MOQ cash required"
          unit={cur}
          value={inputs.moqCashRequired}
          onChange={(v) => onEdit((d) => (d.moqCashRequired = v))}
        />
        {inputs.cacByChannel[0] && (
          <NumberKnob
            label={`CAC — ${inputs.cacByChannel[0].channel}`}
            unit={cur}
            value={inputs.cacByChannel[0].cac}
            onChange={(v) =>
              onEdit((d) => {
                if (d.cacByChannel[0]) d.cacByChannel[0].cac = v;
              })
            }
          />
        )}
      </div>

      <button
        onClick={onRecompute}
        disabled={recomputing}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {recomputing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {recomputing ? "Recomputing…" : "Recompute"}
      </button>
      <p className="text-[11px] text-neutral-400">
        Recompute is deterministic and free — it re-runs the math against the
        same simulated buyers, no AI call.
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function NumberKnob({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className="flex items-center gap-1.5">
        {unit && <span className="text-xs text-neutral-400">{unit}</span>}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-right text-sm focus:border-indigo-400 focus:outline-none"
        />
      </span>
    </label>
  );
}

// --- Scenarios tab: save what-ifs and compare them side by side.
function ScenariosTab({
  scenarios,
  canSave,
  onSave,
  onRemove,
}: {
  scenarios: Scenario[];
  canSave: boolean;
  onSave: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onSave}
        disabled={!canSave}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        Save current as scenario
      </button>

      {scenarios.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Save the current numbers as a scenario, change an assumption on the
          Calculate tab, recompute, and save again — then compare them here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="py-2 pr-3 font-medium">Metric</th>
                {scenarios.map((s) => (
                  <th key={s.id} className="py-2 pr-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      {s.name}
                      <button
                        onClick={() => onRemove(s.id)}
                        className="text-neutral-300 hover:text-rose-500"
                        aria-label={`Remove ${s.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(scenarios[0]?.metrics ?? []).map((m, rowIdx) => (
                <tr key={m.label} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 text-neutral-500">{m.label}</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="py-2 pr-3 font-medium text-neutral-900">
                      {s.metrics[rowIdx]?.value ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

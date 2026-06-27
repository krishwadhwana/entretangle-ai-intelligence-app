"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  CornerDownLeft,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  MessageCircleQuestion,
  NotebookPen,
  Play,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import type {
  Block,
  Conclusion,
  FinancialInputs,
  FinancialModel,
  FollowUpTurn,
  KnowHowRunProgress,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import {
  defaultKnowHowModule,
  KNOW_HOW_MODULES,
  moduleByKey,
  type KnowHowModule,
  type KnowHowModuleKey,
} from "@/lib/knowHow";
import { DOMAIN_META } from "./domains";
import { DOMAIN_COLORS } from "./segments";
import GlossaryText from "./GlossaryText";
import { providerErrorMessage } from "@/lib/providerErrors";

type Props = {
  runId: string;
  runStatus: string;
  projectId: string | null;
  state: CanvasState;
  onQuery: (
    q: string,
    opts?: {
      domains?: string[];
      highlight?: boolean;
      answerInstructions?: string;
    },
  ) => Promise<string>;
  onNavigate: (view: "launch" | "playbook") => void;
};

const EMPTY_PROGRESS: KnowHowRunProgress = {
  selectedModuleKey: "strategy",
  completedTaskIds: {},
  notesByModule: {},
  askHistoryByModule: {},
  updatedAt: null,
};

function fmtMoney(v: number, currency: string): string {
  if (!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const compact =
    abs >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${(v / 1_000).toFixed(1)}k`
        : `${Math.round(v)}`;
  return `${currency} ${compact}`;
}

function financialMetrics(model: FinancialModel) {
  const cur = model.currency;
  const base =
    model.priceTiers.find((tier) => tier.grossMarginPct.value >= 0) ??
    model.priceTiers[0];
  return [
    { label: "Base price", value: base ? fmtMoney(base.price.value, cur) : "-" },
    {
      label: "Gross margin",
      value: base ? `${Math.round(base.grossMarginPct.value)}%` : "-",
    },
    {
      label: "Revenue / mo",
      value: base ? fmtMoney(base.estRevenuePerMonth.value, cur) : "-",
    },
    {
      label: "Break-even units",
      value: model.breakEven.breakEvenUnitsPerMonth
        ? Math.round(
            model.breakEven.breakEvenUnitsPerMonth.value,
          ).toLocaleString()
        : "never",
    },
    {
      label: "LTV:CAC",
      value: model.unitEconomics.ltvCacRatio
        ? `${model.unitEconomics.ltvCacRatio.value.toFixed(2)}x`
        : "-",
    },
    {
      label: "Runway",
      value: model.runwayFit.runwayMonths
        ? `${model.runwayFit.runwayMonths.value.toFixed(1)} mo`
        : "-",
    },
  ];
}

function moduleEvidence(state: CanvasState, module: KnowHowModule) {
  const blocks = state.blockOrder
    .map((id) => state.blocks[id])
    .filter((block): block is Block => Boolean(block))
    .filter((block) => module.domains.includes(block.domain));
  const conclusions = blocks.flatMap((block) =>
    block.conclusions.map((conclusion) => ({ block, conclusion })),
  );
  return { blocks, conclusions };
}

function taskProgress(module: KnowHowModule, progress: KnowHowRunProgress) {
  const done = new Set(progress.completedTaskIds[module.key] ?? []);
  return module.tasks.filter((task) => done.has(task.id)).length;
}

export default function KnowHowWorkspace({
  runId,
  runStatus,
  projectId,
  state,
  onQuery,
  onNavigate,
}: Props) {
  const ready = runStatus === "complete" || runStatus === "capped";
  const [progress, setProgress] = useState<KnowHowRunProgress>(EMPTY_PROGRESS);
  const [selectedKey, setSelectedKey] =
    useState<KnowHowModuleKey>("strategy");
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedModule =
    moduleByKey(selectedKey) ?? moduleByKey(progress.selectedModuleKey) ??
    defaultKnowHowModule();
  const selectedEvidence = useMemo(
    () => moduleEvidence(state, selectedModule),
    [state, selectedModule],
  );
  const notes = progress.notesByModule[selectedModule.key] ?? "";
  const history = progress.askHistoryByModule[selectedModule.key] ?? [];

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadingProgress(true);
    fetch(`/api/projects/${projectId}/know-how?runId=${runId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Know-How load failed");
        return (data.progress ?? EMPTY_PROGRESS) as KnowHowRunProgress;
      })
      .then((loaded) => {
        if (cancelled) return;
        setProgress(loaded);
        const module = moduleByKey(loaded.selectedModuleKey);
        setSelectedKey(module ? module.key : "strategy");
      })
      .catch((error) => {
        if (!cancelled) {
          setSaveError(
            error instanceof Error ? error.message : "Know-How load failed",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProgress(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, runId]);

  const patchProgress = useCallback(
    async (
      patch: Partial<
        Pick<
          KnowHowRunProgress,
          | "selectedModuleKey"
          | "completedTaskIds"
          | "notesByModule"
          | "askHistoryByModule"
        >
      >,
    ) => {
      const next: KnowHowRunProgress = {
        ...progress,
        selectedModuleKey: patch.selectedModuleKey ?? progress.selectedModuleKey,
        completedTaskIds: {
          ...progress.completedTaskIds,
          ...(patch.completedTaskIds ?? {}),
        },
        notesByModule: {
          ...progress.notesByModule,
          ...(patch.notesByModule ?? {}),
        },
        askHistoryByModule: {
          ...progress.askHistoryByModule,
          ...(patch.askHistoryByModule ?? {}),
        },
        updatedAt: new Date().toISOString(),
      };
      setProgress(next);
      if (patch.selectedModuleKey) {
        const module = moduleByKey(patch.selectedModuleKey);
        if (module) setSelectedKey(module.key);
      }
      if (!projectId) return;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/know-how`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, ...patch }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Know-How save failed");
        if (data.progress) setProgress(data.progress as KnowHowRunProgress);
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Know-How save failed",
        );
      } finally {
        setSaving(false);
      }
    },
    [progress, projectId, runId],
  );

  function selectModule(module: KnowHowModule) {
    void patchProgress({ selectedModuleKey: module.key });
  }

  function toggleTask(taskId: string) {
    const current = new Set(progress.completedTaskIds[selectedModule.key] ?? []);
    if (current.has(taskId)) current.delete(taskId);
    else current.add(taskId);
    void patchProgress({
      completedTaskIds: {
        [selectedModule.key]: Array.from(current),
      },
    });
  }

  function saveNotes(value: string) {
    void patchProgress({
      notesByModule: {
        [selectedModule.key]: value,
      },
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto grid grid-cols-1 max-w-[1500px] gap-4 p-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="h-fit rounded-lg border border-neutral-200 bg-white p-3 xl:sticky xl:top-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Know-How
              </p>
              <h2 className="text-sm font-semibold text-neutral-950">
                Operating workbench
              </h2>
            </div>
            {loadingProgress || saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
          </div>
          <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white to-transparent xl:hidden" />
          <nav className="flex gap-1.5 overflow-x-auto no-scrollbar xl:flex-col xl:gap-0 xl:space-y-1 xl:overflow-visible">
            {KNOW_HOW_MODULES.map((module) => {
              const done = taskProgress(module, progress);
              const active = module.key === selectedModule.key;
              return (
                <button
                  key={module.key}
                  type="button"
                  onClick={() => selectModule(module)}
                  className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-xs transition xl:w-full ${
                    active
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {module.title}
                    </span>
                    <span
                      className={`mt-0.5 block text-[10px] ${
                        active ? "text-neutral-300" : "text-neutral-400"
                      }`}
                    >
                      {done}/{module.tasks.length} tasks
                    </span>
                  </span>
                  {done === module.tasks.length ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
                        active
                          ? "bg-white/10 text-white"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {done}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          </div>
          {saveError ? (
            <p className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
              {saveError}
            </p>
          ) : null}
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Founder manual
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">
                  {selectedModule.title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  {selectedModule.blurb}
                </p>
              </div>
              <span
                className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  ready
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {ready
                  ? "Run conclusions ready"
                  : "Know-How unlocks when the run has conclusions"}
              </span>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <InfoPanel
              icon={Target}
              title="What this helps you decide"
              body={selectedModule.decision}
            />
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-neutral-400" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  What you need to know
                </h3>
              </div>
              <ul className="mt-3 space-y-2">
                {selectedModule.needToKnow.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-sm leading-6 text-neutral-600"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
                    <GlossaryText>{item}</GlossaryText>
                  </li>
                ))}
              </ul>
              {selectedModule.referenceLinks?.length ? (
                <div className="mt-4 border-t border-neutral-100 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Official references
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedModule.referenceLinks.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-[10px] font-medium text-neutral-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                        title={link.url}
                      >
                        <span className="truncate">{link.label}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </section>

          <ToolArea
            module={selectedModule}
            runId={runId}
            projectId={projectId}
            state={state}
            onNavigate={onNavigate}
          />

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-neutral-400" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Tasks / checklist
              </h3>
            </div>
            <div className="space-y-2">
              {selectedModule.tasks.map((task) => {
                const checked = (
                  progress.completedTaskIds[selectedModule.key] ?? []
                ).includes(task.id);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 px-3 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40"
                  >
                    {checked ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300" />
                    )}
                    <span>
                      <span className="block text-sm font-semibold text-neutral-900">
                        {task.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-neutral-500">
                        {task.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <EvidencePanel
            ready={ready}
            blocks={selectedEvidence.blocks}
            items={selectedEvidence.conclusions}
          />
        </main>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:h-fit">
          <AskPanel
            module={selectedModule}
            ready={ready}
            history={history}
            onAsk={async (question) => {
              const answer = await onQuery(question, {
                domains: selectedModule.domains,
                highlight: false,
                answerInstructions: selectedModule.askInstructions,
              });
              const next = [
                ...history,
                { question, answer, ts: new Date().toISOString() },
              ];
              await patchProgress({
                askHistoryByModule: { [selectedModule.key]: next },
              });
            }}
          />
          <NotesPanel notes={notes} onSave={saveNotes} />
        </aside>
      </div>
    </div>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Target;
  title: string;
  body: string;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        <GlossaryText>{body}</GlossaryText>
      </p>
    </section>
  );
}

function ToolArea({
  module,
  runId,
  projectId,
  state,
  onNavigate,
}: {
  module: KnowHowModule;
  runId: string;
  projectId: string | null;
  state: CanvasState;
  onNavigate: (view: "launch" | "playbook") => void;
}) {
  if (module.tool === "financials") {
    return <FinancialTool runId={runId} projectId={projectId} />;
  }
  if (module.tool === "launch") {
    return (
      <ActionTool
        icon={Play}
        title="Launch simulator"
        body="Model ad spend, orders, cash and inventory for this run before you commit budget."
        button="Open launch simulator"
        onClick={() => onNavigate("launch")}
      />
    );
  }
  if (module.tool === "audience") {
    const cohorts = state.cohortOrder
      .map((id) => state.cohorts[id])
      .filter(Boolean);
    const personas = cohorts.reduce(
      (sum, cohort) => sum + cohort.personas.length,
      0,
    );
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Audience signals
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric label="Cohorts" value={cohorts.length.toLocaleString()} />
          <Metric label="Personas" value={personas.toLocaleString()} />
          <Metric
            label="Platforms"
            value={(state.aggregate?.platformShare?.length ?? 0).toString()}
          />
        </div>
      </section>
    );
  }
  if (module.tool === "playbook") {
    return (
      <ActionTool
        icon={BookOpen}
        title="Deep playbook"
        body="Use the generated playbook for richer competitor, compliance, pricing and action-plan detail."
        button="Open playbook"
        onClick={() => onNavigate("playbook")}
      />
    );
  }
  return (
    <ActionTool
      icon={MessageCircleQuestion}
      title="Scoped world-model Q&A"
      body="Ask against only this module's evidence and conclusions, then save the useful answers here."
      button="Ask in this module"
      onClick={() => undefined}
      passive
    />
  );
}

function ActionTool({
  icon: Icon,
  title,
  body,
  button,
  onClick,
  passive = false,
}: {
  icon: typeof Play;
  title: string;
  body: string;
  button: string;
  onClick: () => void;
  passive?: boolean;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-neutral-500">{body}</p>
          </div>
        </div>
        {!passive ? (
          <button
            type="button"
            onClick={onClick}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700"
          >
            {button}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FinancialTool({
  runId,
  projectId,
}: {
  runId: string;
  projectId: string | null;
}) {
  const [model, setModel] = useState<FinancialModel | null>(null);
  const [inputs, setInputs] = useState<FinancialInputs | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${projectId}/owner-dashboard?runId=${runId}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const fin = json?.ownerDashboard?.financials ?? null;
        setModel(fin?.model ?? null);
        setInputs(fin?.inputs ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, runId]);

  async function buildOrRecompute(nextInputs = inputs) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...(nextInputs ? { inputs: nextInputs } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(providerErrorMessage(json.error ?? json, "Financial model failed"));
      setModel(json.model);
      setInputs(json.inputs ?? nextInputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Financial model failed");
    } finally {
      setBusy(false);
    }
  }

  const baseTier = inputs
    ? inputs.priceTiers.find((tier) => tier.label === inputs.baseTierLabel) ??
      inputs.priceTiers[0]
    : null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Financial calculator
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void buildOrRecompute()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : model ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {model ? "Recompute" : "Build model"}
        </button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading model
        </p>
      ) : model ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {financialMetrics(model).map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </div>
          {baseTier && inputs ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <NumberField
                label={`Base price (${baseTier.label})`}
                value={baseTier.price}
                onChange={(value) => {
                  const draft = structuredClone(inputs);
                  const tier =
                    draft.priceTiers.find((t) => t.label === baseTier.label) ??
                    draft.priceTiers[0];
                  if (tier) tier.price = value;
                  setInputs(draft);
                }}
              />
              <NumberField
                label="Fixed costs / month"
                value={inputs.fixedCostsPerMonth}
                onChange={(value) => {
                  const draft = structuredClone(inputs);
                  draft.fixedCostsPerMonth = value;
                  setInputs(draft);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-sm leading-6 text-neutral-500">
          No financial model has been built for this run yet.
        </p>
      )}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-lg border border-neutral-200 px-3 py-2">
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full border-0 p-0 text-sm font-semibold text-neutral-900 outline-none"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function citationUrl(source: string): string | null {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function citationLabel(source: string): string {
  const href = citationUrl(source);
  if (!href) return source;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function CitationList({ sources }: { sources: string[] }) {
  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500">
        No source citations are attached to this finding.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-neutral-400">Citations</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, index) => {
          const href = citationUrl(source);
          const label = citationLabel(source);
          return href ? (
            <a
              key={`${source}-${index}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={source}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600 underline-offset-2 hover:border-indigo-200 hover:bg-indigo-100 hover:underline"
            >
              <span className="truncate">
                {index + 1}. {label}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <span
              key={`${source}-${index}`}
              title={source}
              className="max-w-full truncate rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500"
            >
              {index + 1}. {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceCard({
  block,
  conclusion,
  expanded,
  onToggle,
}: {
  block: Block;
  conclusion: Conclusion;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = DOMAIN_META[block.domain];
  const color = DOMAIN_COLORS[block.domain] ?? "#737373";
  const sources = Array.from(
    new Set(conclusion.sources.map((source) => source.trim()).filter(Boolean)),
  );
  const citationText =
    sources.length === 1
      ? "1 citation"
      : sources.length > 1
        ? `${sources.length} citations`
        : "No citations";

  return (
    <article
      className={`rounded-lg border border-neutral-200 px-3 py-3 transition-colors hover:border-neutral-300 ${
        expanded ? "lg:col-span-2" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: color }}
            />
            <p className="truncate text-[11px] font-medium text-neutral-400">
              {meta.label} · {block.name}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse evidence" : "Expand evidence"}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>
      <p className="text-sm font-semibold leading-5 text-neutral-900">
        <GlossaryText>{conclusion.claim}</GlossaryText>
      </p>
      <p
        className={`mt-1 text-xs leading-5 text-neutral-600 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        <GlossaryText>{conclusion.value}</GlossaryText>
      </p>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
              conf {Math.round(conclusion.confidence * 100)}%
            </span>
            {conclusion.entities.map((entity) => (
              <span
                key={entity}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-500"
              >
                {entity}
              </span>
            ))}
          </div>
          <CitationList sources={sources} />
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-neutral-400">{citationText}</span>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500 hover:text-indigo-700"
          >
            Expand
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </article>
  );
}

function EvidencePanel({
  ready,
  blocks,
  items,
}: {
  ready: boolean;
  blocks: Block[];
  items: Array<{ block: Block; conclusion: Conclusion }>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const itemKey = items.map(({ conclusion }) => conclusion.id).join("|");
  const visibleItems = showAll ? items : items.slice(0, 10);

  useEffect(() => {
    setShowAll(false);
    setExpandedIds(new Set());
  }, [itemKey]);

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Relevant evidence from the run
          </h3>
        </div>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
          {items.length} findings · {blocks.length} desks
        </span>
      </div>
      {!ready ? (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-sm leading-6 text-neutral-500">
          Know-How unlocks when the run has conclusions.
        </p>
      ) : items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {visibleItems.map(({ block, conclusion }) => (
              <EvidenceCard
                key={conclusion.id}
                block={block}
                conclusion={conclusion}
                expanded={expandedIds.has(conclusion.id)}
                onToggle={() => toggleExpanded(conclusion.id)}
              />
            ))}
          </div>
          {items.length > 10 ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-600 hover:border-indigo-200 hover:text-indigo-600"
              >
                {showAll ? "Show top 10" : `Show all ${items.length} findings`}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    showAll ? "rotate-180" : ""
                  }`}
                />
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-sm leading-6 text-neutral-500">
          No evidence has landed for this module yet. Use the checklist and
          notes as the working area until the run produces matching findings.
        </p>
      )}
    </section>
  );
}

const ANSWER_LINK_RE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;

function LinkedAnswerText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of children.matchAll(ANSWER_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(
        <GlossaryText key={`text-${key++}`}>
          {children.slice(lastIndex, index)}
        </GlossaryText>,
      );
    }

    const label = match[1] ?? match[3] ?? "";
    const href = citationUrl(match[2] ?? match[3] ?? "");
    if (href) {
      parts.push(
        <a
          key={`link-${key++}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700"
        >
          {label}
        </a>,
      );
    } else {
      parts.push(
        <GlossaryText key={`fallback-${key++}`}>{match[0]}</GlossaryText>,
      );
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < children.length) {
    parts.push(
      <GlossaryText key={`text-${key++}`}>
        {children.slice(lastIndex)}
      </GlossaryText>,
    );
  }

  return <>{parts}</>;
}

function AskPanel({
  module,
  ready,
  history,
  onAsk,
}: {
  module: KnowHowModule;
  ready: boolean;
  history: FollowUpTurn[];
  onAsk: (question: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const q = question.trim();
    if (!q || asking || !ready) return;
    setQuestion("");
    setAsking(true);
    setError(null);
    try {
      await onAsk(q);
    } catch (err) {
      setQuestion(q);
      setError(err instanceof Error ? err.message : "Could not answer that");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-900">Ask</h3>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {history.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-neutral-500">
              Ask about {module.askSubject}. Answers stay attached to this
              module.
            </p>
            {module.starterQuestions?.length ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Suggested questions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {module.starterQuestions.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={!ready || asking}
                      onClick={() => setQuestion(starter)}
                      className="rounded-full border border-neutral-200 px-2.5 py-1 text-left text-[11px] font-medium leading-4 text-neutral-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          history.map((turn, index) => (
            <div key={`${turn.ts}-${index}`} className="space-y-1.5">
              <p className="rounded-lg bg-indigo-600 px-3 py-2 text-xs leading-5 text-white">
                {turn.question}
              </p>
              <p className="whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-700">
                <LinkedAnswerText>{turn.answer}</LinkedAnswerText>
              </p>
            </div>
          ))
        )}
        {asking ? (
          <p className="flex items-center gap-2 text-xs text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          disabled={!ready || asking}
          rows={2}
          placeholder={ready ? "Ask this module..." : "Ask when the run is ready"}
          className="min-h-16 flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || asking || !question.trim()}
          title="Ask"
          className="flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {asking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Ask
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

function NotesPanel({
  notes,
  onSave,
}: {
  notes: string;
  onSave: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(notes);

  useEffect(() => {
    setDraft(notes);
  }, [notes]);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-900">Notes</h3>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onSave(draft)}
        rows={8}
        maxLength={8000}
        placeholder="Write working notes, proof points, supplier calls, or next decisions..."
        className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-500"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-400">
          {draft.length.toLocaleString()}/8,000
        </span>
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <Save className="h-3.5 w-3.5" />
          Save notes
        </button>
      </div>
    </section>
  );
}

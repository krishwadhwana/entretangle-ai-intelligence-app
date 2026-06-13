"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Star,
  CornerDownLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
  Globe2,
  Network,
  BarChart3,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";
import type { Block, Domain } from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { DOMAIN_META, DOMAIN_ORDER } from "./domains";

function StateDot({ state }: { state: Block["state"] }) {
  if (state === "concluded")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (state === "failed")
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return (
    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
  );
}

function DeskSubpanel({
  block,
  onCite,
}: {
  block: Block;
  onCite: (blockId: string) => void;
}) {
  const [tab, setTab] = useState<"conclusions" | "discussion">("conclusions");
  const webGrounded =
    block.params.webSearch === 1 || block.params.webSearch === "true";
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <StateDot state={block.state} />
        <span
          className="flex-1 truncate text-sm font-semibold"
          title={block.mission}
        >
          {block.name}
        </span>
        {webGrounded && (
          <Globe className="h-3 w-3 text-indigo-400" aria-label="web-grounded" />
        )}
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setTab("conclusions")}
            className={`rounded px-2 py-1 ${tab === "conclusions" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            Findings
          </button>
          <button
            onClick={() => setTab("discussion")}
            className={`rounded px-2 py-1 ${tab === "discussion" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            Discussion
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {tab === "discussion" ? (
          block.logs.length ? (
            <ul className="space-y-1.5">
              {block.logs.map((l, i) => (
                <li key={i} className="font-mono text-xs text-neutral-500">
                  › {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-400">No activity yet.</p>
          )
        ) : block.conclusions.length ? (
          <ul className="space-y-3">
            {block.conclusions.map((c) => (
              <li
                key={c.id}
                className="cursor-pointer rounded-lg border border-neutral-100 p-3 hover:border-indigo-300"
                onClick={() => onCite(block.id)}
              >
                <p className="text-sm font-medium leading-snug text-neutral-900">
                  {c.claim}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                  {c.value}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                    conf {Math.round(c.confidence * 100)}%
                  </span>
                  {c.entities.slice(0, 3).map((e) => (
                    <span
                      key={e}
                      className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-500"
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                  {c.sources.map((s, i) =>
                    s.startsWith("http") ? (
                      <a
                        key={i}
                        href={s}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="truncate text-[10px] text-indigo-600 underline"
                        style={{ maxWidth: 180 }}
                      >
                        {new URL(s).hostname}
                      </a>
                    ) : (
                      <span key={i} className="text-[10px] text-neutral-400">
                        {s}
                      </span>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-400">
            {block.state === "failed" ? "Desk failed." : "Working…"}
          </p>
        )}
      </div>
    </div>
  );
}

function FinalReportView({ report }: { report: CanvasState["finalReport"] }) {
  if (!report) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-xs font-semibold text-neutral-700">
          Final business report
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          The report is written after desks, audience synthesis, insights and
          synthesis work finish. Older runs may not have a report event yet.
        </p>
      </div>
    );
  }

  return (
    <article className="h-full overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4">
      <div className="border-b border-neutral-100 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
          Final business report
        </p>
        <h3 className="mt-1 text-sm font-semibold text-neutral-900">
          {report.title}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-700">
          {report.executiveSummary}
        </p>
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-indigo-900">
          {report.verdict}
        </p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {report.sections.map((section) => (
          <section
            key={section.title}
            className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-3"
          >
            <h4 className="text-xs font-semibold text-neutral-800">
              {section.title}
            </h4>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
              {section.summary}
            </p>
            <ul className="mt-2 space-y-1.5">
              {section.bullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[11px] leading-relaxed text-neutral-700"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            {section.citedConclusionIds.length > 0 && (
              <p className="mt-2 text-[9px] text-neutral-400">
                cites {section.citedConclusionIds.slice(0, 5).join(", ")}
                {section.citedConclusionIds.length > 5 && "…"}
              </p>
            )}
          </section>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <h4 className="text-xs font-semibold text-emerald-900">
            Next actions
          </h4>
          <ol className="mt-2 space-y-1.5">
            {report.nextActions.map((action, i) => (
              <li
                key={i}
                className="flex gap-2 text-[11px] leading-relaxed text-emerald-950"
              >
                <span className="font-semibold tabular-nums">{i + 1}.</span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-lg border border-amber-100 bg-amber-50/70 p-3">
          <h4 className="text-xs font-semibold text-amber-900">
            Risks to validate
          </h4>
          <ul className="mt-2 space-y-1.5">
            {report.risks.map((risk, i) => (
              <li
                key={i}
                className="flex gap-2 text-[11px] leading-relaxed text-amber-950"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

export function ConclusionWorkspace({
  state,
  onQuery,
  reportBusy,
  onGenerateReport,
}: {
  state: CanvasState;
  onQuery: (q: string) => Promise<string>;
  reportBusy: boolean;
  onGenerateReport: () => void;
}) {
  const [question, setQuestion] = useState("");
  // Turns asked this session — persisted turns arrive via state.conversation on
  // reload, so these only cover the current page load (no double-render: the
  // run is terminal here, so the SSE is closed and won't replay them live).
  const [pending, setPending] = useState<
    { question: string; answer: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const ready = state.status === "complete" || state.status === "capped";
  const report = state.finalReport;

  // Whole-world-model Q&A (domain-scoped Playbook asks are excluded).
  const history = state.conversation.filter((t) => t.domains.length === 0);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const answer = await onQuery(q);
      setPending((p) => [...p, { question: q, answer }]);
      setQuestion("");
    } catch {
      setPending((p) => [
        ...p,
        { question: q, answer: "Query failed — try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const agg = state.aggregate;
  return (
    <div className="h-full overflow-y-auto bg-neutral-50/60 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-2">
            <FinalReportView report={report} />
            {!report && ready && (
              <button
                onClick={onGenerateReport}
                disabled={reportBusy}
                className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {reportBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {reportBusy ? "Writing report..." : "Generate final report"}
              </button>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <p className="text-xs font-semibold text-indigo-900">
                World model
              </p>
              <p className="mt-1 text-[11px] text-neutral-600">
                {state.worldModel
                  ? `${state.worldModel.conclusionCount} conclusions · ${state.worldModel.blockCount} desks`
                  : state.phaseLabel}
                {state.status === "capped" && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] text-amber-700">
                    capped
                  </span>
                )}
              </p>
              {agg && (
                <p className="mt-2 text-[11px] leading-snug text-neutral-600">
                  <span className="font-medium text-neutral-800">
                    {agg.totalPersonas.toLocaleString()} personas
                  </span>{" "}
                  across {agg.totalCohorts} cohorts. Top channel:{" "}
                  {agg.channelShare[0]?.name} ({agg.channelShare[0]?.share}%).
                  Top platform: {agg.platformShare[0]?.name} (
                  {agg.platformShare[0]?.share}%).
                </p>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-neutral-800">
                Ask the model
              </p>
              <form onSubmit={ask} className="flex items-center gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    ready
                      ? "Ask a follow-up..."
                      : "Available when the run converges..."
                  }
                  disabled={!ready || busy}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!ready || busy || !question.trim()}
                  className="rounded-lg border border-neutral-300 p-2 text-neutral-500 hover:border-indigo-400 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CornerDownLeft className="h-4 w-4" />
                  )}
                </button>
              </form>
              {(history.length > 0 || pending.length > 0) && (
                <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                  {[...history, ...pending].map((t, i) => (
                    <div
                      key={"seq" in t ? `h${t.seq}` : `p${i}`}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-2"
                    >
                      <p className="text-[11px] font-medium text-neutral-800">
                        {t.question}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
                        {t.answer}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

type Props = {
  state: CanvasState;
  activePanel: Domain | "conclusion" | null;
  onSelectPanel: (panel: Domain | "conclusion") => void;
  activeView: "geo" | "network" | "insights" | "playbook" | "owner" | null;
  onSelectMainView: (
    view: "geo" | "network" | "insights" | "playbook" | "owner"
  ) => void;
};

/**
 * Top panel strip (SPEC-V2 §5): one panel per domain → subpanels per desk
 * showing what they discussed + their conclusions; plus the ★ Conclusion
 * panel (world-model summary + query).
 */
export function useBlocksByDomain(state: CanvasState) {
  const byDomain = useMemo(() => {
    const m = new Map<Domain, Block[]>();
    for (const id of state.blockOrder) {
      const b = state.blocks[id];
      if (!b) continue;
      m.set(b.domain, [...(m.get(b.domain) ?? []), b]);
    }
    return m;
  }, [state.blocks, state.blockOrder]);
  return byDomain;
}

export function DomainWorkspace({
  domain,
  state,
  onCite,
}: {
  domain: Domain;
  state: CanvasState;
  onCite: (blockId: string) => void;
}) {
  const byDomain = useBlocksByDomain(state);
  const meta = DOMAIN_META[domain];
  const blocks = byDomain.get(domain) ?? [];
  const done = blocks.filter((b) => b.state === "concluded").length;
  const Icon = meta.icon;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/60 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              {meta.label}
            </h2>
            <p className="text-xs text-neutral-500">
              {done}/{blocks.length} desks concluded
            </p>
          </div>
        </div>
        {blocks.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-400">
            No desks in this module yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {blocks.map((b) => (
              <DeskSubpanel key={b.id} block={b} onCite={onCite} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Top module navigation. The selected panel renders in the main workspace.
 */
export default function PanelStrip({
  state,
  activePanel,
  onSelectPanel,
  activeView,
  onSelectMainView,
}: Props) {
  const byDomain = useBlocksByDomain(state);
  const [researchOpen, setResearchOpen] = useState(false);
  const researchRef = useRef<HTMLDivElement>(null);
  const mainViews = [
    { id: "geo", label: "Geography", icon: Globe2 },
    { id: "network", label: "Network", icon: Network },
    { id: "insights", label: "Insights", icon: BarChart3 },
    { id: "playbook", label: "Playbook", icon: BookOpen },
    { id: "owner", label: "Owner", icon: LayoutDashboard },
  ] as const;
  const activeDomain =
    activePanel && activePanel !== "conclusion" ? activePanel : null;
  const activeDomainMeta = activeDomain ? DOMAIN_META[activeDomain] : null;
  const ActiveDomainIcon = activeDomainMeta?.icon ?? BookOpen;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        researchRef.current &&
        !researchRef.current.contains(e.target as Node)
      ) {
        setResearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="border-b border-neutral-200 bg-neutral-50/60">
      <div className="flex items-center gap-1.5 overflow-visible px-4 py-2">
        <span className="shrink-0 pr-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Views
        </span>
        {mainViews.map(({ id, label, icon: Icon }) => {
          const active = activeView === id;
          return (
            <button
              key={id}
              onClick={() => onSelectMainView(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
        <div className="mx-2 h-5 w-px shrink-0 bg-neutral-200" />
        <div className="relative shrink-0" ref={researchRef}>
          <button
            onClick={() => setResearchOpen((open) => !open)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              activeDomain
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
            }`}
          >
            <ActiveDomainIcon className="h-3.5 w-3.5" />
            {activeDomainMeta?.label ?? "Research modules"}
            {activeDomain && byDomain.has(activeDomain) && (
              <span className="rounded-full bg-white/20 px-1.5 text-[9px]">
                {
                  byDomain
                    .get(activeDomain)!
                    .filter((b) => b.state === "concluded").length
                }
                /{byDomain.get(activeDomain)!.length}
              </span>
            )}
          </button>
          {researchOpen && (
            <div className="absolute left-0 z-[1200] mt-1.5 max-h-96 w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
              {DOMAIN_ORDER.filter((d) => byDomain.has(d)).map((d) => {
                const meta = DOMAIN_META[d];
                const blocks = byDomain.get(d)!;
                const done = blocks.filter(
                  (b) => b.state === "concluded"
                ).length;
                const Icon = meta.icon;
                const active = activePanel === d;
                return (
                  <button
                    key={d}
                    onClick={() => {
                      setResearchOpen(false);
                      onSelectPanel(d);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                      active
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{meta.label}</span>
                    <span
                      className={`rounded-full px-1.5 text-[10px] ${
                        active ? "bg-white/20" : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {done}/{blocks.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => onSelectPanel("conclusion")}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
            activePanel === "conclusion"
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
          }`}
        >
          <Star className="h-3.5 w-3.5" />
          Conclusion
        </button>
      </div>
    </div>
  );
}

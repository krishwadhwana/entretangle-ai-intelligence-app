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
  Lightbulb,
  BarChart3,
  BookOpen,
  LayoutDashboard,
  ChevronDown,
  FileDown,
  FileText,
  MessageSquareText,
  Printer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { Block, Domain } from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { DOMAIN_META, DOMAIN_ORDER } from "./domains";
import { downloadDossier, slug, type Dossier, type DossierSection } from "./pdf";

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
  defaultOpen = false,
}: {
  block: Block;
  onCite: (blockId: string) => void;
  defaultOpen?: boolean;
}) {
  const [tab, setTab] = useState<"conclusions" | "discussion">("conclusions");
  const [open, setOpen] = useState(defaultOpen);
  const webGrounded =
    block.params.webSearch === 1 || block.params.webSearch === "true";
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={open ? "Collapse desk" : "Expand desk"}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
          <StateDot state={block.state} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {block.name}
          </span>
        </button>
        {webGrounded && (
          <Globe className="h-3 w-3 text-indigo-400" aria-label="web-grounded" />
        )}
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
          {block.conclusions.length} findings
        </span>
        {open && (
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
        )}
      </div>
      {open ? (
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
      ) : (
        <div className="px-4 py-2">
          <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">
            {block.mission}
          </p>
        </div>
      )}
    </div>
  );
}

// The report writer occasionally embeds raw conclusion ids inline as
// "[clx9abc...]" or "[clx9abc..., cly2def...]" — meaningless to a reader. Strip
// those bracketed id tokens from prose; real words never form 16+ char
// alphanumeric runs, so this only ever removes machine ids.
const ID_TOKEN_RE =
  /\s*\[\s*[a-z0-9]{16,}(?:\s*,\s*[a-z0-9]{16,})*\s*\]/g;
function stripIds(text: string): string {
  return text.replace(ID_TOKEN_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Render cited conclusions as subtle, human-readable links (the claim text),
// never the raw ids. Clicking jumps to the network graph and highlights the
// desk the evidence came from. Ids that no longer resolve are dropped, so a
// stale report quietly shows nothing rather than leaking machine ids.
function CitedEvidence({
  ids,
  conclusionsById,
  onCite,
}: {
  ids: string[];
  conclusionsById?: Map<string, { claim: string; blockId: string }>;
  onCite?: (blockId: string) => void;
}) {
  if (ids.length === 0 || !conclusionsById) return null;
  const cited = ids
    .map((id) => conclusionsById.get(id))
    .filter((c): c is { claim: string; blockId: string } => Boolean(c))
    .slice(0, 4);
  if (cited.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-neutral-400">
      <span className="uppercase tracking-wide">Evidence</span>
      {cited.map((c, i) =>
        onCite ? (
          <button
            key={i}
            type="button"
            onClick={() => onCite(c.blockId)}
            title={c.claim}
            className="max-w-[12rem] truncate text-indigo-400 underline-offset-2 hover:text-indigo-600 hover:underline"
          >
            {c.claim}
          </button>
        ) : (
          <span key={i} title={c.claim} className="max-w-[12rem] truncate">
            {c.claim}
          </span>
        )
      )}
    </p>
  );
}

function FinalReportView({
  report,
  conclusionsById,
  onCite,
}: {
  report: CanvasState["finalReport"];
  conclusionsById?: Map<string, { claim: string; blockId: string }>;
  onCite?: (blockId: string) => void;
}) {
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
          {stripIds(report.title)}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-700">
          {stripIds(report.executiveSummary)}
        </p>
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-indigo-900">
          {stripIds(report.verdict)}
        </p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {report.sections.map((section) => (
          <section
            key={section.title}
            className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-3"
          >
            <h4 className="text-xs font-semibold text-neutral-800">
              {stripIds(section.title)}
            </h4>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
              {stripIds(section.summary)}
            </p>
            <ul className="mt-2 space-y-1.5">
              {section.bullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[11px] leading-relaxed text-neutral-700"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                  <span>{stripIds(bullet)}</span>
                </li>
              ))}
            </ul>
            <CitedEvidence
              ids={section.citedConclusionIds}
              conclusionsById={conclusionsById}
              onCite={onCite}
            />
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
                <span>{stripIds(action)}</span>
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
                <span>{stripIds(risk)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

type ConclusionTab = "report" | "followups" | "foresight";

type PrintableFollowUp = {
  key: string;
  seq?: number;
  question: string;
  answer: string;
  citedConclusionIds?: string[];
};

const FORESIGHT_PROMPTS = [
  {
    label: "Stress verdict",
    prompt:
      "What would make this conclusion wrong in the next 90 days, and which early signals would prove it?",
  },
  {
    label: "Change assumption",
    prompt:
      "Which single assumption should I change first, and how would the conclusion shift if it moved materially?",
  },
  {
    label: "Add foresight",
    prompt:
      "Add a forward-looking scenario analysis for the next 6 months, with upside, base, and downside paths.",
  },
  {
    label: "Standalone memo",
    prompt:
      "Turn the most important follow-up into a standalone validation memo with the decision, assumptions, evidence, and next action.",
  },
] as const;

export function ConclusionWorkspace({
  state,
  onQuery,
  onCite,
  reportBusy,
  onGenerateReport,
}: {
  state: CanvasState;
  onQuery: (
    q: string,
    opts?: {
      domains?: string[];
      highlight?: boolean;
      answerInstructions?: string;
    }
  ) => Promise<string>;
  onCite?: (blockId: string) => void;
  reportBusy: boolean;
  onGenerateReport: (force?: boolean) => void;
}) {
  // Map every conclusion id → its claim + desk, so the report can cite
  // evidence by readable claim text instead of leaking raw ids.
  const conclusionsById = useMemo(() => {
    const m = new Map<string, { claim: string; blockId: string }>();
    for (const block of Object.values(state.blocks)) {
      for (const c of block.conclusions) {
        m.set(c.id, { claim: c.claim, blockId: block.id });
      }
    }
    return m;
  }, [state.blocks]);
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState<ConclusionTab>("report");
  const questionInputRef = useRef<HTMLInputElement>(null);
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
  const history = useMemo(
    () => state.conversation.filter((t) => t.domains.length === 0),
    [state.conversation]
  );
  const followUpTurns = useMemo<PrintableFollowUp[]>(
    () => [
      ...history.map((t) => ({
        key: `h${t.seq}`,
        seq: t.seq,
        question: t.question,
        answer: t.answer,
        citedConclusionIds: t.citedConclusionIds,
      })),
      ...pending.map((t, i) => ({
        key: `p${i}`,
        question: t.question,
        answer: t.answer,
      })),
    ],
    [history, pending]
  );
  const displayedFollowUps = useMemo(
    () => [...followUpTurns].reverse(),
    [followUpTurns]
  );
  const followUpCount = followUpTurns.length;

  function cueQuestion(prompt: string) {
    setQuestion(prompt);
    setTab("followups");
    if (typeof window !== "undefined")
      requestAnimationFrame(() => questionInputRef.current?.focus());
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setTab("followups");
    try {
      // Ask in-place — don't jump to the network graph and leave this page.
      const answer = await onQuery(q, { highlight: false });
      setPending((p) => [...p, { question: q, answer }]);
      setQuestion("");
    } catch (e) {
      setPending((p) => [
        ...p,
        {
          question: q,
          answer: e instanceof Error ? e.message : "Query failed - try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const agg = state.aggregate;

  // --- PDF dossier export -------------------------------------------------
  const [pdfOpen, setPdfOpen] = useState(false);
  const conclusionDossier = (): Dossier => {
    const meta: string[] = [];
    if (state.worldModel)
      meta.push(
        `${state.worldModel.conclusionCount} conclusions · ${state.worldModel.blockCount} desks`
      );
    if (agg)
      meta.push(`${agg.totalPersonas.toLocaleString()} personas · ${agg.totalCohorts} cohorts`);
    meta.push(new Date().toLocaleDateString());
    const sections: DossierSection[] = [];
    if (report) {
      if (report.verdict)
        sections.push({ heading: "Verdict", body: stripIds(report.verdict) });
      if (report.executiveSummary)
        sections.push({
          heading: "Executive summary",
          body: stripIds(report.executiveSummary),
        });
      for (const s of report.sections)
        sections.push({
          heading: stripIds(s.title),
          body: stripIds(s.summary),
          bullets: s.bullets.map(stripIds),
        });
      if (report.nextActions.length)
        sections.push({
          heading: "Next actions",
          bullets: report.nextActions.map(stripIds),
        });
      if (report.risks.length)
        sections.push({
          heading: "Risks to validate",
          bullets: report.risks.map(stripIds),
        });
    }
    if (!sections.length) {
      sections.push({
        heading: "Status",
        body: state.worldModel
          ? `${state.worldModel.conclusionCount} conclusions across ${state.worldModel.blockCount} desks.`
          : state.phaseLabel,
      });
    }
    return {
      title: report?.title ? stripIds(report.title) : "Conclusion dossier",
      subtitle: report?.verdict ? undefined : state.phaseLabel,
      meta,
      sections,
    };
  };
  const followUpSections = (
    turns: PrintableFollowUp[] = followUpTurns
  ): DossierSection[] =>
    turns.map((t, i) => ({
      heading: `${i + 1}. ${stripIds(t.question)}`,
      body: stripIds(t.answer),
    }));
  const baseName = slug(stripIds(report?.title ?? "conclusion"));
  const followUpDossier = (
    turns: PrintableFollowUp[],
    title = "Follow-up dossier"
  ): Dossier => ({
    title,
    subtitle: report?.title ? stripIds(report.title) : "Conclusion workspace",
    meta: [
      `${turns.length} question${turns.length === 1 ? "" : "s"}`,
      new Date().toLocaleDateString(),
    ],
    sections: followUpSections(turns),
  });
  const exportConclusionOnly = () => {
    downloadDossier(conclusionDossier(), `${baseName}-dossier`);
    setPdfOpen(false);
  };
  // One PDF: conclusion with the follow-up Q&A appended as a supplement.
  const exportSupplement = () => {
    const d = conclusionDossier();
    const fu = followUpSections();
    if (fu.length)
      d.sections.push({ heading: "Follow-up Q&A", pageBreak: true }, ...fu);
    downloadDossier(d, `${baseName}-dossier`);
    setPdfOpen(false);
  };
  const exportFollowUpsOnly = () => {
    if (!followUpTurns.length) return;
    downloadDossier(followUpDossier(followUpTurns), `${baseName}-followups`);
    setPdfOpen(false);
  };
  const exportOneFollowUp = (turn: PrintableFollowUp) => {
    const index = followUpTurns.findIndex((t) => t.key === turn.key);
    const number = index >= 0 ? index + 1 : 1;
    downloadDossier(
      followUpDossier([turn], `Follow-up ${number}`),
      `${baseName}-followup-${number}-${slug(turn.question).slice(0, 28)}`
    );
    setPdfOpen(false);
  };

  const tabs = [
    { id: "report", label: "Report", icon: FileText },
    {
      id: "followups",
      label: followUpCount ? `Follow-ups (${followUpCount})` : "Follow-ups",
      icon: MessageSquareText,
    },
    { id: "foresight", label: "Revise", icon: Sparkles },
  ] as const;

  const worldSummaryPanel = (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
      <p className="text-xs font-semibold text-indigo-900">World model</p>
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
          {agg.channelShare[0]?.name} ({agg.channelShare[0]?.share}%). Top
          platform: {agg.platformShare[0]?.name} ({agg.platformShare[0]?.share}
          %).
        </p>
      )}
    </div>
  );

  const renderAskPanel = (title = "Ask the model") => (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-800">{title}</p>
        <button
          type="button"
          onClick={exportFollowUpsOnly}
          disabled={!followUpCount}
          title="Create one PDF from all follow-ups"
          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[10px] font-medium text-neutral-500 hover:border-neutral-400 disabled:opacity-40"
        >
          <Printer className="h-3 w-3" />
          Follow-ups
        </button>
      </div>
      <form onSubmit={ask} className="flex items-center gap-2">
        <input
          ref={questionInputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            ready ? "Ask a follow-up..." : "Available when the run converges..."
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
    </div>
  );

  const renderFollowUpList = () =>
    followUpCount ? (
      <div className="space-y-2">
        {displayedFollowUps.map((t) => {
          const index = followUpTurns.findIndex((turn) => turn.key === t.key);
          const number = index >= 0 ? index + 1 : followUpCount;
          return (
            <div
              key={t.key}
              className="rounded-lg border border-neutral-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Follow-up {number}
                  </p>
                  <p className="mt-1 text-[12px] font-medium leading-snug text-neutral-900">
                    {t.question}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => exportOneFollowUp(t)}
                  title="Create a dossier for this follow-up"
                  className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:border-indigo-300 hover:text-indigo-600"
                >
                  <FileDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-600">
                {t.answer}
              </p>
              {t.citedConclusionIds?.length ? (
                <CitedEvidence
                  ids={t.citedConclusionIds}
                  conclusionsById={conclusionsById}
                  onCite={onCite}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-400">
        No follow-ups yet.
      </div>
    );

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/60 p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
                Conclusion
              </p>
              <h2 className="truncate text-sm font-semibold text-neutral-900">
                {report ? stripIds(report.title) : "Final business report"}
              </h2>
              <p className="mt-1 text-[11px] text-neutral-500">
                {followUpCount
                  ? `${followUpCount} follow-up${followUpCount === 1 ? "" : "s"} ready for dossier export`
                  : state.phaseLabel}
              </p>
            </div>
            {ready && (
              <button
                type="button"
                onClick={() => {
                  setTab("report");
                  onGenerateReport(!!report);
                }}
                disabled={reportBusy}
                title={
                  report
                    ? "Rewrite the report with the latest financial model"
                    : undefined
                }
                className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {reportBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {reportBusy
                  ? "Writing..."
                  : report
                    ? "Regenerate"
                    : "Generate report"}
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPdfOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:border-neutral-400"
              >
                <FileDown className="h-3.5 w-3.5" /> Dossier
                <ChevronDown className="h-3 w-3" />
              </button>
              {pdfOpen && (
                <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={exportConclusionOnly}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[11px] text-neutral-700 hover:bg-neutral-100"
                  >
                    <span className="font-medium">Conclusion dossier</span>
                    <span className="block text-[10px] text-neutral-400">
                      Final report, actions, and risks
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={exportSupplement}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[11px] text-neutral-700 hover:bg-neutral-100"
                  >
                    <span className="font-medium">Conclusion + follow-ups</span>
                    <span className="block text-[10px] text-neutral-400">
                      One PDF with Q&amp;A appended
                      {followUpCount ? ` (${followUpCount})` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={exportFollowUpsOnly}
                    disabled={!followUpCount}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[11px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    <span className="font-medium">Follow-ups only</span>
                    <span className="block text-[10px] text-neutral-400">
                      {followUpCount
                        ? "Print Q&A separately"
                        : "No follow-up Q&A yet"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${
                  tab === id
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "report" && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-2">
              <FinalReportView
                report={report}
                conclusionsById={conclusionsById}
                onCite={onCite}
              />
            </div>
            <aside className="space-y-3">
              {worldSummaryPanel}
              {renderAskPanel("Ask the model")}
            </aside>
          </div>
        )}

        {tab === "followups" && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-neutral-800">
                    Follow-up dossiers
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {followUpCount
                      ? "Export one follow-up or the full Q&A set."
                      : "Ask a follow-up to create a printable dossier."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportFollowUpsOnly}
                  disabled={!followUpCount}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:border-neutral-400 disabled:opacity-40"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print all
                </button>
              </div>
              {renderFollowUpList()}
            </div>
            <aside className="space-y-3">
              {renderAskPanel("New follow-up")}
              {worldSummaryPanel}
            </aside>
          </div>
        )}

        {tab === "foresight" && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                {FORESIGHT_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => cueQuestion(item.prompt)}
                    disabled={!ready}
                    className="rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-indigo-300 disabled:opacity-40"
                  >
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <p className="mt-2 text-sm font-semibold text-neutral-900">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <p className="text-xs font-semibold text-neutral-800">
                  Report revision
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTab("report");
                      onGenerateReport(!!report);
                    }}
                    disabled={!ready || reportBusy}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-300 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
                  >
                    {reportBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {report ? "Rewrite report" : "Generate report"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      cueQuestion(
                        "What exact change should I make before acting on this conclusion, and why?"
                      )
                    }
                    disabled={!ready}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 hover:border-neutral-400 disabled:opacity-40"
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Ask change
                  </button>
                </div>
              </div>
            </div>
            <aside className="space-y-3">
              {renderAskPanel("Foresight follow-up")}
              {worldSummaryPanel}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

type Props = {
  state: CanvasState;
  activePanel: Domain | "conclusion" | null;
  onSelectPanel: (panel: Domain | "conclusion") => void;
  activeView:
    | "geo"
    | "network"
    | "know-how"
    | "insights"
    | "playbook"
    | "owner"
    | null;
  onSelectMainView: (
    view:
      | "geo"
      | "network"
      | "know-how"
      | "insights"
      | "playbook"
      | "owner"
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
  const [selectedBlockId, setSelectedBlockId] = useState<string>("all");
  const visibleBlocks =
    selectedBlockId === "all"
      ? blocks
      : blocks.filter((b) => b.id === selectedBlockId);

  useEffect(() => {
    setSelectedBlockId((current) =>
      current === "all" || blocks.some((b) => b.id === current)
        ? current
        : "all"
    );
  }, [blocks]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/60 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-neutral-900">
                {meta.label}
              </h2>
              <p className="text-xs text-neutral-500">
                {done}/{blocks.length} desks concluded
              </p>
            </div>
          </div>
          {blocks.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              Desk
              <select
                value={selectedBlockId}
                onChange={(e) => setSelectedBlockId(e.target.value)}
                className="max-w-xs rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 outline-none focus:border-indigo-500"
              >
                <option value="all">All desks</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {blocks.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-400">
            No desks in this module yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {visibleBlocks.map((b) => (
              <DeskSubpanel
                key={`${b.id}-${selectedBlockId === b.id ? "focused" : "all"}`}
                block={b}
                onCite={onCite}
                defaultOpen={selectedBlockId === b.id}
              />
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
    { id: "know-how", label: "Know-How", icon: Lightbulb },
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
      <div className="flex flex-wrap items-center gap-1.5 overflow-visible px-4 py-2">
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

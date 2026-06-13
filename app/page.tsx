"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CornerDownLeft,
  FileText,
  Loader2,
  Play,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import type {
  ChatMessage,
  ClientProfile,
  InterviewTranscript,
  PendingQuestion,
  SimulationRunRecord,
} from "@/lib/schema";

// Conversational intake (SPEC Shot 8; v2.1 structured MCQ), now backed by a
// durable project: every message, the pending question, the finished profile
// and every simulation run auto-save to Postgres. A reload restores all of it.

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "What do you want to build? Tell me about the product, your ambition, anything you already know.",
};

// Pins the project this browser is actively working on, so a reload restores
// the SAME project even if a background run updated a different one.
const ACTIVE_PROJECT_KEY = "et_active_project";

// Rough cost model for the audience-size estimate (clearly labelled in the UI
// as an estimate). Research desks are a fixed base; each simulated agent adds
// a small mini-model cost (~25 personas per call).
const BASE_RESEARCH_COST = 1.5; // desks + planner + synthesis + demographics
const COST_PER_AGENT = 0.0006; // ≈ one mini-model call per 25 personas
const MAX_AGENTS = 10000;
function estimateRunCost(agents: number): number {
  return BASE_RESEARCH_COST + Math.max(0, agents) * COST_PER_AGENT;
}

type ProjectData = {
  id: string;
  name: string;
  interviewTranscript: InterviewTranscript;
  ventureProfile: ClientProfile | null;
  simulationRuns: SimulationRunRecord[];
};

type DocSummary = {
  id: string;
  name: string;
  charCount: number;
  chunkCount: number;
  embModel: string;
  createdAt: string;
};

function IntakePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  // Stack of already-answered MCQ questions (with their options) — powers Back.
  const [answeredQuestions, setAnsweredQuestions] = useState<PendingQuestion[]>(
    []
  );
  const [done, setDone] = useState(false);
  const [brief, setBrief] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [simRuns, setSimRuns] = useState<SimulationRunRecord[]>([]);
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Free-text "Other response" for the current question.
  const [otherText, setOtherText] = useState("");
  const submittingRef = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follow-up composer state
  const [focusQuestion, setFocusQuestion] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [mode, setMode] = useState<"full" | "scoped">("full");
  const [agentCount, setAgentCount] = useState(6000); // audience size for this run
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load & fully restore the selected project — or the most recently updated
  // one — or create the first project so saves have a home from message #1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let proj: ProjectData | null = null;
        // Resolution order: explicit ?project= → the last project this browser
        // was working on (localStorage pin) → most-recently-updated → create.
        // The localStorage pin makes a reload deterministic: it restores the
        // SAME project (and its in-progress questionnaire) regardless of which
        // other project was updated most recently by a background run.
        const pinnedId =
          projectParam ||
          (typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_PROJECT_KEY)
            : null);
        if (pinnedId) {
          const res = await fetch(`/api/projects/${pinnedId}`);
          // 404 (deleted) → fall through; other errors too, but a transient
          // error must NOT silently create a new project below.
          if (res.ok) proj = (await res.json()).project;
        }
        if (!proj) {
          const res = await fetch("/api/projects?latest=1");
          if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
          proj = (await res.json()).project; // null only when no projects exist
        }
        if (!proj) {
          // Genuinely no projects yet — create the first.
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Untitled venture" }),
          });
          if (!res.ok) throw new Error(`Project creation failed (${res.status})`);
          proj = (await res.json()).project;
        }
        if (cancelled || !proj) return;
        const t = proj.interviewTranscript;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_PROJECT_KEY, proj.id);
        }
        setProjectId(proj.id);
        setMessages(t.messages.length > 0 ? t.messages : [GREETING]);
        setPending(t.pending);
        setAnsweredQuestions(t.answeredQuestions ?? []);
        setDone(t.done);
        setBrief(t.brief);
        setProfile(proj.ventureProfile);
        setSimRuns(proj.simulationRuns ?? []);
        setSelected(new Set());
        setOtherText("");
        setInput("");
        void loadDocuments(proj.id);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectParam]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, pending, loading]);

  // Auto-save the transcript. Fire-and-forget on purpose: a failed save must
  // not block the conversation, and the next save carries the full state.
  const persistTranscript = useCallback(
    (id: string, transcript: InterviewTranscript) =>
      fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewTranscript: transcript }),
      }).catch(() => undefined),
    []
  );

  async function submitAnswer(content: string) {
    if (submittingRef.current || !content.trim() || busy || launching || !projectId)
      return;
    submittingRef.current = true;
    // The MCQ question being answered now (if any) joins the Back stack.
    const justAnswered = pending;
    const nextAnswered = justAnswered
      ? [...answeredQuestions, justAnswered]
      : answeredQuestions;
    setInput("");
    setSelected(new Set());
    setOtherText("");
    setPending(null);
    setError(null);
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: content.trim() },
    ];
    setMessages(history);
    // Save the user's message before the LLM round-trip — a crash or reload
    // mid-thought loses nothing.
    void persistTranscript(projectId, {
      messages: history,
      pending: null,
      answeredQuestions: nextAnswered,
      done: false,
    });
    setBusy(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) throw new Error(`Intake failed (${res.status})`);
      const result = await res.json();

      if (!result.done) {
        const nextPending: PendingQuestion = {
          question: result.question,
          options: result.options ?? [],
          multiSelect: result.multiSelect ?? false,
        };
        const withQuestion: ChatMessage[] = [
          ...history,
          { role: "assistant", content: result.question },
        ];
        setMessages(withQuestion);
        setPending(nextPending);
        setAnsweredQuestions(nextAnswered);
        await persistTranscript(projectId, {
          messages: withQuestion,
          pending: nextPending,
          answeredQuestions: nextAnswered,
          done: false,
        });
        return;
      }

      // Interview complete — persist profile + transcript, then launch.
      setLaunching(true);
      const closing: ChatMessage[] = [
        ...history,
        {
          role: "assistant",
          content:
            "Got everything I need. Spawning your research desks and audience…",
        },
      ];
      setMessages(closing);
      setDone(true);
      setBrief(result.brief);
      setProfile(result.profile);
      await Promise.all([
        persistTranscript(projectId, {
          messages: closing,
          pending: null,
          answeredQuestions: nextAnswered,
          done: true,
          brief: result.brief,
        }),
        fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ventureProfile: result.profile }),
        }),
      ]);
      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: result.brief,
          clientProfile: result.profile,
          projectId,
        }),
      });
      if (!runRes.ok) throw new Error(`Run creation failed (${runRes.status})`);
      const { runId } = await runRes.json();
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLaunching(false);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  // Scoped follow-ups can only reuse a completed/capped run that actually has
  // a simulated audience. Live runs are shown in history but are not reusable.
  const latestAudienceRunId =
    [...simRuns]
      .reverse()
      .find(
        (r) =>
          (r.status === "complete" || r.status === "capped") &&
          (r.results.audienceAggregate?.totalPersonas ?? 0) > 0
      )?.runId ?? null;

  async function launchNewRun() {
    if (!projectId || !profile || launching) return;
    const fq = focusQuestion.trim();
    const ctx = additionalContext.trim();
    // A scoped run needs a prior run to reuse; fall back to full otherwise.
    const effectiveMode =
      mode === "scoped" && latestAudienceRunId ? "scoped" : "full";
    // Fold the focus question into the brief so it's visible on the dashboard.
    const composedBrief = fq
      ? `${brief ?? profile.product} — focus: ${fq}`
      : brief ?? profile.product;
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: composedBrief,
          clientProfile: profile,
          projectId,
          focusQuestion: fq || undefined,
          additionalContext: ctx || undefined,
          mode: effectiveMode,
          sourceRunId:
            effectiveMode === "scoped" ? latestAudienceRunId : undefined,
          // Audience size only applies to full runs (scoped reuses an audience).
          targetAudienceSize:
            effectiveMode === "scoped"
              ? undefined
              : Math.max(0, Math.min(MAX_AGENTS, Math.round(agentCount))),
        }),
      });
      if (!res.ok) throw new Error(`Run creation failed (${res.status})`);
      const { runId } = await res.json();
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLaunching(false);
    }
  }

  async function loadDocuments(id: string) {
    try {
      const res = await fetch(`/api/projects/${id}/documents`);
      if (res.ok) setDocuments((await res.json()).documents);
    } catch {
      // best-effort; the run still works without docs
    }
  }

  async function uploadDocument(name: string, content: string) {
    if (!projectId || !content.trim() || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.toString?.() ?? `Upload failed (${res.status})`);
      }
      await loadDocuments(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      // Text-ish files only (.txt/.md/.csv/.json/.tsv) — read as UTF-8.
      const text = await file.text();
      await uploadDocument(file.name, text);
    }
  }

  async function deleteDocument(docId: string) {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/documents/${docId}`, {
      method: "DELETE",
    });
    void loadDocuments(projectId);
  }

  function clickOption(opt: string) {
    if (!pending) return;
    if (!pending.multiSelect) {
      void submitAnswer(opt); // single-select: click = answer
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    // typed text wins; otherwise submit the multi-selection
    if (input.trim()) void submitAnswer(input);
    else if (pending?.multiSelect && selected.size > 0)
      void submitAnswer(Array.from(selected).join(", "));
  }

  const otherReady = otherText.trim().length > 0;
  const canContinue =
    !busy &&
    !launching &&
    (pending?.multiSelect ? selected.size > 0 || otherReady : otherReady);

  // Submit the current question: selected options (+ Other text) for
  // multi-select, or just the Other text for single-select.
  function submitInline() {
    if (!pending || !canContinue) return;
    if (pending.multiSelect) {
      const parts = Array.from(selected);
      if (otherReady) parts.push(otherText.trim());
      void submitAnswer(parts.join(", "));
    } else if (otherReady) {
      void submitAnswer(otherText.trim());
    }
  }

  // Can step back as long as we're on a question with a prior step to revert.
  const canGoBack =
    !busy && !launching && !done && pending !== null && messages.length >= 3;

  // Revert the last answer: restore the previous question (with its exact
  // options) and pre-fill the choices the user had made for it.
  function goBack() {
    if (!projectId || !canGoBack) return;
    const prevAnswer = messages[messages.length - 2]?.content ?? "";
    const newMessages = messages.slice(0, -2); // drop last answer + current Q
    setError(null);
    if (answeredQuestions.length > 0) {
      const prevQ = answeredQuestions[answeredQuestions.length - 1];
      const newAnswered = answeredQuestions.slice(0, -1);
      // Re-tick the options (and Other text) the user had chosen before.
      const parts = prevAnswer.split(",").map((s) => s.trim()).filter(Boolean);
      const optSet = new Set(prevQ.options);
      setSelected(new Set(parts.filter((p) => optSet.has(p))));
      setOtherText(parts.filter((p) => !optSet.has(p)).join(", "));
      setInput("");
      setMessages(newMessages);
      setPending(prevQ);
      setAnsweredQuestions(newAnswered);
      void persistTranscript(projectId, {
        messages: newMessages,
        pending: prevQ,
        answeredQuestions: newAnswered,
        done: false,
      });
    } else {
      // Back past the first MCQ → the opening free-text question.
      setSelected(new Set());
      setOtherText("");
      setInput(prevAnswer);
      setMessages(newMessages);
      setPending(null);
      void persistTranscript(projectId, {
        messages: newMessages,
        pending: null,
        answeredQuestions: [],
        done: false,
      });
    }
  }

  // Enter submits a multi-select question from anywhere on the page (not just
  // while the text box is focused). Text fields handle their own Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!pending?.multiSelect || busy || launching || done) return;
      if (selected.size > 0 || otherReady) {
        e.preventDefault();
        submitInline();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) {
    return (
      <main className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> restoring project…
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">EntreTangle</h1>
      <p className="mt-1 text-sm text-neutral-500">
        A short structured interview, then research desks + a simulated
        audience of thousands work your venture live.
      </p>

      {/* Earlier runs stay reachable even while the questionnaire is shown as
          in-progress (done=false). Without this, switching to a project whose
          transcript isn't marked done leaves its simulations with no entry
          point — the done-only history block below never renders. */}
      {!done && simRuns.length > 0 && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-500">
            Simulation runs for this venture
          </p>
          <ul className="space-y-1">
            {[...simRuns].reverse().map((r) => (
              <li key={r.runId}>
                <a
                  href={`/runs/${r.runId}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs hover:border-indigo-400 hover:bg-indigo-50"
                >
                  <span className="truncate text-neutral-700">
                    {r.params?.focusQuestion
                      ? `“${r.params.focusQuestion}”`
                      : new Date(r.timestamp).toLocaleString()}
                  </span>
                  <span
                    className={`shrink-0 font-medium ${
                      r.status === "complete"
                        ? "text-emerald-600"
                        : r.status === "failed"
                          ? "text-red-500"
                          : "text-amber-600"
                    }`}
                  >
                    {r.status}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-xl border px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "assistant"
                ? "border-neutral-200 bg-neutral-50 text-neutral-800"
                : "ml-auto border-indigo-200 bg-indigo-50 text-neutral-900"
            }`}
          >
            {m.content}
          </div>
        ))}

        {/* Clickable options for the current question (Cursor-style) */}
        {pending && pending.options.length > 0 && !busy && !launching && !done && (
          <div className="max-w-[85%]">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              {canGoBack ? (
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-indigo-600"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              ) : (
                <span />
              )}
              {pending.multiSelect && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                  You can select multiple responses
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {pending.options.map((opt) => {
                const isSel = selected.has(opt);
                return (
                  <button
                    key={opt}
                    onClick={(e) => {
                      clickOption(opt);
                      // blur so a subsequent Enter submits instead of
                      // re-toggling this focused chip
                      (e.currentTarget as HTMLButtonElement).blur();
                    }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                      isSel
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
                    }`}
                  >
                    {pending.multiSelect && (
                      <span
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${isSel ? "border-white bg-white/20" : "border-neutral-300"}`}
                      >
                        {isSel && <Check className="h-2.5 w-2.5" />}
                      </span>
                    )}
                    {opt}
                  </button>
                );
              })}
            </div>

            {/* Other — a free-text box below all the option boxes */}
            <input
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitInline();
                }
              }}
              placeholder="Other response"
              className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />

            {/* Explicit submit — always for multi-select; for single-select
                only once an "Other response" is being typed */}
            {(pending.multiSelect || otherReady) && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={submitInline}
                  disabled={!canContinue}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  Continue <CornerDownLeft className="h-3 w-3" />
                </button>
                {pending.multiSelect && (
                  <span className="text-[10px] text-neutral-400">
                    {selected.size + (otherReady ? 1 : 0)} selected
                  </span>
                )}
              </div>
            )}

            <p className="mt-1.5 text-[10px] text-neutral-400">
              {pending.multiSelect
                ? "Pick all that apply (or type an Other response), then Continue — or press ⏎."
                : "Click one — or type an Other response below."}
            </p>
          </div>
        )}

        {/* Interview finished: venture profile + simulation history */}
        {done && profile && !launching && (
          <div className="max-w-[95%] space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Venture profile
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[
                profile.product,
                profile.category,
                profile.priceBand,
                ...(profile.geography ?? []),
                profile.targetAudience,
                profile.funding?.capitalAvailable
                  ? `capital: ${profile.funding.capitalAvailable}`
                  : null,
                profile.funding?.runwayMonths
                  ? `runway: ${profile.funding.runwayMonths} months`
                  : null,
              ]
                .filter(Boolean)
                .map((chip, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-neutral-700"
                  >
                    {chip}
                  </span>
                ))}
            </div>
            {simRuns.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Simulation runs
                </p>
                <ul className="space-y-1.5">
                  {[...simRuns].reverse().map((r) => {
                    const isComplete = r.status === "complete";
                    const isFailed = r.status === "failed";
                    return (
                      <li key={r.runId}>
                        <a
                          href={`/runs/${r.runId}`}
                          className="group flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 transition hover:border-indigo-400 hover:bg-indigo-50/40 hover:shadow-sm"
                        >
                          {/* Status icon */}
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                              isComplete
                                ? "bg-emerald-50 text-emerald-600"
                                : isFailed
                                  ? "bg-red-50 text-red-500"
                                  : "bg-amber-50 text-amber-600"
                            }`}
                            title={r.status}
                          >
                            {isComplete ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : isFailed ? (
                              <XCircle className="h-4 w-4" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                          </span>

                          {/* Title + metadata */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-neutral-800">
                              {r.params?.focusQuestion
                                ? `“${r.params.focusQuestion}”`
                                : "Full simulation"}
                              {r.params?.mode === "scoped" && (
                                <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal text-neutral-500">
                                  scoped
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-neutral-400">
                              {new Date(r.timestamp).toLocaleString()} ·{" "}
                              {r.results.blocks.length} desks ·{" "}
                              {r.results.audienceAggregate?.totalPersonas ?? 0}{" "}
                              personas · ${r.results.costUsd.toFixed(2)}
                            </p>
                          </div>

                          {/* View CTA */}
                          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-neutral-400 transition group-hover:text-indigo-600">
                            <span className="hidden sm:inline">View</span>
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Founder data (RAG): upload real data to ground the simulation */}
            <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Your data {documents.length > 0 && `(${documents.length})`}
                </p>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:border-indigo-400 hover:bg-indigo-50">
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  Upload
                  <input
                    type="file"
                    multiple
                    accept=".txt,.md,.csv,.tsv,.json,text/plain"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      void onFilesPicked(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="text-[10px] text-neutral-400">
                Upload real data (sales, surveys, competitor lists, pricing) as
                .txt / .md / .csv. Research desks and the audience read the most
                relevant parts as ground truth.
              </p>
              {documents.length > 0 && (
                <ul className="space-y-1">
                  {documents.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                        <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
                        <span className="truncate" title={d.name}>
                          {d.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          {d.chunkCount} chunks
                        </span>
                      </span>
                      <button
                        onClick={() => void deleteDocument(d.id)}
                        className="shrink-0 rounded p-1 text-neutral-300 hover:text-red-500"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Follow-up composer: add information + a question, run again */}
            <div className="space-y-2 rounded-lg border border-dashed border-neutral-300 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {simRuns.length > 0 ? "Run a follow-up simulation" : "Run a simulation"}
              </p>
              <input
                value={focusQuestion}
                onChange={(e) => setFocusQuestion(e.target.value)}
                placeholder="Question to explore — e.g. “Will Gulf export pricing hold up vs. local players?”"
                disabled={launching}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="New information since the last run (optional) — e.g. “Secured a Jodhpur manufacturing partner and ₹50L more capital.”"
                disabled={launching}
                rows={2}
                className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
              />

              {/* Audience size: slider 0–10,000 + custom number, with a live
                  cost estimate. Only applies to full runs. */}
              <div className="space-y-1.5 rounded-lg bg-neutral-50 p-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-neutral-600">
                    Audience size
                    {mode === "scoped" && (
                      <span className="ml-1 text-neutral-400">
                        (reuses last run — N/A)
                      </span>
                    )}
                  </label>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    ~${estimateRunCost(agentCount).toFixed(2)} est.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={MAX_AGENTS}
                    step={100}
                    value={agentCount}
                    onChange={(e) => setAgentCount(Number(e.target.value))}
                    disabled={launching || mode === "scoped"}
                    className="flex-1 accent-indigo-600 disabled:opacity-40"
                  />
                  <input
                    type="number"
                    min={0}
                    max={MAX_AGENTS}
                    step={100}
                    value={agentCount}
                    onChange={(e) =>
                      setAgentCount(
                        Math.max(
                          0,
                          Math.min(MAX_AGENTS, Math.round(Number(e.target.value) || 0))
                        )
                      )
                    }
                    disabled={launching || mode === "scoped"}
                    className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 disabled:opacity-40"
                  />
                  <span className="text-[11px] text-neutral-500">agents</span>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-400">
                  <span>0 · research only (~${estimateRunCost(0).toFixed(2)})</span>
                  <span>
                    {MAX_AGENTS.toLocaleString()} · ~$
                    {estimateRunCost(MAX_AGENTS).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-[11px] font-medium">
                  <button
                    type="button"
                    onClick={() => setMode("full")}
                    className={`px-2.5 py-1.5 ${mode === "full" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                    title="Full simulation: fresh research desks + a newly simulated audience of thousands."
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("scoped")}
                    disabled={!latestAudienceRunId}
                    className={`px-2.5 py-1.5 disabled:opacity-40 ${mode === "scoped" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                    title={
                      latestAudienceRunId
                        ? "Lighter: re-run research desks toward your question and reuse the latest completed audience. Much cheaper."
                        : "Available after a completed simulation with an audience."
                    }
                  >
                    Lighter
                  </button>
                </div>
                <button
                  onClick={() => void launchNewRun()}
                  disabled={launching}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  {mode === "scoped"
                    ? "Run lighter simulation"
                    : agentCount === 0
                      ? "Run research only"
                      : `Run ${agentCount.toLocaleString()} agents · ~$${estimateRunCost(agentCount).toFixed(2)}`}
                </button>
              </div>
              <p className="text-[10px] text-neutral-400">
                {mode === "scoped"
                  ? "Lighter: re-runs research desks on your question and reuses the latest completed audience — cheaper, faster."
                  : "Full: fresh research desks and a newly simulated audience of thousands (can reach the cost cap)."}
              </p>
            </div>
          </div>
        )}

        {(busy || launching) && (
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {launching ? "launching run…" : "thinking…"}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Free-text bar — only for the opening question or any question that
          has no clickable options. Questions WITH options take their custom
          input via the inline “Other” field above. */}
      {!done && !(pending && pending.options.length > 0) && (
        <form onSubmit={send} className="pb-2">
          <div className="flex items-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 focus-within:border-indigo-500">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                messages.length === 1
                  ? "I want to launch a teak furniture brand from Jodhpur…"
                  : "Type your answer…"
              }
              disabled={busy || launching}
              className="flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={!input.trim() || busy || launching}
              className="text-neutral-400 hover:text-indigo-600 disabled:opacity-40"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

export default function IntakePage() {
  return (
    <Suspense fallback={null}>
      <IntakePageInner />
    </Suspense>
  );
}

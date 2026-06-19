"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardList,
  CornerDownLeft,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  Sparkles,
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
  WebsiteAnalysis,
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

function runStatusPresentation(status: SimulationRunRecord["status"]) {
  if (status === "complete" || status === "capped") {
    return {
      label: status === "capped" ? "Capped" : "Complete",
      icon: "complete" as const,
      tone: "bg-emerald-50 text-emerald-600",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      icon: "failed" as const,
      tone: "bg-red-50 text-red-500",
    };
  }
  if (status === "cancelled" || status === "cancelling") {
    return {
      label: status === "cancelling" ? "Cancelling" : "Cancelled",
      icon: "cancelled" as const,
      tone: "bg-neutral-100 text-neutral-500",
    };
  }
  return {
    label: status === "planning" ? "Planning" : "Running",
    icon: "loading" as const,
    tone: "bg-amber-50 text-amber-600",
  };
}

type ProjectData = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  interviewTranscript: InterviewTranscript;
  ventureProfile: ClientProfile | null;
  simulationRuns: SimulationRunRecord[];
  websiteAnalysis?: WebsiteAnalysis | null;
};

type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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
  const [projectName, setProjectName] = useState("Untitled venture");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectPreviews, setProjectPreviews] = useState<ProjectData[]>([]);
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
  // Website-analysis bootstrap: pre-fills the intake (ask only gaps) and feeds
  // the consumer-opinion brief into the simulation.
  const [websiteAnalysis, setWebsiteAnalysis] = useState<WebsiteAnalysis | null>(
    null
  );
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
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
  // Text buffer for the audience-size field so it can be cleared/typed freely
  // (the bound number snaps to a floor otherwise, making it read as stuck text).
  const [agentCountText, setAgentCountText] = useState("6000");
  const bottomRef = useRef<HTMLDivElement>(null);

  function toProjectSummary(p: ProjectData): ProjectSummary {
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  function setProjectUrl(id: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", id);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.dispatchEvent(
      new CustomEvent("et:project-selected", { detail: { id } })
    );
  }

  function applyProject(proj: ProjectData, updateUrl = false) {
    const t = proj.interviewTranscript;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, proj.id);
      if (updateUrl) setProjectUrl(proj.id);
    }
    setProjectId(proj.id);
    setProjectName(proj.name);
    setMessages(t.messages.length > 0 ? t.messages : [GREETING]);
    setPending(t.pending);
    setAnsweredQuestions(t.answeredQuestions ?? []);
    setDone(t.done);
    setBrief(t.brief);
    setProfile(proj.ventureProfile);
    setWebsiteAnalysis(proj.websiteAnalysis ?? null);
    setWebsiteUrl(proj.websiteAnalysis?.url ?? "");
    setAnalyzing(false);
    setSimRuns(proj.simulationRuns ?? []);
    setDocuments([]);
    setSelected(new Set());
    setOtherText("");
    setInput("");
    setFocusQuestion("");
    setAdditionalContext("");
    setMode("full");
    void loadDocuments(proj.id);
  }

  function currentProjectSnapshot(): ProjectData | null {
    if (!projectId) return null;
    const base = projectPreviews.find((p) => p.id === projectId);
    return {
      id: projectId,
      name: projectName,
      createdAt: base?.createdAt ?? new Date().toISOString(),
      updatedAt: base?.updatedAt ?? new Date().toISOString(),
      interviewTranscript: {
        messages,
        pending,
        answeredQuestions,
        done,
        brief,
      },
      ventureProfile: profile,
      simulationRuns: simRuns,
    };
  }

  // Preload lightweight project previews so sidebar switching is instant and
  // does not re-enter the whole page loading state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects?previews=1");
        if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
        let previews = ((await res.json()).projects ?? []) as ProjectData[];
        if (previews.length === 0) {
          const createRes = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Untitled venture" }),
          });
          if (!createRes.ok)
            throw new Error(`Project creation failed (${createRes.status})`);
          previews = [(await createRes.json()).project as ProjectData];
        }
        if (cancelled) return;
        // Resolution order: explicit ?project= → the last project this browser
        // was working on (localStorage pin) → most-recently-updated.
        // The localStorage pin makes a reload deterministic: it restores the
        // SAME project (and its in-progress questionnaire) regardless of which
        // other project was updated most recently by a background run.
        const pinnedId =
          projectParam ||
          (typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_PROJECT_KEY)
            : null);
        const proj =
          previews.find((p) => p.id === pinnedId) ??
          previews[0];
        setProjectPreviews(previews);
        setProjects(previews.map(toProjectSummary));
        applyProject(proj, !projectParam);
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
  }, []);

  useEffect(() => {
    function onPopState() {
      const id = new URL(window.location.href).searchParams.get("project");
      const proj =
        projectPreviews.find((p) => p.id === id) ?? projectPreviews[0];
      if (proj) applyProject(proj);
    }
    function onSwitchProject(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) switchProject(id);
    }
    function onProjectCreated(event: Event) {
      const proj = (event as CustomEvent<{ project?: ProjectData }>).detail
        ?.project;
      if (!proj) return;
      const snapshot = currentProjectSnapshot();
      const nextPreviews = [
        proj,
        ...projectPreviews.map((p) =>
          snapshot && p.id === snapshot.id ? snapshot : p
        ),
      ];
      setProjectPreviews(nextPreviews);
      setProjects(nextPreviews.map(toProjectSummary));
      applyProject(proj, true);
    }
    async function onProjectDeleted(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      let nextPreviews = projectPreviews.filter((p) => p.id !== id);
      if (nextPreviews.length === 0) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Untitled venture" }),
        });
        if (!res.ok) {
          setError(`Project creation failed (${res.status})`);
          return;
        }
        nextPreviews = [(await res.json()).project as ProjectData];
      }
      setProjectPreviews(nextPreviews);
      setProjects(nextPreviews.map(toProjectSummary));
      if (projectId === id) {
        applyProject(nextPreviews[0], true);
      }
    }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("et:switch-project", onSwitchProject);
    window.addEventListener("et:project-created", onProjectCreated);
    window.addEventListener("et:project-deleted", onProjectDeleted);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("et:switch-project", onSwitchProject);
      window.removeEventListener("et:project-created", onProjectCreated);
      window.removeEventListener("et:project-deleted", onProjectDeleted);
    };
  }, [projectPreviews, projectId, projectName, messages, pending, answeredQuestions, done, brief, profile, simRuns]);

  // Auto-save the transcript. Fire-and-forget on purpose: a failed save must
  // not block the conversation, and the next save carries the full state.
  const persistTranscript = useCallback(
    (id: string, transcript: InterviewTranscript) => {
      setProjectPreviews((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, interviewTranscript: transcript } : p
        )
      );
      return fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewTranscript: transcript }),
      }).catch(() => undefined);
    },
    []
  );

  function switchProject(id: string) {
    const target = projectPreviews.find((p) => p.id === id);
    if (!target || target.id === projectId) return;
    const snapshot = currentProjectSnapshot();
    if (snapshot) {
      setProjectPreviews((prev) =>
        prev.map((p) => (p.id === snapshot.id ? snapshot : p))
      );
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    }
    applyProject(target, true);
  }

  // Analyse the founder's website + online consumer opinion, then seed the
  // interview with a correctable summary so it only asks the gaps.
  async function analyzeWebsite() {
    const url = websiteUrl.trim();
    if (!url || !projectId || analyzing || busy) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data?.error ?? `Analysis failed (${res.status})`);
      const analysis = data.analysis as WebsiteAnalysis;
      setWebsiteAnalysis(analysis);

      const summaryMsg = [
        `Here's what I gathered from your site:`,
        analysis.summary,
        analysis.consumerOpinion
          ? `\nWhat customers say online (${analysis.sentiment}): ${analysis.consumerOpinion}`
          : "",
        `\nI'll only ask about what I couldn't work out. If anything above is off, just tell me — otherwise reply "looks good" and answer the few questions next.`,
      ]
        .filter(Boolean)
        .join("\n");
      const seeded: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: summaryMsg },
      ];
      setMessages(seeded);
      void persistTranscript(projectId, {
        messages: seeded,
        pending: null,
        answeredQuestions,
        done: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Website analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

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
        body: JSON.stringify({
          messages: history,
          // Skip questions the website analysis already answered.
          prefill: websiteAnalysis
            ? {
                draftProfile: websiteAnalysis.draftProfile,
                knownFields: websiteAnalysis.knownFields,
                consumerOpinion: websiteAnalysis.consumerOpinion,
              }
            : undefined,
        }),
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

      // Interview complete — persist profile + transcript, then hand off to the
      // launch composer so the user can choose their audience size before the
      // simulation runs (rather than silently launching on a default).
      const closing: ChatMessage[] = [
        ...history,
        {
          role: "assistant",
          content:
            "Got everything I need. Choose how many agents to simulate below, then launch when you're ready.",
        },
      ];
      setMessages(closing);
      setDone(true);
      setBrief(result.brief);
      setProfile(result.profile);
      setProjectPreviews((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                interviewTranscript: {
                  messages: closing,
                  pending: null,
                  answeredQuestions: nextAnswered,
                  done: true,
                  brief: result.brief,
                },
                ventureProfile: result.profile,
              }
            : p
        )
      );
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
    // Seed the simulation with real online consumer opinion from the website
    // analysis so the synthetic audience reflects what actual customers say.
    const opinion = websiteAnalysis?.consumerOpinion?.trim();
    const composedContext =
      [
        opinion
          ? `Real online consumer opinion about this brand/category (treat as ground truth when simulating the audience): ${opinion}`
          : "",
        ctx,
      ]
        .filter(Boolean)
        .join("\n\n") || "";
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
          additionalContext: composedContext || undefined,
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
      <main className="flex h-full items-center justify-center bg-neutral-50 px-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> restoring project…
        </div>
      </main>
    );
  }

  const sortedRuns = [...simRuns].reverse();
  const completedRuns = simRuns.filter(
    (r) => r.status === "complete" || r.status === "capped"
  ).length;
  const latestRun = sortedRuns[0];
  const userAnswers = messages.filter((m) => m.role === "user").slice(-4);
  const setupStep = done ? "Profile complete" : pending ? "Setup questions" : "Project brief";
  const profileChips = profile
    ? [
        profile.product,
        profile.category,
        profile.priceBand,
        ...(profile.productDetails?.styleKeywords ?? []),
        ...(profile.productDetails?.heroProducts ?? []),
        ...(profile.productDetails?.occasions ?? []),
        profile.productDetails?.materialsAndFit,
        profile.productDetails?.differentiation,
        ...(profile.geography ?? []),
        profile.targetAudience,
        profile.funding?.capitalAvailable
          ? `capital: ${profile.funding.capitalAvailable}`
          : null,
        profile.funding?.runwayMonths
          ? `runway: ${profile.funding.runwayMonths} months`
          : null,
      ].filter(Boolean)
    : [];

  if (!done) {
    return (
      <main className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-neutral-50 text-neutral-900 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
        <aside className="flex min-h-0 flex-col border-r border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Projects
            </p>
          </div>
          <nav className="max-h-56 min-h-0 flex-1 overflow-y-auto p-2 md:max-h-none">
            {projects.map((p) => {
              const active = p.id === projectId;
              return (
                <button
                  key={p.id}
                  onClick={() => switchProject(p.id)}
                  className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    active
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  <FolderOpen
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      active ? "text-white" : "text-neutral-400"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {p.name}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-[10px] ${
                        active ? "text-neutral-300" : "text-neutral-400"
                      }`}
                    >
                      Updated {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="min-h-0 overflow-y-auto px-4 py-10">
          <div className="mx-auto w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Project setup
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight">
                  {projectName}
                </h1>
              </div>
              {canGoBack && (
                <button
                  onClick={goBack}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-700"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <h2 className="text-base font-semibold leading-snug text-neutral-900">
                {pending?.question ?? GREETING.content}
              </h2>

              {!pending &&
                !done &&
                !launching &&
                messages.length <= 1 &&
                !websiteAnalysis && (
                  <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-700">
                      <Sparkles className="h-3.5 w-3.5" /> Have a website? I&apos;ll
                      read your site + what customers say online, pre-fill what I
                      can, and only ask what&apos;s missing.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void analyzeWebsite();
                          }
                        }}
                        placeholder="yourbrand.com"
                        disabled={analyzing}
                        className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => void analyzeWebsite()}
                        disabled={analyzing || !websiteUrl.trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {analyzing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {analyzing ? "Analyzing…" : "Analyze"}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-neutral-400">
                      Reads real reviews &amp; sentiment about your brand. Or just
                      start typing below to describe your venture.
                    </p>
                  </div>
                )}

              {pending && pending.options.length > 0 && !busy && !launching && (
                <div className="mt-4 space-y-3">
                  {pending.multiSelect && (
                    <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                      Select multiple
                    </span>
                  )}
                  <div className="grid gap-2">
                    {pending.options.map((opt) => {
                      const isSel = selected.has(opt);
                      return (
                        <button
                          key={opt}
                          onClick={(e) => {
                            clickOption(opt);
                            (e.currentTarget as HTMLButtonElement).blur();
                          }}
                          className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                            isSel
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
                          }`}
                        >
                          {pending.multiSelect && (
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSel ? "border-white bg-white/20" : "border-neutral-300"}`}
                            >
                              {isSel && <Check className="h-3 w-3" />}
                            </span>
                          )}
                          <span className="min-w-0 break-words">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
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
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  {(pending.multiSelect || otherReady) && (
                    <div className="flex items-center gap-2">
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
                </div>
              )}

              {!(pending && pending.options.length > 0) && (
                <form onSubmit={send} className="mt-4">
                  <div className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2.5 focus-within:border-indigo-500">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={
                        messages.length === 1
                          ? "I want to launch a teak furniture brand from Jodhpur..."
                          : "Type your answer..."
                      }
                      disabled={busy || launching}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
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
            </div>

            {(busy || launching) && (
              <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {launching ? "launching run..." : "thinking..."}
              </div>
            )}
            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-neutral-50 text-neutral-900 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Projects
          </p>
        </div>
        <nav className="max-h-56 min-h-0 flex-1 overflow-y-auto p-2 md:max-h-none">
          {projects.map((p) => {
            const active = p.id === projectId;
            return (
              <button
                key={p.id}
                onClick={() => switchProject(p.id)}
                className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                <FolderOpen
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    active ? "text-white" : "text-neutral-400"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {p.name}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[10px] ${
                      active ? "text-neutral-300" : "text-neutral-400"
                    }`}
                  >
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <header className="border-b border-neutral-200 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Active project
                  </p>
                  <h2 className="break-words text-2xl font-semibold tracking-tight">
                    {projectName}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-neutral-500">
                    {profile?.product ??
                      brief ??
                      "Set up the venture profile, then run research and audience simulations from this workspace."}
                  </p>
                </div>
                {latestRun && (
                  <a
                    href={`/runs/${latestRun.runId}`}
                    className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
                  >
                    Open latest run <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </header>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-neutral-500">Profile</p>
                <p className="mt-1 text-lg font-semibold">{setupStep}</p>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-neutral-500">Runs</p>
                <p className="mt-1 text-lg font-semibold">
                  {completedRuns} complete / {simRuns.length} total
                </p>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Database className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-neutral-500">Data</p>
                <p className="mt-1 text-lg font-semibold">
                  {documents.length} uploaded
                </p>
              </div>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Venture profile</h3>
                {!done && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    Setup in progress
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                {profileChips.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {profileChips.map((chip, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-neutral-700"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Complete the setup steps to turn this into a structured
                    venture profile.
                  </p>
                )}
                {userAnswers.length > 0 && !done && (
                  <div className="mt-4 border-t border-neutral-100 pt-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Captured so far
                    </p>
                    <div className="space-y-1.5">
                      {userAnswers.map((m, i) => (
                        <p
                          key={i}
                          className="line-clamp-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600"
                        >
                          {m.content}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Simulation runs</h3>
              {sortedRuns.length > 0 ? (
                <ul className="space-y-2">
                  {sortedRuns.map((r) => {
                    const status = runStatusPresentation(r.status);
                    return (
                      <li key={r.runId}>
                        <a
                          href={`/runs/${r.runId}`}
                          className="group flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 transition hover:border-indigo-300 hover:bg-indigo-50/40"
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status.tone}`}
                            title={status.label}
                          >
                            {status.icon === "complete" ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : status.icon === "failed" ||
                              status.icon === "cancelled" ? (
                              <XCircle className="h-4 w-4" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-neutral-800">
                              {r.params?.focusQuestion
                                ? r.params.focusQuestion
                                : "Full simulation"}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                              {new Date(r.timestamp).toLocaleString()} ·{" "}
                              {status.label} ·{" "}
                              {r.results.blocks.length} desks ·{" "}
                              {r.results.audienceAggregate?.totalPersonas ?? 0}{" "}
                              personas · ${r.results.costUsd.toFixed(2)}
                              {r.params?.mode === "scoped" ? " · lighter" : ""}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500">
                  No simulations yet. Finish setup to launch the first run.
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  Project data {documents.length > 0 && `(${documents.length})`}
                </h3>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:border-indigo-400 hover:bg-indigo-50">
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
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
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                {documents.length > 0 ? (
                  <ul className="space-y-1">
                    {documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between rounded-lg border border-neutral-200 px-2.5 py-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
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
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Upload sales notes, survey results, pricing, or competitor
                    lists to ground future research.
                  </p>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
            {!done && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Setup
                    </p>
                    <h3 className="mt-1 text-base font-semibold">
                      {pending?.question ?? GREETING.content}
                    </h3>
                  </div>
                  {canGoBack && (
                    <button
                      onClick={goBack}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back
                    </button>
                  )}
                </div>

                {pending && pending.options.length > 0 && !busy && !launching && (
                  <div className="space-y-3">
                    {pending.multiSelect && (
                      <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        Select multiple
                      </span>
                    )}
                    <div className="grid gap-2">
                      {pending.options.map((opt) => {
                        const isSel = selected.has(opt);
                        return (
                          <button
                            key={opt}
                            onClick={(e) => {
                              clickOption(opt);
                              (e.currentTarget as HTMLButtonElement).blur();
                            }}
                            className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                              isSel
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
                            }`}
                          >
                            {pending.multiSelect && (
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSel ? "border-white bg-white/20" : "border-neutral-300"}`}
                              >
                                {isSel && <Check className="h-3 w-3" />}
                              </span>
                            )}
                            <span className="min-w-0 break-words">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
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
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                    {(pending.multiSelect || otherReady) && (
                      <div className="flex items-center gap-2">
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
                  </div>
                )}

                {!done && !(pending && pending.options.length > 0) && (
                  <form onSubmit={send}>
                    <div className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2.5 focus-within:border-indigo-500">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                          messages.length === 1
                            ? "I want to launch a teak furniture brand from Jodhpur..."
                            : "Type your answer..."
                        }
                        disabled={busy || launching}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
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

                {(busy || launching) && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {launching ? "launching run..." : "thinking..."}
                  </div>
                )}
              </section>
            )}

            {done && profile && !launching && (
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    {simRuns.length > 0
                      ? "Run a follow-up simulation"
                      : "Run a simulation"}
                  </p>
                  <h3 className="mt-1 text-base font-semibold">
                    Explore the next decision
                  </h3>
                </div>
                <input
                  value={focusQuestion}
                  onChange={(e) => setFocusQuestion(e.target.value)}
                  placeholder="Question to explore"
                  disabled={launching}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="New information since the last run (optional)"
                  disabled={launching}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                />

                <div className="space-y-1.5 rounded-lg bg-neutral-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-medium text-neutral-600">
                      Audience size
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
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setAgentCount(v);
                        setAgentCountText(String(v));
                      }}
                      disabled={launching || mode === "scoped"}
                      className="min-w-0 flex-1 accent-indigo-600 disabled:opacity-40"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_AGENTS}
                      step={100}
                      value={agentCountText}
                      placeholder="6000"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAgentCountText(raw);
                        const n = Number(raw);
                        if (raw !== "" && Number.isFinite(n)) {
                          setAgentCount(
                            Math.max(0, Math.min(MAX_AGENTS, Math.round(n)))
                          );
                        }
                      }}
                      onBlur={() => {
                        const n = Number(agentCountText);
                        const v =
                          agentCountText === "" || !Number.isFinite(n)
                            ? 0
                            : Math.max(0, Math.min(MAX_AGENTS, Math.round(n)));
                        setAgentCount(v);
                        setAgentCountText(String(v));
                      }}
                      disabled={launching || mode === "scoped"}
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => setMode("full")}
                      className={`px-2.5 py-1.5 ${mode === "full" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                      title="Full simulation: fresh research desks + a newly simulated audience."
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
                          ? "Re-run research toward your question and reuse the latest completed audience."
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
                      ? "Run lighter"
                      : agentCount === 0
                        ? "Run research"
                        : `Run ${agentCount.toLocaleString()} agents`}
                  </button>
                </div>
                {launching && (
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    launching run...
                  </div>
                )}
              </section>
            )}

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </aside>
        </div>
      </section>
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

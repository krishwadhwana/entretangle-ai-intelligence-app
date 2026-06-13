"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { Domain } from "@/lib/schema";
import {
  RotateCcw,
  Coins,
  Users,
  Layers,
  ChevronDown,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { useRunEvents } from "./useRunEvents";
import PanelStrip, { ConclusionWorkspace, DomainWorkspace } from "./PanelStrip";
import NetworkView from "./NetworkView";
import InsightsView from "./InsightsView";
import PlaybookView from "./PlaybookView";
import OwnerDashboard from "./OwnerDashboard";
import CohortDrawer from "./CohortDrawer";
import { ProjectSelector } from "./AppHeader";

// Leaflet touches `window` — render the geography layer client-side only.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-neutral-400">
      Loading map…
    </div>
  ),
});

type SiblingRun = {
  id: string;
  focusQuestion: string | null;
  mode: string;
  status: string;
  createdAt: string;
};

type Props = {
  runId: string;
  projectId: string | null;
  brief: string;
  parentRunId: string | null;
  childRunIds: string[];
  maxCostUsd: number;
  maxTokens: number;
  siblingRuns: SiblingRun[];
};

/** Header dropdown to hop between sibling runs in the same project. */
function RunSwitcher({
  runId,
  siblings,
}: {
  runId: string;
  siblings: SiblingRun[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const idx = siblings.findIndex((s) => s.id === runId);
  const label = `Run ${siblings.length - idx} of ${siblings.length}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400"
        title="Switch between simulations in this project"
      >
        <Layers className="h-3 w-3" /> {label}
        <ChevronDown className="h-3 w-3 text-neutral-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-[1100] mt-1.5 max-h-80 w-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          {siblings.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setOpen(false);
                if (s.id !== runId) router.push(`/runs/${s.id}`);
              }}
              className={`block w-full px-3 py-2 text-left text-xs ${
                s.id === runId ? "bg-indigo-50" : "hover:bg-neutral-50"
              }`}
            >
              <p className="truncate font-medium text-neutral-800">
                {s.focusQuestion
                  ? `“${s.focusQuestion}”`
                  : i === siblings.length - 1
                    ? "Initial simulation"
                    : "Follow-up simulation"}
              </p>
              <p className="text-[10px] text-neutral-400">
                {new Date(s.createdAt).toLocaleString()} · {s.status}
                {s.mode === "scoped" && " · scoped"}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * v2 dashboard (SPEC-V2 §5): top bar → domain panel strip (subpanels +
 * conclusion panel) → THE MAP with two toggle layers (geography / network)
 * and the cohort drawer.
 */
export default function RunDashboard({
  runId,
  projectId,
  brief,
  parentRunId,
  childRunIds,
  maxCostUsd,
  maxTokens,
  siblingRuns,
}: Props) {
  const router = useRouter();
  const { state, patchState, replay, replaying } = useRunEvents(runId);
  const [view, setView] = useState<
    "geo" | "network" | "insights" | "playbook" | "owner" | "domain" | "conclusion"
  >("geo");
  const [activePanel, setActivePanel] = useState<
    "conclusion" | Domain | null
  >(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [highlightedBlocks, setHighlightedBlocks] = useState<Set<string>>(
    new Set()
  );

  const cohorts = useMemo(
    () =>
      state.cohortOrder.map((id) => state.cohorts[id]).filter(Boolean),
    [state.cohorts, state.cohortOrder]
  );
  const personaCount = useMemo(
    () => cohorts.reduce((s, c) => s + c.personas.length, 0),
    [cohorts]
  );

  // Live progress while the run is still working (SSE-driven).
  const progress = useMemo(() => {
    const inProgress = ["connecting", "planning", "running"].includes(
      state.status
    );
    const cohortsDone = cohorts.filter((c) => c.state === "done").length;
    const cohortsTotal = cohorts.length;
    const blocks = Object.values(state.blocks);
    const desksTotal = blocks.length;
    const desksDone = blocks.filter(
      (b) => b.state === "concluded" || b.state === "failed"
    ).length;
    // Cohorts are the long pole; fall back to desks before cohorts spawn.
    const pct =
      cohortsTotal > 0
        ? Math.round((100 * cohortsDone) / cohortsTotal)
        : desksTotal > 0
          ? Math.round((100 * desksDone) / desksTotal)
          : 4;
    return {
      inProgress,
      cohortsDone,
      cohortsTotal,
      desksDone,
      desksTotal,
      pct,
    };
  }, [state.status, state.blocks, cohorts]);

  const onQuery = useCallback(
    async (
      question: string,
      opts?: { domains?: string[]; highlight?: boolean }
    ): Promise<string> => {
      const res = await fetch(`/api/runs/${runId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(opts?.domains ? { domains: opts.domains } : {}),
        }),
      });
      if (!res.ok) throw new Error(`query failed (${res.status})`);
      const { answer, citedConclusionIds } = await res.json();
      // The Playbook asks in-place (highlight:false); the panel/network query
      // highlights the cited desks and jumps to the network graph.
      if (opts?.highlight !== false) {
        const cited = new Set<string>(citedConclusionIds);
        const blockIds = new Set<string>();
        for (const block of Object.values(state.blocks)) {
          if (block.conclusions.some((c) => cited.has(c.id))) {
            blockIds.add(block.id);
          }
        }
        setHighlightedBlocks(blockIds);
        if (blockIds.size > 0) {
          setActivePanel(null);
          setView("network"); // show the cited path
        }
      }
      return answer;
    },
    [runId, state.blocks]
  );

  const onForkParam = useCallback(
    async (blockId: string, key: string, value: number | string) => {
      const block = state.blocks[blockId];
      if (!block || block.params[key] === value) return;
      if (!window.confirm(`Fork run from "${block.name}" with ${key}=${value}?`))
        return;
      const res = await fetch(`/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          params: { ...block.params, [key]: value },
        }),
      });
      if (res.ok) {
        const { runId: newRunId } = await res.json();
        router.push(`/runs/${newRunId}`);
      }
    },
    [runId, state.blocks, router]
  );

  const onCite = useCallback((blockId: string) => {
    setHighlightedBlocks(new Set([blockId]));
    setActivePanel(null);
    setView("network");
  }, []);

  const onSelectPanel = useCallback(
    (panel: NonNullable<typeof activePanel>) => {
      setActivePanel(panel);
      setView(panel === "conclusion" ? "conclusion" : "domain");
    },
    []
  );

  const selectMainView = useCallback(
    (nextView: "geo" | "network" | "insights" | "playbook" | "owner") => {
      setActivePanel(null);
      setView(nextView);
    },
    []
  );

  const onGenerateReport = useCallback(async () => {
    if (reportBusy) return;
    setReportBusy(true);
    patchState({ phaseLabel: "Writing final business report" });
    try {
      const res = await fetch(`/api/runs/${runId}/report`, { method: "POST" });
      if (!res.ok) throw new Error(`report failed (${res.status})`);
      const data = await res.json();
      patchState({
        finalReport: data.report,
        phaseLabel: "World model ready",
        ...(typeof data.tokensUsed === "number"
          ? { tokensUsed: data.tokensUsed }
          : {}),
        ...(typeof data.costUsd === "number" ? { costUsd: data.costUsd } : {}),
      });
    } finally {
      patchState({ phaseLabel: "World model ready" });
      setReportBusy(false);
    }
  }, [patchState, reportBusy, runId]);

  // --- "Continue run" (resume) ----------------------------------------------
  // A run is resumable if it ended capped/failed, OR it claims to be "running"
  // but hasn't emitted an event in a while (a hang). The Continue button
  // re-runs only the unfinished cohorts — no re-paying for the desks.
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // Stalled = "running" but the LAST EVENT (by its server timestamp) is old.
  // Using the event timestamp — not when the client received it — means a
  // page reload doesn't reset the clock and hide the Continue button.
  const stale =
    now > 0 &&
    state.lastEventTs > 0 &&
    state.status === "running" &&
    now - state.lastEventTs > 90_000;
  const resumable =
    !resuming &&
    !replaying &&
    (state.status === "capped" || state.status === "failed" || stale);
  const cancellable =
    !cancelling &&
    (state.status === "connecting" ||
      state.status === "planning" ||
      state.status === "running");

  const onResume = useCallback(async () => {
    setResuming(true);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      if (res.ok) {
        // Reconnect the SSE stream so live progress shows again.
        window.location.reload();
      } else {
        setResuming(false);
      }
    } catch {
      setResuming(false);
    }
  }, [runId]);

  const onCancel = useCallback(async () => {
    if (!window.confirm("Cancel this run? Work already completed will stay saved."))
      return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) setCancelling(false);
    } catch {
      setCancelling(false);
    }
  }, [runId]);

  const selectedCohort = selectedCohortId
    ? state.cohorts[selectedCohortId]
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2.5">
        <a href="/" className="text-sm font-semibold tracking-tight">
          EntreTangle
        </a>
        <ProjectSelector selectedProjectId={projectId} menuAlign="left" />
        <p
          className="max-w-md flex-1 truncate text-xs text-neutral-500"
          title={brief}
        >
          {brief}
        </p>
        <span className="rounded-full border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
          {replaying ? "Replaying…" : state.phaseLabel}
        </span>
        {siblingRuns.length > 1 && (
          <RunSwitcher runId={runId} siblings={siblingRuns} />
        )}
        <span
          className="flex items-center gap-1 text-[11px] text-neutral-500"
          title="simulated personas"
        >
          <Users className="h-3.5 w-3.5" />
          {personaCount.toLocaleString()}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          <Coins className="h-3.5 w-3.5" />
          {state.tokensUsed.toLocaleString()} tok · $
          {state.costUsd.toFixed(2)}
        </span>
        {(resumable || resuming) && (
          <button
            onClick={onResume}
            disabled={resuming}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            title="Continue this run — re-runs only the unfinished cohorts, reusing the completed desks (no re-paying)"
          >
            {resuming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {resuming ? "Continuing…" : "Continue run"}
          </button>
        )}
        {(cancellable || cancelling || state.status === "cancelling") && (
          <button
            onClick={onCancel}
            disabled={cancelling || state.status === "cancelling"}
            className="flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:border-red-400 disabled:opacity-60"
            title="Cancel this run before the next expensive step starts"
          >
            {cancelling || state.status === "cancelling" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            {cancelling || state.status === "cancelling"
              ? "Cancelling..."
              : "Cancel"}
          </button>
        )}
        <button
          onClick={replay}
          disabled={replaying}
          className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400 disabled:opacity-40"
          title="Replay the run from the event log"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </header>

      {/* Live progress while the simulation is working */}
      {progress.inProgress && (
        <div className="flex items-center gap-3 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2 text-[11px] text-neutral-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
          <span className="font-medium">{state.phaseLabel}</span>
          {progress.desksTotal > 0 && (
            <span className="text-neutral-500">
              desks {progress.desksDone}/{progress.desksTotal}
            </span>
          )}
          {progress.cohortsTotal > 0 && (
            <span className="text-neutral-500">
              cohorts {progress.cohortsDone}/{progress.cohortsTotal}
            </span>
          )}
          <span className="text-neutral-500">
            {personaCount.toLocaleString()} personas
          </span>
          <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-indigo-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.max(4, progress.pct)}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums text-neutral-500">
            {progress.pct}%
          </span>
        </div>
      )}

      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      <PanelStrip
        state={state}
        activePanel={activePanel}
        onSelectPanel={onSelectPanel}
        activeView={
          view === "geo" ||
          view === "network" ||
          view === "insights" ||
          view === "playbook" ||
          view === "owner"
            ? view
            : null
        }
        onSelectMainView={selectMainView}
      />

      <div className="relative flex-1">
        {view === "domain" && activePanel && activePanel !== "conclusion" ? (
          <DomainWorkspace
            domain={activePanel}
            state={state}
            onCite={onCite}
          />
        ) : view === "conclusion" ? (
          <ConclusionWorkspace
            state={state}
            onQuery={onQuery}
            reportBusy={reportBusy}
            onGenerateReport={onGenerateReport}
          />
        ) : view === "geo" ? (
          <MapView
            cohorts={cohorts}
            selectedCohortId={selectedCohortId}
            onSelectCohort={setSelectedCohortId}
          />
        ) : view === "insights" ? (
          <InsightsView
            state={state}
            maxCostUsd={maxCostUsd}
            maxTokens={maxTokens}
            onSelectCohort={setSelectedCohortId}
          />
        ) : view === "playbook" ? (
          <PlaybookView state={state} onQuery={onQuery} />
        ) : view === "owner" ? (
          <OwnerDashboard
            runId={runId}
            projectId={projectId}
            state={state}
          />
        ) : (
          <NetworkView
            state={state}
            highlightedBlocks={highlightedBlocks}
            parentRunId={parentRunId}
            childRunIds={childRunIds}
            onQuery={onQuery}
            onForkParam={onForkParam}
            onSelectCohort={setSelectedCohortId}
          />
        )}

        {selectedCohort && (
          <CohortDrawer
            runId={runId}
            cohort={selectedCohort}
            onClose={() => setSelectedCohortId(null)}
          />
        )}
      </div>
    </div>
  );
}

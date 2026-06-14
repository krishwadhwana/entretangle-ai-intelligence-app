"use client";

import { useEffect, useReducer, useRef, useState, useCallback } from "react";
import type {
  AudienceAggregate,
  Block,
  Cohort,
  Edge,
  FinalReport,
  Persona,
  RunEvent,
  RunStatus,
} from "@/lib/schema";

export type CohortWithPersonas = Cohort & { personas: Persona[] };

// One persisted world-model Q&A, replayed from the event log so the
// Conclusion panel's conversation survives reload.
export type ConversationTurn = {
  seq: number;
  question: string;
  answer: string;
  citedConclusionIds: string[];
  domains: string[];
};

export type CanvasState = {
  status: RunStatus | "connecting";
  phaseLabel: string;
  blocks: Record<string, Block>;
  blockOrder: string[]; // spawn order — stable layout columns
  edges: Edge[];
  cohorts: Record<string, CohortWithPersonas>;
  cohortOrder: string[];
  aggregate: AudienceAggregate | null;
  // wall-clock per desk, derived from event timestamps — fuels the timeline
  blockTimings: Record<string, { start: number; end: number | null }>;
  tokensUsed: number;
  costUsd: number;
  worldModel: { conclusionCount: number; blockCount: number } | null;
  finalReport: FinalReport | null;
  // Persisted world-model Q&A, in ask order.
  conversation: ConversationTurn[];
  error: string | null;
  lastSeq: number;
  // Server-side timestamp of the most recent event — used to detect a stalled
  // run independently of when the client replayed/received it.
  lastEventTs: number;
};

export const initialCanvasState: CanvasState = {
  status: "connecting",
  phaseLabel: "Connecting…",
  blocks: {},
  blockOrder: [],
  edges: [],
  cohorts: {},
  cohortOrder: [],
  aggregate: null,
  blockTimings: {},
  tokensUsed: 0,
  costUsd: 0,
  worldModel: null,
  finalReport: null,
  conversation: [],
  error: null,
  lastSeq: 0,
  lastEventTs: 0,
};

// Pure, idempotent on seq (replay-safe) — the canvas is a function of the
// event log (SPEC invariant §0.4).
export function canvasReducer(
  state: CanvasState,
  event: RunEvent
): CanvasState {
  if (event.seq <= state.lastSeq) return state; // dedupe / replay overlap
  const next = { ...state, lastSeq: event.seq, lastEventTs: event.ts };

  switch (event.type) {
    case "run_status":
      return { ...next, status: event.status, phaseLabel: event.phaseLabel };
    case "block_spawned":
      return {
        ...next,
        blocks: { ...next.blocks, [event.block.id]: event.block },
        blockOrder: next.blockOrder.includes(event.block.id)
          ? next.blockOrder
          : [...next.blockOrder, event.block.id],
      };
    case "block_working": {
      const b = next.blocks[event.blockId];
      if (!b) return next;
      return {
        ...next,
        blocks: { ...next.blocks, [b.id]: { ...b, state: "working" } },
        blockTimings: {
          ...next.blockTimings,
          [b.id]: { start: event.ts, end: null },
        },
      };
    }
    case "block_log": {
      const b = next.blocks[event.blockId];
      if (!b) return next;
      return {
        ...next,
        blocks: {
          ...next.blocks,
          [b.id]: { ...b, logs: [...b.logs, event.line] },
        },
      };
    }
    case "block_concluded": {
      const b = next.blocks[event.blockId];
      if (!b) return next;
      const t = next.blockTimings[b.id];
      return {
        ...next,
        blocks: {
          ...next.blocks,
          [b.id]: { ...b, state: "concluded", conclusions: event.conclusions },
        },
        blockTimings: t
          ? { ...next.blockTimings, [b.id]: { ...t, end: event.ts } }
          : next.blockTimings,
      };
    }
    case "block_failed": {
      const b = next.blocks[event.blockId];
      if (!b) return next;
      const t = next.blockTimings[b.id];
      return {
        ...next,
        blocks: {
          ...next.blocks,
          [b.id]: { ...b, state: "failed", logs: [...b.logs, event.error] },
        },
        blockTimings: t
          ? { ...next.blockTimings, [b.id]: { ...t, end: event.ts } }
          : next.blockTimings,
      };
    }
    case "edge_added":
      return next.edges.some((e) => e.id === event.edge.id)
        ? next
        : { ...next, edges: [...next.edges, event.edge] };
    case "world_model_ready":
      return {
        ...next,
        worldModel: {
          conclusionCount: event.conclusionCount,
          blockCount: event.blockCount,
        },
      };
    case "final_report":
      return { ...next, finalReport: event.report };
    case "tokens_used":
      return { ...next, tokensUsed: event.tokensUsed };
    case "cost_used":
      return { ...next, costUsd: event.costUsd };
    case "cohort_spawned":
      return {
        ...next,
        cohorts: {
          ...next.cohorts,
          [event.cohort.id]: { ...event.cohort, personas: [] },
        },
        cohortOrder: next.cohortOrder.includes(event.cohort.id)
          ? next.cohortOrder
          : [...next.cohortOrder, event.cohort.id],
      };
    case "cohort_simulated": {
      const c = next.cohorts[event.cohortId];
      if (!c) return next;
      return {
        ...next,
        cohorts: {
          ...next.cohorts,
          [c.id]: {
            ...c,
            state: "done",
            stats: event.stats,
            summary: event.summary,
            personas: event.personas,
          },
        },
      };
    }
    case "cohort_failed": {
      const c = next.cohorts[event.cohortId];
      if (!c) return next;
      return {
        ...next,
        cohorts: { ...next.cohorts, [c.id]: { ...c, state: "failed" } },
      };
    }
    case "persona_updated": {
      const c = next.cohorts[event.cohortId];
      if (!c) return next;
      const personas = c.personas.map((p) =>
        p.id === event.personaId
          ? {
              ...p,
              intent: event.intent,
              intentOriginal: event.intentOriginal,
              objection: event.objection,
              voteChangedAt: event.voteChangedAt,
            }
          : p
      );
      // Keep the cohort's cached mean intent consistent with the moved vote so
      // the drawer stat doesn't drift (InsightsView re-derives from personas).
      const stats =
        c.stats && personas.length > 0
          ? {
              ...c.stats,
              meanIntent:
                personas.reduce((sum, p) => sum + p.intent, 0) /
                personas.length,
            }
          : c.stats;
      return {
        ...next,
        cohorts: { ...next.cohorts, [c.id]: { ...c, personas, stats } },
      };
    }
    case "audience_aggregated":
      return { ...next, aggregate: event.aggregate };
    case "conclusion_query":
      return {
        ...next,
        conversation: [
          ...next.conversation,
          {
            seq: event.seq,
            question: event.question,
            answer: event.answer,
            citedConclusionIds: event.citedConclusionIds,
            domains: event.domains,
          },
        ],
      };
    case "run_error":
      return { ...next, error: event.message };
    default:
      return next;
  }
}

type ReducerAction =
  | { kind: "event"; event: RunEvent }
  | { kind: "patch"; patch: Partial<CanvasState> }
  | { kind: "reset" };

function dispatchReducer(
  state: CanvasState,
  action: ReducerAction
): CanvasState {
  if (action.kind === "reset") return initialCanvasState;
  if (action.kind === "patch") return { ...state, ...action.patch };
  return canvasReducer(state, action.event);
}

const EVENT_TYPES = [
  "run_status",
  "block_spawned",
  "block_working",
  "block_log",
  "block_concluded",
  "block_failed",
  "edge_added",
  "world_model_ready",
  "final_report",
  "tokens_used",
  "cost_used",
  "cohort_spawned",
  "cohort_simulated",
  "cohort_failed",
  "audience_aggregated",
  "conclusion_query",
  "run_error",
] as const;

export function useRunEvents(runId: string): {
  state: CanvasState;
  patchState: (patch: Partial<CanvasState>) => void;
  replay: () => void;
  replaying: boolean;
  hydrated: boolean;
} {
  const [state, dispatch] = useReducer(dispatchReducer, initialCanvasState);
  // Every event ever received, in seq order — fuels client-side replay.
  const eventLog = useRef<RunEvent[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    eventLog.current = [];
    setHydrated(false);
    dispatch({ kind: "reset" });
    let source: EventSource | null = null;

    const onEvent = (msg: MessageEvent) => {
      try {
        const event = JSON.parse(msg.data) as RunEvent;
        if (!eventLog.current.some((e) => e.seq === event.seq)) {
          eventLog.current.push(event);
          eventLog.current.sort((a, b) => a.seq - b.seq);
        }
        dispatch({ kind: "event", event });
      } catch {
        // malformed frame — ignore
      }
    };

    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok) {
          const data = (await res.json()) as {
            run: {
              status: RunStatus;
              tokensUsed: number;
              costUsd: number;
            };
            blocks: Block[];
            edges: Edge[];
            cohorts: CohortWithPersonas[];
            aggregate: AudienceAggregate | null;
            finalReport: FinalReport | null;
            phaseLabel: string | null;
            latestEvent: { seq: number; ts: number } | null;
          };
          if (!cancelled) {
            const blocks: Record<string, Block> = {};
            for (const block of data.blocks) blocks[block.id] = block;
            const cohorts: Record<string, CohortWithPersonas> = {};
            for (const cohort of data.cohorts) cohorts[cohort.id] = cohort;
            dispatch({
              kind: "patch",
              patch: {
                status: data.run.status,
                phaseLabel:
                  data.phaseLabel ??
                  (data.run.status === "complete" || data.run.status === "capped"
                    ? "World model ready"
                    : data.run.status === "failed"
                      ? "Run failed"
                      : data.run.status === "cancelled"
                        ? "Run cancelled"
                        : "Loading run…"),
                blocks,
                blockOrder: data.blocks.map((b) => b.id),
                edges: data.edges,
                cohorts,
                cohortOrder: data.cohorts.map((c) => c.id),
                aggregate: data.aggregate,
                tokensUsed: data.run.tokensUsed,
                costUsd: data.run.costUsd,
                worldModel:
                  data.blocks.length > 0
                    ? {
                        blockCount: data.blocks.length,
                        conclusionCount: data.blocks.reduce(
                          (sum, block) => sum + block.conclusions.length,
                          0
                        ),
                      }
                    : null,
                finalReport: data.finalReport,
                lastSeq: data.latestEvent?.seq ?? 0,
                lastEventTs: data.latestEvent?.ts ?? 0,
              },
            });
          }
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
          source = new EventSource(`/api/runs/${runId}/events`);
          // EventSource dispatches by `event:` name, so register every type.
          for (const t of EVENT_TYPES) source.addEventListener(t, onEvent);
        }
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [runId]);

  // Re-reduces the captured event log with original inter-event delays
  // (capped at 1.5s) — pure client-side (SPEC §7 top bar).
  const replay = useCallback(() => {
    const log = eventLog.current;
    if (log.length === 0 || replayTimers.current.length > 0) return;
    setReplaying(true);
    dispatch({ kind: "reset" });
    let at = 0;
    log.forEach((event, i) => {
      if (i > 0) {
        at += Math.min(Math.max(event.ts - log[i - 1].ts, 0), 1500);
      }
      replayTimers.current.push(
        setTimeout(() => {
          dispatch({ kind: "event", event });
          if (i === log.length - 1) {
            replayTimers.current = [];
            setReplaying(false);
          }
        }, at)
      );
    });
  }, []);

  useEffect(() => {
    const timers = replayTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const patchState = useCallback((patch: Partial<CanvasState>) => {
    dispatch({ kind: "patch", patch });
  }, []);

  return { state, patchState, replay, replaying, hydrated };
}

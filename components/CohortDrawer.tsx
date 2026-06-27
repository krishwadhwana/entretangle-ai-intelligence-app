"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { CohortWithPersonas } from "./useRunEvents";
import PersonaInteraction, { type PickablePersona } from "./PersonaInteraction";
import { regionForLocality } from "@/lib/datasources/politicalGeography";
import { SEGMENT_COLORS } from "./segments";
import { ValueTooltip } from "./ValueTooltip";
import type { PersonaConversation } from "@/lib/schema";
import { classifySentiment, isRejector, SENTIMENT_META } from "@/lib/vote";
import { providerErrorMessage } from "@/lib/providerErrors";
import { postSSE } from "@/lib/sseClient";

type Props = {
  runId: string;
  cohort: CohortWithPersonas;
  /** All cohorts in the run — lets Persona Interaction pull in someone from
   *  another region. Falls back to just this cohort when omitted. */
  allCohorts?: CohortWithPersonas[];
  onClose: () => void;
  /** When set, auto-open the chat targeting this persona (win-back deep link). */
  initialChatPersonaId?: string;
};

// Short region label for a cohort (GoI zone), e.g. "West", "South" — used to
// flag cross-region picks in Persona Interaction.
function cohortRegion(c: { locality: string; country: string }): string {
  return regionForLocality(c.locality, c.country)?.zone ?? "Other";
}

type ChatMode = "customer" | "group";
type ChatRole = "founder" | "customer" | "moderator";
type DrawerChatMessage = {
  id: string;
  role: ChatRole;
  speaker: string;
  personaId?: string | null;
  content: string;
  intentAfter?: number | null;
  objection?: string | null;
};

type AudienceChatResponse = {
  messages: Array<Omit<DrawerChatMessage, "id" | "role"> & { role?: ChatRole }>;
  summary?: string;
  nextMove?: string;
};

// A persisted 1:1 win-back turn, as returned by the conversations endpoint.
type SavedWinbackTurn = {
  question: string;
  messages: Array<{
    role?: ChatRole;
    speaker: string;
    personaId?: string | null;
    content: string;
    intentAfter?: number | null;
    objection?: string | null;
  }>;
  intentBefore: number;
  intentAfter: number | null;
  ts: string;
};
type SavedWinbackEntry = {
  personaId: string;
  name: string;
  intent: number;
  intentOriginal: number | null;
  turns: SavedWinbackTurn[];
};

// Flatten a persisted win-back transcript back into renderable chat bubbles so
// a past 1:1 conversation reappears exactly as it was left.
function flattenTurns(entry: SavedWinbackEntry): DrawerChatMessage[] {
  const out: DrawerChatMessage[] = [];
  entry.turns.forEach((turn, ti) => {
    out.push({
      id: `saved-${entry.personaId}-${ti}-q`,
      role: "founder",
      speaker: "You",
      content: turn.question,
    });
    turn.messages.forEach((m, mi) => {
      out.push({
        id: `saved-${entry.personaId}-${ti}-${mi}`,
        role: m.role === "moderator" ? "moderator" : "customer",
        speaker: m.speaker,
        personaId: m.personaId ?? null,
        content: m.content,
        intentAfter: m.intentAfter ?? null,
        objection: m.objection ?? null,
      });
    });
  });
  return out;
}

const DRAWER_DEFAULT_WIDTH = 384;
const DRAWER_MIN_WIDTH = 360;
const DRAWER_MAX_WIDTH = 720;

function drawerBounds() {
  if (typeof window === "undefined") {
    return { min: DRAWER_MIN_WIDTH, max: DRAWER_MAX_WIDTH };
  }
  const max = Math.max(320, Math.min(DRAWER_MAX_WIDTH, window.innerWidth - 32));
  return { min: Math.min(DRAWER_MIN_WIDTH, max), max };
}

function clampDrawerWidth(width: number) {
  const { min, max } = drawerBounds();
  return Math.min(max, Math.max(min, width));
}

function ChatBubble({ message }: { message: DrawerChatMessage }) {
  const founder = message.role === "founder";
  const moderator = message.role === "moderator";
  return (
    <li
      className={`flex ${
        founder ? "justify-end" : moderator ? "justify-center" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[88%] rounded-lg px-2.5 py-2 text-[11px] leading-snug ${
          founder
            ? "bg-neutral-900 text-white"
            : moderator
              ? "border border-neutral-200 bg-neutral-50 text-neutral-600"
              : "border border-indigo-100 bg-indigo-50 text-neutral-700"
        }`}
      >
        <div
          className={`mb-1 flex items-center gap-1 text-[9px] font-semibold ${
            founder
              ? "text-neutral-300"
              : moderator
                ? "text-neutral-500"
                : "text-indigo-500"
          }`}
        >
          <span className="truncate">{message.speaker}</span>
          {typeof message.intentAfter === "number" && (
            <span className="shrink-0 rounded-full bg-white/70 px-1 text-[8px] text-indigo-600">
              intent {Math.round(message.intentAfter * 100)}%
            </span>
          )}
        </div>
        <p>{message.content}</p>
        {message.objection && !founder && (
          <p className="mt-1 text-[9px] text-red-400">
            Objection: {message.objection}
          </p>
        )}
      </div>
    </li>
  );
}

/** 10-bin purchase-intent histogram across this cohort's personas. */
function IntentHistogram({ cohort }: { cohort: CohortWithPersonas }) {
  if (cohort.personas.length === 0) return null;
  const bins = Array.from({ length: 10 }, () => 0);
  for (const p of cohort.personas) bins[Math.min(9, Math.floor(p.intent * 10))]++;
  const max = Math.max(...bins, 1);
  const color = SEGMENT_COLORS[cohort.segment] ?? "#6366f1";
  return (
    <div className="mb-4">
      <p className="mb-1 text-[11px] font-medium text-neutral-500">
        Intent distribution
      </p>
      <div className="flex h-14 items-end gap-0.5">
        {bins.map((n, i) => (
          <ValueTooltip
            key={i}
            content={`Intent ${i * 10}–${i * 10 + 10}%: ${n} ${n === 1 ? "persona" : "personas"}`}
          >
            <div
              className="flex-1 rounded-t"
              style={{
                height: `${(n / max) * 100}%`,
                minHeight: n > 0 ? 2 : 0,
                background: color,
                opacity: 0.35 + (i / 9) * 0.65,
              }}
            />
          </ValueTooltip>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-neutral-400">
        <span>0%</span>
        <span>intent</span>
        <span>100%</span>
      </div>
    </div>
  );
}

/** WTP spread bar: P25–P75 band with a P50 marker. */
function WtpSpread({ cohort }: { cohort: CohortWithPersonas }) {
  const s = cohort.stats;
  if (!s) return null;
  const color = SEGMENT_COLORS[cohort.segment] ?? "#6366f1";
  const cur = s.wtpCurrency;
  // Scale the track to the band with a half-span of padding on each side, so
  // the band sits comfortably inside the bar (no dead space) and every label
  // can be placed at its TRUE position rather than evenly spaced.
  const span = Math.max(s.wtpP75 - s.wtpP25, 1);
  const lo = Math.max(0, s.wtpP25 - span * 0.5);
  const hi = s.wtpP75 + span * 0.5;
  const denom = Math.max(hi - lo, 1);
  const pct = (v: number) =>
    Math.min(100, Math.max(0, ((v - lo) / denom) * 100));
  const p25 = pct(s.wtpP25);
  const p50 = pct(s.wtpP50);
  const p75 = pct(s.wtpP75);
  // Keep the floating median label inside the bar at the extremes.
  const medianLabelLeft = Math.min(86, Math.max(14, p50));
  return (
    <div className="mb-4">
      <p className="mb-1 text-[11px] font-medium text-neutral-500">
        Willingness to pay ({cur})
      </p>
      <ValueTooltip
        content={`Willingness to pay — P25 ${cur} ${s.wtpP25.toLocaleString()} · P50 ${cur} ${s.wtpP50.toLocaleString()} · P75 ${cur} ${s.wtpP75.toLocaleString()}`}
      >
        <div className="relative pt-5">
          {/* Median (P50) value, pinned above its line so it reads at a glance. */}
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-900 px-1 py-px text-[9px] font-semibold text-white"
            style={{ left: `${medianLabelLeft}%` }}
          >
            P50 · {cur} {s.wtpP50.toLocaleString()}
          </span>
          <div className="relative h-4 rounded bg-neutral-100">
            {/* P25–P75 band */}
            <div
              className="absolute inset-y-0 rounded"
              style={{
                left: `${p25}%`,
                width: `${Math.max(2, p75 - p25)}%`,
                background: color,
                opacity: 0.4,
              }}
            />
            {/* P50 median line — taller + full-strength so it stands out. */}
            <div
              className="absolute -top-1 h-6 w-[2px] -translate-x-1/2 rounded"
              style={{ left: `${p50}%`, background: color }}
            />
          </div>
        </div>
      </ValueTooltip>
      {/* P25 / P75 labels anchored under the band's actual ends. */}
      <div className="relative mt-1 h-3 text-[10px] text-neutral-400">
        <span className="absolute" style={{ left: `${p25}%` }}>
          P25 {s.wtpP25.toLocaleString()}
        </span>
        <span className="absolute -translate-x-full" style={{ left: `${p75}%` }}>
          P75 {s.wtpP75.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/** Right-side drawer: cohort stats + individual persona cards (SPEC-V2 §5). */
export default function CohortDrawer({
  runId,
  cohort,
  allCohorts,
  onClose,
  initialChatPersonaId,
}: Props) {
  // Every persona in the run, tagged with its cohort/region — the pool Persona
  // Interaction draws from so you can stage a cross-region discussion. The
  // current cohort's people are listed first.
  const interactionPool = useMemo<PickablePersona[]>(() => {
    const cohorts = allCohorts?.length ? allCohorts : [cohort];
    const ordered = [cohort, ...cohorts.filter((c) => c.id !== cohort.id)];
    const out: PickablePersona[] = [];
    for (const c of ordered) {
      const region = cohortRegion(c);
      for (const p of c.personas) {
        out.push({
          id: p.id,
          name: p.name,
          occupation: p.occupation,
          personality: p.personality,
          intent: p.intent,
          cohortLabel: c.label,
          region,
          segment: c.segment,
        });
      }
    }
    return out;
  }, [allCohorts, cohort]);
  const [shown, setShown] = useState(12);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DRAWER_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem("cohortDrawerWidth"));
    return clampDrawerWidth(
      Number.isFinite(saved) && saved > 0 ? saved : DRAWER_DEFAULT_WIDTH
    );
  });
  const resizing = useRef(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("customer");
  const [selectedPersonaId, setSelectedPersonaId] = useState(
    cohort.personas[0]?.id ?? ""
  );
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<DrawerChatMessage[]>([]);
  const [chatSummary, setChatSummary] = useState<{
    summary: string;
    nextMove: string;
  } | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  // Live reply prose while a 1:1 customer chat streams in (null = not streaming).
  const [chatStreaming, setChatStreaming] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  // Which panel the chat region shows: 1:1/group "chat" or two-persona "interaction".
  const [panel, setPanel] = useState<"chat" | "interaction">("chat");
  // Persisted conversations (so they don't disappear) — loaded when the panel opens.
  const [savedWinback, setSavedWinback] = useState<SavedWinbackEntry[]>([]);
  const [interactionConvos, setInteractionConvos] = useState<
    PersonaConversation[]
  >([]);
  // A saved interaction the user chose to resume (key forces a fresh mount).
  const [resumeConvo, setResumeConvo] = useState<PersonaConversation | null>(
    null
  );
  // Persona pre-selected as side A when launching an interaction from a card.
  const [pendingInteractionAId, setPendingInteractionAId] = useState<
    string | null
  >(null);
  const s = cohort.stats;
  const selectedPersona = useMemo(
    () =>
      cohort.personas.find((p) => p.id === selectedPersonaId) ??
      cohort.personas[0] ??
      null,
    [cohort.personas, selectedPersonaId]
  );

  // Load the cohort's persisted conversations (win-back transcripts + saved
  // two-persona interactions) so they survive drawer close / reload.
  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/runs/${runId}/conversations?cohortId=${cohort.id}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        winback: SavedWinbackEntry[];
        interactions: PersonaConversation[];
      };
      setSavedWinback(data.winback ?? []);
      setInteractionConvos(data.interactions ?? []);
      // If the open 1:1 chat has no live messages yet, replay saved history.
      const entry = (data.winback ?? []).find(
        (w) => w.personaId === selectedPersonaId
      );
      if (entry) {
        setChatMessages((cur) => (cur.length === 0 ? flattenTurns(entry) : cur));
      }
    } catch {
      // Non-fatal — the panel still works for new conversations.
    }
  }, [runId, cohort.id, selectedPersonaId]);

  useEffect(() => {
    if (chatOpen) void loadSaved();
  }, [chatOpen, loadSaved]);

  useEffect(() => {
    setShown(12);
    setChatOpen(false);
    setChatMode("customer");
    setPanel("chat");
    setSelectedPersonaId(cohort.personas[0]?.id ?? "");
    setChatQuestion("");
    setChatMessages([]);
    setChatSummary(null);
    setChatError(null);
    setSavedWinback([]);
    setInteractionConvos([]);
    setResumeConvo(null);
  }, [cohort.id]);

  useEffect(() => {
    if (!selectedPersonaId && cohort.personas[0]) {
      setSelectedPersonaId(cohort.personas[0].id);
    }
  }, [cohort.personas, selectedPersonaId]);

  // Win-back deep link: open the chat focused on a specific persona (e.g. from
  // the Insights "Win back rejectors" panel). Runs after the cohort-reset
  // effect above so it wins on first open.
  useEffect(() => {
    if (!initialChatPersonaId) return;
    if (!cohort.personas.some((p) => p.id === initialChatPersonaId)) return;
    setChatOpen(true);
    setPanel("chat");
    setChatMode("customer");
    selectWinbackPersona(initialChatPersonaId);
    setChatError(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohort.id, initialChatPersonaId, cohort.personas]);

  // Switch the 1:1 chat to a persona and replay their saved transcript (so a
  // past win-back conversation reappears instead of starting blank).
  const selectWinbackPersona = useCallback(
    (personaId: string) => {
      setSelectedPersonaId(personaId);
      const entry = savedWinback.find((w) => w.personaId === personaId);
      setChatMessages(entry ? flattenTurns(entry) : []);
      setChatSummary(null);
    },
    [savedWinback]
  );

  const startWinBack = (personaId: string) => {
    setChatOpen(true);
    setPanel("chat");
    setChatMode("customer");
    selectWinbackPersona(personaId);
    setChatError(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Launch a fresh two-persona discussion seeded with this persona as side A.
  const startInteraction = (personaId: string) => {
    setResumeConvo(null);
    setPendingInteractionAId(personaId);
    setPanel("interaction");
    setChatOpen(true);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!resizing.current) return;
      setWidth(clampDrawerWidth(window.innerWidth - event.clientX));
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((current) => {
        const next = clampDrawerWidth(current);
        window.localStorage.setItem("cohortDrawerWidth", String(next));
        return next;
      });
    };
    const onResize = () => setWidth((current) => clampDrawerWidth(current));
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const startResize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const sendChat = async () => {
    const question = chatQuestion.trim();
    if (!question || chatLoading || cohort.personas.length === 0) return;

    const founderMessage: DrawerChatMessage = {
      id: `founder-${Date.now()}`,
      role: "founder",
      speaker: "You",
      content: question,
    };
    const history = chatMessages.slice(-12).map((m) => ({
      role: m.role,
      speaker: m.speaker,
      content: m.content,
    }));

    setChatMessages((messages) => [...messages, founderMessage]);
    setChatQuestion("");
    setChatError(null);
    setChatLoading(true);
    // Customer (1:1) chats go to the win-back endpoint, which persists any vote
    // change and emits an event; group chats stay on the audience route.
    const customer = chatMode === "customer" && selectedPersona;
    try {
      let result: AudienceChatResponse;
      if (customer) {
        // 1:1 reply streams token-by-token for immediate feedback.
        setChatStreaming("");
        result = await postSSE<AudienceChatResponse>(
          `/api/runs/${runId}/persona/${selectedPersona.id}/chat?stream=1`,
          { question, history },
          (text) => setChatStreaming(text)
        );
      } else {
        const res = await fetch(`/api/runs/${runId}/audience-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: chatMode,
            cohortId: cohort.id,
            personaId: null,
            question,
            history,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            providerErrorMessage(data.error ?? data, `chat failed (${res.status})`)
          );
        }
        result = data as AudienceChatResponse;
      }
      const received = result.messages.map((message, index) => ({
        id: `audience-${Date.now()}-${index}`,
        role:
          message.role === "moderator" || message.role === "customer"
            ? message.role
            : "customer",
        speaker: message.speaker,
        personaId: message.personaId,
        content: message.content,
        intentAfter: message.intentAfter,
        objection: message.objection,
      }));
      setChatMessages((messages) => [...messages, ...received]);
      setChatSummary({
        summary: result.summary ?? "",
        nextMove: result.nextMove ?? "",
      });
    } catch (e) {
      setChatError(providerErrorMessage(e, "chat failed"));
    } finally {
      setChatStreaming(null);
      setChatLoading(false);
    }
  };

  return (
    <aside
      className="absolute right-0 top-0 z-[1000] flex h-full max-w-[calc(100vw-2rem)] flex-col border-l border-neutral-200 bg-white shadow-xl max-sm:inset-0 max-sm:!w-full max-sm:!max-w-none max-sm:border-l-0"
      style={{ width }}
    >
      <button
        type="button"
        onMouseDown={startResize}
        className="absolute -left-3 top-0 flex h-full w-5 cursor-col-resize items-center justify-center text-neutral-300 hover:text-neutral-500 max-sm:hidden"
        title="Resize drawer"
        aria-label="Resize persona drawer"
      >
        <span className="rounded-full border border-neutral-200 bg-white py-2 shadow-sm">
          <GripVertical className="h-4 w-4" />
        </span>
      </button>
      <header className="flex items-start gap-2 border-b border-neutral-200 p-4">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ background: SEGMENT_COLORS[cohort.segment] }}
        />
        <div className="flex-1">
          <h3 className="text-base font-semibold leading-tight">{cohort.label}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {cohort.locality}, {cohort.country} · {cohort.weightPct}% of
            audience · {cohort.state}
          </p>
        </div>
        <button
          onClick={() => {
            setPanel("chat");
            setChatOpen((open) => (panel === "chat" ? !open : true));
          }}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${
            chatOpen && panel === "chat"
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-neutral-200 text-neutral-500 hover:border-indigo-300 hover:text-indigo-600"
          }`}
          title="Chat with this audience"
        >
          <MessageCircle className="h-3.5 w-3.5" /> Chat
        </button>
        <button
          onClick={() => {
            setResumeConvo(null);
            setPanel("interaction");
            setChatOpen((open) => (panel === "interaction" ? !open : true));
          }}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${
            chatOpen && panel === "interaction"
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-neutral-200 text-neutral-500 hover:border-indigo-300 hover:text-indigo-600"
          }`}
          title="Have two personas discuss a topic"
        >
          <Sparkles className="h-3.5 w-3.5" /> Interact
        </button>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {cohort.summary && (
          <p className="mb-3 rounded-lg bg-neutral-50 p-2.5 text-xs leading-relaxed text-neutral-600">
            {cohort.summary}
          </p>
        )}

        {chatOpen && panel === "interaction" && (
          <PersonaInteraction
            key={resumeConvo?.id ?? `new-${pendingInteractionAId ?? ""}`}
            runId={runId}
            personas={interactionPool}
            initialConvo={resumeConvo}
            initialAId={pendingInteractionAId ?? undefined}
          />
        )}

        {chatOpen && panel === "interaction" && interactionConvos.length > 0 && (
          <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3">
            <p className="mb-1.5 text-[10px] font-semibold text-neutral-500">
              Saved discussions
            </p>
            <div className="space-y-1.5">
              {interactionConvos.map((c) => {
                const names = c.participantIds
                  .map(
                    (id) =>
                      interactionPool.find((p) => p.id === id)?.name ?? "Persona"
                  )
                  .join(" · ");
                return (
                  <details
                    key={c.id}
                    className="group rounded-md border border-neutral-200 open:border-indigo-200"
                  >
                    <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] text-neutral-600 marker:text-neutral-400">
                      <span className="font-medium text-neutral-700">{names}</span>
                      {c.topic ? ` · ${c.topic}` : ""}
                      <span className="text-neutral-400">
                        {" "}
                        · {c.messages.length} msgs
                        {c.conclusion ? " · concluded" : ""}
                      </span>
                    </summary>
                    <div className="space-y-1.5 border-t border-neutral-100 px-2 py-2">
                      {c.messages.length === 0 ? (
                        <p className="text-[10px] text-neutral-400">
                          No messages yet.
                        </p>
                      ) : (
                        c.messages.map((m, i) => (
                          <div key={i} className="text-[10px] leading-snug">
                            <span
                              className={`font-semibold ${
                                m.role === "founder"
                                  ? "text-amber-600"
                                  : "text-indigo-600"
                              }`}
                            >
                              {m.speaker}:
                            </span>{" "}
                            <span className="text-neutral-600">{m.content}</span>
                          </div>
                        ))
                      )}
                      {c.conclusion && (
                        <p className="rounded bg-indigo-50 px-2 py-1 text-[10px] leading-snug text-indigo-700">
                          <span className="font-semibold">Conclusion: </span>
                          {c.conclusion}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setResumeConvo(c)}
                        className="mt-1 rounded-md border border-indigo-200 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
                      >
                        Resume this discussion
                      </button>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {chatOpen && panel === "chat" && (
          <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-medium text-neutral-500">
                Chat
                <select
                  value={chatMode}
                  onChange={(event) => {
                    setChatMode(event.target.value as ChatMode);
                    setChatError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
                >
                  <option value="customer">Customer</option>
                  <option value="group">Customer group</option>
                </select>
              </label>
              <label className="text-[10px] font-medium text-neutral-500">
                Target
                <select
                  value={chatMode === "group" ? "group" : selectedPersonaId}
                  onChange={(event) => selectWinbackPersona(event.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
                >
                  {chatMode === "group" ? (
                    <option value="group">
                      {cohort.label} ({cohort.personas.length})
                    </option>
                  ) : cohort.personas.length === 0 ? (
                    <option value="">No personas yet</option>
                  ) : (
                    cohort.personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {Math.round(p.intent * 100)}%
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            {chatMode === "customer" && savedWinback.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[10px] font-medium text-neutral-400">
                  Saved win-back conversations
                </p>
                {savedWinback.map((w) => {
                  const msgCount = w.turns.reduce(
                    (n, t) => n + 1 + t.messages.length,
                    0
                  );
                  return (
                    <details
                      key={w.personaId}
                      className="rounded-md border border-neutral-200 open:border-indigo-200"
                    >
                      <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] text-neutral-600 marker:text-neutral-400">
                        <span className="font-medium text-neutral-700">
                          {w.name}
                        </span>
                        <span className="text-neutral-400">
                          {" "}
                          · {w.turns.length} exchange
                          {w.turns.length === 1 ? "" : "s"} · now{" "}
                          {Math.round(w.intent * 100)}% intent
                        </span>
                      </summary>
                      <div className="border-t border-neutral-100 px-2 py-2">
                        <ul className="space-y-2">
                          {flattenTurns(w).map((message) => (
                            <ChatBubble key={message.id} message={message} />
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => selectWinbackPersona(w.personaId)}
                          className="mt-2 rounded-md border border-indigo-200 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
                        >
                          Continue this chat
                        </button>
                        <span className="ml-1 text-[9px] text-neutral-400">
                          ({msgCount} messages)
                        </span>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-neutral-100 bg-neutral-50 p-2">
              {chatMessages.length === 0 ? (
                <p className="py-5 text-center text-[11px] text-neutral-400">
                  No messages yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {chatMessages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                </ul>
              )}
              {chatStreaming !== null && chatStreaming !== "" && (
                <div className="mt-2 flex justify-start">
                  <div className="max-w-[90%] rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-2 text-[11px] leading-snug text-neutral-700">
                    {chatStreaming}
                    <span className="ml-0.5 inline-block animate-pulse">▍</span>
                  </div>
                </div>
              )}
              {chatLoading && (chatStreaming === null || chatStreaming === "") && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-indigo-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Simulating response…
                </div>
              )}
            </div>

            {chatSummary && (chatSummary.summary || chatSummary.nextMove) && (
              <div className="mt-2 rounded-lg bg-indigo-50 px-2.5 py-2 text-[10px] leading-snug text-indigo-700">
                {chatSummary.summary && <p>{chatSummary.summary}</p>}
                {chatSummary.nextMove && (
                  <p className="mt-1 font-medium">Next: {chatSummary.nextMove}</p>
                )}
              </div>
            )}

            {chatError && (
              <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">
                {chatError}
              </p>
            )}

            <div className="mt-2 flex gap-2">
              <textarea
                value={chatQuestion}
                onChange={(event) => setChatQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChat();
                  }
                }}
                rows={2}
                placeholder="Question or USP"
                className="min-h-10 flex-1 resize-none rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] leading-snug text-neutral-700 outline-none focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={() => void sendChat()}
                disabled={
                  chatLoading ||
                  !chatQuestion.trim() ||
                  cohort.personas.length === 0
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                title="Send"
                aria-label="Send chat message"
              >
                {chatLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </section>
        )}

        {s && (
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-neutral-200 p-2.5">
              <p className="text-lg font-semibold">{s.n}</p>
              <p className="text-[11px] text-neutral-500">personas</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-2.5">
              <p className="text-lg font-semibold">
                {Math.round(s.meanIntent * 100)}%
              </p>
              <p className="text-[11px] text-neutral-500">mean intent</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-2.5">
              <p className="text-lg font-semibold">
                {s.wtpP50 >= 1000
                  ? `${Math.round(s.wtpP50 / 1000)}k`
                  : s.wtpP50}
              </p>
              <p className="text-[11px] text-neutral-500">
                WTP P50 ({s.wtpCurrency})
              </p>
            </div>
          </div>
        )}

        <IntentHistogram cohort={cohort} />
        <WtpSpread cohort={cohort} />

        {s && (
          <div className="mb-4 space-y-2.5 text-xs">
            <div>
              <p className="font-semibold text-neutral-700">Channels</p>
              <p className="mt-0.5 leading-relaxed text-neutral-500">
                {s.topChannels.map((c) => `${c.name} ${c.share}%`).join(" · ")}
              </p>
            </div>
            <div>
              <p className="font-semibold text-neutral-700">Platforms</p>
              <p className="mt-0.5 leading-relaxed text-neutral-500">
                {s.topPlatforms.length
                  ? s.topPlatforms.map((p) => `${p.name} ${p.share}%`).join(" · ")
                  : "mostly offline"}
              </p>
            </div>
            <div>
              <p className="font-semibold text-neutral-700">Objections</p>
              <ul className="mt-0.5 list-inside list-disc leading-relaxed text-neutral-500">
                {s.topObjections.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
          <Users className="h-4 w-4" /> Personas
        </p>
        {cohort.personas.length === 0 ? (
          <p className="text-xs text-neutral-400">
            {cohort.state === "done" ? "No personas." : "Simulating…"}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {cohort.personas.slice(0, shown).map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-neutral-200 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {p.name}{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      {p.age} · {p.occupation}
                      {p.lifeStage ? ` · ${p.lifeStage}` : ""}
                    </span>
                  </p>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="flex items-center gap-1">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        style={{
                          background:
                            SENTIMENT_META[classifySentiment(p.intent)].color,
                        }}
                      >
                        {SENTIMENT_META[classifySentiment(p.intent)].label}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${p.intent >= 0.4 ? "text-emerald-600" : p.intent >= 0.2 ? "text-amber-600" : "text-neutral-400"}`}
                      >
                        {Math.round(p.intent * 100)}%
                      </span>
                    </span>
                    {typeof p.intentOriginal === "number" &&
                      p.intentOriginal !== p.intent && (
                        <span className="text-[9px] text-neutral-400">
                          was {Math.round(p.intentOriginal * 100)}%
                        </span>
                      )}
                  </div>
                </div>

                {p.personality && (
                  <p className="mt-1.5 text-[11px] leading-snug text-indigo-500">
                    ✦ {p.personality}
                  </p>
                )}

                {p.personalityTraits.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.personalityTraits.map((t, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {p.lifestyle && (
                  <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
                    {p.lifestyle}
                  </p>
                )}

                <p className="mt-1.5 text-xs italic leading-relaxed text-neutral-600">
                  “{p.quote}”
                </p>

                {p.reasoning && (
                  <p className="mt-1.5 rounded bg-neutral-50 px-2 py-1.5 text-[11px] leading-snug text-neutral-600">
                    <span className="font-semibold text-neutral-500">Why: </span>
                    {p.reasoning}
                  </p>
                )}

                {p.values.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.values.map((v, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-500"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
                  WTP {p.wtpCurrency} {p.wtp.toLocaleString()}
                  {" · "}
                  {Math.round(p.priceSensitivity * 100)}% price-sensitive · buys
                  via {p.channelPref} ·{" "}
                  {p.platforms.length ? p.platforms.join(", ") : "offline"}
                </p>
                {p.shoppingHabits && (
                  <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                    🛒 {p.shoppingHabits}
                  </p>
                )}
                <p className="mt-1 text-[11px] leading-snug text-red-400">
                  ⚠ {p.objection}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => startWinBack(p.id)}
                    className="flex items-center gap-1 rounded-lg border border-indigo-200 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
                    title={`Chat 1:1 with ${p.name}`}
                  >
                    <MessageCircle className="h-3 w-3" />
                    {isRejector(p.intent) ? "Win back" : "Chat"}
                  </button>
                  {cohort.personas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => startInteraction(p.id)}
                      className="flex items-center gap-1 rounded-lg border border-indigo-200 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
                      title={`Have ${p.name} discuss with other personas`}
                    >
                      <Sparkles className="h-3 w-3" /> Persona interaction
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {shown < cohort.personas.length && (
          <button
            onClick={() => setShown((n) => n + 12)}
            className="mt-2.5 w-full rounded-lg border border-neutral-200 py-2 text-xs text-neutral-500 hover:border-neutral-400"
          >
            Show more ({cohort.personas.length - shown} remaining)
          </button>
        )}
      </div>
    </aside>
  );
}

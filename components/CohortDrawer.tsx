"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Loader2, MessageCircle, Send, Users, X } from "lucide-react";
import type { CohortWithPersonas } from "./useRunEvents";
import { SEGMENT_COLORS } from "./segments";

type Props = {
  runId: string;
  cohort: CohortWithPersonas;
  onClose: () => void;
};

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
      <p className="mb-1 text-[10px] font-medium text-neutral-500">
        Intent distribution
      </p>
      <div className="flex h-12 items-end gap-0.5">
        {bins.map((n, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{
              height: `${(n / max) * 100}%`,
              minHeight: n > 0 ? 2 : 0,
              background: color,
              opacity: 0.35 + (i / 9) * 0.65,
            }}
            title={`${i * 10}–${i * 10 + 10}%: ${n} personas`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-neutral-400">
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
  const max = Math.max(s.wtpP75 * 1.15, 1);
  const color = SEGMENT_COLORS[cohort.segment] ?? "#6366f1";
  return (
    <div className="mb-4">
      <p className="mb-1 text-[10px] font-medium text-neutral-500">
        Willingness to pay ({s.wtpCurrency})
      </p>
      <div className="relative h-4 rounded bg-neutral-100">
        <div
          className="absolute h-4 rounded opacity-40"
          style={{
            left: `${(s.wtpP25 / max) * 100}%`,
            width: `${Math.max(1, ((s.wtpP75 - s.wtpP25) / max) * 100)}%`,
            background: color,
          }}
        />
        <div
          className="absolute top-0 h-4 w-1 rounded"
          style={{ left: `${(s.wtpP50 / max) * 100}%`, background: color }}
        />
      </div>
      <div className="flex justify-between text-[8px] text-neutral-400">
        <span>P25 {s.wtpP25.toLocaleString()}</span>
        <span>P50 {s.wtpP50.toLocaleString()}</span>
        <span>P75 {s.wtpP75.toLocaleString()}</span>
      </div>
    </div>
  );
}

/** Right-side drawer: cohort stats + individual persona cards (SPEC-V2 §5). */
export default function CohortDrawer({ runId, cohort, onClose }: Props) {
  const [shown, setShown] = useState(12);
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
  const [chatError, setChatError] = useState<string | null>(null);
  const s = cohort.stats;
  const selectedPersona = useMemo(
    () =>
      cohort.personas.find((p) => p.id === selectedPersonaId) ??
      cohort.personas[0] ??
      null,
    [cohort.personas, selectedPersonaId]
  );

  useEffect(() => {
    setShown(12);
    setChatOpen(false);
    setChatMode("customer");
    setSelectedPersonaId(cohort.personas[0]?.id ?? "");
    setChatQuestion("");
    setChatMessages([]);
    setChatSummary(null);
    setChatError(null);
  }, [cohort.id]);

  useEffect(() => {
    if (!selectedPersonaId && cohort.personas[0]) {
      setSelectedPersonaId(cohort.personas[0].id);
    }
  }, [cohort.personas, selectedPersonaId]);

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
    try {
      const res = await fetch(`/api/runs/${runId}/audience-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: chatMode,
          cohortId: cohort.id,
          personaId: chatMode === "customer" ? selectedPersona?.id : null,
          question,
          history,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `chat failed (${res.status})`);
      const result = data as AudienceChatResponse;
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
      setChatError(e instanceof Error ? e.message : "chat failed");
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <aside
      className="absolute right-0 top-0 z-[1000] flex h-full max-w-[calc(100vw-2rem)] flex-col border-l border-neutral-200 bg-white shadow-xl"
      style={{ width }}
    >
      <button
        type="button"
        onMouseDown={startResize}
        className="absolute -left-3 top-0 flex h-full w-5 cursor-col-resize items-center justify-center text-neutral-300 hover:text-neutral-500"
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
          <h3 className="text-sm font-semibold leading-tight">{cohort.label}</h3>
          <p className="text-[11px] text-neutral-500">
            {cohort.locality}, {cohort.country} · {cohort.weightPct}% of
            audience · {cohort.state}
          </p>
        </div>
        <button
          onClick={() => setChatOpen((open) => !open)}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${
            chatOpen
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-neutral-200 text-neutral-500 hover:border-indigo-300 hover:text-indigo-600"
          }`}
          title="Chat with this audience"
        >
          <MessageCircle className="h-3.5 w-3.5" /> Chat
        </button>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {cohort.summary && (
          <p className="mb-3 rounded-lg bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-600">
            {cohort.summary}
          </p>
        )}

        {chatOpen && (
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
                  onChange={(event) => setSelectedPersonaId(event.target.value)}
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
              {chatLoading && (
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
            <div className="rounded-lg border border-neutral-200 p-2">
              <p className="text-sm font-semibold">{s.n}</p>
              <p className="text-[9px] text-neutral-500">personas</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-2">
              <p className="text-sm font-semibold">
                {Math.round(s.meanIntent * 100)}%
              </p>
              <p className="text-[9px] text-neutral-500">mean intent</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-2">
              <p className="text-sm font-semibold">
                {s.wtpP50 >= 1000
                  ? `${Math.round(s.wtpP50 / 1000)}k`
                  : s.wtpP50}
              </p>
              <p className="text-[9px] text-neutral-500">
                WTP P50 ({s.wtpCurrency})
              </p>
            </div>
          </div>
        )}

        <IntentHistogram cohort={cohort} />
        <WtpSpread cohort={cohort} />

        {s && (
          <div className="mb-4 space-y-2 text-[11px]">
            <div>
              <p className="font-medium text-neutral-700">Channels</p>
              <p className="text-neutral-500">
                {s.topChannels.map((c) => `${c.name} ${c.share}%`).join(" · ")}
              </p>
            </div>
            <div>
              <p className="font-medium text-neutral-700">Platforms</p>
              <p className="text-neutral-500">
                {s.topPlatforms.length
                  ? s.topPlatforms.map((p) => `${p.name} ${p.share}%`).join(" · ")
                  : "mostly offline"}
              </p>
            </div>
            <div>
              <p className="font-medium text-neutral-700">Objections</p>
              <ul className="list-inside list-disc text-neutral-500">
                {s.topObjections.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-neutral-700">
          <Users className="h-3.5 w-3.5" /> Personas
        </p>
        {cohort.personas.length === 0 ? (
          <p className="text-[11px] text-neutral-400">
            {cohort.state === "done" ? "No personas." : "Simulating…"}
          </p>
        ) : (
          <ul className="space-y-2">
            {cohort.personas.slice(0, shown).map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-neutral-100 p-2.5"
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-[11px] font-semibold">
                    {p.name}{" "}
                    <span className="font-normal text-neutral-400">
                      {p.age} · {p.occupation}
                      {p.lifeStage ? ` · ${p.lifeStage}` : ""}
                    </span>
                  </p>
                  <span
                    className={`text-[10px] font-medium ${p.intent >= 0.4 ? "text-emerald-600" : p.intent >= 0.2 ? "text-amber-600" : "text-neutral-400"}`}
                  >
                    intent {Math.round(p.intent * 100)}%
                  </span>
                </div>

                {p.personality && (
                  <p className="mt-1 text-[9px] leading-snug text-indigo-500">
                    ✦ {p.personality}
                  </p>
                )}

                {p.personalityTraits.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.personalityTraits.map((t, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[8px] text-indigo-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {p.lifestyle && (
                  <p className="mt-1 text-[9px] leading-snug text-neutral-500">
                    {p.lifestyle}
                  </p>
                )}

                <p className="mt-1 text-[10px] italic leading-snug text-neutral-600">
                  “{p.quote}”
                </p>

                {p.reasoning && (
                  <p className="mt-1 rounded bg-neutral-50 px-1.5 py-1 text-[9px] leading-snug text-neutral-600">
                    <span className="font-medium text-neutral-500">Why: </span>
                    {p.reasoning}
                  </p>
                )}

                {p.values.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.values.map((v, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-neutral-200 bg-white px-1.5 py-0.5 text-[8px] text-neutral-500"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-1 text-[9px] text-neutral-400">
                  WTP {p.wtpCurrency} {p.wtp.toLocaleString()}
                  {" · "}
                  {Math.round(p.priceSensitivity * 100)}% price-sensitive · buys
                  via {p.channelPref} ·{" "}
                  {p.platforms.length ? p.platforms.join(", ") : "offline"}
                </p>
                {p.shoppingHabits && (
                  <p className="text-[9px] text-neutral-400">
                    🛒 {p.shoppingHabits}
                  </p>
                )}
                <p className="text-[9px] text-red-400">⚠ {p.objection}</p>
              </li>
            ))}
          </ul>
        )}
        {shown < cohort.personas.length && (
          <button
            onClick={() => setShown((n) => n + 12)}
            className="mt-2 w-full rounded-lg border border-neutral-200 py-1.5 text-[11px] text-neutral-500 hover:border-neutral-400"
          >
            Show more ({cohort.personas.length - shown} remaining)
          </button>
        )}
      </div>
    </aside>
  );
}

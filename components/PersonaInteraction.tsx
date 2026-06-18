"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles, Flag } from "lucide-react";
import type { CohortWithPersonas } from "./useRunEvents";
import type { PersonaConversation } from "@/lib/schema";

type Loading = "start" | "A" | "B" | "inject" | "conclude" | null;

/**
 * Persona Interaction: two simulated personas discuss a topic. The user drives
 * each turn by clicking "Generate reply from <name>" (one LLM call per click,
 * so the discussion can't run away on cost), can inject knowledge both personas
 * then see, and can wrap the thread into a conclusion. The conversation is
 * persisted server-side, so it survives drawer close / reload.
 */
export default function PersonaInteraction({
  runId,
  personas,
  initialConvo = null,
  initialAId,
}: {
  runId: string;
  personas: CohortWithPersonas["personas"];
  initialConvo?: PersonaConversation | null;
  initialAId?: string;
}) {
  const defaultA = initialConvo?.personaAId ?? initialAId ?? personas[0]?.id ?? "";
  const [aId, setAId] = useState(defaultA);
  const [bId, setBId] = useState(
    initialConvo?.personaBId ??
      personas.find((p) => p.id !== defaultA)?.id ??
      personas[0]?.id ??
      ""
  );
  const [topic, setTopic] = useState(initialConvo?.topic ?? "");
  const [convo, setConvo] = useState<PersonaConversation | null>(initialConvo);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const nameOf = (id: string) =>
    personas.find((p) => p.id === id)?.name ?? "Persona";
  const aName = convo ? nameOf(convo.personaAId) : nameOf(aId);
  const bName = convo ? nameOf(convo.personaBId) : nameOf(bId);

  const post = async (payload: Record<string, unknown>, kind: Loading) => {
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/persona-interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `failed (${res.status})`);
      setConvo(data as PersonaConversation);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      return false;
    } finally {
      setLoading(null);
    }
  };

  const start = () => {
    if (!aId || !bId || aId === bId) {
      setError("Pick two different personas.");
      return;
    }
    void post({ action: "start", personaAId: aId, personaBId: bId, topic }, "start");
  };

  const reply = (speaker: "A" | "B") =>
    convo && void post({ action: "reply", conversationId: convo.id, speaker }, speaker);

  const inject = () => {
    const n = note.trim();
    if (!n || !convo) return;
    void post({ action: "inject", conversationId: convo.id, note: n }, "inject").then(
      (ok) => ok && setNote("")
    );
  };

  const conclude = () =>
    convo && void post({ action: "conclude", conversationId: convo.id }, "conclude");

  const busy = loading !== null;

  // --- Setup (no conversation yet) ------------------------------------------
  if (!convo) {
    return (
      <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
        <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" /> Persona interaction
        </p>
        <p className="mb-2 text-[10px] leading-snug text-neutral-500">
          Have two personas discuss a topic. You generate each reply turn-by-turn,
          can add knowledge mid-conversation, and wrap it up into a conclusion.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["A", "B"] as const).map((slot) => (
            <label key={slot} className="text-[10px] font-medium text-neutral-500">
              Persona {slot}
              <select
                value={slot === "A" ? aId : bId}
                onChange={(e) =>
                  slot === "A" ? setAId(e.target.value) : setBId(e.target.value)
                }
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {Math.round(p.intent * 100)}%
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional) — e.g. is the price worth it?"
          className="mt-2 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
        />
        {error && (
          <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={start}
          disabled={busy || personas.length < 2}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-indigo-600 py-2 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {loading === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {personas.length < 2 ? "Need 2+ personas" : "Start discussion"}
        </button>
      </section>
    );
  }

  // --- Active conversation --------------------------------------------------
  return (
    <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
        <Sparkles className="h-3.5 w-3.5" /> {aName} ↔ {bName}
      </p>
      {convo.topic && (
        <p className="mb-2 text-[10px] text-neutral-500">Topic: {convo.topic}</p>
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-100 bg-neutral-50 p-2">
        {convo.messages.length === 0 ? (
          <p className="py-5 text-center text-[11px] text-neutral-400">
            No messages yet — generate the first reply below.
          </p>
        ) : (
          <ul className="space-y-2">
            {convo.messages.map((m, i) => {
              const founder = m.role === "founder";
              const isA = m.role === "personaA";
              return (
                <li
                  key={i}
                  className={`flex ${founder ? "justify-center" : isA ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-lg px-2.5 py-2 text-[11px] leading-snug ${
                      founder
                        ? "border border-amber-200 bg-amber-50 text-amber-700"
                        : isA
                          ? "border border-indigo-100 bg-indigo-50 text-neutral-700"
                          : "border border-emerald-100 bg-emerald-50 text-neutral-700"
                    }`}
                  >
                    <div className="mb-0.5 flex items-center gap-1 text-[9px] font-semibold text-neutral-500">
                      <span className="truncate">{m.speaker}</span>
                      {typeof m.intentAfter === "number" && (
                        <span className="shrink-0 rounded-full bg-white/70 px-1 text-[8px] text-indigo-600">
                          intent {Math.round(m.intentAfter * 100)}%
                        </span>
                      )}
                    </div>
                    <p>{m.content}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {busy && loading !== "inject" && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-indigo-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Generating…
          </div>
        )}
      </div>

      {convo.conclusion && (
        <div className="mt-2 rounded-lg bg-indigo-50 px-2.5 py-2 text-[10px] leading-snug text-indigo-700">
          <p className="mb-0.5 font-semibold">Conclusion</p>
          <p>{convo.conclusion}</p>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">
          {error}
        </p>
      )}

      {/* Turn controls — one LLM call per click keeps cost bounded. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => reply("A")}
          disabled={busy}
          className="flex items-center justify-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
        >
          {loading === "A" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
          Reply from {aName}
        </button>
        <button
          type="button"
          onClick={() => reply("B")}
          disabled={busy}
          className="flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
        >
          {loading === "B" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
          Reply from {bName}
        </button>
      </div>

      {/* Founder knowledge injection — both personas see it on their next turn. */}
      <div className="mt-2 flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              inject();
            }
          }}
          placeholder="Add knowledge both personas will see…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
        />
        <button
          type="button"
          onClick={inject}
          disabled={busy || !note.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-40"
          title="Inject knowledge for both personas"
          aria-label="Inject knowledge"
        >
          {loading === "inject" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={conclude}
        disabled={busy || convo.messages.length === 0}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-neutral-300 py-1.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
      >
        {loading === "conclude" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Flag className="h-3.5 w-3.5" />
        )}
        {convo.conclusion ? "Re-conclude" : "Conclude discussion"}
      </button>
    </section>
  );
}

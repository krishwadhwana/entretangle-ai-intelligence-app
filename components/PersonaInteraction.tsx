"use client";

import { useMemo, useState } from "react";
import { Loader2, Send, Sparkles, Flag, Plus, Search, X, MapPin } from "lucide-react";
import type { PersonaConversation } from "@/lib/schema";
import { classifySentiment, SENTIMENT_META } from "@/lib/vote";
import { providerErrorMessage } from "@/lib/providerErrors";
import { postSSE } from "@/lib/sseClient";

// A persona the picker can choose — carries its cohort context (label, region,
// segment) so you can pull someone in from another ring of the country.
export type PickablePersona = {
  id: string;
  name: string;
  occupation: string;
  personality: string;
  intent: number;
  cohortLabel: string;
  region: string;
  segment: string;
};

type Loading = "start" | "inject" | "conclude" | string | null;
type SentimentFilter = "all" | "approve" | "mixed" | "reject";

const MIN = 2;
const MAX = 4;

// Per-participant colour, by their index in the discussion.
const PALETTE = [
  { dot: "#6366f1", bubble: "border-indigo-100 bg-indigo-50", btn: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100" },
  { dot: "#10b981", bubble: "border-emerald-100 bg-emerald-50", btn: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
  { dot: "#f59e0b", bubble: "border-amber-100 bg-amber-50", btn: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" },
  { dot: "#0ea5e9", bubble: "border-sky-100 bg-sky-50", btn: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100" },
];

/**
 * Persona Interaction: 2-4 simulated personas discuss a topic. The user drives
 * each turn by clicking "Reply from <name>" (one LLM call per click, so it
 * can't run away on cost), can inject knowledge everyone then sees, and can wrap
 * the thread into a conclusion. Persisted server-side, so it survives reload.
 */
export default function PersonaInteraction({
  runId,
  personas,
  initialConvo = null,
  initialAId,
}: {
  runId: string;
  personas: PickablePersona[];
  initialConvo?: PersonaConversation | null;
  initialAId?: string;
}) {
  const seed =
    initialConvo?.participantIds ??
    (initialAId
      ? [initialAId]
      : personas[0]
        ? [personas[0].id]
        : []);
  const [selected, setSelected] = useState<string[]>(seed);
  const [topic, setTopic] = useState(initialConvo?.topic ?? "");
  const [convo, setConvo] = useState<PersonaConversation | null>(initialConvo);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Live reply prose while a turn streams in (cleared once the turn lands).
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SentimentFilter>("all");
  const [region, setRegion] = useState<string>("all");

  const byId = useMemo(
    () => new Map(personas.map((p) => [p.id, p])),
    [personas]
  );
  const nameOf = (id: string) => byId.get(id)?.name ?? "Persona";
  const regionOf = (id: string) => byId.get(id)?.region ?? "";

  // Regions present across the run — drives the "another ring of the country"
  // filter so you can deliberately pull in someone from elsewhere.
  const regions = useMemo(
    () => Array.from(new Set(personas.map((p) => p.region).filter(Boolean))).sort(),
    [personas]
  );

  // The add-persona picker: not-yet-selected personas matching search + filters.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return personas.filter((p) => {
      if (selected.includes(p.id)) return false;
      if (filter !== "all" && classifySentiment(p.intent) !== filter) return false;
      if (region !== "all" && p.region !== region) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.occupation.toLowerCase().includes(q) ||
        p.cohortLabel.toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q) ||
        (p.personality ?? "").toLowerCase().includes(q)
      );
    });
  }, [personas, selected, query, filter, region]);

  // How many distinct regions are in the current discussion — surfaced as a
  // "cross-region" hint so the multi-ring nature is obvious.
  const selectedRegions = useMemo(
    () => Array.from(new Set(selected.map(regionOf).filter(Boolean))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, personas]
  );

  const post = async (payload: Record<string, unknown>, kind: Loading) => {
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/persona-interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data.error ?? data, `failed (${res.status})`)
        );
      }
      setConvo(data as PersonaConversation);
      return true;
    } catch (e) {
      setError(providerErrorMessage(e, "request failed"));
      return false;
    } finally {
      setLoading(null);
    }
  };

  const addPersona = (id: string) =>
    setSelected((cur) => (cur.length >= MAX || cur.includes(id) ? cur : [...cur, id]));
  const removePersona = (id: string) =>
    setSelected((cur) => cur.filter((x) => x !== id));

  const start = () => {
    if (selected.length < MIN) {
      setError(`Add at least ${MIN} personas.`);
      return;
    }
    void post({ action: "start", participantIds: selected, topic }, "start");
  };
  // Reply streams: tokens render live in a transient bubble, then the saved
  // conversation replaces it. Falls back cleanly if streaming errors out.
  const reply = (personaId: string) => {
    if (!convo) return;
    setLoading(personaId);
    setError(null);
    setStreamingText("");
    void postSSE<PersonaConversation>(
      `/api/runs/${runId}/persona-interaction?stream=1`,
      { action: "reply", conversationId: convo.id, personaId },
      (text) => setStreamingText(text)
    )
      .then((data) => setConvo(data))
      .catch((e) => setError(providerErrorMessage(e, "request failed")))
      .finally(() => {
        setStreamingText(null);
        setLoading(null);
      });
  };
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

  // ===== Setup (no conversation yet) =======================================
  if (!convo) {
    return (
      <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
        <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" /> Persona interaction
        </p>
        <p className="mb-2 text-[10px] leading-snug text-neutral-500">
          Pick {MIN}–{MAX} personas — from this cohort or any other region — to
          discuss a topic. You generate each reply turn-by-turn, can add knowledge
          mid-conversation, and wrap it up into a conclusion.
        </p>

        {/* Selected participants */}
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-neutral-500">
          In this discussion ({selected.length}/{MAX})
          {selectedRegions.length > 1 && (
            <span className="flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-px text-[9px] font-semibold text-indigo-600">
              <MapPin className="h-2.5 w-2.5" /> cross-region ·{" "}
              {selectedRegions.join(", ")}
            </span>
          )}
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {selected.length === 0 && (
            <span className="text-[10px] text-neutral-400">None yet — add below.</span>
          )}
          {selected.map((id, i) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
              style={{ borderColor: PALETTE[i % PALETTE.length].dot, color: "#404040" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: PALETTE[i % PALETTE.length].dot }}
              />
              {nameOf(id)}
              {regionOf(id) && (
                <span className="text-neutral-400">· {regionOf(id)}</span>
              )}
              <button
                type="button"
                onClick={() => removePersona(id)}
                className="text-neutral-400 hover:text-neutral-700"
                aria-label={`Remove ${nameOf(id)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Searchable / filterable add-persona picker */}
        {selected.length < MAX && (
          <div className="mb-2 rounded-lg border border-neutral-200 p-2">
            <div className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search any region by name, job, place…"
                className="min-w-0 flex-1 text-[11px] text-neutral-700 outline-none placeholder:text-neutral-400"
              />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {regions.length > 1 && (
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-600 outline-none"
                  title="Filter personas by region of the country"
                >
                  <option value="all">All regions</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as SentimentFilter)}
                className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-600 outline-none"
              >
                <option value="all">All sentiment</option>
                <option value="approve">Approve</option>
                <option value="mixed">Mixed</option>
                <option value="reject">Reject</option>
              </select>
            </div>
            <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
              {candidates.length === 0 ? (
                <p className="py-2 text-center text-[10px] text-neutral-400">
                  No matching personas.
                </p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addPersona(p.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[10px] text-neutral-600 hover:bg-indigo-50"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-neutral-700">{p.name}</span>{" "}
                      · {p.occupation}
                      <span className="text-neutral-400">
                        {" "}
                        · {p.region || p.cohortLabel}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className="rounded-full px-1 py-px text-[8px] font-semibold text-white"
                        style={{
                          background: SENTIMENT_META[classifySentiment(p.intent)].color,
                        }}
                      >
                        {Math.round(p.intent * 100)}%
                      </span>
                      <Plus className="h-3 w-3 text-indigo-500" />
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional) — e.g. is the price worth it?"
          className="mb-2 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
        />
        {error && (
          <p className="mb-2 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={start}
          disabled={busy || selected.length < MIN}
          className="flex w-full items-center justify-center gap-1 rounded-lg bg-indigo-600 py-2 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {loading === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {selected.length < MIN
            ? `Add ${MIN - selected.length} more`
            : `Start discussion (${selected.length})`}
        </button>
      </section>
    );
  }

  // ===== Active conversation ===============================================
  const participants = convo.participantIds;
  const colorIndex = (personaId: string | null) =>
    personaId ? Math.max(0, participants.indexOf(personaId)) : 0;

  return (
    <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
        <Sparkles className="h-3.5 w-3.5" />
        {participants.map(nameOf).join(" · ")}
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
              const tone = PALETTE[colorIndex(m.personaId) % PALETTE.length];
              return (
                <li key={i} className={`flex ${founder ? "justify-center" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-lg border px-2.5 py-2 text-[11px] leading-snug ${
                      founder
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : `${tone.bubble} text-neutral-700`
                    }`}
                  >
                    <div className="mb-0.5 flex items-center gap-1 text-[9px] font-semibold text-neutral-500">
                      {!founder && (
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: tone.dot }}
                        />
                      )}
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
        {streamingText !== null && (
          <div className="mt-2 flex justify-start">
            <div className="max-w-[90%] rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-2 text-[11px] leading-snug text-neutral-700">
              {streamingText ? (
                <p>
                  {streamingText}
                  <span className="ml-0.5 inline-block animate-pulse">▍</span>
                </p>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-indigo-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </span>
              )}
            </div>
          </div>
        )}
        {busy && streamingText === null && loading !== "inject" && (
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
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {participants.map((id, i) => {
          const tone = PALETTE[i % PALETTE.length];
          return (
            <button
              key={id}
              type="button"
              onClick={() => reply(id)}
              disabled={busy}
              className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium disabled:opacity-40 ${tone.btn}`}
            >
              {loading === id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Reply from {nameOf(id)}
            </button>
          );
        })}
      </div>

      {/* Founder knowledge injection — everyone sees it on their next turn. */}
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
          placeholder="Add knowledge everyone will see…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] text-neutral-700 outline-none focus:border-indigo-400"
        />
        <button
          type="button"
          onClick={inject}
          disabled={busy || !note.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-40"
          title="Inject knowledge for all personas"
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

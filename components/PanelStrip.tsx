"use client";

import { useMemo, useState } from "react";
import {
  Star,
  CornerDownLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
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
    <div className="flex w-80 shrink-0 flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <StateDot state={block.state} />
        <span
          className="flex-1 truncate text-xs font-semibold"
          title={block.mission}
        >
          {block.name}
        </span>
        {webGrounded && (
          <Globe className="h-3 w-3 text-indigo-400" aria-label="web-grounded" />
        )}
        <div className="flex gap-1 text-[10px]">
          <button
            onClick={() => setTab("conclusions")}
            className={`rounded px-1.5 py-0.5 ${tab === "conclusions" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            Findings
          </button>
          <button
            onClick={() => setTab("discussion")}
            className={`rounded px-1.5 py-0.5 ${tab === "discussion" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            Discussion
          </button>
        </div>
      </div>
      <div className="max-h-44 flex-1 overflow-y-auto px-3 py-2">
        {tab === "discussion" ? (
          block.logs.length ? (
            <ul className="space-y-1">
              {block.logs.map((l, i) => (
                <li key={i} className="font-mono text-[10px] text-neutral-500">
                  › {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-neutral-400">No activity yet.</p>
          )
        ) : block.conclusions.length ? (
          <ul className="space-y-2">
            {block.conclusions.map((c) => (
              <li
                key={c.id}
                className="cursor-pointer rounded-lg border border-neutral-100 p-2 hover:border-indigo-300"
                onClick={() => onCite(block.id)}
              >
                <p className="text-[11px] font-medium leading-snug">{c.claim}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
                  {c.value}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded-full bg-neutral-100 px-1.5 text-[9px] text-neutral-500">
                    conf {Math.round(c.confidence * 100)}%
                  </span>
                  {c.entities.slice(0, 3).map((e) => (
                    <span
                      key={e}
                      className="rounded-full bg-indigo-50 px-1.5 text-[9px] text-indigo-500"
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.sources.map((s, i) =>
                    s.startsWith("http") ? (
                      <a
                        key={i}
                        href={s}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="truncate text-[9px] text-indigo-600 underline"
                        style={{ maxWidth: 120 }}
                      >
                        {new URL(s).hostname}
                      </a>
                    ) : (
                      <span key={i} className="text-[9px] text-neutral-400">
                        {s}
                      </span>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-400">
            {block.state === "failed" ? "Desk failed." : "Working…"}
          </p>
        )}
      </div>
    </div>
  );
}

function ConclusionPanel({
  state,
  onQuery,
}: {
  state: CanvasState;
  onQuery: (q: string) => Promise<string>;
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
      setPending((p) => [...p, { question: q, answer: "Query failed — try again." }]);
    } finally {
      setBusy(false);
    }
  }

  const agg = state.aggregate;
  return (
    <div className="flex w-full gap-4">
      <div className="w-64 shrink-0 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
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
            platform: {agg.platformShare[0]?.name} (
            {agg.platformShare[0]?.share}%).
          </p>
        )}
      </div>
      <div className="flex-1">
        <form onSubmit={ask} className="flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              ready
                ? "Ask the world model — e.g. why that channel first? what price in Dubai?"
                : "Available when the run converges…"
            }
            disabled={!ready || busy}
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
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
          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {[...history, ...pending].map((t, i) => (
              <div
                key={"seq" in t ? `h${t.seq}` : `p${i}`}
                className="rounded-lg border border-neutral-200 bg-white p-2"
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
    </div>
  );
}

type Props = {
  state: CanvasState;
  onQuery: (q: string) => Promise<string>;
  onCite: (blockId: string) => void;
};

/**
 * Top panel strip (SPEC-V2 §5): one panel per domain → subpanels per desk
 * showing what they discussed + their conclusions; plus the ★ Conclusion
 * panel (world-model summary + query).
 */
export default function PanelStrip({ state, onQuery, onCite }: Props) {
  const [open, setOpen] = useState<Domain | "conclusion" | null>(null);

  const byDomain = useMemo(() => {
    const m = new Map<Domain, Block[]>();
    for (const id of state.blockOrder) {
      const b = state.blocks[id];
      if (!b) continue;
      m.set(b.domain, [...(m.get(b.domain) ?? []), b]);
    }
    return m;
  }, [state.blocks, state.blockOrder]);

  return (
    <div className="border-b border-neutral-200 bg-neutral-50/60">
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-2">
        {DOMAIN_ORDER.filter((d) => byDomain.has(d)).map((d) => {
          const meta = DOMAIN_META[d];
          const blocks = byDomain.get(d)!;
          const done = blocks.filter((b) => b.state === "concluded").length;
          const Icon = meta.icon;
          const active = open === d;
          return (
            <button
              key={d}
              onClick={() => setOpen(active ? null : d)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
              <span
                className={`rounded-full px-1.5 text-[9px] ${active ? "bg-white/20" : "bg-neutral-100 text-neutral-500"}`}
              >
                {done}/{blocks.length}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setOpen(open === "conclusion" ? null : "conclusion")}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
            open === "conclusion"
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
          }`}
        >
          <Star className="h-3.5 w-3.5" />
          Conclusion
        </button>
      </div>

      {open && (
        <div className="border-t border-neutral-200 px-4 py-3">
          {open === "conclusion" ? (
            <ConclusionPanel state={state} onQuery={onQuery} />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {(byDomain.get(open) ?? []).map((b) => (
                <DeskSubpanel key={b.id} block={b} onCite={onCite} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

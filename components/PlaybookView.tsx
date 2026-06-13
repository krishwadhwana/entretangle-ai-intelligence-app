"use client";

import { useMemo, useState } from "react";
import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import type { Block, Conclusion, Domain } from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { DOMAIN_META, PLAYBOOK_ORDER } from "./domains";
import { DOMAIN_COLORS } from "./segments";

// What each business module answers — shown as the section subtitle so a
// founder can "walk through each module of the business".
const MODULE_BLURB: Record<Domain, string> = {
  synthesis: "Cross-cutting action plans — start here for what to actually do.",
  market: "Demand, market size and how to position the brand.",
  product: "What to make: materials, range architecture, quality bar.",
  competitor: "Who you're up against and how they won or failed.",
  supply: "How it gets made: factories, MOQ, sampling, lead times.",
  operations: "Inventory, fulfilment, returns/RTO and quality control.",
  channel: "Where you sell: retail, marketplaces, D2C, institutional.",
  pricing: "Landed cost build-up and price positioning.",
  finance: "Unit economics, margins, working capital and funding fit.",
  regulation: "Trade law, duties, labelling and certifications.",
  social: "Where the audience lives and how to reach them.",
  audience: "What the simulated buyers actually say.",
};

type QueryFn = (
  q: string,
  opts?: { domains?: string[]; highlight?: boolean }
) => Promise<string>;

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`confidence ${Math.round(value * 100)}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-neutral-200">
        <span
          className="block h-full rounded-full bg-neutral-700"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="text-[9px] text-neutral-400">{Math.round(value * 100)}%</span>
    </span>
  );
}

function ConclusionCard({ c }: { c: Conclusion }) {
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-[12px] font-semibold leading-snug text-neutral-900">
        {c.claim}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">{c.value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ConfidenceBar value={c.confidence} />
        {c.entities.slice(0, 4).map((e) => (
          <span
            key={e}
            className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-500"
          >
            {e}
          </span>
        ))}
      </div>
      {c.sources.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {c.sources.map((s, i) =>
            s.startsWith("http") ? (
              <a
                key={i}
                href={s}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[9px] text-indigo-600 underline"
                style={{ maxWidth: 160 }}
              >
                {(() => {
                  try {
                    return new URL(s).hostname;
                  } catch {
                    return s;
                  }
                })()}
              </a>
            ) : (
              <span key={i} className="text-[9px] text-neutral-400">
                {s}
              </span>
            )
          )}
        </div>
      )}
    </li>
  );
}

function ModuleSection({
  domain,
  blocks,
  onQuery,
  ready,
}: {
  domain: Domain;
  blocks: Block[];
  onQuery: QueryFn;
  ready: boolean;
}) {
  const meta = DOMAIN_META[domain];
  const Icon = meta.icon;
  const color = DOMAIN_COLORS[domain] ?? "#6366f1";
  const conclusions = blocks.flatMap((b) => b.conclusions);
  const done = blocks.filter((b) => b.state === "concluded").length;

  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await onQuery(q.trim(), { domains: [domain], highlight: false }));
    } catch {
      setAnswer("Query failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-4">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ background: color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">{meta.label}</h3>
            <span className="rounded-full bg-neutral-200/70 px-1.5 py-0.5 text-[9px] font-medium text-neutral-600">
              {conclusions.length} findings · {done}/{blocks.length} desks
            </span>
          </div>
          <p className="text-[11px] text-neutral-500">{MODULE_BLURB[domain]}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {conclusions.length > 0 ? (
          conclusions.map((c) => <ConclusionCard key={c.id} c={c} />)
        ) : (
          <li className="rounded-lg border border-dashed border-neutral-200 p-3 text-[11px] text-neutral-400">
            {blocks.some((b) => b.state === "failed")
              ? "These desks failed to conclude."
              : "Researching… findings will appear here."}
          </li>
        )}
      </ul>

      <form onSubmit={ask} className="mt-3 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            ready
              ? `Ask about ${meta.label.toLowerCase()}…`
              : "Ask when the run converges…"
          }
          disabled={!ready || busy}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[11px] outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!ready || busy || !q.trim()}
          className="rounded-lg border border-neutral-300 bg-white p-1.5 text-neutral-500 hover:border-indigo-400 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </form>
      {answer && (
        <p className="mt-2 rounded-lg border border-neutral-200 bg-white p-2.5 text-[11px] leading-relaxed text-neutral-700">
          {answer}
        </p>
      )}
    </section>
  );
}

/**
 * The Playbook (SPEC-V2 §5, expanded): the converged world model presented as
 * a walkable section per business module — every module shows its decision-
 * ready findings AND a query box scoped to just that module, so a founder can
 * go function-by-function and ask the AI about each. Action plans (synthesis)
 * come first. A global ask box queries the whole world model.
 */
export default function PlaybookView({
  state,
  onQuery,
}: {
  state: CanvasState;
  onQuery: QueryFn;
}) {
  const ready = state.status === "complete" || state.status === "capped";

  const byDomain = useMemo(() => {
    const m = new Map<Domain, Block[]>();
    for (const id of state.blockOrder) {
      const b = state.blocks[id];
      if (!b) continue;
      m.set(b.domain, [...(m.get(b.domain) ?? []), b]);
    }
    return m;
  }, [state.blocks, state.blockOrder]);

  const orderedDomains = PLAYBOOK_ORDER.filter((d) => byDomain.has(d));

  const [gq, setGq] = useState("");
  const [gAnswer, setGAnswer] = useState<string | null>(null);
  const [gBusy, setGBusy] = useState(false);

  async function askGlobal(e: React.FormEvent) {
    e.preventDefault();
    if (!gq.trim() || gBusy) return;
    setGBusy(true);
    setGAnswer(null);
    try {
      setGAnswer(await onQuery(gq.trim(), { highlight: false }));
    } catch {
      setGAnswer("Query failed — try again.");
    } finally {
      setGBusy(false);
    }
  }

  const totalConclusions = orderedDomains.reduce(
    (s, d) => s + (byDomain.get(d) ?? []).flatMap((b) => b.conclusions).length,
    0
  );

  return (
    <div className="absolute inset-0 overflow-y-auto bg-white px-5 pb-10 pt-16">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Business Playbook
          </h2>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Every part of the business, with decision-ready findings and an AI you
          can question per module. {totalConclusions} findings across{" "}
          {orderedDomains.length} modules
          {!ready && " · still researching, updating live"}.
        </p>

        <form
          onSubmit={askGlobal}
          className="mt-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-2"
        >
          <input
            value={gq}
            onChange={(e) => setGq(e.target.value)}
            placeholder={
              ready
                ? "Ask anything across the whole business — e.g. what MOQ can I afford, where do I manufacture?"
                : "Available when the run converges…"
            }
            disabled={!ready || gBusy}
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!ready || gBusy || !gq.trim()}
            className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {gBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </form>
        {gAnswer && (
          <p className="mt-2 rounded-lg border border-neutral-200 bg-white p-3 text-[12px] leading-relaxed text-neutral-700">
            {gAnswer}
          </p>
        )}

        <div className="mt-5 space-y-4">
          {orderedDomains.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-xs text-neutral-400">
              Desks are spinning up — modules will appear here as they report.
            </p>
          ) : (
            orderedDomains.map((d) => (
              <ModuleSection
                key={d}
                domain={d}
                blocks={byDomain.get(d) ?? []}
                onQuery={onQuery}
                ready={ready}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

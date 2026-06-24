"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CornerDownLeft,
  Loader2,
  Sparkles,
  Wand2,
  FileDown,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type {
  Block,
  Conclusion,
  Domain,
  GeneratedPlaybook,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { DOMAIN_META, PLAYBOOK_ORDER } from "./domains";
import { DOMAIN_COLORS } from "./segments";
import GlossaryText from "./GlossaryText";
import { ValueTooltip } from "./ValueTooltip";
import { providerErrorMessage } from "@/lib/providerErrors";

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

// Playbook generation is a single web-grounded request that can take ~60s.
// Cache the result AND the in-flight promise at MODULE scope (keyed by runId) so
// switching dashboard tabs — which unmounts this view — doesn't abandon the work:
// the request keeps running and the spinner + result reattach when you return.
const pbResult = new Map<string, GeneratedPlaybook>();
const pbInFlight = new Map<string, Promise<GeneratedPlaybook>>();

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`confidence ${Math.round(value * 100)}%`}>
      <ValueTooltip content={`Confidence: ${Math.round(value * 100)}%`}>
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-neutral-200">
          <span
            className="block h-full rounded-full bg-neutral-700"
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        </span>
      </ValueTooltip>
      <span className="text-[9px] text-neutral-400">{Math.round(value * 100)}%</span>
    </span>
  );
}

function ConclusionCard({ c }: { c: Conclusion }) {
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-[12px] font-semibold leading-snug text-neutral-900">
        <GlossaryText>{c.claim}</GlossaryText>
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        <GlossaryText>{c.value}</GlossaryText>
      </p>
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
  wide = false,
}: {
  domain: Domain;
  blocks: Block[];
  onQuery: QueryFn;
  ready: boolean;
  wide?: boolean;
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
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : "Query failed - try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="h-fit rounded-2xl border border-neutral-200 bg-neutral-50/40 p-4">
      <div className="flex items-start gap-2.5">
        <ValueTooltip content={`Module: ${meta.label}`}>
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: color }}
          >
            <Icon className="h-4 w-4" />
          </span>
        </ValueTooltip>
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

      <ul
        className={
          wide
            ? "mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2"
            : "mt-3 space-y-2"
        }
      >
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
          <GlossaryText>{answer}</GlossaryText>
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
  runId,
  brief,
}: {
  state: CanvasState;
  onQuery: QueryFn;
  runId: string;
  brief: string;
}) {
  const ready = state.status === "complete" || state.status === "capped";

  // Deep playbook: an LLM-enriched, web-grounded deepening of the world model
  // (expanded taxes & competitors), regenerable independently of the simulation.
  const [generated, setGenerated] = useState<GeneratedPlaybook | null>(
    () => pbResult.get(runId) ?? null
  );
  // Initialise "busy" from the module cache so returning to the tab mid-run
  // immediately shows the spinner again.
  const [genBusy, setGenBusy] = useState(() => pbInFlight.has(runId));
  const [genError, setGenError] = useState<string | null>(null);

  // On mount / runId change: reattach to any in-flight generation, surface a
  // cached result, or fetch the persisted one.
  useEffect(() => {
    let alive = true;
    const cached = pbResult.get(runId);
    if (cached) setGenerated(cached);
    const inflight = pbInFlight.get(runId);
    if (inflight) {
      setGenBusy(true);
      inflight
        .then((p) => alive && setGenerated(p))
        .catch(
          (e) =>
            alive &&
            setGenError(providerErrorMessage(e, "playbook generation failed"))
        )
        .finally(() => alive && setGenBusy(false));
    } else if (!cached) {
      fetch(`/api/runs/${runId}/playbook`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d?.playbook) {
            pbResult.set(runId, d.playbook);
            setGenerated(d.playbook as GeneratedPlaybook);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [runId]);

  const generate = useCallback(async () => {
    if (pbInFlight.has(runId)) return; // already running (possibly from another tab)
    setGenError(null);
    setGenBusy(true);
    // The promise lives in the module map, NOT in the component — so it survives
    // this view unmounting when the founder switches tabs.
    const promise = (async () => {
      const res = await fetch(`/api/runs/${runId}/playbook`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          providerErrorMessage(data?.error ?? data, `failed (${res.status})`)
        );
      return data.playbook as GeneratedPlaybook;
    })();
    pbInFlight.set(runId, promise);
    try {
      const result = await promise;
      pbResult.set(runId, result);
      setGenerated(result);
    } catch (e) {
      setGenError(providerErrorMessage(e, "playbook generation failed"));
    } finally {
      pbInFlight.delete(runId);
      setGenBusy(false);
    }
  }, [runId]);

  const downloadPlaybookDossier = useCallback(async () => {
    if (!generated) return;
    const [{ buildPlaybookDossier }, { downloadDossier, slug }] =
      await Promise.all([import("./runDossier"), import("./pdf")]);
    const title = `${brief.slice(0, 70)} — Playbook`;
    const dossier = buildPlaybookDossier({
      title,
      generated,
      generatedOn: new Date().toLocaleDateString(),
    });
    downloadDossier(dossier, `${slug(title)}-playbook`);
  }, [generated, brief]);

  const byDomain = useMemo(() => {
    const m = new Map<Domain, Block[]>();
    for (const id of state.blockOrder) {
      const b = state.blocks[id];
      if (!b) continue;
      m.set(b.domain, [...(m.get(b.domain) ?? []), b]);
    }
    return m;
  }, [state.blocks, state.blockOrder]);

  const orderedDomains = useMemo(
    () => PLAYBOOK_ORDER.filter((d) => byDomain.has(d)),
    [byDomain]
  );
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);

  const [gq, setGq] = useState("");
  const [gAnswer, setGAnswer] = useState<string | null>(null);
  const [gBusy, setGBusy] = useState(false);

  useEffect(() => {
    if (orderedDomains.length === 0) {
      setSelectedDomain(null);
      return;
    }
    setSelectedDomain((current) =>
      current && orderedDomains.includes(current) ? current : orderedDomains[0]
    );
  }, [orderedDomains]);

  async function askGlobal(e: React.FormEvent) {
    e.preventDefault();
    if (!gq.trim() || gBusy) return;
    setGBusy(true);
    setGAnswer(null);
    try {
      setGAnswer(await onQuery(gq.trim(), { highlight: false }));
    } catch (e) {
      setGAnswer(e instanceof Error ? e.message : "Query failed - try again.");
    } finally {
      setGBusy(false);
    }
  }

  const totalConclusions = orderedDomains.reduce(
    (s, d) => s + (byDomain.get(d) ?? []).flatMap((b) => b.conclusions).length,
    0
  );
  const selectedIndex = selectedDomain
    ? orderedDomains.indexOf(selectedDomain)
    : -1;
  const selectedBlocks = selectedDomain ? byDomain.get(selectedDomain) ?? [] : [];

  function moveSelected(delta: number) {
    if (selectedIndex < 0 || orderedDomains.length === 0) return;
    const next =
      (selectedIndex + delta + orderedDomains.length) % orderedDomains.length;
    setSelectedDomain(orderedDomains[next]);
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-white px-5 pb-10 pt-10">
      <div className="mx-auto max-w-7xl">
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
            <GlossaryText>{gAnswer}</GlossaryText>
          </p>
        )}

        {/* Deep playbook — LLM-enriched, web-grounded, regenerable */}
        <div className="mt-5 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                <Wand2 className="h-4 w-4 text-indigo-600" /> Deep playbook
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                A web-grounded deepening of the world model — expanded taxes &amp;
                duties, named competitors and more, each with sources. Regenerate
                anytime; the simulation isn&apos;t re-run.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {generated && (
                <button
                  onClick={() => void downloadPlaybookDossier()}
                  className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 hover:border-indigo-500 hover:text-indigo-700"
                  title="Download a hyperlinked PDF dossier of the playbook"
                >
                  <FileDown className="h-3.5 w-3.5" /> Dossier
                </button>
              )}
              <button
                onClick={() => void generate()}
                disabled={!ready || genBusy}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                title={
                  ready
                    ? "Generate a richer, web-sourced playbook"
                    : "Available once the run converges"
                }
              >
                {genBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : generated ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {generated ? "Regenerate" : "Generate richer playbook"}
              </button>
            </div>
          </div>
          {genError && (
            <p className="mt-2 text-[11px] text-red-600">{genError}</p>
          )}
          {generated?.generatedAt && (
            <p className="mt-1 text-[10px] text-neutral-400">
              Generated {new Date(generated.generatedAt).toLocaleString()}
            </p>
          )}
          {genBusy && !generated && (
            <p className="mt-3 flex items-center gap-2 text-[11px] text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Researching taxes,
              duties &amp; named competitors via web search… (~30–60s)
            </p>
          )}
          {generated && generated.modules.length > 0 && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {generated.modules.map((m, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-neutral-200 bg-white p-3"
                >
                  <h4 className="text-[12px] font-semibold text-neutral-900">
                    {m.module}
                  </h4>
                  {m.summary && (
                    <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
                      {m.summary}
                    </p>
                  )}
                  <ul className="mt-2 space-y-2">
                    {m.entries.map((e, j) => (
                      <li key={j} className="text-[11px] leading-snug">
                        <p className="font-medium text-neutral-800">{e.point}</p>
                        {e.detail && (
                          <p className="mt-0.5 text-neutral-600">{e.detail}</p>
                        )}
                        {e.source && /^https?:\/\//.test(e.source) && (
                          <a
                            href={e.source}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-indigo-600 underline"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            {(() => {
                              try {
                                return new URL(e.source).hostname.replace(
                                  /^www\./,
                                  ""
                                );
                              } catch {
                                return "source";
                              }
                            })()}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {orderedDomains.length > 0 && (
          <div className="sticky top-0 z-10 mt-5 border-y border-neutral-200 bg-white/95 py-2 backdrop-blur">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              <button
                type="button"
                onClick={() => moveSelected(-1)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:border-neutral-400"
              >
                Prev
              </button>
              <div className="min-w-0 overflow-hidden">
                <div className="flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain">
                  {orderedDomains.map((d) => {
                    const meta = DOMAIN_META[d];
                    const blocks = byDomain.get(d) ?? [];
                    const count = blocks.flatMap((b) => b.conclusions).length;
                    const active = selectedDomain === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSelectedDomain(d)}
                        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${
                          active
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                        }`}
                      >
                        {meta.label}
                        <span
                          className={`rounded-full px-1.5 text-[9px] ${
                            active
                              ? "bg-white/20 text-white"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => moveSelected(1)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:border-neutral-400"
              >
                Next
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          {orderedDomains.length === 0 || !selectedDomain ? (
            <p className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-xs text-neutral-400 xl:col-span-2">
              Desks are spinning up — modules will appear here as they report.
            </p>
          ) : (
            <ModuleSection
              key={selectedDomain}
              domain={selectedDomain}
              blocks={selectedBlocks}
              onQuery={onQuery}
              ready={ready}
              wide
            />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ExternalLink,
  Globe,
  Lightbulb,
  CheckCircle2,
  Circle,
  ListChecks,
  FileDown,
} from "lucide-react";
import type {
  BrandKit,
  BrandSocialSection as BrandSocialState,
  ChecklistItem,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import { ValueTooltip } from "./ValueTooltip";
import { providerErrorMessage } from "@/lib/providerErrors";

const CHECK_ORDER = ["Setup", "Brand", "Content", "Growth", "Outreach"];
const PRIORITY_STYLE: Record<string, string> = {
  now: "bg-rose-50 text-rose-600",
  soon: "bg-amber-50 text-amber-600",
  later: "bg-neutral-100 text-neutral-500",
};

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function AccountCard({ a }: { a: BrandKit["comparableAccounts"][number] }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-neutral-900">{a.name}</p>
          <p className="text-[11px] text-neutral-500">
            {a.platform} · {a.handle}
            {a.followers ? ` · ${a.followers}` : ""}
          </p>
        </div>
        {a.grounded ? (
          <Pill className="flex items-center gap-1 bg-emerald-50 text-emerald-600">
            <Globe className="h-2.5 w-2.5" /> verified
          </Pill>
        ) : (
          <Pill className="bg-neutral-100 text-neutral-400">from knowledge</Pill>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        <span className="font-medium text-neutral-700">Why: </span>
        {a.whyRelevant}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        <span className="font-medium text-neutral-700">Steal: </span>
        {a.whatToEmulate}
      </p>
      {a.url && (
        <a
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
        >
          Open profile <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function PostConceptCard({
  concept,
}: {
  concept: NonNullable<BrandKit["postConcepts"]>[number];
}) {
  const sourceUrls = concept.sourceUrls ?? [];
  const visualUrls = concept.visualSourceUrls ?? [];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-neutral-900">
            {concept.hook}
          </p>
          <p className="text-[11px] text-neutral-500">
            {concept.platform} · {concept.format}
          </p>
        </div>
        <Pill className="bg-indigo-50 text-indigo-600">post</Pill>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        {concept.caption}
      </p>
      {concept.notes && (
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          {concept.notes}
        </p>
      )}
      {visualUrls.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-hidden">
          {visualUrls.slice(0, 3).map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-md border border-neutral-200 object-cover"
            />
          ))}
        </div>
      )}
      {sourceUrls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {sourceUrls.slice(0, 4).map((url, index) => (
            <a
              key={`${url}-${index}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
            >
              Source {index + 1} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-neutral-700">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-neutral-600">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BrandSocialSection({
  runId,
  projectId,
  state,
  initial,
  onChange,
}: {
  runId: string;
  projectId: string | null;
  state: CanvasState;
  initial: BrandSocialState | null;
  // Lift saved state into the parent so it survives a section-switch remount
  // (the parent only hydrates once, on mount). Mirrors FinancialsSection.onSaved.
  onChange?: (next: BrandSocialState) => void;
}) {
  const ready = state.status === "complete" || state.status === "capped";

  const [kit, setKit] = useState<BrandKit | null>(initial?.kit ?? null);
  const [checks, setChecks] = useState<Record<string, boolean>>(
    initial?.checks ?? {}
  );
  const [generatedAt, setGeneratedAt] = useState<string | null>(
    initial?.generatedAt ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKit(initial?.kit ?? null);
    setChecks(initial?.checks ?? {});
    setGeneratedAt(initial?.generatedAt ?? null);
  }, [initial]);

  async function generate() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/brandkit`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          providerErrorMessage(body.error ?? body, `failed (${res.status})`)
        );
      }
      const data = await res.json();
      setKit(data.kit);
      setChecks(data.checks ?? {});
      setGeneratedAt(data.generatedAt ?? null);
      onChange?.({
        kit: data.kit,
        checks: data.checks ?? {},
        generatedAt: data.generatedAt ?? null,
        sourceRunId: runId,
      });
    } catch (e) {
      setError(providerErrorMessage(e, "Generation failed."));
    } finally {
      setBusy(false);
    }
  }

  // Optimistic toggle + persist to the project (survives reload / sibling runs).
  async function toggle(id: string) {
    const next = !checks[id];
    const nextChecks = { ...checks, [id]: next };
    setChecks(nextChecks);
    // Keep the parent in sync so the toggle survives a section-switch remount,
    // not just a full page reload.
    onChange?.({
      kit,
      checks: nextChecks,
      generatedAt,
      sourceRunId: runId,
    });
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerDashboardChecks: { [id]: next },
          ownerDashboardRunId: runId,
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    } catch {
      // revert on failure (both local + parent)
      const reverted = { ...nextChecks, [id]: !next };
      setChecks(reverted);
      onChange?.({
        kit,
        checks: reverted,
        generatedAt,
        sourceRunId: runId,
      });
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const item of kit?.checklist ?? []) {
      m.set(item.category, [...(m.get(item.category) ?? []), item]);
    }
    return m;
  }, [kit]);

  const downloadBrandDossier = useCallback(async () => {
    if (!kit) return;
    const [{ buildBrandDossier }, { downloadDossier, slug }] = await Promise.all([
      import("./runDossier"),
      import("./pdf"),
    ]);
    const dossier = buildBrandDossier({
      title: "Brand & Social Kit",
      kit,
      generatedOn: new Date().toLocaleDateString(),
    });
    downloadDossier(dossier, `${slug("brand-social")}-dossier`);
  }, [kit]);

  const doneCount = (kit?.checklist ?? []).filter((i) => checks[i.id]).length;
  const totalCount = kit?.checklist.length ?? 0;
  const postConcepts = kit?.postConcepts ?? [];
  const categories = [
    ...CHECK_ORDER.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !CHECK_ORDER.includes(c)),
  ];

  return (
    <div className="px-6 pb-12 pt-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
                Brand & Social Action Plan
              </h2>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Accounts to study, brand + social guidelines, and a checklist you
              tick off as you go. Built from this venture&apos;s research.
              {generatedAt && (
                <span className="ml-1 text-neutral-400">
                  · generated {new Date(generatedAt).toLocaleDateString()}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {kit && (
              <button
                onClick={() => void downloadBrandDossier()}
                title="Download a PDF dossier of the brand & social kit"
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-500 hover:text-indigo-700"
              >
                <FileDown className="h-3.5 w-3.5" /> Dossier
              </button>
            )}
            <button
              onClick={generate}
              disabled={busy || !ready}
              title={ready ? undefined : "Available once the run converges"}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : kit ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {busy ? "Generating…" : kit ? "Regenerate" : "Generate action plan"}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </p>
        )}

        {!kit ? (
          <div className="mt-8 rounded-2xl border border-dashed border-neutral-200 p-10 text-center">
            <Lightbulb className="mx-auto h-6 w-6 text-neutral-300" />
            <p className="mt-2 text-sm font-medium text-neutral-600">
              No action plan yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-neutral-400">
              {ready
                ? "Generate a tailored plan: real comparable accounts to benchmark, brand & social guidelines, and a checklist you can work through."
                : "The plan is built from the converged research — available once this run finishes."}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Comparable accounts */}
            {kit.comparableAccounts.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Accounts to study
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Benchmark these against your own — competitors, peers and
                  category creators.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {kit.comparableAccounts.map((a) => (
                    <AccountCard key={a.id} a={a} />
                  ))}
                </div>
              </section>
            )}

            {/* Brand identity */}
            <section className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-4">
              <h3 className="text-sm font-semibold text-neutral-900">
                Brand identity guidelines
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-700">
                <span className="font-medium">Positioning: </span>
                {kit.brandIdentity.positioning}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-700">
                <span className="font-medium">Voice: </span>
                {kit.brandIdentity.voice}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <BulletList title="Visual codes" items={kit.brandIdentity.visualCodes} />
                <BulletList title="Naming cues" items={kit.brandIdentity.namingCues} />
                <BulletList title="Do" items={kit.brandIdentity.doList} />
                <BulletList title="Don't" items={kit.brandIdentity.dontList} />
              </div>
            </section>

            {/* Social guidelines */}
            <section className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-4">
              <h3 className="text-sm font-semibold text-neutral-900">
                Social media guidelines
              </h3>
              {kit.socialGuidelines.contentPillars.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {kit.socialGuidelines.contentPillars.map((p, i) => (
                    <Pill key={i} className="bg-indigo-50 text-indigo-600">
                      {p}
                    </Pill>
                  ))}
                </div>
              )}
              <div className="mt-3 space-y-2">
                {kit.socialGuidelines.platformPlan.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-neutral-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-neutral-900">
                        {p.platform}
                      </span>
                      {p.segment && (
                        <Pill className="bg-neutral-100 text-neutral-500">
                          {p.segment}
                        </Pill>
                      )}
                      <span className="text-[11px] text-neutral-500">{p.cadence}</span>
                    </div>
                    {p.formats.length > 0 && (
                      <p className="mt-1 text-[11px] text-neutral-600">
                        Formats: {p.formats.join(", ")}
                      </p>
                    )}
                    {p.notes && (
                      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                        {p.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Post concepts */}
            {postConcepts.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Post concepts
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Source-backed hooks generated from collected products,
                  articles, listings, and audience signals.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {postConcepts.map((concept) => (
                    <PostConceptCard key={concept.id} concept={concept} />
                  ))}
                </div>
              </section>
            )}

            {/* Action checklist */}
            <section>
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                  <ListChecks className="h-4 w-4 text-indigo-500" /> Action checklist
                </h3>
                <span className="text-[11px] font-medium text-neutral-500">
                  {doneCount}/{totalCount} done
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <ValueTooltip
                  content={`${doneCount}/${totalCount} complete (${
                    totalCount ? Math.round((100 * doneCount) / totalCount) : 0
                  }%)`}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${totalCount ? (100 * doneCount) / totalCount : 0}%`,
                    }}
                  />
                </ValueTooltip>
              </div>

              <div className="mt-4 space-y-5">
                {categories.map((cat) => (
                  <div key={cat}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                      {cat}
                    </p>
                    <ul className="space-y-1.5">
                      {(grouped.get(cat) ?? []).map((item) => {
                        const done = !!checks[item.id];
                        return (
                          <li key={item.id}>
                            <button
                              onClick={() => toggle(item.id)}
                              className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                                done
                                  ? "border-emerald-200 bg-emerald-50/50"
                                  : "border-neutral-200 bg-white hover:border-indigo-300"
                              }`}
                            >
                              {done ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              ) : (
                                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`flex items-center gap-1.5 text-[12px] font-medium ${
                                    done
                                      ? "text-neutral-400 line-through"
                                      : "text-neutral-900"
                                  }`}
                                >
                                  {item.title}
                                  <Pill className={PRIORITY_STYLE[item.priority]}>
                                    {item.priority}
                                  </Pill>
                                </span>
                                {item.detail && (
                                  <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">
                                    {item.detail}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

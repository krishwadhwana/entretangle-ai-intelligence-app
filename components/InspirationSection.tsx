"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Image,
  Loader2,
  RefreshCw,
  Search,
  Trophy,
  Video,
  FileDown,
} from "lucide-react";
import type {
  InspirationKit,
  InspirationSection as InspirationState,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-xs text-neutral-400">
      {label}
    </div>
  );
}

function SectionShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Video;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <Icon className="h-4 w-4 text-indigo-500" />
        {title}
      </div>
      {children}
    </section>
  );
}

function VideoCard({ item }: { item: InspirationKit["videoExamples"][number] }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="line-clamp-2 text-[13px] font-semibold text-neutral-900">
        {item.title}
      </p>
      <p className="mt-0.5 text-[11px] text-neutral-500">{item.channel}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        {item.whyRelevant}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        <span className="font-medium text-neutral-700">Copy: </span>
        {item.takeaway}
      </p>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
      >
        {item.verified ? (
          <>
            Open video <ExternalLink className="h-3 w-3" />
          </>
        ) : (
          <>
            Find on YouTube <Search className="h-3 w-3" />
          </>
        )}
      </a>
    </div>
  );
}

function PlacementCard({
  item,
}: {
  item: InspirationKit["placementExamples"][number];
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-[13px] font-semibold text-neutral-900">{item.pattern}</p>
      <p className="mt-0.5 text-[11px] text-neutral-500">
        {item.account} · {item.platform}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        {item.recipe}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        {item.whyItWorks}
      </p>
      {item.accountUrl && (
        <a
          href={item.accountUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
        >
          Open account <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function StoryCard({
  item,
}: {
  item: InspirationKit["successStories"][number];
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-[13px] font-semibold text-neutral-900">{item.brand}</p>
      {item.platform && (
        <p className="mt-0.5 text-[11px] text-neutral-500">{item.platform}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        {item.summary}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        <span className="font-medium text-neutral-700">Move: </span>
        {item.theMove}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
        <span className="font-medium text-neutral-700">Result: </span>
        {item.result}
      </p>
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
      >
        Open source <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

export default function InspirationSection({
  runId,
  state,
  initial,
  onSaved,
}: {
  runId: string;
  state: CanvasState;
  initial: InspirationState | null;
  onSaved: (next: InspirationState) => void;
}) {
  const [section, setSection] = useState<InspirationState | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSection(initial);
  }, [initial]);

  const kit = section?.kit ?? null;
  const canGenerate = state.status === "complete" || state.status === "capped";
  const totals = useMemo(
    () => ({
      videos: kit?.videoExamples.length ?? 0,
      placements: kit?.placementExamples.length ?? 0,
      stories: kit?.successStories.length ?? 0,
    }),
    [kit]
  );

  async function generate() {
    if (!canGenerate || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/inspiration`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "inspiration failed");
      const next: InspirationState = {
        kit: body.kit,
        generatedAt: body.generatedAt,
        sourceRunId: runId,
      };
      setSection(next);
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "inspiration failed");
    } finally {
      setLoading(false);
    }
  }

  const downloadInspirationDossier = useCallback(async () => {
    if (!kit) return;
    const [{ buildInspirationDossier }, { downloadDossier, slug }] =
      await Promise.all([import("./runDossier"), import("./pdf")]);
    const dossier = buildInspirationDossier({
      title: "Inspiration Swipe-File",
      kit,
      generatedOn: new Date().toLocaleDateString(),
    });
    downloadDossier(dossier, `${slug("inspiration")}-dossier`);
  }, [kit]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Inspiration</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {totals.videos} videos · {totals.placements} placements ·{" "}
            {totals.stories} stories
          </p>
        </div>
        <div className="flex items-center gap-2">
          {kit && (
            <button
              onClick={() => void downloadInspirationDossier()}
              title="Download a hyperlinked PDF dossier of the inspiration swipe-file"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-500 hover:text-indigo-700"
            >
              <FileDown className="h-3.5 w-3.5" /> Dossier
            </button>
          )}
          <button
            onClick={generate}
            disabled={!canGenerate || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Generate
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600">
          {error}
        </div>
      )}

      {!kit ? (
        <EmptyState
          label={
            canGenerate
              ? "No inspiration generated yet."
              : "Available after the run completes."
          }
        />
      ) : (
        <div className="grid gap-4">
          <SectionShell title="Videos" icon={Video}>
            {kit.videoExamples.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {kit.videoExamples.map((item) => (
                  <VideoCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState label="No verified videos returned." />
            )}
          </SectionShell>

          <SectionShell title="Placement Patterns" icon={Image}>
            {kit.placementExamples.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {kit.placementExamples.map((item) => (
                  <PlacementCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState label="No placement patterns returned." />
            )}
          </SectionShell>

          <SectionShell title="Success Stories" icon={Trophy}>
            {kit.successStories.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {kit.successStories.map((item) => (
                  <StoryCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState label="No verified success stories returned." />
            )}
          </SectionShell>
        </div>
      )}
    </div>
  );
}

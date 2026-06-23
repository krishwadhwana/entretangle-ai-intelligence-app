"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { FounderStorySection as FounderStoryState } from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";

type SkippedUrl = { url: string; reason: string };
type CompanyHit = {
  id: string;
  name: string;
  country: string | null;
  website: string | null;
  sector: string | null;
  description: string;
};

function hasStory(story: FounderStoryState | null): story is FounderStoryState {
  return Boolean(story && (story.evidence.length || story.confidence > 0));
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
      {children}
    </span>
  );
}

function Signal({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  if (!value) return null;
  return (
    <div
      className={`rounded-xl border border-neutral-200 bg-white p-3 ${
        wide ? "md:col-span-2" : ""
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-neutral-700">{value}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {title}
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((item, index) => (
          <li key={index} className="text-[12px] leading-relaxed text-neutral-700">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FounderStorySection({
  projectId,
  initial,
  onSaved,
}: {
  projectId: string | null;
  initial: FounderStoryState | null;
  onSaved?: (next: FounderStoryState) => void;
}) {
  const [story, setStory] = useState<FounderStoryState | null>(initial);
  const [notes, setNotes] = useState("");
  const [urls, setUrls] = useState("");
  const [companyNames, setCompanyNames] = useState("");
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([]);
  const [includeWebsiteAnalysis, setIncludeWebsiteAnalysis] = useState(true);
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedUrls, setSkippedUrls] = useState<SkippedUrl[]>([]);

  useEffect(() => setStory(initial), [initial]);

  const urlList = useMemo(
    () =>
      urls
        .split(/[\n,]/)
        .map((url) => url.trim())
        .filter(Boolean),
    [urls]
  );
  const companyNameList = useMemo(
    () =>
      companyNames
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter(Boolean),
    [companyNames]
  );
  const activeCompanyQuery = useMemo(() => {
    const parts = companyNames.split(/[\n,]/);
    return parts[parts.length - 1]?.trim() ?? "";
  }, [companyNames]);

  useEffect(() => {
    let cancelled = false;
    if (activeCompanyQuery.length < 2) {
      setCompanyHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/company-intel/search?q=${encodeURIComponent(activeCompanyQuery)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { companies?: CompanyHit[] };
        if (!cancelled) setCompanyHits(data.companies ?? []);
      } catch {
        if (!cancelled) setCompanyHits([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCompanyQuery]);

  function addCompanyHit(name: string) {
    const existing = new Set(companyNameList.map((item) => item.toLowerCase()));
    if (existing.has(name.toLowerCase())) return;
    setCompanyNames((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}\n${name}` : name;
    });
  }

  async function generate() {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    setSkippedUrls([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/founder-story`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: urlList,
          companyNames: companyNameList,
          notes,
          includeWebsiteAnalysis,
          includeDocuments,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSkippedUrls(data.skippedUrls ?? []);
        throw new Error(
          providerErrorMessage(data.error ?? data, `failed (${res.status})`)
        );
      }
      setStory(data.founderStory);
      setSkippedUrls(data.skippedUrls ?? []);
      onSaved?.(data.founderStory);
    } catch (err) {
      setError(providerErrorMessage(err, "Extraction failed."));
    } finally {
      setBusy(false);
    }
  }

  const confidence = story ? Math.round(story.confidence * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <UserRound className="h-4 w-4 text-indigo-600" /> Founder Story
          </div>
          {hasStory(story) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Pill>{confidence}% confidence</Pill>
              {story.generatedAt && (
                <Pill>{new Date(story.generatedAt).toLocaleDateString()}</Pill>
              )}
              <Pill>{story.evidence.length} evidence items</Pill>
            </div>
          )}
        </div>
        <button
          onClick={generate}
          disabled={!projectId || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Extract
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <label className="block">
            <span className="text-[11px] font-medium text-neutral-600">
              Founder notes
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={7}
              className="mt-1 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="block">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
              <LinkIcon className="h-3 w-3" /> Story URLs
            </span>
            <textarea
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="block">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
              <Building2 className="h-3 w-3" /> Saved company intel
            </span>
            <textarea
              value={companyNames}
              onChange={(event) => setCompanyNames(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          {companyHits.length > 0 && (
            <div className="space-y-1">
              {companyHits.slice(0, 4).map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => addCompanyHit(company.name)}
                  className="flex w-full items-start justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-neutral-800">
                      {company.name}
                    </span>
                    <span className="block truncate text-[10px] text-neutral-500">
                      {[company.sector, company.country, company.website]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-2 text-[11px] text-neutral-600 sm:grid-cols-2 lg:grid-cols-1">
            <label className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
              <input
                type="checkbox"
                checked={includeWebsiteAnalysis}
                onChange={(event) =>
                  setIncludeWebsiteAnalysis(event.target.checked)
                }
                className="h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600"
              />
              Saved website analysis
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
              <input
                type="checkbox"
                checked={includeDocuments}
                onChange={(event) => setIncludeDocuments(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600"
              />
              Uploaded documents
            </label>
          </div>
          {urlList.length > 0 && <Pill>{urlList.length} URL sources</Pill>}
          {companyNameList.length > 0 && (
            <Pill>{companyNameList.length} company intel matches</Pill>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {skippedUrls.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                Skipped URLs
              </p>
              <ul className="mt-1 space-y-1">
                {skippedUrls.map((item) => (
                  <li
                    key={`${item.url}-${item.reason}`}
                    className="text-[11px] leading-relaxed text-amber-800"
                  >
                    {item.url}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {hasStory(story) ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Signal label="Background" value={story.signals.founderBackground} />
              <Signal label="Origin" value={story.signals.originStory} />
              <Signal label="Motivation" value={story.signals.founderMotivation} />
              <Signal label="Why now" value={story.signals.whyNow} />
              <Signal
                label="Customer insight"
                value={story.signals.customerInsight}
                wide
              />
              <Signal
                label="Category conviction"
                value={story.signals.categoryConviction}
                wide
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ListBlock title="Credibility proof" items={story.signals.credibilityProof} />
              <ListBlock title="Unfair advantages" items={story.signals.unfairAdvantages} />
              <ListBlock title="Constraints" items={story.signals.constraints} />
              <ListBlock title="Open questions" items={story.signals.openQuestions} />
            </div>
            {story.evidence.length > 0 && (
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-700">
                  <FileText className="h-3.5 w-3.5" /> Evidence
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {story.evidence.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-neutral-100 bg-neutral-50 p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-neutral-800">
                            {item.title || item.id}
                          </p>
                          <p className="text-[10px] uppercase tracking-wide text-neutral-400">
                            {item.sourceType}
                          </p>
                        </div>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:text-indigo-700"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
                        {item.summary || item.excerpt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white text-xs text-neutral-400">
            No founder story saved yet.
          </div>
        )}
      </div>
    </div>
  );
}

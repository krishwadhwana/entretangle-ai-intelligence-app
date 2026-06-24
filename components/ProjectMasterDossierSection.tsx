"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  FileText,
  Loader2,
  PackageCheck,
} from "lucide-react";
import type {
  AudienceAggregate,
  Block,
  ClientProfile,
  ExportViabilityReport,
  FinalReport,
  LaunchSimRecord,
  ProductImageRef,
  SimulationRunRecord,
  WebsiteAnalysis,
  WorkspaceNodeWire,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";
import {
  buildProjectMasterDossier,
  type ProjectDocSummary,
  type ProjectMasterRun,
  type ProjectModuleSummary,
} from "./projectMasterDossier";
import { downloadDossierPdf, slug } from "./pdf";

type Props = {
  projectId: string | null;
  projectName: string;
  brief?: string | null;
  profile: ClientProfile | null;
  websiteAnalysis?: WebsiteAnalysis | null;
  documents: ProjectDocSummary[];
  productImages: ProductImageRef[];
  moduleSummary: ProjectModuleSummary;
  assetCount: number;
  runs: SimulationRunRecord[];
  savedExportNodes: WorkspaceNodeWire[];
};

type RunDetailResponse = {
  run?: {
    id: string;
    brief?: string;
    status?: string;
    mode?: string;
    targetMarket?: string | null;
  };
  blocks?: Block[];
  aggregate?: AudienceAggregate | null;
  finalReport?: FinalReport | null;
  cohorts?: Array<{
    stats?: { wtpCurrency?: string | null } | null;
    personas?: Array<{ wtpCurrency?: string | null }>;
  }>;
};

type LaunchResponse = {
  defaults?: { currency?: string };
  scenarios?: LaunchSimRecord[];
};

function hasSavedDossier(node: WorkspaceNodeWire) {
  const dossier = node.payload?.dossier;
  return Boolean(
    dossier &&
      typeof dossier === "object" &&
      "title" in dossier &&
      "sections" in dossier,
  );
}

function inferAudienceCurrency(
  cohorts: RunDetailResponse["cohorts"],
  fallback: string,
) {
  const statsCurrency = cohorts?.find((cohort) => cohort.stats?.wtpCurrency)
    ?.stats?.wtpCurrency;
  if (statsCurrency) return statsCurrency;
  const personaCurrency = cohorts
    ?.flatMap((cohort) => cohort.personas ?? [])
    .find((persona) => persona.wtpCurrency)?.wtpCurrency;
  return personaCurrency ?? fallback;
}

async function fetchRunDetail(runId: string): Promise<RunDetailResponse | null> {
  const res = await fetch(`/api/runs/${runId}`);
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as RunDetailResponse | null;
}

async function fetchLaunch(runId: string) {
  const fallback = { launch: null as LaunchSimRecord | null, currency: "INR" };
  try {
    const res = await fetch(`/api/runs/${runId}/launch-sim`);
    if (!res.ok) return fallback;
    const data = (await res.json().catch(() => null)) as LaunchResponse | null;
    return {
      launch: data?.scenarios?.[0] ?? null,
      currency: data?.defaults?.currency ?? "INR",
    };
  } catch {
    return fallback;
  }
}

async function fetchExportReport(runId: string, mode: string | null | undefined) {
  if (mode !== "export") return null;
  try {
    const res = await fetch(`/api/runs/${runId}/export-sim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      report?: ExportViabilityReport;
    };
    return data.report ?? null;
  } catch {
    return null;
  }
}

async function hydrateRun(snapshot: SimulationRunRecord): Promise<ProjectMasterRun> {
  const [detail, launchData] = await Promise.all([
    fetchRunDetail(snapshot.runId),
    fetchLaunch(snapshot.runId),
  ]);
  const mode = detail?.run?.mode ?? snapshot.params.mode;
  const exportReport = await fetchExportReport(snapshot.runId, mode);
  const blocks = detail?.blocks?.length
    ? detail.blocks
    : snapshot.results.blocks ?? [];
  const aggregate =
    detail?.aggregate ?? snapshot.results.audienceAggregate ?? null;
  return {
    snapshot,
    brief: detail?.run?.brief ?? snapshot.params.brief,
    mode,
    targetMarket: detail?.run?.targetMarket ?? null,
    blocks,
    aggregate,
    finalReport: detail?.finalReport ?? null,
    launch: launchData.launch,
    exportReport,
    currency: launchData.currency,
    audienceCurrency: inferAudienceCurrency(detail?.cohorts, launchData.currency),
  };
}

export default function ProjectMasterDossierSection({
  projectId,
  projectName,
  brief,
  profile,
  websiteAnalysis,
  documents,
  productImages,
  moduleSummary,
  assetCount,
  runs,
  savedExportNodes,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedDossierCount = useMemo(
    () => savedExportNodes.filter(hasSavedDossier).length,
    [savedExportNodes],
  );
  const completeRuns = runs.filter(
    (run) => run.status === "complete" || run.status === "capped",
  ).length;

  async function produceCoverLetter() {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Reading project record");
    try {
      const hydrated: ProjectMasterRun[] = [];
      for (const [index, run] of runs.entries()) {
        setStatus(`Compiling run ${index + 1} of ${runs.length}`);
        hydrated.push(await hydrateRun(run));
      }
      setStatus("Writing PDF");
      const dossier = buildProjectMasterDossier({
        projectName,
        brief,
        profile,
        websiteAnalysis,
        documents,
        productImages,
        moduleSummary,
        assetCount,
        runs: hydrated,
        savedExportNodes,
        generatedOn: new Date().toLocaleDateString(),
      });
      downloadDossierPdf(
        dossier,
        `${slug(projectName)}-cover-letter-master-dossier`,
      );
      setStatus("PDF downloaded");
    } catch (err) {
      setError(providerErrorMessage(err, "Cover letter export failed"));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Cover letter
            </p>
            <h3 className="mt-1 text-base font-semibold text-neutral-900">
              Master project dossier
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
              Brief synopsis first, then the full project packet in one PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void produceCoverLetter()}
            disabled={!projectId || busy}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            Produce cover letter
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[11px] font-medium text-neutral-500">Runs</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {completeRuns}/{runs.length}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[11px] font-medium text-neutral-500">
              Saved dossiers
            </p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {savedDossierCount}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[11px] font-medium text-neutral-500">Data</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {documents.length + productImages.length}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[11px] font-medium text-neutral-500">Assets</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {assetCount}
            </p>
          </div>
        </div>

        {status ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            )}
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" />
            <h4 className="text-sm font-semibold text-neutral-900">
              Cover synopsis
            </h4>
          </div>
          <p className="mt-3 text-sm leading-6 text-neutral-600">
            {profile?.product ??
              brief ??
              "The synopsis will use the project brief once setup is complete."}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            {profile?.targetAudience ? (
              <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                {profile.targetAudience}
              </span>
            ) : null}
            {profile?.geography?.map((place) => (
              <span
                key={place}
                className="rounded-full bg-neutral-100 px-2 py-1 font-medium text-neutral-600"
              >
                {place}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            <h4 className="text-sm font-semibold text-neutral-900">
              Included packet
            </h4>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-neutral-600">
            <li>Logical reasoning and assumption trail</li>
            <li>Approach behind the numbers</li>
            <li>Product-market fit analysis</li>
            <li>All run dossiers generated from current run data</li>
            <li>All saved dossier snapshots from project folders</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

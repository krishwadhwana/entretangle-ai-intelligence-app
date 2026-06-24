"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  AudienceAggregate,
  Cohort,
  Domain,
  Persona,
  UsageLedger,
} from "@/lib/schema";
import {
  RotateCcw,
  Coins,
  Users,
  Layers,
  ChevronDown,
  GitBranchPlus,
  Loader2,
  Play,
  Rocket,
  Ship,
  Square,
  FileDown,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { useRunEvents } from "./useRunEvents";
import PanelStrip, { ConclusionWorkspace, DomainWorkspace } from "./PanelStrip";
import NetworkView, { type KnowHowNodeClick } from "./NetworkView";
import KnowHowDrawer from "./KnowHowDrawer";
import { moduleForNode } from "@/lib/knowHow";
import InsightsView from "./InsightsView";
import PlaybookView from "./PlaybookView";
import OwnerDashboard from "./OwnerDashboard";
import LaunchSimulation from "./LaunchSimulation";
import { providerErrorMessage } from "@/lib/providerErrors";
import ExportViability from "./ExportViability";
import CohortDrawer from "./CohortDrawer";
import { ProjectSelector } from "./AppHeader";
import { searchKnownLocalities } from "@/lib/localityAnchors";

// Leaflet touches `window` — render the geography layer client-side only.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-neutral-400">
      Loading map…
    </div>
  ),
});

type SiblingRun = {
  id: string;
  brief: string;
  focusQuestion: string | null;
  mode: string;
  status: string;
  createdAt: string;
};

type Props = {
  runId: string;
  projectId: string | null;
  brief: string;
  parentRunId: string | null;
  mode?: string;
  targetMarket?: string | null;
  exportProfileDefaults?: {
    targetAudience: string;
    priceBand: string;
    priceMin: number | null;
    priceMax: number | null;
    targetMarginPct: number | null;
  };
  childRunIds: string[];
  maxCostUsd: number;
  maxTokens: number;
  siblingRuns: SiblingRun[];
};

type AudienceBatchResult = {
  cohort: Cohort;
  personas: Persona[];
  aggregate: AudienceAggregate | null;
  tokensUsed?: number;
  costUsd?: number;
};

type ExportDestinationScope = "market" | "locality";

type ExportLocality = {
  label: string;
  country?: string;
  lat?: number;
  lng?: number;
};

type ExportSearchResult = ExportLocality & {
  source: "known" | "geocoder";
};

/** Header dropdown to hop between sibling runs in the same project. */
function RunSwitcher({
  runId,
  siblings,
}: {
  runId: string;
  siblings: SiblingRun[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const idx = siblings.findIndex((s) => s.id === runId);
  const label = `Run ${siblings.length - idx} of ${siblings.length}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400"
        title="Switch between simulations in this project"
      >
        <Layers className="h-3 w-3" /> {label}
        <ChevronDown className="h-3 w-3 text-neutral-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-[1100] mt-1.5 max-h-80 w-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          {siblings.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setOpen(false);
                if (s.id !== runId) router.push(`/runs/${s.id}`);
              }}
              className={`block w-full px-3 py-2 text-left text-xs ${
                s.id === runId ? "bg-indigo-50" : "hover:bg-neutral-50"
              }`}
            >
              <p className="truncate font-medium text-neutral-800">
                {s.brief?.trim() ||
                  (s.focusQuestion
                    ? `“${s.focusQuestion}”`
                    : i === siblings.length - 1
                      ? "Initial simulation"
                      : "Follow-up simulation")}
              </p>
              <p className="text-[10px] text-neutral-400">
                {new Date(s.createdAt).toLocaleString()} · {s.status}
                {s.mode === "scoped" && " · scoped"}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * v2 dashboard (SPEC-V2 §5): top bar → domain panel strip (subpanels +
 * conclusion panel) → THE MAP with two toggle layers (geography / network)
 * and the cohort drawer.
 */
// Destination markets offered for a one-click cross-border export run. The
// engine treats any non-home country as the USD/Western baseline today, so this
// is a convenience list, not a hard limit.
const EXPORT_MARKETS = [
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Canada",
  "Australia",
  "Germany",
  "Singapore",
];

function capDestinationLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117).trimEnd()}...`;
}

function compactDestinationLabel(result: ExportSearchResult): string {
  const country = result.country?.trim();
  if (result.source === "known") {
    const includesCountry =
      !!country && result.label.toLowerCase().includes(country.toLowerCase());
    return capDestinationLabel(
      country && !includesCountry ? `${result.label}, ${country}` : result.label
    );
  }

  const parts = result.label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const primary = parts[0] ?? result.label;
  const countryLower = country?.toLowerCase();
  const region = parts.find((part, index) => {
    if (index === 0) return false;
    const lower = part.toLowerCase();
    if (countryLower && lower === countryLower) return false;
    return !/\b(county|district|division|municipality|region)\b/.test(lower);
  });
  const base = [primary, region].filter(Boolean).join(", ");
  return capDestinationLabel(country ? `${base}, ${country}` : base);
}

export default function RunDashboard({
  runId,
  projectId,
  brief,
  parentRunId,
  mode,
  targetMarket,
  exportProfileDefaults,
  childRunIds,
  maxCostUsd,
  maxTokens,
  siblingRuns,
}: Props) {
  const isExportRun = mode === "export";
  const router = useRouter();
  const { state, patchState, replay, replaying, hydrated } =
    useRunEvents(runId);
  const [view, setView] = useState<
    | "geo"
    | "network"
    | "know-how"
    | "insights"
    | "playbook"
    | "owner"
    | "launch"
    | "export"
    | "domain"
    | "conclusion"
  >("geo");
  // Which graph node's Know-How module is open in the drawer (know-how view).
  const [knowHowNode, setKnowHowNode] = useState<KnowHowNodeClick | null>(null);
  const [ownerMounted, setOwnerMounted] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "conclusion" | Domain | null
  >(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dossierBusy, setDossierBusy] = useState(false);
  const [projectUsage, setProjectUsage] = useState<UsageLedger | null>(null);
  // The "Test in another market" edit-profile modal: which market it's open for,
  // plus the editable (pre-filled) destination-market overrides.
  const [exportMarket, setExportMarket] = useState<string | null>(null);
  const [exportMarketScope, setExportMarketScope] =
    useState<ExportDestinationScope>("market");
  const [exportLocality, setExportLocality] = useState<ExportLocality | null>(
    null
  );
  const [exportMarketQuery, setExportMarketQuery] = useState("");
  const [exportMarketResults, setExportMarketResults] = useState<
    ExportSearchResult[]
  >([]);
  const [exportMarketSearching, setExportMarketSearching] = useState(false);
  const [exportMarketSearchError, setExportMarketSearchError] = useState<
    string | null
  >(null);
  const [ovAudience, setOvAudience] = useState("");
  const [ovPriceBand, setOvPriceBand] = useState("");
  const [ovPriceMin, setOvPriceMin] = useState("");
  const [ovPriceMax, setOvPriceMax] = useState("");
  const [ovMargin, setOvMargin] = useState("");
  const [ovContext, setOvContext] = useState("");

  // Open the modal for a market, pre-filling the inherited profile fields.
  const openExportModal = useCallback(
    (market: string) => {
      setExportError(null);
      setOvAudience(exportProfileDefaults?.targetAudience ?? "");
      setOvPriceBand(exportProfileDefaults?.priceBand ?? "");
      setOvPriceMin(exportProfileDefaults?.priceMin?.toString() ?? "");
      setOvPriceMax(exportProfileDefaults?.priceMax?.toString() ?? "");
      setOvMargin(exportProfileDefaults?.targetMarginPct?.toString() ?? "");
      setOvContext("");
      setExportMarketScope("market");
      setExportLocality(null);
      setExportMarketQuery("");
      setExportMarketResults([]);
      setExportMarketSearchError(null);
      setExportMarket(market);
    },
    [exportProfileDefaults]
  );
  const selectExportMarket = useCallback((market: string) => {
    setExportMarket(market);
    setExportMarketScope("market");
    setExportLocality(null);
    setExportMarketQuery("");
    setExportMarketResults([]);
    setExportMarketSearchError(null);
  }, []);
  const selectExportLocality = useCallback((result: ExportSearchResult) => {
    const label = compactDestinationLabel(result);
    setExportMarket(label);
    setExportMarketScope("locality");
    setExportLocality({
      label,
      country: result.country,
      lat: result.lat,
      lng: result.lng,
    });
    setExportMarketQuery(label);
    setExportMarketResults([]);
    setExportMarketSearchError(null);
  }, []);
  const onExportMarketSearch = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const q = exportMarketQuery.trim();
      if (q.length < 2 || exportMarketSearching) return;
      setExportMarketSearching(true);
      setExportMarketSearchError(null);
      try {
        const known: ExportSearchResult[] = searchKnownLocalities(q, 8).map(
          (r) => ({
            label: r.label,
            country: r.country,
            lat: r.lat,
            lng: r.lng,
            source: "known" as const,
          })
        );
        let remote: ExportSearchResult[] = [];
        try {
          const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const data = (await res.json()) as {
              results?: ExportLocality[];
            };
            remote = (data.results ?? []).map((r) => ({
              ...r,
              source: "geocoder" as const,
            }));
          }
        } catch {
          // Known locality hits are still useful when geocoding is unavailable.
        }
        const seen = new Set<string>();
        const merged = [...known, ...remote].filter((result) => {
          const key = `${result.label}:${result.lat?.toFixed(3)}:${result.lng?.toFixed(3)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setExportMarketResults(merged.slice(0, 8));
        if (merged.length === 0) setExportMarketSearchError("No city found");
      } finally {
        setExportMarketSearching(false);
      }
    },
    [exportMarketQuery, exportMarketSearching]
  );
  const [audienceBranchOpen, setAudienceBranchOpen] = useState(false);
  const [audienceBranchInfo, setAudienceBranchInfo] = useState("");
  const [audienceBranchBusy, setAudienceBranchBusy] = useState(false);
  const [audienceBranchError, setAudienceBranchError] = useState<string | null>(
    null
  );
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  // Win-back deep link: open a cohort's drawer focused on one persona's chat.
  const [chatTarget, setChatTarget] = useState<{
    cohortId: string;
    personaId: string;
  } | null>(null);
  const [highlightedBlocks, setHighlightedBlocks] = useState<Set<string>>(
    new Set()
  );

  const cohorts = useMemo(
    () =>
      state.cohortOrder.map((id) => state.cohorts[id]).filter(Boolean),
    [state.cohorts, state.cohortOrder]
  );
  const personaCount = useMemo(
    () => cohorts.reduce((s, c) => s + c.personas.length, 0),
    [cohorts]
  );
  const totalTokensUsed = Math.max(
    state.tokensUsed,
    projectUsage?.tokensUsed ?? 0
  );
  const totalCostUsd = Math.max(state.costUsd, projectUsage?.costUsd ?? 0);

  // Live progress while the run is still working (SSE-driven).
  const progress = useMemo(() => {
    const inProgress = ["connecting", "planning", "running"].includes(
      state.status
    );
    const cohortsDone = cohorts.filter((c) => c.state === "done").length;
    const cohortsTotal = cohorts.length;
    const blocks = Object.values(state.blocks);
    const desksTotal = blocks.length;
    const desksDone = blocks.filter(
      (b) => b.state === "concluded" || b.state === "failed"
    ).length;
    // Cohorts are the long pole; fall back to desks before cohorts spawn.
    const pct =
      cohortsTotal > 0
        ? Math.round((100 * cohortsDone) / cohortsTotal)
        : desksTotal > 0
          ? Math.round((100 * desksDone) / desksTotal)
          : 4;
    return {
      inProgress,
      cohortsDone,
      cohortsTotal,
      desksDone,
      desksTotal,
      pct,
    };
  }, [state.status, state.blocks, cohorts]);

  const canBranchAudience =
    !progress.inProgress && !replaying && personaCount > 0;
  // Launch Simulation unlocks once the audience has finished simulating.
  const canLaunch = !progress.inProgress && !replaying && personaCount > 0;

  const onQuery = useCallback(
    async (
      question: string,
      opts?: { domains?: string[]; highlight?: boolean }
    ): Promise<string> => {
      const res = await fetch(`/api/runs/${runId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(opts?.domains ? { domains: opts.domains } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(
            data?.error ?? data,
            `query failed (${res.status})`
          )
        );
      }
      const { answer, citedConclusionIds = [] } = data ?? {};
      if (typeof answer !== "string") {
        throw new Error("Query returned an empty answer");
      }
      // The Playbook asks in-place (highlight:false); the panel/network query
      // highlights the cited desks and jumps to the network graph.
      if (opts?.highlight !== false) {
        const cited = new Set<string>(citedConclusionIds);
        const blockIds = new Set<string>();
        for (const block of Object.values(state.blocks)) {
          if (block.conclusions.some((c) => cited.has(c.id))) {
            blockIds.add(block.id);
          }
        }
        setHighlightedBlocks(blockIds);
        if (blockIds.size > 0) {
          setActivePanel(null);
          setView("network"); // show the cited path
        }
      }
      return answer;
    },
    [runId, state.blocks]
  );

  const onForkParam = useCallback(
    async (blockId: string, key: string, value: number | string) => {
      const block = state.blocks[blockId];
      if (!block || block.params[key] === value) return;
      if (!window.confirm(`Fork run from "${block.name}" with ${key}=${value}?`))
        return;
      const res = await fetch(`/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          params: { ...block.params, [key]: value },
        }),
      });
      if (res.ok) {
        const { runId: newRunId } = await res.json();
        router.push(`/runs/${newRunId}`);
      }
    },
    [runId, state.blocks, router]
  );

  const onCite = useCallback((blockId: string) => {
    setHighlightedBlocks(new Set([blockId]));
    setActivePanel(null);
    setView("network");
  }, []);

  const onSelectPanel = useCallback(
    (panel: NonNullable<typeof activePanel>) => {
      setActivePanel(panel);
      setView(panel === "conclusion" ? "conclusion" : "domain");
    },
    []
  );

  const selectMainView = useCallback(
    (
      nextView:
        | "geo"
        | "network"
        | "know-how"
        | "insights"
        | "playbook"
        | "owner"
        | "launch"
        | "export"
    ) => {
      setActivePanel(null);
      if (nextView !== "know-how") setKnowHowNode(null);
      setView(nextView);
    },
    []
  );

  const onGenerateReport = useCallback(async (force = false) => {
    if (reportBusy) return;
    setReportBusy(true);
    patchState({ phaseLabel: "Writing final business report" });
    try {
      const res = await fetch(`/api/runs/${runId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `report failed (${res.status})`)
        );
      }
      patchState({
        finalReport: data.report,
        phaseLabel: "World model ready",
        ...(typeof data.tokensUsed === "number"
          ? { tokensUsed: data.tokensUsed }
          : {}),
        ...(typeof data.costUsd === "number" ? { costUsd: data.costUsd } : {}),
      });
    } catch (e) {
      patchState({
        error: providerErrorMessage(e, "report generation failed"),
      });
    } finally {
      patchState({ phaseLabel: "World model ready" });
      setReportBusy(false);
    }
  }, [patchState, reportBusy, runId]);

  const onCreateAudienceBranch = useCallback(async () => {
    const information = audienceBranchInfo.trim();
    if (!information || audienceBranchBusy) return;
    setAudienceBranchBusy(true);
    setAudienceBranchError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/audience-branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ information }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `branch failed (${res.status})`)
        );
      }
      router.push(`/runs/${data.runId}`);
    } catch (e) {
      setAudienceBranchError(providerErrorMessage(e, "Branch failed"));
      setAudienceBranchBusy(false);
    }
  }, [audienceBranchBusy, audienceBranchInfo, router, runId]);

  // Spin up a dependent export run rooted at THIS completed run: same product,
  // re-pointed at the destination market, carrying this run's results forward —
  // with the founder's optional destination-market profile tweaks applied.
  const onCreateExportRun = useCallback(async () => {
    if (exportBusy || !exportMarket) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const num = (s: string): number | undefined => {
        const n = parseFloat(s);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      const profileOverrides: Record<string, unknown> = {};
      if (ovAudience.trim()) profileOverrides.targetAudience = ovAudience.trim();
      if (ovPriceBand.trim()) profileOverrides.priceBand = ovPriceBand.trim();
      if (num(ovPriceMin) !== undefined) profileOverrides.priceMin = num(ovPriceMin);
      if (num(ovPriceMax) !== undefined) profileOverrides.priceMax = num(ovPriceMax);
      if (num(ovMargin) !== undefined) profileOverrides.targetMarginPct = num(ovMargin);
      const res = await fetch(`/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "export",
          parentRunId: runId,
          targetMarket: exportMarket,
          targetMarketScope: exportMarketScope,
          ...(exportMarketScope === "locality" && exportLocality
            ? { targetMarketLocality: exportLocality }
            : {}),
          projectId,
          ...(Object.keys(profileOverrides).length ? { profileOverrides } : {}),
          ...(ovContext.trim() ? { additionalContext: ovContext.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `export failed (${res.status})`)
        );
      }
      router.push(`/runs/${data.runId}`);
    } catch (e) {
      setExportError(providerErrorMessage(e, "Export run failed"));
      setExportBusy(false);
    }
  }, [
    exportBusy,
    exportMarket,
    exportMarketScope,
    exportLocality,
    ovAudience,
    ovPriceBand,
    ovPriceMin,
    ovPriceMax,
    ovMargin,
    ovContext,
    projectId,
    router,
    runId,
  ]);

  // Generate a full graphical PDF dossier for this run: verdict, audience charts,
  // key findings, launch trajectory, and (for export runs) cross-border viability.
  const onDownloadDossier = useCallback(async () => {
    if (dossierBusy) return;
    setDossierBusy(true);
    try {
      let launch = null;
      let currency = "INR";
      let exportReport = null;
      try {
        const res = await fetch(`/api/runs/${runId}/launch-sim`);
        if (res.ok) {
          const data = await res.json();
          currency = data.defaults?.currency ?? currency;
          launch = data.scenarios?.[0] ?? null;
        }
      } catch {
        // launch data is optional in the dossier
      }
      if (isExportRun) {
        try {
          const res = await fetch(`/api/runs/${runId}/export-sim`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (res.ok) exportReport = (await res.json()).report ?? null;
        } catch {
          // export viability is optional
        }
      }
      const [{ buildRunDossier }, { downloadDossier, slug }] = await Promise.all([
        import("./runDossier"),
        import("./pdf"),
      ]);
      const cohortRows = Object.values(state.cohorts);
      const audienceCurrency =
        cohortRows.find((c) => c.stats?.wtpCurrency)?.stats?.wtpCurrency ??
        cohortRows.flatMap((c) => c.personas).find((p) => p.wtpCurrency)
          ?.wtpCurrency ??
        currency;
      const dossier = buildRunDossier({
        brief,
        mode,
        targetMarket,
        currency,
        audienceCurrency,
        report: state.finalReport,
        aggregate: state.aggregate,
        worldModel: state.worldModel,
        blocks: Object.values(state.blocks),
        launch,
        exportReport,
        generatedOn: new Date().toLocaleDateString(),
      });
      downloadDossier(dossier, `${slug(dossier.title)}-dossier`);
    } finally {
      setDossierBusy(false);
    }
  }, [dossierBusy, runId, isExportRun, brief, mode, targetMarket, state]);

  const onAudienceBatchAdded = useCallback(
    (result: AudienceBatchResult) => {
      const cohort = { ...result.cohort, personas: result.personas };
      patchState({
        status: state.status === "capped" ? "capped" : "complete",
        phaseLabel:
          state.status === "capped"
            ? "Audience batch added; run remains capped"
            : "World model ready",
        cohorts: { ...state.cohorts, [cohort.id]: cohort },
        cohortOrder: state.cohortOrder.includes(cohort.id)
          ? state.cohortOrder
          : [...state.cohortOrder, cohort.id],
        aggregate: result.aggregate ?? state.aggregate,
        ...(typeof result.tokensUsed === "number"
          ? { tokensUsed: result.tokensUsed }
          : {}),
        ...(typeof result.costUsd === "number" ? { costUsd: result.costUsd } : {}),
      });
    },
    [
      patchState,
      state.aggregate,
      state.cohortOrder,
      state.cohorts,
      state.status,
    ]
  );

  // --- "Continue run" (resume) ----------------------------------------------
  // A run is resumable if it ended capped/failed, OR it claims to be "running"
  // but hasn't emitted an event in a while (a hang). The Continue button
  // re-runs only the unfinished cohorts — no re-paying for the desks.
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // Stalled = "running" but the LAST EVENT (by its server timestamp) is old.
  // Using the event timestamp — not when the client received it — means a
  // page reload doesn't reset the clock and hide the Continue button.
  const stale =
    now > 0 &&
    state.lastEventTs > 0 &&
    state.status === "running" &&
    now - state.lastEventTs > 90_000;
  const resumable =
    !resuming &&
    !replaying &&
    (state.status === "capped" ||
      state.status === "failed" ||
      state.status === "cancelled" ||
      stale);
  const cancellable =
    !cancelling &&
    (state.status === "connecting" ||
      state.status === "planning" ||
      state.status === "running");

  const onResume = useCallback(async () => {
    setResuming(true);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      if (res.ok) {
        // Reconnect the SSE stream so live progress shows again.
        window.location.reload();
      } else {
        setResuming(false);
      }
    } catch {
      setResuming(false);
    }
  }, [runId]);

  const onCancel = useCallback(async () => {
    if (!window.confirm("Cancel this run? Work already completed will stay saved."))
      return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) setCancelling(false);
    } catch {
      setCancelling(false);
    }
  }, [runId]);

  const selectedCohort = selectedCohortId
    ? state.cohorts[selectedCohortId]
    : null;

  useEffect(() => {
    if (view === "owner") setOwnerMounted(true);
  }, [view]);

  useEffect(() => {
    if (!projectId) {
      setProjectUsage(null);
      return;
    }
    let cancelled = false;
    async function loadUsage() {
      try {
        const res = await fetch(`/api/projects/${projectId}/owner-dashboard`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          ownerDashboard?: { usage?: UsageLedger | null } | null;
        };
        if (!cancelled) setProjectUsage(data.ownerDashboard?.usage ?? null);
      } catch {
        /* best-effort telemetry */
      }
    }
    void loadUsage();
    const interval = window.setInterval(loadUsage, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId]);

  if (!hydrated) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2.5">
          <a href="/" className="text-sm font-semibold tracking-tight">
            EntreTangle
          </a>
          <ProjectSelector selectedProjectId={projectId} menuAlign="left" />
          <p
            className="max-w-md flex-1 truncate text-xs text-neutral-500"
            title={brief}
          >
            {brief}
          </p>
          {siblingRuns.length > 1 && (
            <RunSwitcher runId={runId} siblings={siblingRuns} />
          )}
        </header>
        <main className="flex flex-1 items-center justify-center bg-neutral-50">
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            Loading simulation…
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2.5">
        <a href="/" className="text-sm font-semibold tracking-tight">
          EntreTangle
        </a>
        <ProjectSelector selectedProjectId={projectId} menuAlign="left" />
        <p
          className="max-w-md flex-1 truncate text-xs text-neutral-500"
          title={brief}
        >
          {brief}
        </p>
        <span className="rounded-full border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
          {replaying ? "Replaying…" : state.phaseLabel}
        </span>
        {siblingRuns.length > 1 && (
          <RunSwitcher runId={runId} siblings={siblingRuns} />
        )}
        <button
          onClick={() => {
            setAudienceBranchError(null);
            setAudienceBranchOpen(true);
          }}
          disabled={!canBranchAudience}
          className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400 disabled:opacity-40"
          title={
            canBranchAudience
              ? "Create an audience-variant branch"
              : "Available after an audience has simulated"
          }
        >
          <GitBranchPlus className="h-3 w-3" /> Audience branch
        </button>
        <button
          onClick={() => selectMainView("launch")}
          disabled={!canLaunch}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            view === "launch"
              ? "bg-indigo-600 text-white"
              : "border border-indigo-300 text-indigo-700 hover:border-indigo-500"
          } disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-transparent disabled:text-neutral-400 disabled:opacity-60`}
          title={
            canLaunch
              ? "Simulate the product launch over this audience"
              : "Available after the audience has finished simulating"
          }
        >
          <Rocket className="h-3 w-3" /> Launch Simulation
        </button>
        <button
          onClick={() => void onDownloadDossier()}
          disabled={dossierBusy || (!state.finalReport && !state.aggregate)}
          className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:border-indigo-500 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          title="Download a full graphical PDF dossier for this run"
        >
          {dossierBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FileDown className="h-3 w-3" />
          )}
          Dossier
        </button>
        {!isExportRun && canLaunch ? (
          <button
            onClick={() => openExportModal("United States")}
            disabled={exportBusy}
            className="flex items-center gap-1 rounded-lg border border-indigo-300 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:border-indigo-500 disabled:opacity-60"
            title="Carry this run forward into another market (landed cost, pricing & viability)"
          >
            {exportBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Ship className="h-3 w-3" />
            )}
            Test in another market
          </button>
        ) : null}
        {isExportRun ? (
          <button
            onClick={() => selectMainView("export")}
            disabled={!canLaunch}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
              view === "export"
                ? "bg-indigo-600 text-white"
                : "border border-indigo-300 text-indigo-700 hover:border-indigo-500"
            } disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-transparent disabled:text-neutral-400 disabled:opacity-60`}
            title={
              canLaunch
                ? "Cross-border landed cost, pricing & viability"
                : "Available after the audience has finished simulating"
            }
          >
            <Ship className="h-3 w-3" /> Export Viability
          </button>
        ) : null}
        <span
          className="flex items-center gap-1 text-[11px] text-neutral-500"
          title="simulated personas"
        >
          <Users className="h-3.5 w-3.5" />
          {personaCount.toLocaleString()}
        </span>
        <span
          className="flex items-center gap-1 text-[11px] text-neutral-500"
          title={projectUsage ? "total project LLM spend" : "current run LLM spend"}
        >
          <Coins className="h-3.5 w-3.5" />
          {totalTokensUsed.toLocaleString()} tok · ${totalCostUsd.toFixed(2)}
        </span>
        {(resumable || resuming) && (
          <button
            onClick={onResume}
            disabled={resuming}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            title="Continue this run from the last saved work — re-runs only unfinished cohorts and reuses completed desks"
          >
            {resuming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {resuming
              ? "Continuing..."
              : state.status === "cancelled"
                ? "Resume run"
                : "Continue run"}
          </button>
        )}
        {(cancellable || cancelling || state.status === "cancelling") && (
          <button
            onClick={onCancel}
            disabled={cancelling || state.status === "cancelling"}
            className="flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:border-red-400 disabled:opacity-60"
            title="Cancel this run before the next expensive step starts"
          >
            {cancelling || state.status === "cancelling" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            {cancelling || state.status === "cancelling"
              ? "Cancelling..."
              : "Cancel"}
          </button>
        )}
        <button
          onClick={replay}
          disabled={replaying}
          className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400 disabled:opacity-40"
          title="Replay the run from the event log"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </header>

      {/* Live progress while the simulation is working */}
      {progress.inProgress && (
        <div className="flex items-center gap-3 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2 text-[11px] text-neutral-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
          <span className="font-medium">{state.phaseLabel}</span>
          {progress.desksTotal > 0 && (
            <span className="text-neutral-500">
              desks {progress.desksDone}/{progress.desksTotal}
            </span>
          )}
          {progress.cohortsTotal > 0 && (
            <span className="text-neutral-500">
              cohorts {progress.cohortsDone}/{progress.cohortsTotal}
            </span>
          )}
          <span className="text-neutral-500">
            {personaCount.toLocaleString()} personas
          </span>
          <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-indigo-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.max(4, progress.pct)}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums text-neutral-500">
            {progress.pct}%
          </span>
        </div>
      )}

      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      {audienceBranchOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-neutral-950/30 px-4">
          <div className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Audience branch
                </h2>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Add one branch-only audience fact.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAudienceBranchOpen(false)}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="block text-xs font-medium text-neutral-700">
                New audience information
              </label>
              <textarea
                value={audienceBranchInfo}
                onChange={(e) => setAudienceBranchInfo(e.target.value)}
                maxLength={4000}
                rows={6}
                className="min-h-32 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="Example: this audience has already seen a trusted creator review the product."
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-neutral-400">
                  {audienceBranchInfo.length.toLocaleString()}/4,000
                </p>
                {audienceBranchError && (
                  <p className="text-[11px] text-red-600">
                    {audienceBranchError}
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setAudienceBranchOpen(false)}
                disabled={audienceBranchBusy}
                className="flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                type="button"
                onClick={onCreateAudienceBranch}
                disabled={!audienceBranchInfo.trim() || audienceBranchBusy}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {audienceBranchBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitBranchPlus className="h-3.5 w-3.5" />
                )}
                {audienceBranchBusy ? "Starting..." : "Run branch"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PanelStrip
        state={state}
        activePanel={activePanel}
        onSelectPanel={onSelectPanel}
        activeView={
          view === "geo" ||
          view === "network" ||
          view === "know-how" ||
          view === "insights" ||
          view === "playbook" ||
          view === "owner"
            ? view
            : null
        }
        onSelectMainView={selectMainView}
      />

      <div className="relative flex-1">
        {(ownerMounted || view === "owner") && (
          <div className={view === "owner" ? "" : "hidden"}>
            <OwnerDashboard
              key={runId}
              runId={runId}
              projectId={projectId}
              state={state}
            />
          </div>
        )}
        {view === "domain" && activePanel && activePanel !== "conclusion" ? (
          <DomainWorkspace
            domain={activePanel}
            state={state}
            onCite={onCite}
          />
        ) : view === "conclusion" ? (
          <ConclusionWorkspace
            state={state}
            onQuery={onQuery}
            onCite={onCite}
            reportBusy={reportBusy}
            onGenerateReport={onGenerateReport}
          />
        ) : view === "geo" ? (
          <MapView
            runId={runId}
            cohorts={cohorts}
            selectedCohortId={selectedCohortId}
            canAddAudience={canBranchAudience}
            onSelectCohort={setSelectedCohortId}
            onAudienceBatchAdded={onAudienceBatchAdded}
          />
        ) : view === "insights" ? (
          <InsightsView
            state={state}
            brief={brief}
            maxCostUsd={maxCostUsd}
            maxTokens={maxTokens}
            onSelectCohort={setSelectedCohortId}
            onChatPersona={(cohortId, personaId) => {
              setSelectedCohortId(cohortId);
              setChatTarget({ cohortId, personaId });
            }}
          />
        ) : view === "playbook" ? (
          <PlaybookView
            state={state}
            onQuery={onQuery}
            runId={runId}
            brief={brief}
          />
        ) : view === "owner" ? (
          null
        ) : view === "launch" ? (
          <LaunchSimulation runId={runId} projectId={projectId} />
        ) : view === "export" ? (
          <ExportViability runId={runId} targetMarket={targetMarket} />
        ) : view === "know-how" ? (
          <>
            <NetworkView
              state={state}
              highlightedBlocks={highlightedBlocks}
              parentRunId={parentRunId}
              childRunIds={childRunIds}
              onQuery={onQuery}
              onForkParam={onForkParam}
              onSelectCohort={setSelectedCohortId}
              knowHow
              onOpenKnowHow={setKnowHowNode}
            />
            {knowHowNode && (
              <KnowHowDrawer
                key={knowHowNode.id}
                runId={runId}
                runStatus={state.status}
                projectId={projectId}
                module={moduleForNode(knowHowNode)}
                nodeLabel={knowHowNode.label}
                onClose={() => setKnowHowNode(null)}
              />
            )}
          </>
        ) : (
          <NetworkView
            state={state}
            highlightedBlocks={highlightedBlocks}
            parentRunId={parentRunId}
            childRunIds={childRunIds}
            onQuery={onQuery}
            onForkParam={onForkParam}
            onSelectCohort={setSelectedCohortId}
          />
        )}

        {selectedCohort && (
          <CohortDrawer
            runId={runId}
            cohort={selectedCohort}
            allCohorts={cohorts}
            onClose={() => {
              setSelectedCohortId(null);
              setChatTarget(null);
            }}
            initialChatPersonaId={
              chatTarget?.cohortId === selectedCohortId
                ? chatTarget.personaId
                : undefined
            }
          />
        )}
      </div>

      {/* Test-in-another-market: edit the inherited profile for the destination
          before spinning up the dependent export branch. */}
      {exportMarket && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4"
          onClick={() => !exportBusy && setExportMarket(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <Ship className="h-4 w-4 text-indigo-600" /> Test in another market
            </h3>
            <p className="mt-1 text-[11px] text-neutral-500">
              Pick a destination, then tweak the profile for it (or leave it to
              carry your home settings forward). The product stays the same; this
              only re-aims the audience &amp; pricing for the destination.
            </p>
            <div className="mt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Destination market
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {EXPORT_MARKETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => selectExportMarket(m)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                      exportMarket === m && exportMarketScope === "market"
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <form
                onSubmit={onExportMarketSearch}
                className="mt-2 flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1"
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <input
                  value={exportMarketQuery}
                  onChange={(e) => setExportMarketQuery(e.target.value)}
                  className="min-w-0 flex-1 text-xs text-neutral-900 outline-none placeholder:text-neutral-400"
                  placeholder="Search city"
                />
                <button
                  type="submit"
                  disabled={exportMarketQuery.trim().length < 2 || exportMarketSearching}
                  className="grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                  title="Search city"
                >
                  {exportMarketSearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </button>
              </form>
              {exportMarketResults.length > 0 && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1">
                  {exportMarketResults.map((result) => (
                    <button
                      key={`${result.source}:${result.label}:${result.lat}:${result.lng}`}
                      type="button"
                      onClick={() => selectExportLocality(result)}
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-neutral-800">
                          {compactDestinationLabel(result)}
                        </span>
                        <span className="block truncate text-[10px] text-neutral-400">
                          {result.source === "known" ? "Known locality" : result.label}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {exportMarketSearchError && (
                <p className="mt-1 text-[10px] text-rose-600">
                  {exportMarketSearchError}
                </p>
              )}
              {exportMarketScope === "locality" && exportLocality && (
                <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-indigo-700">
                  <MapPin className="h-3 w-3" />
                  {exportLocality.label}
                </p>
              )}
            </div>
            <div className="mt-3 space-y-2.5">
              <label className="block text-[11px] font-medium text-neutral-600">
                Target audience
                <textarea
                  value={ovAudience}
                  onChange={(e) => setOvAudience(e.target.value)}
                  rows={2}
                  className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  placeholder="Who buys this in the destination market?"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] font-medium text-neutral-600">
                  Price band
                  <input
                    value={ovPriceBand}
                    onChange={(e) => setOvPriceBand(e.target.value)}
                    className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    placeholder="e.g. premium"
                  />
                </label>
                <label className="block text-[11px] font-medium text-neutral-600">
                  Target margin %
                  <input
                    value={ovMargin}
                    onChange={(e) => setOvMargin(e.target.value)}
                    className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    placeholder="auto"
                  />
                </label>
                <label className="block text-[11px] font-medium text-neutral-600">
                  Price min
                  <input
                    value={ovPriceMin}
                    onChange={(e) => setOvPriceMin(e.target.value)}
                    className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="block text-[11px] font-medium text-neutral-600">
                  Price max
                  <input
                    value={ovPriceMax}
                    onChange={(e) => setOvPriceMax(e.target.value)}
                    className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <label className="block text-[11px] font-medium text-neutral-600">
                Destination-specific context (optional)
                <textarea
                  value={ovContext}
                  onChange={(e) => setOvContext(e.target.value)}
                  rows={2}
                  className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  placeholder="Anything that's different in this market — positioning, competitors, occasions…"
                />
              </label>
            </div>
            {exportError && (
              <p className="mt-2 text-[11px] text-rose-600">{exportError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setExportMarket(null)}
                disabled={exportBusy}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:border-neutral-400 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void onCreateExportRun()}
                disabled={exportBusy}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {exportBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ship className="h-3.5 w-3.5" />
                )}
                Run {exportMarket} export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BadgeDollarSign,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  CornerDownLeft,
  CreditCard,
  Database,
  Factory,
  FileText,
  FolderOpen,
  Globe,
  ImageIcon,
  LayoutTemplate,
  Link2,
  Loader2,
  Megaphone,
  Palette,
  Pencil,
  Plus,
  Play,
  Printer,
  Share2,
  Ship,
  Sparkles,
  Store,
  Target,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AssetLibraryRating,
  AssetLibraryStatus,
  ChatMessage,
  ClientProfile,
  DesignAsset,
  GenerationCount,
  InterviewTranscript,
  LogoAsset,
  MetaPixelStatus,
  PendingQuestion,
  PrintColorSource,
  ProjectCampaign,
  ProjectFolder,
  ProjectGenerationPreference,
  ProjectMetaPixel,
  ProjectModuleIntent,
  ProjectPrintSpec,
  ProductImageRef,
  SiteAsset,
  SimulationRunRecord,
  WebsiteAnalysis,
} from "@/lib/schema";
import DesignStudioSection from "@/components/DesignStudioSection";
import { providerErrorMessage } from "@/lib/providerErrors";

// Conversational intake (SPEC Shot 8; v2.1 structured MCQ), now backed by a
// durable project: every message, the pending question, the finished profile
// and every simulation run auto-save to Postgres. A reload restores all of it.

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "What do you want to build? Tell me about the product, your ambition, anything you already know.",
};

// Pins the project this browser is actively working on, so a reload restores
// the SAME project even if a background run updated a different one.
const ACTIVE_PROJECT_KEY = "et_active_project";

// Rough cost model for the audience-size estimate (clearly labelled in the UI
// as an estimate). Research desks are a fixed base; each simulated agent adds
// a small mini-model cost (~25 personas per call).
const BASE_RESEARCH_COST = 1.5; // desks + planner + synthesis + demographics
const COST_PER_AGENT = 0.0006; // ≈ one mini-model call per 25 personas
const MAX_AGENTS = 10000;
function estimateRunCost(agents: number): number {
  return BASE_RESEARCH_COST + Math.max(0, agents) * COST_PER_AGENT;
}

function runStatusPresentation(status: SimulationRunRecord["status"]) {
  if (status === "complete" || status === "capped") {
    return {
      label: status === "capped" ? "Capped" : "Complete",
      icon: "complete" as const,
      tone: "bg-emerald-50 text-emerald-600",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      icon: "failed" as const,
      tone: "bg-red-50 text-red-500",
    };
  }
  if (status === "cancelled" || status === "cancelling") {
    return {
      label: status === "cancelling" ? "Cancelling" : "Cancelled",
      icon: "cancelled" as const,
      tone: "bg-neutral-100 text-neutral-500",
    };
  }
  return {
    label: status === "planning" ? "Planning" : "Running",
    icon: "loading" as const,
    tone: "bg-amber-50 text-amber-600",
  };
}

function simulationRunTitle(run: SimulationRunRecord): string {
  return (
    run.params?.brief?.trim() ||
    run.params?.focusQuestion?.trim() ||
    "Full simulation"
  );
}

type ProjectData = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  interviewTranscript: InterviewTranscript;
  ventureProfile: ClientProfile | null;
  simulationRuns: SimulationRunRecord[];
  ownerDashboard?: {
    designStudio?: {
      assets?: DesignAsset[];
      logos?: LogoAsset[];
      sites?: SiteAsset[];
    };
    moduleRegistry?: {
      intents?: Record<string, ProjectModuleIntent>;
      updatedAt?: string | null;
    };
    assetLibrary?: {
      ratings?: Record<string, AssetLibraryRating>;
      updatedAt?: string | null;
    };
    projectWorkspace?: {
      folders?: ProjectFolder[];
      campaigns?: ProjectCampaign[];
      generationPrefs?: Record<string, ProjectGenerationPreference>;
      printSpec?: ProjectPrintSpec;
      integrations?: {
        metaPixel?: ProjectMetaPixel;
      };
      updatedAt?: string | null;
    };
  } | null;
  websiteAnalysis?: WebsiteAnalysis | null;
};

type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type DocSummary = {
  id: string;
  name: string;
  charCount: number;
  chunkCount: number;
  embModel: string;
  createdAt: string;
};

type WorkspaceNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
};

type BusinessModuleId =
  | "brand"
  | "logo"
  | "businessCard"
  | "website"
  | "social"
  | "adSpend"
  | "exportImport"
  | "manufacturing"
  | "retail"
  | "financials"
  | "custom";

type ModuleRelevance = "core" | "likely" | "needs-context";

type BusinessModule = {
  id: BusinessModuleId;
  label: string;
  icon: LucideIcon;
  description: string;
  status: "Ready" | "Needs profile" | "Needs context";
  relevance: ModuleRelevance;
  enabled: boolean;
  reason: string;
  savedIntent?: ProjectModuleIntent;
};

type AssetLibraryItem = {
  id: string;
  title: string;
  type: string;
  module: string;
  description: string;
  createdAt: string;
  source: "collateral" | "logo" | "site" | "productImage";
  status: AssetLibraryStatus | "unrated";
};

type ProjectWorkspaceClient = NonNullable<
  NonNullable<ProjectData["ownerDashboard"]>["projectWorkspace"]
>;

const EMPTY_PRINT_SPEC_CLIENT: ProjectPrintSpec = {
  cmyk: { primary: "", secondary: "", accent: "" },
  pantone: { primary: "", secondary: "", accent: "" },
  exactPantoneSource: "approximation",
  notes: "",
  updatedAt: null,
};

const EMPTY_META_PIXEL_CLIENT: ProjectMetaPixel = {
  status: "not_connected",
  pixelId: "",
  notes: "",
  updatedAt: null,
};

function workspaceWithDefaults(
  workspace?: ProjectWorkspaceClient | null,
): ProjectWorkspaceClient {
  return {
    folders: workspace?.folders ?? [],
    campaigns: workspace?.campaigns ?? [],
    generationPrefs: workspace?.generationPrefs ?? {},
    printSpec: workspace?.printSpec ?? EMPTY_PRINT_SPEC_CLIENT,
    integrations: {
      metaPixel: workspace?.integrations?.metaPixel ?? EMPTY_META_PIXEL_CLIENT,
    },
    updatedAt: workspace?.updatedAt ?? null,
  };
}

const GENERATION_COUNTS: GenerationCount[] = [1, 3, 5, 10];

function estimateGenerationSpend(count: GenerationCount) {
  return count * 0.18;
}

const MODULE_CATALOG: Array<{
  id: BusinessModuleId;
  label: string;
  icon: LucideIcon;
  description: string;
}> = [
  {
    id: "brand",
    label: "Brand guidelines",
    icon: Palette,
    description: "Voice, colors, typography, logo usage, and brand rules.",
  },
  {
    id: "logo",
    label: "Logo",
    icon: Boxes,
    description: "Logo concepts, lockups, versions, and future print specs.",
  },
  {
    id: "businessCard",
    label: "Business card",
    icon: CreditCard,
    description: "Founder, sales, and retail-ready contact collateral.",
  },
  {
    id: "website",
    label: "Website",
    icon: Globe,
    description: "Landing pages, site versions, copy, and deployment flow.",
  },
  {
    id: "social",
    label: "Social media",
    icon: Share2,
    description: "Content pillars, platform plans, posts, and campaigns.",
  },
  {
    id: "adSpend",
    label: "Ad spend",
    icon: BadgeDollarSign,
    description: "Media budgets, CAC assumptions, creatives, and tests.",
  },
  {
    id: "exportImport",
    label: "Export/import",
    icon: Ship,
    description: "Market entry, compliance, duties, and destination planning.",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: Factory,
    description: "Production, suppliers, MOQ, packaging, and QA notes.",
  },
  {
    id: "retail",
    label: "Retail",
    icon: Store,
    description: "Retail pitch packs, distributor notes, and shelf strategy.",
  },
  {
    id: "financials",
    label: "Financials",
    icon: BarChart3,
    description: "Margins, runway, CAC, scenario models, and assumptions.",
  },
  {
    id: "custom",
    label: "Custom option",
    icon: Plus,
    description: "Add a business option and explain how it should be used.",
  },
];

function projectText(profile: ClientProfile | null, fallback = "") {
  return [
    fallback,
    profile?.product,
    profile?.category,
    profile?.targetAudience,
    profile?.productDetails?.materialsAndFit,
    profile?.productDetails?.differentiation,
    ...(profile?.productDetails?.heroProducts ?? []),
    ...(profile?.productDetails?.styleKeywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function projectLooksDigital(profile: ClientProfile | null, fallback = "") {
  const text = projectText(profile, fallback);
  return [
    "app",
    "saas",
    "software",
    "platform",
    "marketplace",
    "digital",
    "ai tool",
    "mobile",
    "subscription",
  ].some((word) => text.includes(word));
}

function projectLooksPhysical(profile: ClientProfile | null, fallback = "") {
  const text = projectText(profile, fallback);
  if (!text.trim()) return false;
  if (projectLooksDigital(profile, fallback)) {
    return [
      "hardware",
      "device",
      "packaging",
      "retail",
      "furniture",
      "apparel",
      "beauty",
      "food",
      "beverage",
      "skincare",
      "manufacturing",
    ].some((word) => text.includes(word));
  }
  return true;
}

function buildBusinessModules({
  profile,
  brief,
  done,
  intents = {},
}: {
  profile: ClientProfile | null;
  brief?: string;
  done: boolean;
  intents?: Record<string, ProjectModuleIntent>;
}): BusinessModule[] {
  const hasProfile = done && Boolean(profile);
  const physical = projectLooksPhysical(profile, brief);
  const digital = projectLooksDigital(profile, brief);
  const geography = (profile?.geography ?? []).join(" ").toLowerCase();
  const international =
    geography.includes("export") ||
    geography.includes("global") ||
    geography.includes("international") ||
    (profile?.geography?.length ?? 0) > 1;

  return MODULE_CATALOG.map((module) => {
    const savedIntent = intents[module.id];
    let relevance: ModuleRelevance = "likely";
    let reason = "This module is generally useful for most projects.";

    if (
      module.id === "brand" ||
      module.id === "logo" ||
      module.id === "website" ||
      module.id === "social" ||
      module.id === "financials"
    ) {
      relevance = "core";
      reason = "This is a core workspace for almost every venture.";
    }

    if (module.id === "businessCard") {
      relevance = physical ? "likely" : "needs-context";
      reason = physical
        ? "Useful for sales, retail, supplier, and partnership conversations."
        : "Explain how you would like to use business cards, since this appears to be more digital than physical.";
    }

    if (module.id === "adSpend") {
      relevance = hasProfile ? "likely" : "needs-context";
      reason = hasProfile
        ? "Ad planning can use the profile, audience, and pricing assumptions."
        : "Finish the project profile before ad-spend assumptions will be useful.";
    }

    if (module.id === "exportImport") {
      relevance = physical || international ? "likely" : "needs-context";
      reason =
        physical || international
          ? "Relevant because the project may involve physical markets, regions, or cross-border planning."
          : "Explain how you would like to use export/import, since this project does not yet show physical goods, logistics, or cross-border movement.";
    }

    if (module.id === "manufacturing") {
      relevance = physical ? "likely" : "needs-context";
      reason = physical
        ? "Relevant because the project appears to involve a physical product or supply chain."
        : "Explain how you would like to use manufacturing, since this project appears digital and does not yet include production, inventory, suppliers, or packaging.";
    }

    if (module.id === "retail") {
      relevance = physical && !digital ? "likely" : "needs-context";
      reason =
        physical && !digital
          ? "Retail planning can support channels, shelf strategy, and distributor conversations."
          : "Explain how you would like to use retail, since the project does not yet clearly involve stores, distributors, or shelf placement.";
    }

    if (module.id === "custom") {
      relevance = "needs-context";
      reason =
        "Use this when the option is specific to the business and needs a custom explanation.";
    }

    if (savedIntent) {
      return {
        ...module,
        relevance,
        reason,
        savedIntent,
        enabled: true,
        status: "Ready",
      };
    }

    return {
      ...module,
      relevance,
      reason,
      enabled: hasProfile || module.id === "custom",
      status: !hasProfile
        ? "Needs profile"
        : relevance === "needs-context"
          ? "Needs context"
          : "Ready",
    };
  });
}

function relevanceTone(relevance: ModuleRelevance) {
  if (relevance === "core") return "bg-indigo-50 text-indigo-700";
  if (relevance === "likely") return "bg-emerald-50 text-emerald-700";
  return "bg-amber-50 text-amber-700";
}

function ProjectWorkspaceRail({
  items,
  activeId,
  onSelect,
}: {
  items: WorkspaceNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="space-y-1 rounded-lg border border-neutral-200 bg-white p-2">
      <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        Workspace
      </p>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs font-medium transition-colors ${
              active
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  active ? "text-white" : "text-neutral-400"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </span>
            {typeof item.count === "number" ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active
                    ? "bg-white/15 text-white"
                    : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function ModuleRegistryGrid({
  modules,
  savingId,
  onSaveIntent,
  onOpenModule,
}: {
  modules: BusinessModule[];
  savingId: string | null;
  onSaveIntent: (module: BusinessModule, intent: string) => Promise<void>;
  onOpenModule?: (module: BusinessModule) => void;
}) {
  const [editingId, setEditingId] = useState<BusinessModuleId | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function startExplain(module: BusinessModule) {
    setEditingId(module.id);
    setDrafts((prev) => ({
      ...prev,
      [module.id]: prev[module.id] ?? module.savedIntent?.intent ?? "",
    }));
  }

  async function save(module: BusinessModule) {
    const intent = drafts[module.id]?.trim();
    if (!intent) return;
    await onSaveIntent(module, intent);
    setEditingId(null);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {modules.map((module) => {
        const Icon = module.icon;
        const editing = editingId === module.id;
        const draft = drafts[module.id] ?? module.savedIntent?.intent ?? "";
        const saving = savingId === module.id;
        return (
          <article
            key={module.id}
            className={`rounded-lg border bg-white p-4 ${
              module.enabled
                ? "border-neutral-200"
                : "border-neutral-200 opacity-70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-neutral-900">
                    {module.label}
                  </h4>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">
                    {module.description}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${relevanceTone(
                  module.relevance,
                )}`}
              >
                {module.relevance === "needs-context"
                  ? "Context"
                  : module.relevance}
              </span>
            </div>
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <p className="text-[11px] leading-5 text-neutral-500">
                {module.reason}
              </p>
              {module.savedIntent ? (
                <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                    Saved use
                  </p>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-emerald-800">
                    {module.savedIntent.intent}
                  </p>
                </div>
              ) : null}
              {editing ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [module.id]: e.target.value,
                      }))
                    }
                    placeholder={`Explain how you would like to use ${module.label.toLowerCase()} in this project.`}
                    rows={4}
                    className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void save(module)}
                      disabled={!draft.trim() || saving}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : null}
                      Save use
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-neutral-400">
                  {module.status}
                </span>
                <span className="flex items-center gap-1.5">
                  {module.relevance === "needs-context" ||
                  module.savedIntent ? (
                    <button
                      type="button"
                      disabled={!module.enabled}
                      onClick={() => startExplain(module)}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {module.savedIntent ? "Edit use" : "Explain use"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!module.enabled || !onOpenModule}
                    onClick={() => onOpenModule?.(module)}
                    className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Open
                  </button>
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

const ASSET_BUCKETS: Array<{
  id: AssetLibraryStatus | "unrated";
  label: string;
}> = [
  { id: "unrated", label: "Unrated" },
  { id: "good", label: "Good" },
  { id: "medium", label: "Medium" },
  { id: "reject", label: "Reject" },
];

function assetStatusTone(status: AssetLibraryStatus | "unrated") {
  if (status === "good") return "bg-emerald-50 text-emerald-700";
  if (status === "medium") return "bg-amber-50 text-amber-700";
  if (status === "reject") return "bg-red-50 text-red-700";
  return "bg-neutral-100 text-neutral-500";
}

function AssetLibraryCore({
  assets,
  ratingId,
  deletingId,
  onRate,
  onDelete,
}: {
  assets: AssetLibraryItem[];
  ratingId: string | null;
  deletingId: string | null;
  onRate: (
    asset: AssetLibraryItem,
    status: AssetLibraryStatus,
  ) => Promise<void>;
  onDelete: (asset: AssetLibraryItem) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {ASSET_BUCKETS.map((bucket) => {
        const bucketAssets = assets.filter(
          (asset) => asset.status === bucket.id,
        );
        return (
          <section
            key={bucket.id}
            className="rounded-lg border border-neutral-200 bg-white p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-neutral-800">
                {bucket.label}
              </h4>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${assetStatusTone(
                  bucket.id,
                )}`}
              >
                {bucketAssets.length}
              </span>
            </div>
            {bucketAssets.length > 0 ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {bucketAssets.map((asset) => (
                  <article
                    key={asset.id}
                    className="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-neutral-900">
                          {asset.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          {asset.module} · {asset.type} ·{" "}
                          {new Date(asset.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onDelete(asset)}
                        disabled={deletingId === asset.id}
                        title="Delete asset"
                        className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {deletingId === asset.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-neutral-500">
                      {asset.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(
                        ["good", "medium", "reject"] as AssetLibraryStatus[]
                      ).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => void onRate(asset, status)}
                          disabled={ratingId === asset.id}
                          className={`rounded-full border px-2 py-1 text-[10px] font-medium capitalize ${
                            asset.status === status
                              ? `${assetStatusTone(status)} border-transparent`
                              : "border-neutral-200 bg-white text-neutral-500 hover:border-indigo-300 hover:bg-indigo-50"
                          } disabled:opacity-50`}
                        >
                          {ratingId === asset.id ? "Saving" : status}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">
                No assets here.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function projectAssetTotal(project: ProjectData) {
  const studio = project.ownerDashboard?.designStudio;
  return (
    (studio?.assets?.length ?? 0) +
    (studio?.logos?.length ?? 0) +
    (studio?.sites?.length ?? 0) +
    (project.ventureProfile?.productImages?.length ?? 0)
  );
}

function readyModulesForProject(project: ProjectData) {
  return buildBusinessModules({
    profile: project.ventureProfile,
    brief: project.interviewTranscript.brief,
    done: project.interviewTranscript.done,
    intents: project.ownerDashboard?.moduleRegistry?.intents ?? {},
  }).filter((module) => module.status === "Ready").length;
}

function ProjectComparePanel({
  projects,
  selectedIds,
  onOpen,
}: {
  projects: ProjectData[];
  selectedIds: Set<string>;
  onOpen: (id: string) => void;
}) {
  const selected = projects.filter((project) => selectedIds.has(project.id));
  if (selected.length < 2) return null;

  return (
    <section className="rounded-lg border border-indigo-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Project comparison</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Compare readiness, runs, assets, and workspace coverage before
            choosing which project to push forward.
          </p>
        </div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
          {selected.length} selected
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Project</th>
              <th className="px-3 py-2 font-semibold">Profile</th>
              <th className="px-3 py-2 font-semibold">Ready modules</th>
              <th className="px-3 py-2 font-semibold">Runs</th>
              <th className="px-3 py-2 font-semibold">Assets</th>
              <th className="px-3 py-2 font-semibold">Updated</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {selected.map((project) => {
              const completeRuns = project.simulationRuns.filter(
                (run) => run.status === "complete" || run.status === "capped",
              ).length;
              return (
                <tr key={project.id}>
                  <td className="max-w-[220px] px-3 py-3">
                    <p className="truncate font-semibold text-neutral-900">
                      {project.name}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-neutral-400">
                      {project.ventureProfile?.product ??
                        project.interviewTranscript.brief ??
                        "No brief yet"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        project.interviewTranscript.done
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {project.interviewTranscript.done ? "Complete" : "Setup"}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-semibold text-neutral-800">
                    {readyModulesForProject(project)}
                  </td>
                  <td className="px-3 py-3 text-neutral-600">
                    {completeRuns} / {project.simulationRuns.length}
                  </td>
                  <td className="px-3 py-3 font-semibold text-neutral-800">
                    {projectAssetTotal(project)}
                  </td>
                  <td className="px-3 py-3 text-neutral-500">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(project.id)}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModuleWorkspaceHub({
  modules,
  selectedModuleId,
  folders,
  campaigns,
  savingKey,
  deletingKey,
  onSelectModule,
  onSaveFolder,
  onSaveCampaign,
  onDeleteWorkspaceItem,
}: {
  modules: BusinessModule[];
  selectedModuleId: BusinessModuleId;
  folders: ProjectFolder[];
  campaigns: ProjectCampaign[];
  savingKey: string | null;
  deletingKey: string | null;
  onSelectModule: (id: BusinessModuleId) => void;
  onSaveFolder: (input: {
    moduleId: BusinessModuleId;
    name: string;
    description: string;
  }) => Promise<void>;
  onSaveCampaign: (input: {
    moduleId: BusinessModuleId;
    folderId: string | null;
    name: string;
    description: string;
    status: ProjectCampaign["status"];
  }) => Promise<void>;
  onDeleteWorkspaceItem: (
    type: "folder" | "campaign",
    itemId: string,
  ) => Promise<void>;
}) {
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignFolderId, setCampaignFolderId] = useState("");
  const [campaignStatus, setCampaignStatus] =
    useState<ProjectCampaign["status"]>("draft");
  const selectedModule =
    modules.find((module) => module.id === selectedModuleId) ?? modules[0];
  const moduleFolders = folders.filter(
    (folder) => folder.moduleId === selectedModuleId,
  );
  const moduleCampaigns = campaigns.filter(
    (campaign) => campaign.moduleId === selectedModuleId,
  );

  useEffect(() => {
    setCampaignFolderId("");
  }, [selectedModuleId]);

  async function submitFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    await onSaveFolder({
      moduleId: selectedModuleId,
      name,
      description: folderDescription.trim(),
    });
    setFolderName("");
    setFolderDescription("");
  }

  async function submitCampaign(e: React.FormEvent) {
    e.preventDefault();
    const name = campaignName.trim();
    if (!name) return;
    await onSaveCampaign({
      moduleId: selectedModuleId,
      folderId: campaignFolderId || null,
      name,
      description: campaignDescription.trim(),
      status: campaignStatus,
    });
    setCampaignName("");
    setCampaignDescription("");
    setCampaignFolderId("");
    setCampaignStatus("draft");
  }

  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Folders & campaigns
          </p>
          <h3 className="mt-1 text-sm font-semibold text-neutral-900">
            Module workspace
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
            Create subgroup folders with full intent descriptions, then attach
            campaigns to the module that owns the work.
          </p>
        </div>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
          {folders.length} folders · {campaigns.length} campaigns
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {modules.map((module) => {
          const Icon = module.icon;
          const active = module.id === selectedModuleId;
          return (
            <button
              key={module.id}
              type="button"
              onClick={() => onSelectModule(module.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                active
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {module.label}
            </button>
          );
        })}
      </div>

      {selectedModule ? (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-neutral-900">
                {selectedModule.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-5 text-neutral-500">
                {selectedModule.reason}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${relevanceTone(
                selectedModule.relevance,
              )}`}
            >
              {selectedModule.status}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <form
          onSubmit={(e) => void submitFolder(e)}
          className="space-y-2 rounded-lg border border-neutral-200 p-3"
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-neutral-400" />
            <h4 className="text-xs font-semibold text-neutral-800">
              New folder
            </h4>
          </div>
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Folder name"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
          <textarea
            value={folderDescription}
            onChange={(e) => setFolderDescription(e.target.value)}
            placeholder="Describe what should live here"
            rows={3}
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={!folderName.trim() || savingKey === "folder"}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {savingKey === "folder" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add folder
          </button>
        </form>

        <form
          onSubmit={(e) => void submitCampaign(e)}
          className="space-y-2 rounded-lg border border-neutral-200 p-3"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-neutral-400" />
            <h4 className="text-xs font-semibold text-neutral-800">
              New campaign
            </h4>
          </div>
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Campaign name"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={campaignFolderId}
              onChange={(e) => setCampaignFolderId(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
            >
              <option value="">No folder</option>
              {moduleFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <select
              value={campaignStatus}
              onChange={(e) =>
                setCampaignStatus(e.target.value as ProjectCampaign["status"])
              }
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <textarea
            value={campaignDescription}
            onChange={(e) => setCampaignDescription(e.target.value)}
            placeholder="What is the campaign trying to do?"
            rows={3}
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={!campaignName.trim() || savingKey === "campaign"}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {savingKey === "campaign" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add campaign
          </button>
        </form>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-neutral-800">
            {selectedModule?.label ?? "Module"} folders
          </h4>
          {moduleFolders.length > 0 ? (
            moduleFolders.map((folder) => (
              <article
                key={folder.id}
                className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-900">
                      {folder.name}
                    </p>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-neutral-500">
                      {folder.description || "No description yet."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void onDeleteWorkspaceItem("folder", folder.id)
                    }
                    disabled={deletingKey === folder.id}
                    className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Delete folder"
                  >
                    {deletingKey === folder.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-xs text-neutral-400">
              No folders in this module.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-neutral-800">
            {selectedModule?.label ?? "Module"} campaigns
          </h4>
          {moduleCampaigns.length > 0 ? (
            moduleCampaigns.map((campaign) => {
              const folder = folders.find(
                (item) => item.id === campaign.folderId,
              );
              return (
                <article
                  key={campaign.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-neutral-900">
                          {campaign.name}
                        </p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium capitalize text-neutral-500">
                          {campaign.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-neutral-500">
                        {campaign.description || "No description yet."}
                      </p>
                      <p className="mt-1 text-[10px] text-neutral-400">
                        {folder ? `Folder: ${folder.name}` : "No folder"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void onDeleteWorkspaceItem("campaign", campaign.id)
                      }
                      disabled={deletingKey === campaign.id}
                      className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Delete campaign"
                    >
                      {deletingKey === campaign.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-xs text-neutral-400">
              No campaigns in this module.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function GenerationControls({
  modules,
  selectedModuleId,
  preferences,
  savingKey,
  onSelectModule,
  onSavePreference,
}: {
  modules: BusinessModule[];
  selectedModuleId: BusinessModuleId;
  preferences: Record<string, ProjectGenerationPreference>;
  savingKey: string | null;
  onSelectModule: (id: BusinessModuleId) => void;
  onSavePreference: (
    moduleId: BusinessModuleId,
    count: GenerationCount,
  ) => Promise<void>;
}) {
  const selectedModule =
    modules.find((module) => module.id === selectedModuleId) ?? modules[0];
  const savedCount = preferences[selectedModuleId]?.count ?? 3;

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Generations
          </p>
          <h3 className="mt-1 text-sm font-semibold text-neutral-900">
            Variant controls
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Pick how many logo, website, social, or collateral versions a user
            wants before generation starts.
          </p>
        </div>
        <Target className="h-4 w-4 text-neutral-400" />
      </div>

      <select
        value={selectedModuleId}
        onChange={(e) => onSelectModule(e.target.value as BusinessModuleId)}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
      >
        {modules.map((module) => (
          <option key={module.id} value={module.id}>
            {module.label}
          </option>
        ))}
      </select>

      {selectedModule ? (
        <div className="rounded-lg bg-neutral-50 p-3">
          <p className="text-xs font-semibold text-neutral-900">
            {selectedModule.label}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            Current setting: {savedCount} generation
            {savedCount === 1 ? "" : "s"}.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {GENERATION_COUNTS.map((count) => {
          const active = savedCount === count;
          return (
            <button
              key={count}
              type="button"
              onClick={() => void onSavePreference(selectedModuleId, count)}
              disabled={savingKey === "generation"}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-medium ${
                active
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-indigo-300 hover:bg-indigo-50"
              } disabled:opacity-50`}
            >
              <span className="block text-sm font-semibold">{count}</span>
              <span className="mt-0.5 block text-[10px] text-neutral-400">
                ~${estimateGenerationSpend(count).toFixed(2)} est.
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PrintSpecPanel({
  printSpec,
  savingKey,
  onSave,
}: {
  printSpec: ProjectPrintSpec;
  savingKey: string | null;
  onSave: (spec: {
    cmyk: ProjectPrintSpec["cmyk"];
    pantone: ProjectPrintSpec["pantone"];
    exactPantoneSource: PrintColorSource;
    notes: string;
  }) => Promise<void>;
}) {
  const [cmyk, setCmyk] = useState(printSpec.cmyk);
  const [pantone, setPantone] = useState(printSpec.pantone);
  const [source, setSource] = useState<PrintColorSource>(
    printSpec.exactPantoneSource,
  );
  const [notes, setNotes] = useState(printSpec.notes);

  useEffect(() => {
    setCmyk(printSpec.cmyk);
    setPantone(printSpec.pantone);
    setSource(printSpec.exactPantoneSource);
    setNotes(printSpec.notes);
  }, [printSpec]);

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Print colours
          </p>
          <h3 className="mt-1 text-sm font-semibold text-neutral-900">
            CMYK & Pantone guide
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Save print-ready colour specs for logo and brand guideline outputs.
            Exact Pantone values should come from a licensed guide or a
            user-entered match.
          </p>
        </div>
        <Printer className="h-4 w-4 text-neutral-400" />
      </div>

      <div className="grid gap-2">
        {(["primary", "secondary", "accent"] as const).map((key) => (
          <div key={key} className="grid gap-2 sm:grid-cols-2">
            <input
              value={cmyk[key]}
              onChange={(e) =>
                setCmyk((prev) => ({ ...prev, [key]: e.target.value }))
              }
              placeholder={`${key} CMYK`}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
            />
            <input
              value={pantone[key]}
              onChange={(e) =>
                setPantone((prev) => ({ ...prev, [key]: e.target.value }))
              }
              placeholder={`${key} Pantone`}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
            />
          </div>
        ))}
      </div>

      <select
        value={source}
        onChange={(e) => setSource(e.target.value as PrintColorSource)}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
      >
        <option value="approximation">Approximation</option>
        <option value="user_entered">User-entered Pantone</option>
        <option value="licensed_exact">Licensed exact match</option>
      </select>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Print notes, stock, finish, coating, or production caveats"
        rows={3}
        className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
      />

      <button
        type="button"
        onClick={() =>
          void onSave({
            cmyk,
            pantone,
            exactPantoneSource: source,
            notes: notes.trim(),
          })
        }
        disabled={savingKey === "print"}
        className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {savingKey === "print" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Save print guide
      </button>
    </section>
  );
}

function OperationsPanel({
  modules,
  metaPixel,
  savingKey,
  onSaveMetaPixel,
}: {
  modules: BusinessModule[];
  metaPixel: ProjectMetaPixel;
  savingKey: string | null;
  onSaveMetaPixel: (input: {
    status: MetaPixelStatus;
    pixelId: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [pixelStatus, setPixelStatus] = useState<MetaPixelStatus>(
    metaPixel.status,
  );
  const [pixelId, setPixelId] = useState(metaPixel.pixelId);
  const [pixelNotes, setPixelNotes] = useState(metaPixel.notes);
  const operationIds: BusinessModuleId[] = [
    "social",
    "adSpend",
    "exportImport",
    "manufacturing",
    "retail",
  ];
  const operationNotes: Record<BusinessModuleId, string[]> = {
    brand: [],
    logo: [],
    businessCard: [],
    website: [],
    social: ["Campaign folders", "Post concepts", "Asset rating queue"],
    adSpend: ["Budget tests", "CAC assumptions", "Meta Pixel ready later"],
    exportImport: ["Market entry", "Duties and compliance", "Importer notes"],
    manufacturing: ["Suppliers", "MOQ and costing", "Packaging and QA"],
    retail: ["Distributor pitch", "Store targets", "Shelf and sampling plan"],
    financials: [],
    custom: [],
  };

  useEffect(() => {
    setPixelStatus(metaPixel.status);
    setPixelId(metaPixel.pixelId);
    setPixelNotes(metaPixel.notes);
  }, [metaPixel]);

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Operations
          </p>
          <h3 className="mt-1 text-sm font-semibold text-neutral-900">
            Social, media, retail, manufacturing
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Track whether each operational module belongs in the project before
            deeper tools and imports are connected.
          </p>
        </div>
        <Boxes className="h-4 w-4 text-neutral-400" />
      </div>

      <div className="grid gap-2">
        {operationIds.map((id) => {
          const module = modules.find((item) => item.id === id);
          if (!module) return null;
          const Icon = module.icon;
          return (
            <article
              key={id}
              className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-900">
                      {module.label}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-neutral-500">
                      {module.reason}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${relevanceTone(
                    module.relevance,
                  )}`}
                >
                  {module.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {operationNotes[id].map((note) => (
                  <span
                    key={note}
                    className="rounded-full bg-white px-2 py-0.5 text-[10px] text-neutral-500"
                  >
                    {note}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-indigo-700" />
          <h4 className="text-xs font-semibold text-indigo-900">
            Meta Pixel placeholder
          </h4>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select
            value={pixelStatus}
            onChange={(e) => setPixelStatus(e.target.value as MetaPixelStatus)}
            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
          >
            <option value="not_connected">Not connected</option>
            <option value="planned">Planned</option>
            <option value="connected">Connected</option>
          </select>
          <input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value)}
            placeholder="Pixel ID"
            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
        </div>
        <textarea
          value={pixelNotes}
          onChange={(e) => setPixelNotes(e.target.value)}
          placeholder="Tracking notes, event names, or import plan"
          rows={2}
          className="mt-2 w-full resize-y rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={() =>
            void onSaveMetaPixel({
              status: pixelStatus,
              pixelId: pixelId.trim(),
              notes: pixelNotes.trim(),
            })
          }
          disabled={savingKey === "metaPixel"}
          className="mt-2 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {savingKey === "metaPixel" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save integration
        </button>
      </div>
    </section>
  );
}

// Projects rail shared by the setup and dashboard views: switch, rename
// (inline), or delete a project. Rename/delete hit /api/projects/[id]; the
// parent owns the persistence and state updates via the handlers it passes.
function ProjectSidebar({
  projects,
  activeId,
  onDashboard,
  onSwitch,
  onRename,
  onDelete,
}: {
  projects: ProjectSummary[];
  activeId: string | null;
  onDashboard?: () => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  function startEdit(p: ProjectSummary) {
    setEditingId(p.id);
    setDraft(p.name);
  }
  function commitEdit() {
    if (!editingId) return;
    const name = draft.trim();
    const original = projects.find((p) => p.id === editingId);
    if (name && original && name !== original.name) onRename(editingId, name);
    setEditingId(null);
  }

  return (
    <aside className="flex min-h-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Projects
        </p>
        {onDashboard ? (
          <button
            type="button"
            onClick={onDashboard}
            className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[10px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-700"
          >
            <ArrowLeft className="h-3 w-3" />
            Dashboard
          </button>
        ) : null}
      </div>
      <nav className="max-h-56 min-h-0 flex-1 overflow-y-auto p-2 md:max-h-none">
        {projects.map((p) => {
          const active = p.id === activeId;
          if (editingId === p.id) {
            return (
              <div
                key={p.id}
                className="mb-1 flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-2 py-1.5"
              >
                <input
                  ref={inputRef}
                  value={draft}
                  maxLength={120}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-xs font-medium text-neutral-900 outline-none"
                />
                <button
                  onClick={commitEdit}
                  title="Save"
                  className="shrink-0 rounded p-1 text-neutral-400 hover:text-emerald-600"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  title="Cancel"
                  className="shrink-0 rounded p-1 text-neutral-400 hover:text-neutral-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }
          return (
            <div
              key={p.id}
              className={`group mb-1 flex items-center gap-0.5 rounded-lg pr-1 transition ${
                active
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              <button
                onClick={() => onSwitch(p.id)}
                className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left"
              >
                <FolderOpen
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    active ? "text-white" : "text-neutral-400"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {p.name}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[10px] ${
                      active ? "text-neutral-300" : "text-neutral-400"
                    }`}
                  >
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
              <button
                onClick={() => startEdit(p)}
                title="Rename project"
                className={`shrink-0 rounded p-1 ${
                  active
                    ? "text-neutral-400 hover:text-white"
                    : "text-neutral-300 hover:text-indigo-600 group-hover:text-neutral-400"
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(p.id)}
                title="Delete project"
                className={`shrink-0 rounded p-1 ${
                  active
                    ? "text-neutral-400 hover:text-red-300"
                    : "text-neutral-300 hover:text-red-500 group-hover:text-neutral-400"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function IntakePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [view, setView] = useState<"dashboard" | "project">(
    projectParam ? "project" : "dashboard",
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled venture");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectPreviews, setProjectPreviews] = useState<ProjectData[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareNotice, setCompareNotice] = useState(false);
  const [savingModuleIntentId, setSavingModuleIntentId] = useState<
    string | null
  >(null);
  const [selectedWorkspaceModuleId, setSelectedWorkspaceModuleId] =
    useState<BusinessModuleId>("brand");
  const [activeWorkspaceSection, setActiveWorkspaceSection] =
    useState("workspace-overview");
  const [savingWorkspaceKey, setSavingWorkspaceKey] = useState<string | null>(
    null,
  );
  const [deletingWorkspaceItemId, setDeletingWorkspaceItemId] = useState<
    string | null
  >(null);
  const [ratingAssetId, setRatingAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  // Stack of already-answered MCQ questions (with their options) — powers Back.
  const [answeredQuestions, setAnsweredQuestions] = useState<PendingQuestion[]>(
    [],
  );
  const [done, setDone] = useState(false);
  const [brief, setBrief] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  // Website-analysis bootstrap: pre-fills the intake (ask only gaps) and feeds
  // the consumer-opinion brief into the simulation.
  const [websiteAnalysis, setWebsiteAnalysis] =
    useState<WebsiteAnalysis | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [simRuns, setSimRuns] = useState<SimulationRunRecord[]>([]);
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Free-text "Other response" for the current question.
  const [otherText, setOtherText] = useState("");
  const submittingRef = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follow-up composer state
  const [focusQuestion, setFocusQuestion] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [mode, setMode] = useState<"full" | "scoped">("full");
  const [agentCount, setAgentCount] = useState(6000); // audience size for this run
  // Text buffer for the audience-size field so it can be cleared/typed freely
  // (the bound number snaps to a floor otherwise, making it read as stuck text).
  const [agentCountText, setAgentCountText] = useState("6000");
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [runDraft, setRunDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  function toProjectSummary(p: ProjectData): ProjectSummary {
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  function setProjectUrl(id: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", id);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.dispatchEvent(
      new CustomEvent("et:project-selected", { detail: { id } }),
    );
  }

  function setDashboardUrl() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }

  function applyProject(proj: ProjectData, updateUrl = false) {
    const t = proj.interviewTranscript;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, proj.id);
      if (updateUrl) setProjectUrl(proj.id);
    }
    setProjectId(proj.id);
    setProjectName(proj.name);
    setMessages(t.messages.length > 0 ? t.messages : [GREETING]);
    setPending(t.pending);
    setAnsweredQuestions(t.answeredQuestions ?? []);
    setDone(t.done);
    setBrief(t.brief);
    setProfile(proj.ventureProfile);
    setWebsiteAnalysis(proj.websiteAnalysis ?? null);
    setWebsiteUrl(proj.websiteAnalysis?.url ?? "");
    setAnalyzing(false);
    setSimRuns(proj.simulationRuns ?? []);
    setDocuments([]);
    setUploadingImages(false);
    setSelected(new Set());
    setOtherText("");
    setInput("");
    setFocusQuestion("");
    setAdditionalContext("");
    setMode("full");
    setActiveWorkspaceSection("workspace-overview");
    void loadDocuments(proj.id);
  }

  function clearProjectState() {
    setProjectId(null);
    setProjectName("Untitled venture");
    setMessages([GREETING]);
    setPending(null);
    setAnsweredQuestions([]);
    setDone(false);
    setBrief(undefined);
    setProfile(null);
    setWebsiteAnalysis(null);
    setWebsiteUrl("");
    setAnalyzing(false);
    setSimRuns([]);
    setDocuments([]);
    setUploading(false);
    setUploadingImages(false);
    setSelected(new Set());
    setOtherText("");
    setInput("");
    setFocusQuestion("");
    setAdditionalContext("");
    setMode("full");
    setActiveWorkspaceSection("workspace-overview");
    setEditingRunId(null);
    setRunDraft("");
  }

  function currentProjectSnapshot(): ProjectData | null {
    if (!projectId) return null;
    const base = projectPreviews.find((p) => p.id === projectId);
    return {
      id: projectId,
      name: projectName,
      createdAt: base?.createdAt ?? new Date().toISOString(),
      updatedAt: base?.updatedAt ?? new Date().toISOString(),
      interviewTranscript: {
        messages,
        pending,
        answeredQuestions,
        done,
        brief,
      },
      ventureProfile: profile,
      simulationRuns: simRuns,
      ownerDashboard: base?.ownerDashboard ?? null,
      websiteAnalysis: websiteAnalysis ?? null,
    };
  }

  // Preload lightweight project previews so sidebar switching is instant and
  // does not re-enter the whole page loading state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!projectParam) {
          const summaryRes = await fetch("/api/projects");
          if (!summaryRes.ok) {
            throw new Error(`Failed to load projects (${summaryRes.status})`);
          }
          const summaries = ((await summaryRes.json()).projects ??
            []) as ProjectSummary[];
          if (cancelled) return;
          setProjects(summaries);
          if (summaries.length === 0) {
            setProjectPreviews([]);
            clearProjectState();
          }
          setView("dashboard");
          setLoading(false);

          setLoadingPreviews(true);
          fetch("/api/projects?previews=1")
            .then(async (previewRes) => {
              if (!previewRes.ok) return;
              const previews = ((await previewRes.json()).projects ??
                []) as ProjectData[];
              if (cancelled) return;
              setProjectPreviews(previews);
              setProjects(previews.map(toProjectSummary));
            })
            .catch(() => undefined)
            .finally(() => {
              if (!cancelled) setLoadingPreviews(false);
            });
          return;
        }

        const res = await fetch("/api/projects?previews=1");
        if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
        let previews = ((await res.json()).projects ?? []) as ProjectData[];
        if (cancelled) return;
        setProjectPreviews(previews);
        setProjects(previews.map(toProjectSummary));
        if (previews.length === 0) {
          clearProjectState();
          setView("dashboard");
          return;
        }
        // Resolution order: explicit ?project= → the last project this browser
        // was working on (localStorage pin) → most-recently-updated.
        // The localStorage pin makes a reload deterministic: it restores the
        // SAME project (and its in-progress questionnaire) regardless of which
        // other project was updated most recently by a background run.
        const pinnedId =
          projectParam ||
          (typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_PROJECT_KEY)
            : null);
        const proj = previews.find((p) => p.id === pinnedId) ?? previews[0];
        applyProject(proj, false);
        setView(
          projectParam && previews.some((p) => p.id === projectParam)
            ? "project"
            : "dashboard",
        );
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load project",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onPopState() {
      const id = new URL(window.location.href).searchParams.get("project");
      if (!id) {
        setView("dashboard");
        return;
      }
      const proj = projectPreviews.find((p) => p.id === id);
      if (proj) {
        applyProject(proj);
        setView("project");
      } else {
        setView("dashboard");
      }
    }
    function onSwitchProject(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) switchProject(id);
    }
    function onProjectCreated(event: Event) {
      const proj = (event as CustomEvent<{ project?: ProjectData }>).detail
        ?.project;
      if (!proj) return;
      const snapshot = currentProjectSnapshot();
      const nextPreviews = [
        proj,
        ...projectPreviews.map((p) =>
          snapshot && p.id === snapshot.id ? snapshot : p,
        ),
      ];
      setProjectPreviews(nextPreviews);
      setProjects(nextPreviews.map(toProjectSummary));
      applyProject(proj, true);
      setView("project");
    }
    async function onProjectDeleted(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const nextPreviews = projectPreviews.filter((p) => p.id !== id);
      const nextProjects = projects.filter((p) => p.id !== id);
      setProjectPreviews(nextPreviews);
      setProjects(nextProjects);
      setCompareIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (projectId === id) {
        if (nextPreviews[0]) {
          applyProject(nextPreviews[0], view === "project");
        } else {
          clearProjectState();
          setDashboardUrl();
          setView("dashboard");
        }
      }
    }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("et:switch-project", onSwitchProject);
    window.addEventListener("et:project-created", onProjectCreated);
    window.addEventListener("et:project-deleted", onProjectDeleted);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("et:switch-project", onSwitchProject);
      window.removeEventListener("et:project-created", onProjectCreated);
      window.removeEventListener("et:project-deleted", onProjectDeleted);
    };
  }, [
    projectPreviews,
    projects,
    projectId,
    projectName,
    messages,
    pending,
    answeredQuestions,
    done,
    brief,
    profile,
    simRuns,
    view,
  ]);

  // Auto-save the transcript. Fire-and-forget on purpose: a failed save must
  // not block the conversation, and the next save carries the full state.
  const persistTranscript = useCallback(
    (id: string, transcript: InterviewTranscript) => {
      setProjectPreviews((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, interviewTranscript: transcript } : p,
        ),
      );
      return fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewTranscript: transcript }),
      }).catch(() => undefined);
    },
    [],
  );

  async function switchProject(id: string) {
    let target = projectPreviews.find((p) => p.id === id);
    if (!target) {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.project) {
          throw new Error(`Failed to open project (${res.status})`);
        }
        target = data.project as ProjectData;
        setProjectPreviews((prev) =>
          prev.some((p) => p.id === target?.id) || !target
            ? prev
            : [target, ...prev],
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open project");
        return;
      }
    }
    if (!target) return;
    setView("project");
    if (target.id === projectId) {
      setProjectUrl(id);
      return;
    }
    const snapshot = currentProjectSnapshot();
    if (snapshot) {
      setProjectPreviews((prev) =>
        prev.map((p) => (p.id === snapshot.id ? snapshot : p)),
      );
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    }
    applyProject(target, true);
  }

  function showDashboard() {
    const snapshot = currentProjectSnapshot();
    if (snapshot) {
      setProjectPreviews((prev) =>
        prev.map((p) => (p.id === snapshot.id ? snapshot : p)),
      );
    }
    setDashboardUrl();
    setView("dashboard");
  }

  async function createProjectFromDashboard(e?: React.FormEvent) {
    e?.preventDefault();
    if (creatingProject) return;
    const name = newProjectName.trim() || "Untitled venture";
    setCreatingProject(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Project creation failed (${res.status})`,
        );
      }
      setCreateOpen(false);
      setNewProjectName("");
      window.dispatchEvent(
        new CustomEvent("et:project-created", {
          detail: { project: data.project as ProjectData },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project creation failed");
    } finally {
      setCreatingProject(false);
    }
  }

  function promptRenameProject(project: ProjectSummary) {
    const name = window.prompt("Rename project:", project.name);
    if (name === null || !name.trim() || name.trim() === project.name) return;
    renameProject(project.id, name.trim());
  }

  function toggleCompareProject(id: string) {
    setCompareNotice(false);
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveModuleIntent(module: BusinessModule, intent: string) {
    if (!projectId) return;
    setSavingModuleIntentId(module.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectModuleIntent: {
            moduleId: module.id,
            label: module.label,
            intent,
            reason: module.reason,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.moduleIntent) {
        throw new Error(`Save failed (${res.status})`);
      }
      const saved = data.moduleIntent as ProjectModuleIntent;
      setProjectPreviews((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const ownerDashboard = p.ownerDashboard ?? {};
          const moduleRegistry = ownerDashboard.moduleRegistry ?? {
            intents: {},
            updatedAt: null,
          };
          return {
            ...p,
            ownerDashboard: {
              ...ownerDashboard,
              moduleRegistry: {
                intents: {
                  ...(moduleRegistry.intents ?? {}),
                  [saved.moduleId]: saved,
                },
                updatedAt: saved.updatedAt,
              },
            },
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Module use save failed");
    } finally {
      setSavingModuleIntentId(null);
    }
  }

  async function rateAsset(
    asset: AssetLibraryItem,
    status: AssetLibraryStatus,
  ) {
    if (!projectId) return;
    setRatingAssetId(asset.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectAssetRating: {
            assetId: asset.id,
            type: asset.type,
            title: asset.title,
            status,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.assetRating) {
        throw new Error(`Rating failed (${res.status})`);
      }
      const rating = data.assetRating as AssetLibraryRating;
      setProjectPreviews((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const ownerDashboard = p.ownerDashboard ?? {};
          const assetLibrary = ownerDashboard.assetLibrary ?? {
            ratings: {},
            updatedAt: null,
          };
          return {
            ...p,
            ownerDashboard: {
              ...ownerDashboard,
              assetLibrary: {
                ratings: {
                  ...(assetLibrary.ratings ?? {}),
                  [rating.assetId]: rating,
                },
                updatedAt: rating.updatedAt,
              },
            },
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Asset rating failed");
    } finally {
      setRatingAssetId(null);
    }
  }

  function updateActiveWorkspace(
    update: (workspace: ProjectWorkspaceClient) => ProjectWorkspaceClient,
  ) {
    if (!projectId) return;
    setProjectPreviews((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const ownerDashboard: NonNullable<ProjectData["ownerDashboard"]> =
          p.ownerDashboard ?? {};
        const workspace = workspaceWithDefaults(
          ownerDashboard.projectWorkspace,
        );
        return {
          ...p,
          ownerDashboard: {
            ...ownerDashboard,
            projectWorkspace: update(workspace),
          },
        };
      }),
    );
  }

  async function saveWorkspaceFolder(input: {
    moduleId: BusinessModuleId;
    name: string;
    description: string;
  }) {
    if (!projectId) return;
    setSavingWorkspaceKey("folder");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectFolder: input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.folder) {
        throw new Error(`Folder save failed (${res.status})`);
      }
      const folder = data.folder as ProjectFolder;
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        folders: workspace.folders?.some((item) => item.id === folder.id)
          ? workspace.folders.map((item) =>
              item.id === folder.id ? folder : item,
            )
          : [...(workspace.folders ?? []), folder],
        updatedAt: folder.updatedAt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Folder save failed");
    } finally {
      setSavingWorkspaceKey(null);
    }
  }

  async function saveWorkspaceCampaign(input: {
    moduleId: BusinessModuleId;
    folderId: string | null;
    name: string;
    description: string;
    status: ProjectCampaign["status"];
  }) {
    if (!projectId) return;
    setSavingWorkspaceKey("campaign");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCampaign: input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.campaign) {
        throw new Error(`Campaign save failed (${res.status})`);
      }
      const campaign = data.campaign as ProjectCampaign;
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        campaigns: workspace.campaigns?.some((item) => item.id === campaign.id)
          ? workspace.campaigns.map((item) =>
              item.id === campaign.id ? campaign : item,
            )
          : [...(workspace.campaigns ?? []), campaign],
        updatedAt: campaign.updatedAt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign save failed");
    } finally {
      setSavingWorkspaceKey(null);
    }
  }

  async function saveGenerationPreference(
    moduleId: BusinessModuleId,
    count: GenerationCount,
  ) {
    if (!projectId) return;
    setSavingWorkspaceKey("generation");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationPreference: { moduleId, count } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.generationPreference) {
        throw new Error(`Generation setting failed (${res.status})`);
      }
      const preference =
        data.generationPreference as ProjectGenerationPreference;
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        generationPrefs: {
          ...(workspace.generationPrefs ?? {}),
          [preference.moduleId]: preference,
        },
        updatedAt: preference.updatedAt,
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation setting failed",
      );
    } finally {
      setSavingWorkspaceKey(null);
    }
  }

  async function savePrintSpec(input: {
    cmyk: ProjectPrintSpec["cmyk"];
    pantone: ProjectPrintSpec["pantone"];
    exactPantoneSource: PrintColorSource;
    notes: string;
  }) {
    if (!projectId) return;
    setSavingWorkspaceKey("print");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printSpec: input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.printSpec) {
        throw new Error(`Print guide save failed (${res.status})`);
      }
      const printSpec = data.printSpec as ProjectPrintSpec;
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        printSpec,
        updatedAt: printSpec.updatedAt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print guide save failed");
    } finally {
      setSavingWorkspaceKey(null);
    }
  }

  async function saveMetaPixel(input: {
    status: MetaPixelStatus;
    pixelId: string;
    notes: string;
  }) {
    if (!projectId) return;
    setSavingWorkspaceKey("metaPixel");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaPixel: input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.metaPixel) {
        throw new Error(`Meta Pixel save failed (${res.status})`);
      }
      const metaPixel = data.metaPixel as ProjectMetaPixel;
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        integrations: {
          ...(workspace.integrations ?? {}),
          metaPixel,
        },
        updatedAt: metaPixel.updatedAt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meta Pixel save failed");
    } finally {
      setSavingWorkspaceKey(null);
    }
  }

  async function deleteWorkspaceItem(
    type: "folder" | "campaign",
    itemId: string,
  ) {
    if (!projectId) return;
    if (!window.confirm(`Delete this ${type}?`)) return;
    setDeletingWorkspaceItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteProjectWorkspaceItem: { type, itemId },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.projectWorkspace) {
        throw new Error(`Delete failed (${res.status})`);
      }
      const projectWorkspace = data.projectWorkspace as ProjectWorkspaceClient;
      updateActiveWorkspace(() => workspaceWithDefaults(projectWorkspace));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingWorkspaceItemId(null);
    }
  }

  async function deleteLibraryAsset(asset: AssetLibraryItem) {
    if (!projectId) return;
    if (!window.confirm(`Delete "${asset.title}"?`)) return;
    setDeletingAssetId(asset.id);
    setError(null);
    try {
      if (asset.source === "productImage") {
        await deleteProductImage(asset.id);
        return;
      }
      const endpoint =
        asset.source === "collateral"
          ? `/api/projects/${projectId}/design/collateral?assetId=${encodeURIComponent(
              asset.id,
            )}`
          : asset.source === "logo"
            ? `/api/projects/${projectId}/design/logo?logoId=${encodeURIComponent(
                asset.id,
              )}`
            : `/api/projects/${projectId}/design/site?siteId=${encodeURIComponent(
                asset.id,
              )}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setProjectPreviews((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const ownerDashboard = p.ownerDashboard ?? {};
          const studio = ownerDashboard.designStudio;
          if (!studio) return p;
          return {
            ...p,
            ownerDashboard: {
              ...ownerDashboard,
              designStudio: {
                ...studio,
                assets:
                  asset.source === "collateral"
                    ? (studio.assets ?? []).filter((a) => a.id !== asset.id)
                    : studio.assets,
                logos:
                  asset.source === "logo"
                    ? (studio.logos ?? []).filter(
                        (logo) => logo.id !== asset.id,
                      )
                    : studio.logos,
                sites:
                  asset.source === "site"
                    ? (studio.sites ?? []).filter(
                        (site) => site.id !== asset.id,
                      )
                    : studio.sites,
              },
            },
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Asset delete failed");
    } finally {
      setDeletingAssetId(null);
    }
  }

  // Optimistic rename: update the rail + active title immediately, persist in
  // the background. A failed save self-corrects on the next project reload.
  function renameProject(id: string, name: string) {
    setProjectPreviews((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p)),
    );
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    if (id === projectId) setProjectName(name);
    void fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => undefined);
  }

  // Delete after confirmation. The shared et:project-deleted handler does the
  // state surgery (drop it, re-create if the list empties, switch off it).
  function deleteProject(id: string) {
    const target = projects.find((p) => p.id === id);
    if (
      !window.confirm(
        `Delete "${
          target?.name ?? "this project"
        }"? Its interview, profile and simulation history will be removed.`,
      )
    )
      return;
    void fetch(`/api/projects/${id}`, { method: "DELETE" })
      .then((res) => {
        if (res.ok) {
          window.dispatchEvent(
            new CustomEvent("et:project-deleted", { detail: { id } }),
          );
        }
      })
      .catch(() => undefined);
  }

  function patchRunInState(
    runId: string,
    update: (run: SimulationRunRecord) => SimulationRunRecord,
  ) {
    const updatedAt = new Date().toISOString();
    setSimRuns((prev) =>
      prev.map((run) => (run.runId === runId ? update(run) : run)),
    );
    setProjectPreviews((prev) =>
      prev.map((project) => {
        const hasRun = project.simulationRuns.some(
          (run) => run.runId === runId,
        );
        if (!hasRun) return project;
        return {
          ...project,
          updatedAt,
          simulationRuns: project.simulationRuns.map((run) =>
            run.runId === runId ? update(run) : run,
          ),
        };
      }),
    );
    if (projectId) {
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, updatedAt } : project,
        ),
      );
    }
  }

  function removeRunFromState(runId: string) {
    const updatedAt = new Date().toISOString();
    setSimRuns((prev) => prev.filter((run) => run.runId !== runId));
    setProjectPreviews((prev) =>
      prev.map((project) => {
        const hasRun = project.simulationRuns.some(
          (run) => run.runId === runId,
        );
        if (!hasRun) return project;
        return {
          ...project,
          updatedAt,
          simulationRuns: project.simulationRuns.filter(
            (run) => run.runId !== runId,
          ),
        };
      }),
    );
    if (projectId) {
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, updatedAt } : project,
        ),
      );
    }
  }

  function startRunEdit(run: SimulationRunRecord) {
    setEditingRunId(run.runId);
    setRunDraft(simulationRunTitle(run));
  }

  async function commitRunEdit() {
    if (!editingRunId) return;
    const runId = editingRunId;
    const name = runDraft.trim();
    const target = simRuns.find((run) => run.runId === runId);
    setEditingRunId(null);
    if (!target || !name || name === simulationRunTitle(target)) return;

    patchRunInState(runId, (run) => ({
      ...run,
      params: { ...run.params, brief: name },
    }));
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : `Rename failed (${res.status})`;
        throw new Error(message);
      }
    } catch (err) {
      patchRunInState(runId, () => target);
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  async function deleteSimulationRun(run: SimulationRunRecord) {
    const title = simulationRunTitle(run);
    if (
      !window.confirm(
        `Delete "${title}"? This removes the simulator run and saved launch simulations attached to it.`,
      )
    )
      return;
    const previousRuns = simRuns;
    removeRunFromState(run.runId);
    try {
      const res = await fetch(`/api/runs/${run.runId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    } catch (err) {
      setSimRuns(previousRuns);
      setProjectPreviews((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? { ...project, simulationRuns: previousRuns }
            : project,
        ),
      );
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // Analyse the founder's website + online consumer opinion, then seed the
  // interview with a correctable summary so it only asks the gaps.
  async function analyzeWebsite() {
    const url = websiteUrl.trim();
    if (!url || !projectId || analyzing || busy) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          providerErrorMessage(
            data?.error ?? data,
            `Analysis failed (${res.status})`,
          ),
        );
      const analysis = data.analysis as WebsiteAnalysis;
      setWebsiteAnalysis(analysis);

      const summaryMsg = [
        `Here's what I gathered from your site:`,
        analysis.summary,
        analysis.consumerOpinion
          ? `\nWhat customers say online (${analysis.sentiment}): ${analysis.consumerOpinion}`
          : "",
        `\nI'll only ask about what I couldn't work out. If anything above is off, just tell me — otherwise reply "looks good" and answer the few questions next.`,
      ]
        .filter(Boolean)
        .join("\n");
      const seeded: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: summaryMsg },
      ];
      setMessages(seeded);
      void persistTranscript(projectId, {
        messages: seeded,
        pending: null,
        answeredQuestions,
        done: false,
      });
    } catch (err) {
      setError(providerErrorMessage(err, "Website analysis failed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function submitAnswer(content: string) {
    if (
      submittingRef.current ||
      !content.trim() ||
      busy ||
      launching ||
      !projectId
    )
      return;
    submittingRef.current = true;
    // The MCQ question being answered now (if any) joins the Back stack.
    const justAnswered = pending;
    const nextAnswered = justAnswered
      ? [...answeredQuestions, justAnswered]
      : answeredQuestions;
    setInput("");
    setSelected(new Set());
    setOtherText("");
    setPending(null);
    setError(null);
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: content.trim() },
    ];
    setMessages(history);
    // Save the user's message before the LLM round-trip — a crash or reload
    // mid-thought loses nothing.
    void persistTranscript(projectId, {
      messages: history,
      pending: null,
      answeredQuestions: nextAnswered,
      done: false,
    });
    setBusy(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          // Skip questions the website analysis already answered.
          prefill: websiteAnalysis
            ? {
                draftProfile: websiteAnalysis.draftProfile,
                knownFields: websiteAnalysis.knownFields,
                consumerOpinion: websiteAnalysis.consumerOpinion,
              }
            : undefined,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(
            result?.error ?? result,
            `Intake failed (${res.status})`,
          ),
        );
      }

      if (!result.done) {
        const nextPending: PendingQuestion = {
          question: result.question,
          options: result.options ?? [],
          multiSelect: result.multiSelect ?? false,
        };
        const withQuestion: ChatMessage[] = [
          ...history,
          { role: "assistant", content: result.question },
        ];
        setMessages(withQuestion);
        setPending(nextPending);
        setAnsweredQuestions(nextAnswered);
        await persistTranscript(projectId, {
          messages: withQuestion,
          pending: nextPending,
          answeredQuestions: nextAnswered,
          done: false,
        });
        return;
      }

      // Interview complete — persist profile + transcript, then hand off to the
      // launch composer so the user can choose their audience size before the
      // simulation runs (rather than silently launching on a default).
      const closing: ChatMessage[] = [
        ...history,
        {
          role: "assistant",
          content:
            "Got everything I need. Choose how many agents to simulate below, then launch when you're ready.",
        },
      ];
      setMessages(closing);
      setDone(true);
      setBrief(result.brief);
      setProfile(result.profile);
      setProjectPreviews((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                interviewTranscript: {
                  messages: closing,
                  pending: null,
                  answeredQuestions: nextAnswered,
                  done: true,
                  brief: result.brief,
                },
                ventureProfile: result.profile,
              }
            : p,
        ),
      );
      await Promise.all([
        persistTranscript(projectId, {
          messages: closing,
          pending: null,
          answeredQuestions: nextAnswered,
          done: true,
          brief: result.brief,
        }),
        fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ventureProfile: result.profile }),
        }),
      ]);
    } catch (err) {
      setError(providerErrorMessage(err, "Something went wrong"));
      setLaunching(false);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  // Scoped follow-ups can only reuse a completed/capped run that actually has
  // a simulated audience. Live runs are shown in history but are not reusable.
  const latestAudienceRunId =
    [...simRuns]
      .reverse()
      .find(
        (r) =>
          (r.status === "complete" || r.status === "capped") &&
          (r.results.audienceAggregate?.totalPersonas ?? 0) > 0,
      )?.runId ?? null;

  async function launchNewRun() {
    if (!projectId || !profile || launching) return;
    const fq = focusQuestion.trim();
    const ctx = additionalContext.trim();
    // Seed the simulation with real online consumer opinion from the website
    // analysis so the synthetic audience reflects what actual customers say.
    const opinion = websiteAnalysis?.consumerOpinion?.trim();
    const composedContext =
      [
        opinion
          ? `Real online consumer opinion about this brand/category (treat as ground truth when simulating the audience): ${opinion}`
          : "",
        ctx,
      ]
        .filter(Boolean)
        .join("\n\n") || "";
    // A scoped run needs a prior run to reuse; fall back to full otherwise.
    const effectiveMode =
      mode === "scoped" && latestAudienceRunId ? "scoped" : "full";
    // Fold the focus question into the brief so it's visible on the dashboard.
    const composedBrief = fq
      ? `${brief ?? profile.product} — focus: ${fq}`
      : (brief ?? profile.product);
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: composedBrief,
          clientProfile: profile,
          projectId,
          focusQuestion: fq || undefined,
          additionalContext: composedContext || undefined,
          mode: effectiveMode,
          sourceRunId:
            effectiveMode === "scoped" ? latestAudienceRunId : undefined,
          // Audience size only applies to full runs (scoped reuses an audience).
          targetAudienceSize:
            effectiveMode === "scoped"
              ? undefined
              : Math.max(0, Math.min(MAX_AGENTS, Math.round(agentCount))),
        }),
      });
      if (!res.ok) throw new Error(`Run creation failed (${res.status})`);
      const { runId } = await res.json();
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLaunching(false);
    }
  }

  async function loadDocuments(id: string) {
    try {
      const res = await fetch(`/api/projects/${id}/documents`);
      if (res.ok) setDocuments((await res.json()).documents);
    } catch {
      // best-effort; the run still works without docs
    }
  }

  async function uploadDocument(name: string, content: string) {
    if (!projectId || !content.trim() || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(
          e.error?.toString?.() ?? `Upload failed (${res.status})`,
        );
      }
      await loadDocuments(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      // Text-ish files only (.txt/.md/.csv/.json/.tsv) — read as UTF-8.
      const text = await file.text();
      await uploadDocument(file.name, text);
    }
  }

  async function deleteDocument(docId: string) {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/documents/${docId}`, {
      method: "DELETE",
    });
    void loadDocuments(projectId);
  }

  function applyProductImages(productImages: ProductImageRef[]) {
    if (!projectId || !profile) return;
    const nextProfile: ClientProfile = { ...profile, productImages };
    setProfile(nextProfile);
    setProjectPreviews((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, ventureProfile: nextProfile } : p,
      ),
    );
  }

  async function onProductImagesPicked(files: FileList | null) {
    if (!files || !projectId || !profile || uploadingImages) return;
    const picked = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (picked.length === 0) return;

    setUploadingImages(true);
    setError(null);
    try {
      for (const file of picked) {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch(`/api/projects/${projectId}/product-images`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : `Image upload failed (${res.status})`,
          );
        }
        applyProductImages((data.productImages ?? []) as ProductImageRef[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImages(false);
    }
  }

  async function deleteProductImage(imageId: string) {
    if (!projectId || !profile) return;
    const prior = profile.productImages ?? [];
    applyProductImages(prior.filter((image) => image.id !== imageId));
    try {
      const res = await fetch(
        `/api/projects/${projectId}/product-images/${imageId}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Image removal failed (${res.status})`,
        );
      }
      applyProductImages((data.productImages ?? []) as ProductImageRef[]);
    } catch (err) {
      applyProductImages(prior);
      setError(err instanceof Error ? err.message : "Image removal failed");
    }
  }

  function clickOption(opt: string) {
    if (!pending) return;
    if (!pending.multiSelect) {
      void submitAnswer(opt); // single-select: click = answer
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    // typed text wins; otherwise submit the multi-selection
    if (input.trim()) void submitAnswer(input);
    else if (pending?.multiSelect && selected.size > 0)
      void submitAnswer(Array.from(selected).join(", "));
  }

  const otherReady = otherText.trim().length > 0;
  const canContinue =
    !busy &&
    !launching &&
    (pending?.multiSelect ? selected.size > 0 || otherReady : otherReady);

  // Submit the current question: selected options (+ Other text) for
  // multi-select, or just the Other text for single-select.
  function submitInline() {
    if (!pending || !canContinue) return;
    if (pending.multiSelect) {
      const parts = Array.from(selected);
      if (otherReady) parts.push(otherText.trim());
      void submitAnswer(parts.join(", "));
    } else if (otherReady) {
      void submitAnswer(otherText.trim());
    }
  }

  // Can step back as long as we're on a question with a prior step to revert.
  const canGoBack =
    !busy && !launching && !done && pending !== null && messages.length >= 3;

  // Revert the last answer: restore the previous question (with its exact
  // options) and pre-fill the choices the user had made for it.
  function goBack() {
    if (!projectId || !canGoBack) return;
    const prevAnswer = messages[messages.length - 2]?.content ?? "";
    const newMessages = messages.slice(0, -2); // drop last answer + current Q
    setError(null);
    if (answeredQuestions.length > 0) {
      const prevQ = answeredQuestions[answeredQuestions.length - 1];
      const newAnswered = answeredQuestions.slice(0, -1);
      // Re-tick the options (and Other text) the user had chosen before.
      const parts = prevAnswer
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const optSet = new Set(prevQ.options);
      setSelected(new Set(parts.filter((p) => optSet.has(p))));
      setOtherText(parts.filter((p) => !optSet.has(p)).join(", "));
      setInput("");
      setMessages(newMessages);
      setPending(prevQ);
      setAnsweredQuestions(newAnswered);
      void persistTranscript(projectId, {
        messages: newMessages,
        pending: prevQ,
        answeredQuestions: newAnswered,
        done: false,
      });
    } else {
      // Back past the first MCQ → the opening free-text question.
      setSelected(new Set());
      setOtherText("");
      setInput(prevAnswer);
      setMessages(newMessages);
      setPending(null);
      void persistTranscript(projectId, {
        messages: newMessages,
        pending: null,
        answeredQuestions: [],
        done: false,
      });
    }
  }

  // Enter submits a multi-select question from anywhere on the page (not just
  // while the text box is focused). Text fields handle their own Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!pending?.multiSelect || busy || launching || done) return;
      if (selected.size > 0 || otherReady) {
        e.preventDefault();
        submitInline();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) {
    return (
      <main className="flex h-full items-center justify-center bg-neutral-50 px-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> restoring project…
        </div>
      </main>
    );
  }

  const sortedRuns = [...simRuns].reverse();
  const completedRuns = simRuns.filter(
    (r) => r.status === "complete" || r.status === "capped",
  ).length;
  const latestRun = sortedRuns[0];
  const userAnswers = messages.filter((m) => m.role === "user").slice(-4);
  const setupStep = done
    ? "Profile complete"
    : pending
      ? "Setup questions"
      : "Project brief";
  const profileChips = profile
    ? [
        profile.product,
        profile.category,
        profile.priceBand,
        ...(profile.productDetails?.styleKeywords ?? []),
        ...(profile.productDetails?.heroProducts ?? []),
        ...(profile.productDetails?.occasions ?? []),
        profile.productDetails?.materialsAndFit,
        profile.productDetails?.differentiation,
        ...(profile.geography ?? []),
        profile.targetAudience,
        profile.funding?.capitalAvailable
          ? `capital: ${profile.funding.capitalAvailable}`
          : null,
        profile.funding?.runwayMonths
          ? `runway: ${profile.funding.runwayMonths} months`
          : null,
      ].filter(Boolean)
    : [];
  const productImages = profile?.productImages ?? [];
  const activeProjectPreview = projectId
    ? projectPreviews.find((p) => p.id === projectId)
    : null;
  const designStudio = activeProjectPreview?.ownerDashboard?.designStudio;
  const moduleIntents =
    activeProjectPreview?.ownerDashboard?.moduleRegistry?.intents ?? {};
  const assetRatings =
    activeProjectPreview?.ownerDashboard?.assetLibrary?.ratings ?? {};
  const projectWorkspace = workspaceWithDefaults(
    activeProjectPreview?.ownerDashboard?.projectWorkspace,
  );
  const workspaceFolders = projectWorkspace.folders ?? [];
  const workspaceCampaigns = projectWorkspace.campaigns ?? [];
  const generationPrefs = projectWorkspace.generationPrefs ?? {};
  const printSpec = projectWorkspace.printSpec ?? EMPTY_PRINT_SPEC_CLIENT;
  const metaPixel =
    projectWorkspace.integrations?.metaPixel ?? EMPTY_META_PIXEL_CLIENT;
  const assetLibraryItems: AssetLibraryItem[] = [
    ...(designStudio?.assets ?? []).map((asset) => ({
      id: asset.id,
      title: asset.title,
      type: asset.type,
      module: "Collateral",
      description:
        asset.visualBrief ||
        asset.content.headline ||
        asset.content.tagline ||
        "Generated collateral asset.",
      createdAt: asset.createdAt,
      source: "collateral" as const,
      status: assetRatings[asset.id]?.status ?? "unrated",
    })),
    ...(designStudio?.logos ?? []).map((logo) => ({
      id: logo.id,
      title: `${logo.brandName} logo`,
      type: logo.style || "logo",
      module: "Logo",
      description: logo.concept,
      createdAt: logo.createdAt,
      source: "logo" as const,
      status: assetRatings[logo.id]?.status ?? "unrated",
    })),
    ...(designStudio?.sites ?? []).map((site) => ({
      id: site.id,
      title: site.title,
      type: "website",
      module: "Website",
      description: site.deployUrl
        ? `Published at ${site.deployUrl}`
        : "Generated website draft.",
      createdAt: site.createdAt,
      source: "site" as const,
      status: assetRatings[site.id]?.status ?? "unrated",
    })),
    ...productImages.map((image) => ({
      id: image.id,
      title: image.name,
      type: "product image",
      module: "Product references",
      description: image.visualSummary || "Uploaded product reference.",
      createdAt: image.uploadedAt,
      source: "productImage" as const,
      status: assetRatings[image.id]?.status ?? "unrated",
    })),
  ];
  const assetCount = assetLibraryItems.length;
  const businessModules = buildBusinessModules({
    profile,
    brief,
    done,
    intents: moduleIntents,
  });
  const readyModuleCount = businessModules.filter(
    (module) => module.status === "Ready",
  ).length;
  const needsContextModuleCount = businessModules.filter(
    (module) => module.status === "Needs context",
  ).length;
  const workspaceNavItems: WorkspaceNavItem[] = [
    { id: "workspace-overview", label: "Overview", icon: LayoutTemplate },
    {
      id: "workspace-modules",
      label: "Modules",
      icon: Building2,
      count: businessModules.length,
    },
    {
      id: "workspace-design",
      label: "Design",
      icon: Palette,
      count:
        (designStudio?.logos?.length ?? 0) +
        (designStudio?.assets?.length ?? 0) +
        (designStudio?.sites?.length ?? 0),
    },
    {
      id: "workspace-work",
      label: "Folders",
      icon: FolderOpen,
      count: workspaceFolders.length + workspaceCampaigns.length,
    },
    {
      id: "workspace-generations",
      label: "Generate",
      icon: Sparkles,
    },
    {
      id: "workspace-print",
      label: "Print",
      icon: Printer,
    },
    {
      id: "workspace-ops",
      label: "Operations",
      icon: Boxes,
    },
    {
      id: "workspace-runs",
      label: "Runs",
      icon: BarChart3,
      count: simRuns.length,
    },
    {
      id: "workspace-data",
      label: "Data",
      icon: Database,
      count: documents.length + productImages.length,
    },
    {
      id: "workspace-assets",
      label: "Assets",
      icon: ImageIcon,
      count: assetCount,
    },
  ];

  function openBusinessModule(module: BusinessModule) {
    setSelectedWorkspaceModuleId(module.id);
    if (
      module.id === "brand" ||
      module.id === "logo" ||
      module.id === "businessCard" ||
      module.id === "website"
    ) {
      setActiveWorkspaceSection("workspace-design");
      return;
    }
    if (
      module.id === "social" ||
      module.id === "adSpend" ||
      module.id === "exportImport" ||
      module.id === "manufacturing" ||
      module.id === "retail"
    ) {
      setActiveWorkspaceSection("workspace-ops");
      return;
    }
    if (module.id === "financials") {
      setActiveWorkspaceSection("workspace-runs");
      return;
    }
    setActiveWorkspaceSection("workspace-work");
  }

  const previewByProject = new Map(projectPreviews.map((p) => [p.id, p]));
  const dashboardSourceProjects = projects.map<ProjectData>((p) => {
    const preview = previewByProject.get(p.id);
    if (preview) return preview;
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      interviewTranscript: {
        messages: [],
        pending: null,
        answeredQuestions: [],
        done: false,
      },
      ventureProfile: null,
      simulationRuns: [],
    };
  });
  const dashboardProjects = dashboardSourceProjects.filter((p) => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return true;
    return [
      p.name,
      p.ventureProfile?.product,
      p.ventureProfile?.category,
      p.ventureProfile?.targetAudience,
      p.interviewTranscript.brief,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
  const totalRuns = projectPreviews.reduce(
    (sum, p) => sum + p.simulationRuns.length,
    0,
  );
  const completeRunCount = projectPreviews.reduce(
    (sum, p) =>
      sum +
      p.simulationRuns.filter(
        (r) => r.status === "complete" || r.status === "capped",
      ).length,
    0,
  );
  const setupCompleteCount = projectPreviews.filter(
    (p) => p.interviewTranscript.done,
  ).length;
  const recentProjects = [...dashboardSourceProjects]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 5);

  if (view === "dashboard" || !projectId) {
    return (
      <main className="min-h-full bg-neutral-50 text-neutral-900">
        <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
          <header className="flex flex-col gap-4 border-b border-neutral-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Command center
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">
                Project dashboard
              </h1>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                Create, open, compare, and manage project workspaces with
                modules, folders, campaigns, assets, and operational planning.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                <Plus className="h-4 w-4" />
                New project
              </button>
              <button
                type="button"
                onClick={() => setCompareNotice(true)}
                disabled={compareIds.size < 2}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <BarChart3 className="h-4 w-4" />
                Compare {compareIds.size > 0 ? `(${compareIds.size})` : ""}
              </button>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs font-medium text-neutral-500">Projects</p>
              <p className="mt-2 text-2xl font-semibold">{projects.length}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs font-medium text-neutral-500">
                Profiles complete
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {setupCompleteCount}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs font-medium text-neutral-500">
                Simulation runs
              </p>
              <p className="mt-2 text-2xl font-semibold">{totalRuns}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs font-medium text-neutral-500">
                Completed runs
              </p>
              <p className="mt-2 text-2xl font-semibold">{completeRunCount}</p>
            </div>
          </section>

          {compareNotice ? (
            <ProjectComparePanel
              projects={dashboardSourceProjects}
              selectedIds={compareIds}
              onOpen={switchProject}
            />
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Projects</h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    Open a workspace, rename it, delete it, or mark it for a
                    future comparison.
                  </p>
                  {loadingPreviews ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Hydrating run details
                    </p>
                  ) : null}
                </div>
                <input
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="Search projects"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 sm:w-64"
                />
              </div>

              {dashboardProjects.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {dashboardProjects.map((p) => {
                    const runs = p.simulationRuns;
                    const completed = runs.filter(
                      (r) => r.status === "complete" || r.status === "capped",
                    ).length;
                    const activeRun = [...runs]
                      .reverse()
                      .find(
                        (r) =>
                          r.status === "planning" ||
                          r.status === "running" ||
                          r.status === "cancelling",
                      );
                    const latest = [...runs].sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                    )[0];
                    const status = !p.interviewTranscript.done
                      ? "Setup"
                      : activeRun
                        ? "Running"
                        : completed > 0
                          ? "Active"
                          : "Ready";
                    const statusTone =
                      status === "Running"
                        ? "bg-amber-50 text-amber-700"
                        : status === "Active"
                          ? "bg-emerald-50 text-emerald-700"
                          : status === "Ready"
                            ? "bg-indigo-50 text-indigo-700"
                            : "bg-neutral-100 text-neutral-600";
                    const summary =
                      p.ventureProfile?.product ??
                      p.interviewTranscript.brief ??
                      "No venture profile yet.";
                    return (
                      <article
                        key={p.id}
                        className="rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone}`}
                            >
                              {status}
                            </span>
                            <h3 className="mt-2 truncate text-base font-semibold text-neutral-950">
                              {p.name}
                            </h3>
                            <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-neutral-500">
                              {summary}
                            </p>
                          </div>
                          <label
                            className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-500"
                            title="Select for future project comparison"
                          >
                            <input
                              type="checkbox"
                              checked={compareIds.has(p.id)}
                              onChange={() => toggleCompareProject(p.id)}
                              className="h-3.5 w-3.5 accent-indigo-600"
                            />
                            Compare
                          </label>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-md bg-neutral-50 px-2 py-2">
                            <p className="text-neutral-400">Runs</p>
                            <p className="mt-1 font-semibold text-neutral-800">
                              {runs.length}
                            </p>
                          </div>
                          <div className="rounded-md bg-neutral-50 px-2 py-2">
                            <p className="text-neutral-400">Complete</p>
                            <p className="mt-1 font-semibold text-neutral-800">
                              {completed}
                            </p>
                          </div>
                          <div className="rounded-md bg-neutral-50 px-2 py-2">
                            <p className="text-neutral-400">Updated</p>
                            <p className="mt-1 truncate font-semibold text-neutral-800">
                              {new Date(p.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {latest ? (
                          <p className="mt-3 truncate text-[11px] text-neutral-400">
                            Latest: {simulationRunTitle(latest)}
                          </p>
                        ) : (
                          <p className="mt-3 text-[11px] text-neutral-400">
                            No simulations yet.
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                          <button
                            type="button"
                            onClick={() => switchProject(p.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
                          >
                            Open workspace
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => promptRenameProject(p)}
                              title="Rename project"
                              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-indigo-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteProject(p.id)}
                              title="Delete project"
                              className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
                  <FolderOpen className="mx-auto h-8 w-8 text-neutral-300" />
                  <h3 className="mt-3 text-sm font-semibold text-neutral-800">
                    {projects.length === 0
                      ? "No projects yet"
                      : "No matching projects"}
                  </h3>
                  <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-neutral-500">
                    {projects.length === 0
                      ? "Create the first project to start the intake and simulation flow."
                      : "Try a different search or clear the search box."}
                  </p>
                  {projects.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                    >
                      <Plus className="h-4 w-4" />
                      Create project
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Compare projects</h2>
                    <p className="text-xs text-neutral-500">Readiness view</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-neutral-500">
                  Select two or more projects to prepare a comparison across
                  profile status, modules, runs, and generated assets.
                </p>
                <button
                  type="button"
                  onClick={() => setCompareNotice(true)}
                  disabled={compareIds.size < 2}
                  className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Compare selected
                </button>
              </section>

              <section className="rounded-lg border border-neutral-200 bg-white p-4">
                <h2 className="text-sm font-semibold">Recent activity</h2>
                {recentProjects.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {recentProjects.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-100 px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => switchProject(p.id)}
                          className="min-w-0 text-left"
                        >
                          <span className="block truncate text-xs font-medium text-neutral-800">
                            {p.name}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-neutral-400">
                            Updated {new Date(p.updatedAt).toLocaleString()}
                          </span>
                        </button>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-neutral-500">
                    Project updates will appear here once you create a project.
                  </p>
                )}
              </section>
            </aside>
          </div>
        </section>

        {createOpen ? (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-neutral-950/35 px-4">
            <form
              onSubmit={(e) => void createProjectFromDashboard(e)}
              className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    New project
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-neutral-950">
                    Name this venture
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Untitled venture"
                autoFocus
                className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {creatingProject ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Create and open
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </main>
    );
  }

  if (!done) {
    return (
      <main className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-neutral-50 text-neutral-900 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
        <ProjectSidebar
          projects={projects}
          activeId={projectId}
          onDashboard={showDashboard}
          onSwitch={switchProject}
          onRename={renameProject}
          onDelete={deleteProject}
        />

        <section className="min-h-0 overflow-y-auto px-4 py-6">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <ProjectWorkspaceRail
              items={workspaceNavItems}
              activeId={activeWorkspaceSection}
              onSelect={setActiveWorkspaceSection}
            />
            <div className="space-y-5">
              <section id="workspace-overview" className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Project workspace
                  </p>
                  <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">
                    {projectName}
                  </h1>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                    Finish the profile first; modules, assets, campaigns, and
                    comparison-ready project work will build from this base.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Profile
                    </p>
                    <p className="mt-1 text-lg font-semibold">{setupStep}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Modules
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {readyModuleCount} ready
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">Runs</p>
                    <p className="mt-1 text-lg font-semibold">
                      {simRuns.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">Data</p>
                    <p className="mt-1 text-lg font-semibold">
                      {documents.length + productImages.length}
                    </p>
                  </div>
                </div>
              </section>

              <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Project setup
                    </p>
                    <h1 className="mt-1 text-xl font-semibold tracking-tight">
                      {projectName}
                    </h1>
                  </div>
                  {canGoBack && (
                    <button
                      onClick={goBack}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <h2 className="text-base font-semibold leading-snug text-neutral-900">
                    {pending?.question ?? GREETING.content}
                  </h2>

                  {!pending &&
                    !done &&
                    !launching &&
                    messages.length <= 1 &&
                    !websiteAnalysis && (
                      <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-700">
                          <Sparkles className="h-3.5 w-3.5" /> Have a website?
                          I&apos;ll read your site + what customers say online,
                          pre-fill what I can, and only ask what&apos;s missing.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <input
                            value={websiteUrl}
                            onChange={(e) => setWebsiteUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void analyzeWebsite();
                              }
                            }}
                            placeholder="yourbrand.com"
                            disabled={analyzing}
                            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => void analyzeWebsite()}
                            disabled={analyzing || !websiteUrl.trim()}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                          >
                            {analyzing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {analyzing ? "Analyzing…" : "Analyze"}
                          </button>
                        </div>
                        <p className="mt-1.5 text-[10px] text-neutral-400">
                          Reads real reviews &amp; sentiment about your brand.
                          Or just start typing below to describe your venture.
                        </p>
                      </div>
                    )}

                  {pending &&
                    pending.options.length > 0 &&
                    !busy &&
                    !launching && (
                      <div className="mt-4 space-y-3">
                        {pending.multiSelect && (
                          <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                            Select multiple
                          </span>
                        )}
                        <div className="grid gap-2">
                          {pending.options.map((opt) => {
                            const isSel = selected.has(opt);
                            return (
                              <button
                                key={opt}
                                onClick={(e) => {
                                  clickOption(opt);
                                  (e.currentTarget as HTMLButtonElement).blur();
                                }}
                                className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                                  isSel
                                    ? "border-indigo-600 bg-indigo-600 text-white"
                                    : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
                                }`}
                              >
                                {pending.multiSelect && (
                                  <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSel ? "border-white bg-white/20" : "border-neutral-300"}`}
                                  >
                                    {isSel && <Check className="h-3 w-3" />}
                                  </span>
                                )}
                                <span className="min-w-0 break-words">
                                  {opt}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <input
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              submitInline();
                            }
                          }}
                          placeholder="Other response"
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
                        />
                        {(pending.multiSelect || otherReady) && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={submitInline}
                              disabled={!canContinue}
                              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                            >
                              Continue <CornerDownLeft className="h-3 w-3" />
                            </button>
                            {pending.multiSelect && (
                              <span className="text-[10px] text-neutral-400">
                                {selected.size + (otherReady ? 1 : 0)} selected
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  {!(pending && pending.options.length > 0) && (
                    <form onSubmit={send} className="mt-4">
                      <div className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2.5 focus-within:border-indigo-500">
                        <input
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          placeholder={
                            messages.length === 1
                              ? "I want to launch a teak furniture brand from Jodhpur..."
                              : "Type your answer..."
                          }
                          disabled={busy || launching}
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={!input.trim() || busy || launching}
                          className="text-neutral-400 hover:text-indigo-600 disabled:opacity-40"
                        >
                          <CornerDownLeft className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {(busy || launching) && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {launching ? "launching run..." : "thinking..."}
                  </div>
                )}
                {error && (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                )}
                <div ref={bottomRef} />
              </div>

              <section id="workspace-modules" className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Project modules</h2>
                    <p className="mt-1 text-xs text-neutral-500">
                      The business option registry is ready; most modules unlock
                      after the profile is complete.
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    {businessModules.length} options
                  </span>
                </div>
                <ModuleRegistryGrid
                  modules={businessModules}
                  savingId={savingModuleIntentId}
                  onSaveIntent={saveModuleIntent}
                  onOpenModule={openBusinessModule}
                />
              </section>

              <section id="workspace-work">
                <ModuleWorkspaceHub
                  modules={businessModules}
                  selectedModuleId={selectedWorkspaceModuleId}
                  folders={workspaceFolders}
                  campaigns={workspaceCampaigns}
                  savingKey={savingWorkspaceKey}
                  deletingKey={deletingWorkspaceItemId}
                  onSelectModule={setSelectedWorkspaceModuleId}
                  onSaveFolder={saveWorkspaceFolder}
                  onSaveCampaign={saveWorkspaceCampaign}
                  onDeleteWorkspaceItem={deleteWorkspaceItem}
                />
              </section>

              <section id="workspace-generations">
                <GenerationControls
                  modules={businessModules}
                  selectedModuleId={selectedWorkspaceModuleId}
                  preferences={generationPrefs}
                  savingKey={savingWorkspaceKey}
                  onSelectModule={setSelectedWorkspaceModuleId}
                  onSavePreference={saveGenerationPreference}
                />
              </section>

              <section id="workspace-print">
                <PrintSpecPanel
                  printSpec={printSpec}
                  savingKey={savingWorkspaceKey}
                  onSave={savePrintSpec}
                />
              </section>

              <section id="workspace-ops">
                <OperationsPanel
                  modules={businessModules}
                  metaPixel={metaPixel}
                  savingKey={savingWorkspaceKey}
                  onSaveMetaPixel={saveMetaPixel}
                />
              </section>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-neutral-50 text-neutral-900 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
      <ProjectSidebar
        projects={projects}
        activeId={projectId}
        onDashboard={showDashboard}
        onSwitch={switchProject}
        onRename={renameProject}
        onDelete={deleteProject}
      />

      <section className="min-h-0 overflow-hidden">
        <div className="grid h-full grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-4">
            <ProjectWorkspaceRail
              items={workspaceNavItems}
              activeId={activeWorkspaceSection}
              onSelect={setActiveWorkspaceSection}
            />
          </aside>

          <div className="min-w-0 overflow-y-auto px-5 py-5">
            <div className="mx-auto max-w-6xl space-y-5">
              <header
                id="workspace-overview"
                className="border-b border-neutral-200 pb-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Project workspace
                    </p>
                    <h2 className="break-words text-2xl font-semibold tracking-tight">
                      {projectName}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-neutral-500">
                      {profile?.product ??
                        brief ??
                        "Set up the venture profile, then run research and audience simulations from this workspace."}
                    </p>
                  </div>
                  {latestRun && (
                    <a
                      href={`/runs/${latestRun.runId}`}
                      className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
                    >
                      Open latest run <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </header>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                    <ClipboardList className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-neutral-500">
                    Profile
                  </p>
                  <p className="mt-1 text-lg font-semibold">{setupStep}</p>
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-neutral-500">Runs</p>
                  <p className="mt-1 text-lg font-semibold">
                    {completedRuns} complete / {simRuns.length} total
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                    <Database className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-neutral-500">Data</p>
                  <p className="mt-1 text-lg font-semibold">
                    {documents.length} uploaded
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-neutral-500">Assets</p>
                  <p className="mt-1 text-lg font-semibold">
                    {assetCount} generated
                  </p>
                </div>
              </div>

              <section
                className={
                  activeWorkspaceSection === "workspace-modules"
                    ? "space-y-3"
                    : "hidden"
                }
              >
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Project modules</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      Business options are registered here with relevance
                      prompts and saved explanations for unusual fits.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      {readyModuleCount} ready
                    </span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      {needsContextModuleCount} need context
                    </span>
                  </div>
                </div>
                <ModuleRegistryGrid
                  modules={businessModules}
                  savingId={savingModuleIntentId}
                  onSaveIntent={saveModuleIntent}
                  onOpenModule={openBusinessModule}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-design"
                    ? "rounded-lg border border-neutral-200 bg-white"
                    : "hidden"
                }
              >
                <DesignStudioSection
                  projectId={projectId}
                  sourceRunId={latestRun?.runId ?? null}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-work" ? "" : "hidden"
                }
              >
                <ModuleWorkspaceHub
                  modules={businessModules}
                  selectedModuleId={selectedWorkspaceModuleId}
                  folders={workspaceFolders}
                  campaigns={workspaceCampaigns}
                  savingKey={savingWorkspaceKey}
                  deletingKey={deletingWorkspaceItemId}
                  onSelectModule={setSelectedWorkspaceModuleId}
                  onSaveFolder={saveWorkspaceFolder}
                  onSaveCampaign={saveWorkspaceCampaign}
                  onDeleteWorkspaceItem={deleteWorkspaceItem}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-generations"
                    ? ""
                    : "hidden"
                }
              >
                <GenerationControls
                  modules={businessModules}
                  selectedModuleId={selectedWorkspaceModuleId}
                  preferences={generationPrefs}
                  savingKey={savingWorkspaceKey}
                  onSelectModule={setSelectedWorkspaceModuleId}
                  onSavePreference={saveGenerationPreference}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-print" ? "" : "hidden"
                }
              >
                <PrintSpecPanel
                  printSpec={printSpec}
                  savingKey={savingWorkspaceKey}
                  onSave={savePrintSpec}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-ops" ? "" : "hidden"
                }
              >
                <OperationsPanel
                  modules={businessModules}
                  metaPixel={metaPixel}
                  savingKey={savingWorkspaceKey}
                  onSaveMetaPixel={saveMetaPixel}
                />
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-assets"
                    ? "space-y-3"
                    : "hidden"
                }
              >
                <div>
                  <h3 className="text-sm font-semibold">Asset library</h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    Generated and uploaded project assets can be sorted into
                    Good, Medium, or Reject. Delete controls route to the source
                    asset.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Collateral
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {designStudio?.assets?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Logos
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {designStudio?.logos?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Sites
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {designStudio?.sites?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-medium text-neutral-500">
                      Product refs
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {productImages.length}
                    </p>
                  </div>
                </div>
                {assetLibraryItems.length > 0 ? (
                  <AssetLibraryCore
                    assets={assetLibraryItems}
                    ratingId={ratingAssetId}
                    deletingId={deletingAssetId}
                    onRate={rateAsset}
                    onDelete={deleteLibraryAsset}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
                    No assets yet. Generate logos, collateral, a website, or add
                    product images to start building the library.
                  </div>
                )}
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-overview"
                    ? "space-y-3"
                    : "hidden"
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Venture profile</h3>
                  {!done && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      Setup in progress
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                  {profileChips.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {profileChips.map((chip, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-neutral-700"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-500">
                      Complete the setup steps to turn this into a structured
                      venture profile.
                    </p>
                  )}
                  {profile && (
                    <div className="mt-4 border-t border-neutral-100 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                            Product images
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {productImages.length} reference
                            {productImages.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:border-indigo-400 hover:bg-indigo-50">
                          {uploadingImages ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          {uploadingImages ? "Adding" : "Add images"}
                          <input
                            type="file"
                            multiple
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            disabled={uploadingImages}
                            onChange={(e) => {
                              void onProductImagesPicked(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>

                      {productImages.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {productImages.map((image) => (
                            <div
                              key={image.id}
                              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
                            >
                              <div className="relative aspect-[4/3] bg-neutral-100">
                                <img
                                  src={image.url}
                                  alt={image.visualSummary || image.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void deleteProductImage(image.id)
                                  }
                                  className="absolute right-1.5 top-1.5 rounded bg-white/90 p-1 text-neutral-500 shadow-sm hover:text-red-500"
                                  title="Remove image"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="min-h-[76px] p-2">
                                <p className="truncate text-xs font-medium text-neutral-800">
                                  {image.name}
                                </p>
                                {image.visualSummary ? (
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-neutral-500">
                                    {image.visualSummary}
                                  </p>
                                ) : (
                                  <p className="mt-1 text-[11px] text-neutral-400">
                                    Visual summary pending
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-xs text-neutral-400">
                          <ImageIcon className="mr-2 h-4 w-4" />
                          No product images yet
                        </div>
                      )}
                    </div>
                  )}
                  {userAnswers.length > 0 && !done && (
                    <div className="mt-4 border-t border-neutral-100 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Captured so far
                      </p>
                      <div className="space-y-1.5">
                        {userAnswers.map((m, i) => (
                          <p
                            key={i}
                            className="line-clamp-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600"
                          >
                            {m.content}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-runs"
                    ? "space-y-3"
                    : "hidden"
                }
              >
                <h3 className="text-sm font-semibold">Simulation runs</h3>
                {done && profile && !launching ? (
                  <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {simRuns.length > 0
                          ? "Run a follow-up simulation"
                          : "Run a simulation"}
                      </p>
                      <h3 className="mt-1 text-base font-semibold">
                        Explore the next decision
                      </h3>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-2">
                        <input
                          value={focusQuestion}
                          onChange={(e) => setFocusQuestion(e.target.value)}
                          placeholder="Question to explore"
                          disabled={launching}
                          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
                        />
                        <textarea
                          value={additionalContext}
                          onChange={(e) => setAdditionalContext(e.target.value)}
                          placeholder="New information since the last run (optional)"
                          disabled={launching}
                          rows={3}
                          className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
                        />
                      </div>

                      <div className="space-y-3 rounded-lg bg-neutral-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-medium text-neutral-600">
                            Audience size
                          </label>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                            ~${estimateRunCost(agentCount).toFixed(2)} est.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={MAX_AGENTS}
                            step={100}
                            value={agentCount}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setAgentCount(v);
                              setAgentCountText(String(v));
                            }}
                            disabled={launching || mode === "scoped"}
                            className="min-w-0 flex-1 accent-indigo-600 disabled:opacity-40"
                          />
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MAX_AGENTS}
                            step={100}
                            value={agentCountText}
                            placeholder="6000"
                            onChange={(e) => {
                              const raw = e.target.value;
                              setAgentCountText(raw);
                              const n = Number(raw);
                              if (raw !== "" && Number.isFinite(n)) {
                                setAgentCount(
                                  Math.max(
                                    0,
                                    Math.min(MAX_AGENTS, Math.round(n)),
                                  ),
                                );
                              }
                            }}
                            onBlur={() => {
                              const n = Number(agentCountText);
                              const v =
                                agentCountText === "" || !Number.isFinite(n)
                                  ? 0
                                  : Math.max(
                                      0,
                                      Math.min(MAX_AGENTS, Math.round(n)),
                                    );
                              setAgentCount(v);
                              setAgentCountText(String(v));
                            }}
                            disabled={launching || mode === "scoped"}
                            className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 disabled:opacity-40"
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-[11px] font-medium">
                            <button
                              type="button"
                              onClick={() => setMode("full")}
                              className={`px-2.5 py-1.5 ${
                                mode === "full"
                                  ? "bg-neutral-900 text-white"
                                  : "text-neutral-600 hover:bg-neutral-50"
                              }`}
                              title="Full simulation: fresh research desks + a newly simulated audience."
                            >
                              Full
                            </button>
                            <button
                              type="button"
                              onClick={() => setMode("scoped")}
                              disabled={!latestAudienceRunId}
                              className={`px-2.5 py-1.5 disabled:opacity-40 ${
                                mode === "scoped"
                                  ? "bg-neutral-900 text-white"
                                  : "text-neutral-600 hover:bg-neutral-50"
                              }`}
                              title={
                                latestAudienceRunId
                                  ? "Re-run research toward your question and reuse the latest completed audience."
                                  : "Available after a completed simulation with an audience."
                              }
                            >
                              Lighter
                            </button>
                          </div>
                          <button
                            onClick={() => void launchNewRun()}
                            disabled={launching}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" />
                            {mode === "scoped"
                              ? "Run lighter"
                              : agentCount === 0
                                ? "Run research"
                                : `Run ${agentCount.toLocaleString()} agents`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}
                {sortedRuns.length > 0 ? (
                  <ul className="space-y-2">
                    {sortedRuns.map((r) => {
                      const status = runStatusPresentation(r.status);
                      const title = simulationRunTitle(r);
                      const meta = `${new Date(r.timestamp).toLocaleString()} · ${
                        status.label
                      } · ${r.results.blocks.length} desks · ${
                        r.results.audienceAggregate?.totalPersonas ?? 0
                      } personas · $${r.results.costUsd.toFixed(2)}${
                        r.params?.mode === "scoped" ? " · lighter" : ""
                      }`;
                      return (
                        <li key={r.runId}>
                          <div className="group flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-3 transition hover:border-indigo-300 hover:bg-indigo-50/40">
                            {editingRunId === r.runId ? (
                              <>
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status.tone}`}
                                  title={status.label}
                                >
                                  {status.icon === "complete" ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : status.icon === "failed" ||
                                    status.icon === "cancelled" ? (
                                    <XCircle className="h-4 w-4" />
                                  ) : (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <input
                                    value={runDraft}
                                    maxLength={500}
                                    autoFocus
                                    onChange={(e) =>
                                      setRunDraft(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitRunEdit();
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setEditingRunId(null);
                                      }
                                    }}
                                    className="block w-full rounded border border-indigo-300 bg-white px-2 py-1 text-sm font-medium text-neutral-900 outline-none"
                                  />
                                  <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                                    {meta}
                                  </span>
                                </span>
                              </>
                            ) : (
                              <a
                                href={`/runs/${r.runId}`}
                                className="flex min-w-0 flex-1 items-center gap-3"
                              >
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status.tone}`}
                                  title={status.label}
                                >
                                  {status.icon === "complete" ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : status.icon === "failed" ||
                                    status.icon === "cancelled" ? (
                                    <XCircle className="h-4 w-4" />
                                  ) : (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span
                                    className="block truncate text-sm font-medium text-neutral-800"
                                    title={title}
                                  >
                                    {title}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                                    {meta}
                                  </span>
                                </span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                              </a>
                            )}
                            {editingRunId === r.runId ? (
                              <>
                                <button
                                  onClick={() => void commitRunEdit()}
                                  title="Save run name"
                                  className="shrink-0 rounded p-1 text-neutral-400 hover:text-emerald-600"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingRunId(null)}
                                  title="Cancel rename"
                                  className="shrink-0 rounded p-1 text-neutral-400 hover:text-neutral-700"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startRunEdit(r)}
                                  title="Rename run"
                                  className="shrink-0 rounded p-1 text-neutral-300 opacity-0 transition hover:text-indigo-600 group-hover:opacity-100"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => void deleteSimulationRun(r)}
                                  title="Delete run"
                                  className="shrink-0 rounded p-1 text-neutral-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500">
                    No simulations yet. Finish setup to launch the first run.
                  </div>
                )}
              </section>

              <section
                className={
                  activeWorkspaceSection === "workspace-data"
                    ? "space-y-3"
                    : "hidden"
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Project data{" "}
                    {documents.length > 0 && `(${documents.length})`}
                  </h3>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:border-indigo-400 hover:bg-indigo-50">
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload
                    <input
                      type="file"
                      multiple
                      accept=".txt,.md,.csv,.tsv,.json,text/plain"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        void onFilesPicked(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  {documents.length > 0 ? (
                    <ul className="space-y-1">
                      {documents.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between rounded-lg border border-neutral-200 px-2.5 py-2 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                            <span className="truncate" title={d.name}>
                              {d.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-neutral-400">
                              {d.chunkCount} chunks
                            </span>
                          </span>
                          <button
                            onClick={() => void deleteDocument(d.id)}
                            className="shrink-0 rounded p-1 text-neutral-300 hover:text-red-500"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-neutral-500">
                      Upload sales notes, survey results, pricing, or competitor
                      lists to ground future research.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>

          <aside className="hidden">
            {!done && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Setup
                    </p>
                    <h3 className="mt-1 text-base font-semibold">
                      {pending?.question ?? GREETING.content}
                    </h3>
                  </div>
                  {canGoBack && (
                    <button
                      onClick={goBack}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back
                    </button>
                  )}
                </div>

                {pending &&
                  pending.options.length > 0 &&
                  !busy &&
                  !launching && (
                    <div className="space-y-3">
                      {pending.multiSelect && (
                        <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          Select multiple
                        </span>
                      )}
                      <div className="grid gap-2">
                        {pending.options.map((opt) => {
                          const isSel = selected.has(opt);
                          return (
                            <button
                              key={opt}
                              onClick={(e) => {
                                clickOption(opt);
                                (e.currentTarget as HTMLButtonElement).blur();
                              }}
                              className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                                isSel
                                  ? "border-indigo-600 bg-indigo-600 text-white"
                                  : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
                              }`}
                            >
                              {pending.multiSelect && (
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSel ? "border-white bg-white/20" : "border-neutral-300"}`}
                                >
                                  {isSel && <Check className="h-3 w-3" />}
                                </span>
                              )}
                              <span className="min-w-0 break-words">{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                      <input
                        value={otherText}
                        onChange={(e) => setOtherText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitInline();
                          }
                        }}
                        placeholder="Other response"
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                      />
                      {(pending.multiSelect || otherReady) && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={submitInline}
                            disabled={!canContinue}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                          >
                            Continue <CornerDownLeft className="h-3 w-3" />
                          </button>
                          {pending.multiSelect && (
                            <span className="text-[10px] text-neutral-400">
                              {selected.size + (otherReady ? 1 : 0)} selected
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                {!done && !(pending && pending.options.length > 0) && (
                  <form onSubmit={send}>
                    <div className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2.5 focus-within:border-indigo-500">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                          messages.length === 1
                            ? "I want to launch a teak furniture brand from Jodhpur..."
                            : "Type your answer..."
                        }
                        disabled={busy || launching}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!input.trim() || busy || launching}
                        className="text-neutral-400 hover:text-indigo-600 disabled:opacity-40"
                      >
                        <CornerDownLeft className="h-4 w-4" />
                      </button>
                    </div>
                  </form>
                )}

                {(busy || launching) && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {launching ? "launching run..." : "thinking..."}
                  </div>
                )}
              </section>
            )}

            {done && profile && !launching && (
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    {simRuns.length > 0
                      ? "Run a follow-up simulation"
                      : "Run a simulation"}
                  </p>
                  <h3 className="mt-1 text-base font-semibold">
                    Explore the next decision
                  </h3>
                </div>
                <input
                  value={focusQuestion}
                  onChange={(e) => setFocusQuestion(e.target.value)}
                  placeholder="Question to explore"
                  disabled={launching}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="New information since the last run (optional)"
                  disabled={launching}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                />

                <div className="space-y-1.5 rounded-lg bg-neutral-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-medium text-neutral-600">
                      Audience size
                    </label>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      ~${estimateRunCost(agentCount).toFixed(2)} est.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={MAX_AGENTS}
                      step={100}
                      value={agentCount}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setAgentCount(v);
                        setAgentCountText(String(v));
                      }}
                      disabled={launching || mode === "scoped"}
                      className="min-w-0 flex-1 accent-indigo-600 disabled:opacity-40"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_AGENTS}
                      step={100}
                      value={agentCountText}
                      placeholder="6000"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAgentCountText(raw);
                        const n = Number(raw);
                        if (raw !== "" && Number.isFinite(n)) {
                          setAgentCount(
                            Math.max(0, Math.min(MAX_AGENTS, Math.round(n))),
                          );
                        }
                      }}
                      onBlur={() => {
                        const n = Number(agentCountText);
                        const v =
                          agentCountText === "" || !Number.isFinite(n)
                            ? 0
                            : Math.max(0, Math.min(MAX_AGENTS, Math.round(n)));
                        setAgentCount(v);
                        setAgentCountText(String(v));
                      }}
                      disabled={launching || mode === "scoped"}
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => setMode("full")}
                      className={`px-2.5 py-1.5 ${mode === "full" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                      title="Full simulation: fresh research desks + a newly simulated audience."
                    >
                      Full
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("scoped")}
                      disabled={!latestAudienceRunId}
                      className={`px-2.5 py-1.5 disabled:opacity-40 ${mode === "scoped" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                      title={
                        latestAudienceRunId
                          ? "Re-run research toward your question and reuse the latest completed audience."
                          : "Available after a completed simulation with an audience."
                      }
                    >
                      Lighter
                    </button>
                  </div>
                  <button
                    onClick={() => void launchNewRun()}
                    disabled={launching}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" />
                    {mode === "scoped"
                      ? "Run lighter"
                      : agentCount === 0
                        ? "Run research"
                        : `Run ${agentCount.toLocaleString()} agents`}
                  </button>
                </div>
                {launching && (
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    launching run...
                  </div>
                )}
              </section>
            )}

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </aside>
        </div>
      </section>
    </main>
  );
}

export default function IntakePage() {
  return (
    <Suspense fallback={null}>
      <IntakePageInner />
    </Suspense>
  );
}

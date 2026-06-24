import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "./db";
import { config } from "./config";
import {
  GeneratedPlaybookSchema,
  type GeneratedPlaybook,
  AssetLibraryRatingSchema,
  BrandSocialSectionSchema,
  ClientProfileSchema,
  FinancialsSectionSchema,
  FounderStorySectionSchema,
  DesignStudioSectionSchema,
  InspirationSectionSchema,
  InterviewTranscriptSchema,
  InvestorOSSectionSchema,
  ProjectModuleIntentSchema,
  ProjectModuleRegistrySchema,
  ProjectAssetLibrarySchema,
  ProjectCampaignSchema,
  ProjectFolderSchema,
  ProjectGenerationPreferenceSchema,
  ProjectMetaPixelSchema,
  ProjectPrintSpecSchema,
  ProjectWorkspaceSchema,
  UsageLedgerSchema,
  WebsiteAnalysisSchema,
  type DesignAsset,
  type AssetLibraryRating,
  type DesignStudioSection,
  type DesignTokens,
  type GenerationCount,
  type LogoAsset,
  type SiteAsset,
  type FounderStorySection,
  type WebsiteAnalysis,
  type MarketDatum,
  type BrandKit,
  type ClientProfile,
  type FinancialModel,
  type FinancialsSection,
  type InspirationKit,
  type InspirationSection,
  type InterviewTranscript,
  type EvidenceItem,
  type InvestorKit,
  type InvestorKitEdits,
  type InvestorOSSection,
  type RoadmapItem,
  type OwnerDashboard,
  type ProjectCampaign,
  type ProjectFolder,
  type ProjectGenerationPreference,
  type ProjectMetaPixel,
  type ProjectModuleIntent,
  type ProjectPrintSpec,
  type RunStatus,
  type SimulationRunRecord,
  type UsageLedger,
} from "./schema";
import { blockToWire, cohortToWire, personaToWire } from "./wire";

// ---------------------------------------------------------------------------
// Every operation on the `projects` table — the durable workspace each
// interview message, profile update and completed simulation auto-saves
// into — routes through this module. The Prisma client itself lives in
// lib/db.ts (re-exported here so callers can import everything from store).
// ---------------------------------------------------------------------------

export { prisma } from "./db";

export const EMPTY_TRANSCRIPT: InterviewTranscript = {
  messages: [],
  pending: null,
  answeredQuestions: [],
  done: false,
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFull = ProjectSummary & {
  interviewTranscript: InterviewTranscript;
  ventureProfile: ClientProfile | null;
  audienceConfig: unknown | null;
  simulationRuns: SimulationRunRecord[];
  ownerDashboard: OwnerDashboard | null;
  websiteAnalysis: WebsiteAnalysis | null;
};

export type OwnerDashboardRunSlice = {
  founderStory: OwnerDashboard["founderStory"] | null;
  brandSocial: OwnerDashboard["brandSocial"] | null;
  financials: OwnerDashboard["financials"] | null;
  inspiration: OwnerDashboard["inspiration"] | null;
  usage: OwnerDashboard["usage"];
};

// Default state for a freshly-initialised owner dashboard.
const EMPTY_OWNER_DASHBOARD: OwnerDashboard = {
  founderStory: {
    signals: {
      founderBackground: "",
      originStory: "",
      founderMotivation: "",
      whyNow: "",
      customerInsight: "",
      categoryConviction: "",
      credibilityProof: [],
      unfairAdvantages: [],
      constraints: [],
      openQuestions: [],
    },
    evidenceIds: {},
    evidence: [],
    sources: [],
    confidence: 0,
    generatedAt: null,
  },
  brandSocial: { kit: null, checks: {}, generatedAt: null, sourceRunId: null },
  brandSocialByRun: {},
  financials: {
    model: null,
    inputs: null,
    editedKeys: [],
    generatedAt: null,
    sourceRunId: null,
    followUp: [],
  },
  financialsByRun: {},
  inspiration: { kit: null, generatedAt: null, sourceRunId: null },
  inspirationByRun: {},
  playbooks: {},
  investorOS: {
    manualEvidence: [],
    roadmap: [],
    kits: [],
    edits: {
      deckSlides: {},
      memoSections: {},
      qaAnswers: {},
      useOfFundsPlan: null,
      financialBullets: null,
      updatedAt: null,
    },
    updatedAt: null,
  },
  designStudio: {
    tokens: null,
    assets: [],
    logos: [],
    sites: [],
    generatedAt: null,
    sourceRunId: null,
  },
  moduleRegistry: {
    intents: {},
    updatedAt: null,
  },
  assetLibrary: {
    ratings: {},
    updatedAt: null,
  },
  projectWorkspace: {
    folders: [],
    campaigns: [],
    generationPrefs: {},
    printSpec: {
      cmyk: { primary: "", secondary: "", accent: "" },
      pantone: { primary: "", secondary: "", accent: "" },
      exactPantoneSource: "approximation",
      notes: "",
      updatedAt: null,
    },
    integrations: {
      metaPixel: {
        status: "not_connected",
        pixelId: "",
        notes: "",
        updatedAt: null,
      },
    },
    updatedAt: null,
  },
  usage: {
    tokensUsed: 0,
    costUsd: 0,
    features: {},
    updatedAt: null,
  },
};

// Parse the owner_dashboard JSONB SECTION BY SECTION. A whole-object parse
// would let one malformed/legacy section (e.g. a stale financial model) fail
// validation and discard EVERY section — silently wiping the founder's brand
// kit and progress. Parsing each independently means a bad section degrades to
// its empty default while the others survive.
function parseOwnerDashboard(raw: Prisma.JsonValue | null): OwnerDashboard {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const brand = BrandSocialSectionSchema.safeParse(obj.brandSocial);
  const brandByRun = z
    .record(BrandSocialSectionSchema)
    .safeParse(obj.brandSocialByRun);
  const fin = FinancialsSectionSchema.safeParse(obj.financials);
  const finByRun = z
    .record(FinancialsSectionSchema)
    .safeParse(obj.financialsByRun);
  const insp = InspirationSectionSchema.safeParse(obj.inspiration);
  const inspByRun = z
    .record(InspirationSectionSchema)
    .safeParse(obj.inspirationByRun);
  const founderStory = FounderStorySectionSchema.safeParse(obj.founderStory);
  const pb = z.record(GeneratedPlaybookSchema).safeParse(obj.playbooks);
  const investorOS = InvestorOSSectionSchema.safeParse(obj.investorOS);
  const designStudio = DesignStudioSectionSchema.safeParse(obj.designStudio);
  const moduleRegistry = ProjectModuleRegistrySchema.safeParse(
    obj.moduleRegistry,
  );
  const assetLibrary = ProjectAssetLibrarySchema.safeParse(obj.assetLibrary);
  const projectWorkspace = ProjectWorkspaceSchema.safeParse(
    obj.projectWorkspace,
  );
  const usage = UsageLedgerSchema.safeParse(obj.usage);
  const brandSocialByRun = brandByRun.success ? { ...brandByRun.data } : {};
  if (
    brand.success &&
    brand.data.sourceRunId &&
    !brandSocialByRun[brand.data.sourceRunId]
  ) {
    brandSocialByRun[brand.data.sourceRunId] = brand.data;
  }
  const financialsByRun = finByRun.success ? { ...finByRun.data } : {};
  if (
    fin.success &&
    fin.data.sourceRunId &&
    !financialsByRun[fin.data.sourceRunId]
  ) {
    financialsByRun[fin.data.sourceRunId] = fin.data;
  }
  const inspirationByRun = inspByRun.success ? { ...inspByRun.data } : {};
  if (
    insp.success &&
    insp.data.sourceRunId &&
    !inspirationByRun[insp.data.sourceRunId]
  ) {
    inspirationByRun[insp.data.sourceRunId] = insp.data;
  }
  return {
    founderStory: founderStory.success
      ? founderStory.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.founderStory),
    brandSocial: brand.success
      ? brand.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.brandSocial),
    brandSocialByRun,
    financials: fin.success
      ? fin.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.financials),
    financialsByRun,
    inspiration: insp.success
      ? insp.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.inspiration),
    inspirationByRun,
    playbooks: pb.success ? pb.data : {},
    investorOS: investorOS.success
      ? investorOS.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.investorOS),
    designStudio: designStudio.success
      ? designStudio.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.designStudio),
    moduleRegistry: moduleRegistry.success
      ? moduleRegistry.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.moduleRegistry),
    assetLibrary: assetLibrary.success
      ? assetLibrary.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.assetLibrary),
    projectWorkspace: projectWorkspace.success
      ? projectWorkspace.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.projectWorkspace),
    usage: usage.success
      ? usage.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.usage),
  };
}

function rawObject(
  raw: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

type RunSectionSchema<T extends { sourceRunId: string | null }> = {
  safeParse(input: unknown): z.SafeParseReturnType<unknown, T>;
};

function parseRunSection<T extends { sourceRunId: string | null }>(
  raw: Prisma.JsonValue | null,
  runId: string,
  byRunKey: string,
  legacyKey: string,
  schema: RunSectionSchema<T>,
  hasContent: (section: T) => boolean,
): T | null {
  const obj = rawObject(raw);
  const byRun = rawObject(obj[byRunKey] as Prisma.JsonValue | null);
  const exact = schema.safeParse(byRun[runId]);
  if (exact.success) return exact.data;

  const legacy = schema.safeParse(obj[legacyKey]);
  if (!legacy.success) return null;
  if (legacy.data.sourceRunId === runId) return legacy.data;
  if (!legacy.data.sourceRunId && hasContent(legacy.data)) return legacy.data;
  return null;
}

function toSummary(row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFull(row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  interviewTranscript: Prisma.JsonValue;
  ventureProfile: Prisma.JsonValue | null;
  audienceConfig: Prisma.JsonValue | null;
  simulationRuns: Prisma.JsonValue;
  ownerDashboard: Prisma.JsonValue | null;
  websiteAnalysis?: Prisma.JsonValue | null;
}): ProjectFull {
  const transcript = InterviewTranscriptSchema.safeParse(
    row.interviewTranscript,
  );
  const website = row.websiteAnalysis
    ? WebsiteAnalysisSchema.safeParse(row.websiteAnalysis)
    : null;
  return {
    ...toSummary(row),
    interviewTranscript: transcript.success
      ? transcript.data
      : EMPTY_TRANSCRIPT,
    ventureProfile: (row.ventureProfile as ClientProfile | null) ?? null,
    audienceConfig: row.audienceConfig ?? null,
    simulationRuns: Array.isArray(row.simulationRuns)
      ? (row.simulationRuns as unknown as SimulationRunRecord[])
      : [],
    ownerDashboard: row.ownerDashboard
      ? parseOwnerDashboard(row.ownerDashboard)
      : null,
    websiteAnalysis: website && website.success ? website.data : null,
  };
}

function emptyRunResults(run: {
  tokensUsed: number;
  costUsd: number;
}): SimulationRunRecord["results"] {
  return {
    tokensUsed: run.tokensUsed,
    costUsd: run.costUsd,
    blocks: [],
    edges: [],
    cohorts: [],
    audienceAggregate: null,
  };
}

function runRowToRecord(row: {
  id: string;
  brief: string;
  clientProfile: string;
  status: string;
  focusQuestion: string | null;
  additionalContext: string | null;
  mode: string;
  sourceRunId: string | null;
  tokensUsed: number;
  costUsd: number;
  createdAt: Date;
}): SimulationRunRecord {
  return {
    runId: row.id,
    timestamp: row.createdAt.toISOString(),
    status: row.status as RunStatus,
    params: {
      brief: row.brief,
      clientProfile: ClientProfileSchema.parse(JSON.parse(row.clientProfile)),
      focusQuestion: row.focusQuestion,
      additionalContext: row.additionalContext,
      mode: row.mode as SimulationRunRecord["params"]["mode"],
      sourceRunId: row.sourceRunId,
      model: config.model,
      miniModel: config.miniModel,
      maxTokensPerRun: config.maxTokensPerRun,
      maxCostUsd: config.maxCostUsd,
      maxBlocksPerRun: config.maxBlocksPerRun,
      maxDesksPerRun: config.maxDesksPerRun,
      maxLayers: config.maxLayers,
      maxCohorts: config.maxCohorts,
      personasPerCohort: config.personasPerCohort,
      mockMode: config.mockMode,
    },
    results: emptyRunResults(row),
  };
}

type LiveRunJobSummary = {
  status: string;
  cancelRequested: boolean;
  updatedAt: Date;
};

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "complete",
  "failed",
  "capped",
  "cancelled",
]);

function displayStatusForLiveRun(row: {
  status: string;
  jobs?: LiveRunJobSummary[];
}): RunStatus {
  if (row.status !== "cancelling") return row.status as RunStatus;

  const activeCancelJobs =
    row.jobs?.filter(
      (job) =>
        job.cancelRequested &&
        (job.status === "queued" || job.status === "running"),
    ) ?? [];
  if (activeCancelJobs.length === 0) return "cancelled";

  const newestUpdate = Math.max(
    ...activeCancelJobs.map((job) => job.updatedAt.getTime()),
  );
  const staleAfterMs = Math.max(config.cohortTimeoutMs * 2, 5 * 60_000);
  return Date.now() - newestUpdate > staleAfterMs ? "cancelled" : "cancelling";
}

/**
 * Merge live Run rows into the saved project snapshots so the home page can
 * show queued/planning/running runs before the final snapshot is appended.
 */
async function withLiveRunSummaries(
  project: ProjectFull,
): Promise<ProjectFull> {
  const rows = await prisma.run.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      brief: true,
      clientProfile: true,
      status: true,
      focusQuestion: true,
      additionalContext: true,
      mode: true,
      sourceRunId: true,
      tokensUsed: true,
      costUsd: true,
      createdAt: true,
      jobs: {
        select: {
          status: true,
          cancelRequested: true,
          updatedAt: true,
        },
      },
    },
  });
  if (rows.length === 0) return project;

  const byRunId = new Map<string, SimulationRunRecord>();
  for (const snapshot of project.simulationRuns) {
    byRunId.set(snapshot.runId, snapshot);
  }
  for (const row of rows) {
    const existing = byRunId.get(row.id);
    const live = {
      ...runRowToRecord(row),
      status: displayStatusForLiveRun(row),
    };
    byRunId.set(
      row.id,
      existing
        ? {
            ...existing,
            status: TERMINAL_RUN_STATUSES.has(existing.status)
              ? existing.status
              : live.status,
            params: { ...existing.params, ...live.params },
            results: {
              ...existing.results,
              tokensUsed: row.tokensUsed,
              costUsd: row.costUsd,
            },
          }
        : live,
    );
  }

  return {
    ...project,
    simulationRuns: Array.from(byRunId.values()).sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    ),
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return rows.map(toSummary);
}

export async function createProject(name: string): Promise<ProjectFull> {
  const row = await prisma.project.create({ data: { name } });
  return toFull(row);
}

export async function getProject(id: string): Promise<ProjectFull | null> {
  const row = await prisma.project.findUnique({ where: { id } });
  return row ? toFull(row) : null;
}

/** The project the app restores on load: most recently updated. */
export async function getLatestProject(): Promise<ProjectFull | null> {
  const row = await prisma.project.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  return row ? toFull(row) : null;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await prisma.project.update({ where: { id }, data: { name } });
}

export async function deleteProject(id: string): Promise<void> {
  // Runs keep living (projectId -> null via onDelete: SetNull); only the
  // workspace row goes away.
  await prisma.project.delete({ where: { id } });
}

export async function saveInterviewTranscript(
  id: string,
  transcript: InterviewTranscript,
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      interviewTranscript: transcript as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function saveVentureProfile(
  id: string,
  profile: ClientProfile,
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { ventureProfile: profile as unknown as Prisma.InputJsonValue },
  });
}

export async function saveWebsiteAnalysis(
  id: string,
  analysis: WebsiteAnalysis,
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { websiteAnalysis: analysis as unknown as Prisma.InputJsonValue },
  });
}

// Web-sourced market benchmark overrides, keyed "<market>:<category>". Read with
// a lean column select (never drags in the heavy simulation_runs blob).
export async function getMarketData(
  id: string,
): Promise<Record<string, MarketDatum>> {
  const row = await prisma.project.findUnique({
    where: { id },
    select: { marketData: true },
  });
  const raw = row?.marketData;
  return raw && typeof raw === "object"
    ? (raw as Record<string, MarketDatum>)
    : {};
}

export async function saveMarketDatum(
  id: string,
  key: string,
  datum: MarketDatum,
): Promise<void> {
  const current = await getMarketData(id);
  await prisma.project.update({
    where: { id },
    data: {
      marketData: {
        ...current,
        [key]: datum,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function saveAudienceConfig(
  id: string,
  audienceConfig: unknown,
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { audienceConfig: audienceConfig as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------------------
// Owner Dashboard › Brand & Social. Read-modify-write the owner_dashboard JSON
// column (the section is small and writes are user-paced, so no concurrency
// concern). Saving a freshly-generated kit PRESERVES checks whose item id
// still exists, so the founder's progress survives a regenerate.
// ---------------------------------------------------------------------------

async function readOwnerDashboard(id: string): Promise<OwnerDashboard> {
  const row = await prisma.project.findUnique({
    where: { id },
    select: { ownerDashboard: true },
  });
  if (!row) throw new Error("project not found");
  return row.ownerDashboard
    ? parseOwnerDashboard(row.ownerDashboard)
    : structuredClone(EMPTY_OWNER_DASHBOARD);
}

async function writeOwnerDashboard(
  id: string,
  owner: OwnerDashboard,
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { ownerDashboard: owner as unknown as Prisma.InputJsonValue },
  });
}

/** Persist a generated playbook for a run (keyed by runId) on its project. */
export async function savePlaybook(
  projectId: string,
  runId: string,
  playbook: GeneratedPlaybook,
): Promise<void> {
  const owner = await readOwnerDashboard(projectId);
  owner.playbooks = { ...owner.playbooks, [runId]: playbook };
  await writeOwnerDashboard(projectId, owner);
}

/** Fetch a previously-generated playbook for a run, if any. */
export async function getPlaybook(
  projectId: string,
  runId: string,
): Promise<GeneratedPlaybook | null> {
  const owner = await readOwnerDashboard(projectId);
  return owner.playbooks[runId] ?? null;
}

export async function saveProjectModuleIntent(
  id: string,
  input: {
    moduleId: string;
    label: string;
    intent: string;
    reason?: string;
  },
): Promise<ProjectModuleIntent> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const prior = owner.moduleRegistry.intents[input.moduleId];
  const intent = ProjectModuleIntentSchema.parse({
    moduleId: input.moduleId,
    label: input.label,
    intent: input.intent,
    reason: input.reason ?? "",
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  });
  owner.moduleRegistry = ProjectModuleRegistrySchema.parse({
    intents: {
      ...owner.moduleRegistry.intents,
      [input.moduleId]: intent,
    },
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return intent;
}

export async function saveProjectAssetRating(
  id: string,
  input: {
    assetId: string;
    type: string;
    title: string;
    status: AssetLibraryRating["status"];
  },
): Promise<AssetLibraryRating> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const rating = AssetLibraryRatingSchema.parse({
    assetId: input.assetId,
    type: input.type,
    title: input.title,
    status: input.status,
    updatedAt: now,
  });
  owner.assetLibrary = ProjectAssetLibrarySchema.parse({
    ratings: {
      ...owner.assetLibrary.ratings,
      [input.assetId]: rating,
    },
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return rating;
}

export async function saveProjectFolder(
  id: string,
  input: {
    id?: string;
    moduleId: string;
    name: string;
    description?: string;
  },
): Promise<ProjectFolder> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const prior = input.id
    ? owner.projectWorkspace.folders.find((folder) => folder.id === input.id)
    : null;
  const folder = ProjectFolderSchema.parse({
    id: input.id ?? randomUUID(),
    moduleId: input.moduleId,
    name: input.name,
    description: input.description ?? "",
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  });
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    folders: prior
      ? owner.projectWorkspace.folders.map((item) =>
          item.id === folder.id ? folder : item,
        )
      : [...owner.projectWorkspace.folders, folder],
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return folder;
}

export async function saveProjectCampaign(
  id: string,
  input: {
    id?: string;
    moduleId: string;
    folderId?: string | null;
    name: string;
    description?: string;
    status?: ProjectCampaign["status"];
  },
): Promise<ProjectCampaign> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const prior = input.id
    ? owner.projectWorkspace.campaigns.find(
        (campaign) => campaign.id === input.id,
      )
    : null;
  const campaign = ProjectCampaignSchema.parse({
    id: input.id ?? randomUUID(),
    moduleId: input.moduleId,
    folderId: input.folderId ?? prior?.folderId ?? null,
    name: input.name,
    description: input.description ?? "",
    status: input.status ?? prior?.status ?? "draft",
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  });
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    campaigns: prior
      ? owner.projectWorkspace.campaigns.map((item) =>
          item.id === campaign.id ? campaign : item,
        )
      : [...owner.projectWorkspace.campaigns, campaign],
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return campaign;
}

export async function saveProjectGenerationPreference(
  id: string,
  input: {
    moduleId: string;
    count: GenerationCount;
  },
): Promise<ProjectGenerationPreference> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const preference = ProjectGenerationPreferenceSchema.parse({
    moduleId: input.moduleId,
    count: input.count,
    updatedAt: now,
  });
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    generationPrefs: {
      ...owner.projectWorkspace.generationPrefs,
      [input.moduleId]: preference,
    },
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return preference;
}

export async function saveProjectPrintSpec(
  id: string,
  input: {
    cmyk?: Partial<ProjectPrintSpec["cmyk"]>;
    pantone?: Partial<ProjectPrintSpec["pantone"]>;
    exactPantoneSource?: ProjectPrintSpec["exactPantoneSource"];
    notes?: string;
  },
): Promise<ProjectPrintSpec> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const prior = owner.projectWorkspace.printSpec;
  const printSpec = ProjectPrintSpecSchema.parse({
    cmyk: { ...prior.cmyk, ...(input.cmyk ?? {}) },
    pantone: { ...prior.pantone, ...(input.pantone ?? {}) },
    exactPantoneSource: input.exactPantoneSource ?? prior.exactPantoneSource,
    notes: input.notes ?? prior.notes,
    updatedAt: now,
  });
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    printSpec,
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return printSpec;
}

export async function saveProjectMetaPixel(
  id: string,
  input: {
    status?: ProjectMetaPixel["status"];
    pixelId?: string;
    notes?: string;
  },
): Promise<ProjectMetaPixel> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  const prior = owner.projectWorkspace.integrations.metaPixel;
  const metaPixel = ProjectMetaPixelSchema.parse({
    status: input.status ?? prior.status,
    pixelId: input.pixelId ?? prior.pixelId,
    notes: input.notes ?? prior.notes,
    updatedAt: now,
  });
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    integrations: {
      ...owner.projectWorkspace.integrations,
      metaPixel,
    },
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return metaPixel;
}

export async function deleteProjectWorkspaceItem(
  id: string,
  input: {
    type: "folder" | "campaign";
    itemId: string;
  },
): Promise<OwnerDashboard["projectWorkspace"]> {
  const owner = await readOwnerDashboard(id);
  const now = new Date().toISOString();
  owner.projectWorkspace = ProjectWorkspaceSchema.parse({
    ...owner.projectWorkspace,
    folders:
      input.type === "folder"
        ? owner.projectWorkspace.folders.filter(
            (folder) => folder.id !== input.itemId,
          )
        : owner.projectWorkspace.folders,
    campaigns:
      input.type === "campaign"
        ? owner.projectWorkspace.campaigns.filter(
            (campaign) => campaign.id !== input.itemId,
          )
        : owner.projectWorkspace.campaigns.map((campaign) =>
            campaign.folderId === input.itemId
              ? { ...campaign, folderId: null, updatedAt: now }
              : campaign,
          ),
    updatedAt: now,
  });
  await writeOwnerDashboard(id, owner);
  return owner.projectWorkspace;
}

export async function saveFounderStory(
  id: string,
  section: FounderStorySection,
): Promise<FounderStorySection> {
  const parsed = FounderStorySectionSchema.parse(section);
  const owner = await readOwnerDashboard(id);
  owner.founderStory = parsed;
  await writeOwnerDashboard(id, owner);
  return parsed;
}

export async function getFounderStory(
  id: string,
): Promise<FounderStorySection | null> {
  const owner = await readOwnerDashboard(id);
  return owner.founderStory.evidence.length || owner.founderStory.confidence > 0
    ? owner.founderStory
    : null;
}

export async function saveBrandKit(
  id: string,
  kit: BrandKit,
  sourceRunId: string,
  generatedAt: string,
): Promise<OwnerDashboard["brandSocial"]> {
  const owner = await readOwnerDashboard(id);
  const validIds = new Set(kit.checklist.map((c) => c.id));
  const prior =
    owner.brandSocialByRun[sourceRunId] ??
    (owner.brandSocial.sourceRunId === sourceRunId
      ? owner.brandSocial
      : structuredClone(EMPTY_OWNER_DASHBOARD.brandSocial));
  const checks: Record<string, boolean> = {};
  for (const [itemId, done] of Object.entries(prior.checks)) {
    if (validIds.has(itemId)) checks[itemId] = done; // keep, drop stale ids
  }
  const section = { kit, checks, generatedAt, sourceRunId };
  owner.brandSocialByRun = {
    ...owner.brandSocialByRun,
    [sourceRunId]: section,
  };
  owner.brandSocial = section;
  await writeOwnerDashboard(id, owner);
  return section;
}

// ---------------------------------------------------------------------------
// Owner Dashboard › Design Studio. Project-level (not per-run): the brand's
// design tokens are one identity for the whole venture, shared by every asset
// generator. sourceRunId is recorded for provenance only.
// ---------------------------------------------------------------------------

export async function saveDesignTokens(
  id: string,
  tokens: DesignTokens,
  sourceRunId: string | null,
  generatedAt: string,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  owner.designStudio = DesignStudioSectionSchema.parse({
    ...owner.designStudio,
    tokens,
    generatedAt,
    sourceRunId,
  });
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

export async function getDesignStudio(
  id: string,
): Promise<DesignStudioSection | null> {
  const owner = await readOwnerDashboard(id);
  return owner.designStudio.tokens || owner.designStudio.assets.length
    ? owner.designStudio
    : null;
}

/** Append (or replace by id) a rendered collateral asset, newest first. */
export async function saveDesignAsset(
  id: string,
  asset: DesignAsset,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  const rest = owner.designStudio.assets.filter((a) => a.id !== asset.id);
  owner.designStudio.assets = [asset, ...rest];
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

/** Remove a generated asset by id. */
export async function deleteDesignAsset(
  id: string,
  assetId: string,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  owner.designStudio.assets = owner.designStudio.assets.filter(
    (a) => a.id !== assetId,
  );
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

/** Append (or replace by id) a generated logo, newest first. */
export async function saveLogoAsset(
  id: string,
  logo: LogoAsset,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  const rest = owner.designStudio.logos.filter((l) => l.id !== logo.id);
  owner.designStudio.logos = [logo, ...rest];
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

/** Remove a generated logo by id. */
export async function deleteLogoAsset(
  id: string,
  logoId: string,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  owner.designStudio.logos = owner.designStudio.logos.filter(
    (l) => l.id !== logoId,
  );
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

/** Append (or replace by id) a generated site, newest first. */
export async function saveSiteAsset(
  id: string,
  site: SiteAsset,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  const rest = owner.designStudio.sites.filter((s) => s.id !== site.id);
  owner.designStudio.sites = [site, ...rest];
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

/** Record a site's published Vercel URL after a successful deploy. */
export async function setSiteDeployUrl(
  id: string,
  siteId: string,
  deployUrl: string,
): Promise<SiteAsset | null> {
  const owner = await readOwnerDashboard(id);
  const site = owner.designStudio.sites.find((s) => s.id === siteId);
  if (!site) return null;
  site.deployUrl = deployUrl;
  await writeOwnerDashboard(id, owner);
  return site;
}

/** Remove a generated site by id. */
export async function deleteSiteAsset(
  id: string,
  siteId: string,
): Promise<DesignStudioSection> {
  const owner = await readOwnerDashboard(id);
  owner.designStudio.sites = owner.designStudio.sites.filter(
    (s) => s.id !== siteId,
  );
  await writeOwnerDashboard(id, owner);
  return owner.designStudio;
}

export async function saveOwnerChecks(
  id: string,
  patch: Record<string, boolean>,
  runId?: string | null,
): Promise<void> {
  const owner = await readOwnerDashboard(id);
  if (runId) {
    const section =
      owner.brandSocialByRun[runId] ??
      (owner.brandSocial.sourceRunId === runId
        ? owner.brandSocial
        : structuredClone(EMPTY_OWNER_DASHBOARD.brandSocial));
    const next = {
      ...section,
      sourceRunId: runId,
      checks: { ...section.checks, ...patch },
    };
    owner.brandSocialByRun = { ...owner.brandSocialByRun, [runId]: next };
    owner.brandSocial = next;
  } else {
    owner.brandSocial.checks = { ...owner.brandSocial.checks, ...patch };
  }
  await writeOwnerDashboard(id, owner);
}

/**
 * Persist the Financials section (computed model + the assumptions it was
 * computed from + which inputs the founder overrode). Stored per run so a
 * destination-market model never overwrites the home-market model.
 */
export async function saveFinancials(
  id: string,
  section: FinancialsSection,
  runId?: string | null,
): Promise<FinancialsSection> {
  const parsed = FinancialsSectionSchema.parse(section);
  const owner = await readOwnerDashboard(id);
  const key = runId ?? parsed.sourceRunId ?? parsed.model?.sourceRunId ?? null;
  if (key) {
    owner.financialsByRun = { ...owner.financialsByRun, [key]: parsed };
  }
  // Keep the legacy slot updated for older code and old project rows. New
  // run-aware reads use financialsByRun first.
  owner.financials = parsed;
  await writeOwnerDashboard(id, owner);
  return parsed;
}

export async function getFinancialsSection(
  projectId: string,
  runId?: string | null,
): Promise<FinancialsSection | null> {
  try {
    const owner = await readOwnerDashboard(projectId);
    if (runId) {
      const exact = owner.financialsByRun[runId];
      if (exact) return exact;
      // Backward compatibility for projects saved before financialsByRun.
      if (
        owner.financials.sourceRunId === runId ||
        (!owner.financials.sourceRunId && owner.financials.model)
      ) {
        return owner.financials;
      }
      return null;
    }
    return owner.financials.model ? owner.financials : null;
  } catch {
    return null;
  }
}

/**
 * Persist the Inspiration section (verified videos, placement examples, success
 * stories). Read-modify-write the owner_dashboard column so the sibling
 * sections are untouched.
 */
export async function saveInspiration(
  id: string,
  kit: InspirationKit,
  sourceRunId: string,
  generatedAt: string,
): Promise<InspirationSection> {
  const owner = await readOwnerDashboard(id);
  const section = { kit, generatedAt, sourceRunId };
  owner.inspirationByRun = {
    ...owner.inspirationByRun,
    [sourceRunId]: section,
  };
  owner.inspiration = section;
  await writeOwnerDashboard(id, owner);
  return section;
}

/**
 * The computed financial model the founder built for this project, if any —
 * used to make the final report's economics quantitative. Returns null when no
 * project / no model yet (report then stays qualitative).
 */
export async function getFinancialModel(
  projectId: string,
  runId?: string | null,
): Promise<FinancialModel | null> {
  const section = await getFinancialsSection(projectId, runId);
  return section?.model ?? null;
}

export async function getInvestorOS(
  projectId: string,
): Promise<InvestorOSSection> {
  const owner = await readOwnerDashboard(projectId);
  return owner.investorOS;
}

export async function saveInvestorOS(
  projectId: string,
  section: InvestorOSSection,
): Promise<InvestorOSSection> {
  const parsed = InvestorOSSectionSchema.parse(section);
  const owner = await readOwnerDashboard(projectId);
  owner.investorOS = parsed;
  await writeOwnerDashboard(projectId, owner);
  return parsed;
}

export async function addInvestorEvidence(
  projectId: string,
  evidence: EvidenceItem,
): Promise<InvestorOSSection> {
  const owner = await readOwnerDashboard(projectId);
  owner.investorOS.manualEvidence = [
    ...owner.investorOS.manualEvidence.filter((e) => e.id !== evidence.id),
    evidence,
  ];
  owner.investorOS.updatedAt = new Date().toISOString();
  await writeOwnerDashboard(projectId, owner);
  return owner.investorOS;
}

export async function saveInvestorRoadmap(
  projectId: string,
  roadmap: RoadmapItem[],
): Promise<InvestorOSSection> {
  const owner = await readOwnerDashboard(projectId);
  owner.investorOS.roadmap = roadmap;
  owner.investorOS.updatedAt = new Date().toISOString();
  await writeOwnerDashboard(projectId, owner);
  return owner.investorOS;
}

export async function saveInvestorKit(
  projectId: string,
  kit: InvestorKit,
): Promise<InvestorOSSection> {
  const owner = await readOwnerDashboard(projectId);
  owner.investorOS.kits = [
    kit,
    ...owner.investorOS.kits.filter((existing) => existing.id !== kit.id),
  ].slice(0, 10);
  owner.investorOS.updatedAt = new Date().toISOString();
  await writeOwnerDashboard(projectId, owner);
  return owner.investorOS;
}

export async function saveInvestorKitEdits(
  projectId: string,
  edits: InvestorKitEdits,
): Promise<InvestorOSSection> {
  const owner = await readOwnerDashboard(projectId);
  owner.investorOS.edits = { ...edits, updatedAt: new Date().toISOString() };
  owner.investorOS.updatedAt = new Date().toISOString();
  await writeOwnerDashboard(projectId, owner);
  return owner.investorOS;
}

/**
 * Append one run record to simulation_runs. Done with a JSONB `||` in SQL so
 * concurrent appends never clobber each other (read-modify-write free).
 */
export async function appendSimulationRun(
  id: string,
  record: SimulationRunRecord,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE projects
    SET simulation_runs = simulation_runs || ${JSON.stringify([record])}::jsonb,
        -- Prisma writes UTC into this timestamp-without-tz column; bare now()
        -- would write server-local wall time and corrupt recency ordering.
        updated_at = now() AT TIME ZONE 'utc'
    WHERE id = ${id}`;
}

/**
 * User-facing run labels are stored as Run.brief. Completed runs also have a
 * project-level JSON snapshot, so explicit rename/delete actions keep both
 * sources aligned.
 */
export async function renameSimulationRun(
  runId: string,
  brief: string,
): Promise<void> {
  const run = await prisma.run.update({
    where: { id: runId },
    data: { brief },
    select: { projectId: true },
  });
  const projectId = run.projectId ?? "__no_project__";
  const snapshotNeedle = JSON.stringify([{ runId }]);
  await prisma.$executeRaw`
    UPDATE projects p
    SET simulation_runs = COALESCE((
          SELECT jsonb_agg(
            CASE
              WHEN elem->>'runId' = ${runId}
              THEN jsonb_set(elem, '{params,brief}', to_jsonb(${brief}::text), true)
              ELSE elem
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(p.simulation_runs) WITH ORDINALITY AS t(elem, ord)
        ), '[]'::jsonb),
        updated_at = now() AT TIME ZONE 'utc'
    WHERE p.id = ${projectId}
       OR p.simulation_runs @> ${snapshotNeedle}::jsonb`;
}

export async function deleteSimulationRun(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, projectId: true },
  });
  if (!run) throw new Error("run not found");

  const projectId = run.projectId ?? "__no_project__";
  const snapshotNeedle = JSON.stringify([{ runId }]);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE projects p
      SET simulation_runs = COALESCE((
            SELECT jsonb_agg(elem ORDER BY ord)
            FROM jsonb_array_elements(p.simulation_runs) WITH ORDINALITY AS t(elem, ord)
            WHERE elem->>'runId' <> ${runId}
          ), '[]'::jsonb),
          updated_at = now() AT TIME ZONE 'utc'
      WHERE p.id = ${projectId}
         OR p.simulation_runs @> ${snapshotNeedle}::jsonb`;

    await tx.run.updateMany({
      where: { parentRunId: runId },
      data: { parentRunId: null, forkPointBlockId: null },
    });
    await tx.run.updateMany({
      where: { sourceRunId: runId },
      data: { sourceRunId: null },
    });
    await tx.personaConversation.deleteMany({ where: { runId } });
    await tx.launchOutcome.deleteMany({ where: { runId } });
    await tx.launchSimulation.deleteMany({ where: { runId } });
    await tx.persona.deleteMany({ where: { cohort: { runId } } });
    await tx.conclusion.deleteMany({ where: { block: { runId } } });
    await tx.cohort.deleteMany({ where: { runId } });
    await tx.edge.deleteMany({ where: { runId } });
    await tx.runEvent.deleteMany({ where: { runId } });
    await tx.runJob.deleteMany({ where: { runId } });
    await tx.block.deleteMany({ where: { runId } });
    await tx.run.delete({ where: { id: runId } });
  });
}

/**
 * Snapshot the full results of a run (blocks+conclusions, edges, cohorts with
 * personas, audience aggregate, spend) into a SimulationRunRecord. The
 * aggregate is recovered from the persisted event log (invariant §0.4).
 */
export async function buildRunRecord(
  runId: string,
  profile: ClientProfile,
): Promise<SimulationRunRecord> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const [blocks, edges, cohorts, aggEvent] = await Promise.all([
    prisma.block.findMany({ where: { runId }, include: { conclusions: true } }),
    prisma.edge.findMany({ where: { runId } }),
    prisma.cohort.findMany({ where: { runId }, include: { personas: true } }),
    prisma.runEvent.findFirst({
      where: { runId, type: "audience_aggregated" },
      orderBy: { seq: "desc" },
    }),
  ]);
  const audienceAggregate: SimulationRunRecord["results"]["audienceAggregate"] =
    aggEvent ? (JSON.parse(aggEvent.payload).aggregate ?? null) : null;

  return {
    runId,
    timestamp: new Date().toISOString(),
    status: run.status as SimulationRunRecord["status"],
    params: {
      brief: run.brief,
      clientProfile: profile,
      focusQuestion: run.focusQuestion,
      additionalContext: run.additionalContext,
      mode: run.mode as SimulationRunRecord["params"]["mode"],
      sourceRunId: run.sourceRunId,
      model: config.model,
      miniModel: config.miniModel,
      maxTokensPerRun: config.maxTokensPerRun,
      maxCostUsd: config.maxCostUsd,
      maxBlocksPerRun: config.maxBlocksPerRun,
      maxDesksPerRun: config.maxDesksPerRun,
      maxLayers: config.maxLayers,
      maxCohorts: config.maxCohorts,
      personasPerCohort: config.personasPerCohort,
      mockMode: config.mockMode,
    },
    results: {
      tokensUsed: run.tokensUsed,
      costUsd: run.costUsd,
      blocks: blocks.map((b) => blockToWire(b, b.conclusions)),
      edges: edges.map((e) => ({
        id: e.id,
        runId: e.runId,
        fromBlockId: e.fromBlockId,
        toBlockId: e.toBlockId,
        kind: e.kind as "entangle" | "feeds",
        reason: e.reason,
      })),
      cohorts: cohorts.map((c) => ({
        ...cohortToWire(c),
        personas: c.personas.map(personaToWire),
      })),
      audienceAggregate,
    },
  };
}

// ---------------------------------------------------------------------------
// Lean reads for the home/list view. The full snapshot embeds every persona
// ("all agent output saved"), but the list UI only needs counts — so strip
// the heavy persona arrays before shipping JSON to the browser. The full
// agent output stays in the DB (Persona table + this snapshot, fetched only
// when a detail/export view actually needs it).
// ---------------------------------------------------------------------------

function stripPersonas(project: ProjectFull): ProjectFull {
  return {
    ...project,
    simulationRuns: project.simulationRuns.map((r) => ({
      ...r,
      results: {
        ...r.results,
        cohorts: (r.results?.cohorts ?? []).map((c) => ({
          ...c,
          personas: [], // counts come from results.audienceAggregate
        })),
      },
    })),
  };
}

export async function getLatestProjectLean(): Promise<ProjectFull | null> {
  const p = await getLatestProject();
  return p ? stripPersonas(await withLiveRunSummaries(p)) : null;
}

export async function getProjectLean(id: string): Promise<ProjectFull | null> {
  const p = await getProject(id);
  return p ? stripPersonas(await withLiveRunSummaries(p)) : null;
}

// Owner Dashboard only needs the small owner_dashboard JSON — NOT the giant
// simulation_runs snapshot embedded on the project row. Select just that column
// so Postgres never ships (and we never parse) megabytes of run/persona data;
// loading the whole project here was timing the Owner tab out.
export async function getOwnerDashboard(
  id: string,
): Promise<OwnerDashboard | null> {
  const row = await prisma.project.findUnique({
    where: { id },
    select: { ownerDashboard: true },
  });
  return row ? parseOwnerDashboard(row.ownerDashboard) : null;
}

export async function getProjectUsage(id: string): Promise<UsageLedger | null> {
  const owner = await getOwnerDashboard(id);
  return owner?.usage ?? null;
}

export async function getOwnerDashboardRunSlice(
  id: string,
  runId: string,
): Promise<OwnerDashboardRunSlice | null> {
  const row = await prisma.project.findUnique({
    where: { id },
    select: { ownerDashboard: true },
  });
  if (!row) return null;
  const owner = parseOwnerDashboard(row.ownerDashboard);

  return {
    founderStory:
      owner.founderStory.evidence.length || owner.founderStory.confidence > 0
        ? owner.founderStory
        : null,
    brandSocial: parseRunSection(
      row.ownerDashboard,
      runId,
      "brandSocialByRun",
      "brandSocial",
      BrandSocialSectionSchema,
      (s) => Boolean(s.kit),
    ),
    financials: parseRunSection(
      row.ownerDashboard,
      runId,
      "financialsByRun",
      "financials",
      FinancialsSectionSchema,
      (s) => Boolean(s.model),
    ),
    inspiration: parseRunSection(
      row.ownerDashboard,
      runId,
      "inspirationByRun",
      "inspiration",
      InspirationSectionSchema,
      (s) => Boolean(s.kit),
    ),
    usage: owner.usage,
  };
}

export async function listProjectPreviews(): Promise<ProjectFull[]> {
  const rows = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
  });
  const projects = rows.map(toFull);
  const withRuns = await Promise.all(projects.map(withLiveRunSummaries));
  return withRuns.map(stripPersonas);
}

// ---------------------------------------------------------------------------
// Founder document store (RAG ground truth). Embeddings live in a JSONB
// column; retrieval is a single-row read + in-process cosine (see lib/rag).
// ---------------------------------------------------------------------------

export type DocChunk = { idx: number; content: string; embedding: number[] };

export type DocumentSummary = {
  id: string;
  name: string;
  charCount: number;
  chunkCount: number;
  embModel: string;
  createdAt: string;
};

export type StoredChunk = DocChunk & { docId: string; docName: string };

export async function createDocument(
  projectId: string,
  data: {
    name: string;
    charCount: number;
    embModel: string;
    chunks: DocChunk[];
  },
): Promise<DocumentSummary> {
  const row = await prisma.document.create({
    data: {
      projectId,
      name: data.name,
      charCount: data.charCount,
      chunkCount: data.chunks.length,
      embModel: data.embModel,
      chunks: data.chunks as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      name: true,
      charCount: true,
      chunkCount: true,
      embModel: true,
      createdAt: true,
    },
  });
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function listDocuments(
  projectId: string,
): Promise<DocumentSummary[]> {
  const rows = await prisma.document.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      charCount: true,
      chunkCount: true,
      embModel: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function deleteDocument(
  projectId: string,
  docId: string,
): Promise<void> {
  await prisma.document.deleteMany({ where: { id: docId, projectId } });
}

export async function countProjectDocuments(
  projectId: string,
): Promise<number> {
  return prisma.document.count({ where: { projectId } });
}

/** All chunks (with embeddings) for a project, tagged with their document. */
export async function getProjectChunks(
  projectId: string,
): Promise<{ chunks: StoredChunk[]; embModels: Set<string> }> {
  const rows = await prisma.document.findMany({
    where: { projectId },
    select: { id: true, name: true, embModel: true, chunks: true },
  });
  const chunks: StoredChunk[] = [];
  const embModels = new Set<string>();
  for (const r of rows) {
    embModels.add(r.embModel);
    for (const c of (r.chunks as unknown as DocChunk[]) ?? []) {
      chunks.push({ ...c, docId: r.id, docName: r.name });
    }
  }
  return { chunks, embModels };
}

// ---------------------------------------------------------------------------
// Industry knowledge cache (option A) — globally shared, auto-built per
// industry, with provenance + freshness. Not scoped to a project.
// ---------------------------------------------------------------------------
export type IndustryKnowledgeRow = {
  industryKey: string;
  industry: string;
  pack: unknown;
  sources: string[];
  builtModel: string;
  builtAt: Date;
};

export async function getIndustryKnowledge(
  industryKey: string,
): Promise<IndustryKnowledgeRow | null> {
  const row = await prisma.industryKnowledge.findUnique({
    where: { industryKey },
  });
  if (!row) return null;
  return {
    industryKey: row.industryKey,
    industry: row.industry,
    pack: row.pack,
    sources: Array.isArray(row.sources) ? (row.sources as string[]) : [],
    builtModel: row.builtModel,
    builtAt: row.builtAt,
  };
}

export async function upsertIndustryKnowledge(data: {
  industryKey: string;
  industry: string;
  pack: unknown;
  sources: string[];
  builtModel: string;
}): Promise<void> {
  const payload = {
    industry: data.industry,
    pack: data.pack as Prisma.InputJsonValue,
    sources: data.sources as unknown as Prisma.InputJsonValue,
    builtModel: data.builtModel,
    builtAt: new Date(),
  };
  await prisma.industryKnowledge.upsert({
    where: { industryKey: data.industryKey },
    create: { industryKey: data.industryKey, ...payload },
    update: payload,
  });
}

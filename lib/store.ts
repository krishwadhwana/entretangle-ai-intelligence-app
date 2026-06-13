import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import {
  BrandSocialSectionSchema,
  FinancialsSectionSchema,
  InterviewTranscriptSchema,
  type BrandKit,
  type ClientProfile,
  type FinancialModel,
  type FinancialsSection,
  type InterviewTranscript,
  type OwnerDashboard,
  type SimulationRunRecord,
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
};

// Default state for a freshly-initialised owner dashboard.
const EMPTY_OWNER_DASHBOARD: OwnerDashboard = {
  brandSocial: { kit: null, checks: {}, generatedAt: null, sourceRunId: null },
  financials: {
    model: null,
    inputs: null,
    editedKeys: [],
    generatedAt: null,
    sourceRunId: null,
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
  const fin = FinancialsSectionSchema.safeParse(obj.financials);
  return {
    brandSocial: brand.success
      ? brand.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.brandSocial),
    financials: fin.success
      ? fin.data
      : structuredClone(EMPTY_OWNER_DASHBOARD.financials),
  };
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
}): ProjectFull {
  const transcript = InterviewTranscriptSchema.safeParse(
    row.interviewTranscript
  );
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
  transcript: InterviewTranscript
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { interviewTranscript: transcript as unknown as Prisma.InputJsonValue },
  });
}

export async function saveVentureProfile(
  id: string,
  profile: ClientProfile
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { ventureProfile: profile as unknown as Prisma.InputJsonValue },
  });
}

export async function saveAudienceConfig(
  id: string,
  audienceConfig: unknown
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
  owner: OwnerDashboard
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: { ownerDashboard: owner as unknown as Prisma.InputJsonValue },
  });
}

export async function saveBrandKit(
  id: string,
  kit: BrandKit,
  sourceRunId: string,
  generatedAt: string
): Promise<OwnerDashboard["brandSocial"]> {
  const owner = await readOwnerDashboard(id);
  const validIds = new Set(kit.checklist.map((c) => c.id));
  const checks: Record<string, boolean> = {};
  for (const [itemId, done] of Object.entries(owner.brandSocial.checks)) {
    if (validIds.has(itemId)) checks[itemId] = done; // keep, drop stale ids
  }
  owner.brandSocial = { kit, checks, generatedAt, sourceRunId };
  await writeOwnerDashboard(id, owner);
  return owner.brandSocial;
}

export async function saveOwnerChecks(
  id: string,
  patch: Record<string, boolean>
): Promise<void> {
  const owner = await readOwnerDashboard(id);
  owner.brandSocial.checks = { ...owner.brandSocial.checks, ...patch };
  await writeOwnerDashboard(id, owner);
}

/**
 * Persist the Financials section (computed model + the assumptions it was
 * computed from + which inputs the founder overrode). Read-modify-write the
 * owner_dashboard column so the sibling brandSocial section is untouched.
 */
export async function saveFinancials(
  id: string,
  section: FinancialsSection
): Promise<FinancialsSection> {
  const owner = await readOwnerDashboard(id);
  owner.financials = section;
  await writeOwnerDashboard(id, owner);
  return owner.financials;
}

/**
 * The computed financial model the founder built for this project, if any —
 * used to make the final report's economics quantitative. Returns null when no
 * project / no model yet (report then stays qualitative).
 */
export async function getFinancialModel(
  projectId: string
): Promise<FinancialModel | null> {
  try {
    const owner = await readOwnerDashboard(projectId);
    return owner.financials.model;
  } catch {
    return null;
  }
}

/**
 * Append one run record to simulation_runs. Done with a JSONB `||` in SQL so
 * concurrent appends never clobber each other (read-modify-write free).
 */
export async function appendSimulationRun(
  id: string,
  record: SimulationRunRecord
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE projects
    SET simulation_runs = simulation_runs || ${JSON.stringify([
      record,
    ])}::jsonb,
        -- Prisma writes UTC into this timestamp-without-tz column; bare now()
        -- would write server-local wall time and corrupt recency ordering.
        updated_at = now() AT TIME ZONE 'utc'
    WHERE id = ${id}`;
}

/**
 * Snapshot the full results of a run (blocks+conclusions, edges, cohorts with
 * personas, audience aggregate, spend) into a SimulationRunRecord. The
 * aggregate is recovered from the persisted event log (invariant §0.4).
 */
export async function buildRunRecord(
  runId: string,
  profile: ClientProfile
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
    aggEvent ? JSON.parse(aggEvent.payload).aggregate ?? null : null;

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
  return p ? stripPersonas(p) : null;
}

export async function getProjectLean(id: string): Promise<ProjectFull | null> {
  const p = await getProject(id);
  return p ? stripPersonas(p) : null;
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
  data: { name: string; charCount: number; embModel: string; chunks: DocChunk[] }
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
  projectId: string
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
  docId: string
): Promise<void> {
  await prisma.document.deleteMany({ where: { id: docId, projectId } });
}

export async function countProjectDocuments(projectId: string): Promise<number> {
  return prisma.document.count({ where: { projectId } });
}

/** All chunks (with embeddings) for a project, tagged with their document. */
export async function getProjectChunks(
  projectId: string
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

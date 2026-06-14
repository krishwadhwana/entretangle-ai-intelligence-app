import { prisma } from "./db";
import type {
  Block,
  Cohort,
  CohortStats,
  Conclusion,
  Persona,
} from "./schema";

// ---------------------------------------------------------------------------
// DB row -> wire-type converters. Kept in their own module (no imports beyond
// db/schema) so both the orchestrator and lib/store can use them without an
// import cycle.
// ---------------------------------------------------------------------------

type DbBlock = NonNullable<Awaited<ReturnType<typeof prisma.block.findUnique>>>;
type DbConclusion = NonNullable<
  Awaited<ReturnType<typeof prisma.conclusion.findUnique>>
>;
type DbCohort = NonNullable<
  Awaited<ReturnType<typeof prisma.cohort.findUnique>>
>;
type DbPersona = NonNullable<
  Awaited<ReturnType<typeof prisma.persona.findUnique>>
>;

export function conclusionToWire(row: DbConclusion): Conclusion {
  return {
    id: row.id,
    blockId: row.blockId,
    claim: row.claim,
    value: row.value,
    confidence: row.confidence,
    entities: JSON.parse(row.entities),
    sources: JSON.parse(row.sources),
  };
}

export function blockToWire(
  row: DbBlock,
  conclusions: DbConclusion[] = []
): Block {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    mission: row.mission,
    layer: row.layer,
    kind: row.kind as Block["kind"],
    domain: row.domain as Block["domain"],
    state: row.state as Block["state"],
    inputBlockIds: JSON.parse(row.inputBlockIds),
    params: JSON.parse(row.params),
    logs: JSON.parse(row.logs),
    conclusions: conclusions.map(conclusionToWire),
  };
}

export function cohortToWire(row: DbCohort): Cohort {
  return {
    id: row.id,
    runId: row.runId,
    label: row.label,
    locality: row.locality,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    segment: row.segment as Cohort["segment"],
    role: row.role as Cohort["role"],
    weightPct: row.weightPct,
    size: row.size,
    state: row.state as Cohort["state"],
    stats: row.stats ? (JSON.parse(row.stats) as CohortStats) : null,
    summary: row.summary,
  };
}

export function personaToWire(row: DbPersona): Persona {
  return {
    id: row.id,
    cohortId: row.cohortId,
    name: row.name,
    age: row.age,
    gender: row.gender,
    occupation: row.occupation,
    incomeBand: row.incomeBand,
    lat: row.lat,
    lng: row.lng,
    intent: row.intent,
    wtp: row.wtp,
    wtpCurrency: row.wtpCurrency,
    channelPref: row.channelPref,
    platforms: JSON.parse(row.platforms),
    objection: row.objection,
    quote: row.quote,
    lifestyle: row.lifestyle,
    lifeStage: row.lifeStage,
    values: JSON.parse(row.values),
    shoppingHabits: row.shoppingHabits,
    priceSensitivity: row.priceSensitivity,
    reasoning: row.reasoning,
    personality: row.personality,
    personalityTraits: JSON.parse(row.personalityTraits),
    intentOriginal: row.intentOriginal ?? null,
    voteChangedAt: row.voteChangedAt ? row.voteChangedAt.toISOString() : null,
  };
}

// Characterization checks for the run/orchestrator lifecycle.
// Run: npm run check:run-invariants
//
// These intentionally execute the real orchestrator in MOCK_MODE with tiny
// audiences. They are the safety net for future orchestrator decomposition and
// any later data-shape migration.

process.env.MOCK_MODE = "true";
process.env.MAX_DESKS_PER_RUN = "3";
process.env.MAX_BLOCKS_PER_RUN = "8";
process.env.MAX_LAYERS = "3";
process.env.MAX_COHORTS = "3";
process.env.TARGET_AUDIENCE_SIZE = "3";
process.env.PERSONAS_PER_CALL = "3";
process.env.MIN_PERSONAS_PER_COHORT = "1";

import { prisma } from "../lib/db";
import { executeRun, resumeRun } from "../lib/orchestrator";
import { executeBlock } from "../lib/blocks";
import { RunEmitter } from "../lib/events";
import {
  ClientProfileSchema,
  type AudienceAggregate,
  type ClientProfile,
  type RunEvent,
} from "../lib/schema";

let failures = 0;
const createdRunIds: string[] = [];

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("OK:", msg);
  }
}

const profile: ClientProfile = ClientProfileSchema.parse({
  ambitions: "Build a premium furniture brand with export potential.",
  product: "Jodhpur teak dining tables",
  capitalInr: 4_000_000,
  experience: "Founder has sourcing and design experience.",
  scale: "India metros first, export later",
  restrictions: ["limited working capital", "needs reliable logistics"],
  goal: "Validate launch demand and export viability",
  category: "furniture",
  priceBand: "premium",
  geography: ["India"],
  targetAudience: "Urban affluent home owners and retail buyers",
});

async function createRun(opts: {
  mode?: "full" | "scoped";
  sourceRunId?: string | null;
  targetAudienceSize?: number;
  tokensUsed?: number;
} = {}): Promise<string> {
  const run = await prisma.run.create({
    data: {
      brief: `Invariant fixture ${new Date().toISOString()}`,
      clientProfile: JSON.stringify(profile),
      status: "planning",
      mode: opts.mode ?? "full",
      sourceRunId: opts.sourceRunId ?? null,
      targetAudienceSize: opts.targetAudienceSize ?? 3,
      tokensUsed: opts.tokensUsed ?? 0,
    },
    select: { id: true },
  });
  createdRunIds.push(run.id);
  return run.id;
}

async function events(runId: string): Promise<RunEvent[]> {
  const rows = await prisma.runEvent.findMany({
    where: { runId },
    orderBy: { seq: "asc" },
  });
  return rows.map((row) => JSON.parse(row.payload) as RunEvent);
}

async function terminalStatus(runId: string): Promise<string | null> {
  const row = await prisma.run.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return row?.status ?? null;
}

function assertTerminalStatusLast(evts: RunEvent[], expected: string, label: string) {
  const last = evts.at(-1);
  assert(
    last?.type === "run_status" && "status" in last && last.status === expected,
    `${label}: terminal run_status(${expected}) is the final event`
  );
  const terminalIndex = evts.findLastIndex(
    (e) =>
      e.type === "run_status" &&
      "status" in e &&
      ["complete", "failed", "capped", "cancelled"].includes(e.status)
  );
  assert(
    terminalIndex === evts.length - 1,
    `${label}: no event is emitted after terminal status`
  );
}

async function latestAggregate(runId: string): Promise<AudienceAggregate | null> {
  const row = await prisma.runEvent.findFirst({
    where: { runId, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  return row ? (JSON.parse(row.payload).aggregate as AudienceAggregate) : null;
}

async function personaCount(runId: string): Promise<number> {
  return prisma.persona.count({ where: { cohort: { runId } } });
}

async function cleanup() {
  for (const runId of createdRunIds.reverse()) {
    const blocks = await prisma.block.findMany({
      where: { runId },
      select: { id: true },
    });
    const blockIds = blocks.map((b) => b.id);
    const cohorts = await prisma.cohort.findMany({
      where: { runId },
      select: { id: true },
    });
    const cohortIds = cohorts.map((c) => c.id);

    await prisma.persona.deleteMany({ where: { cohortId: { in: cohortIds } } });
    await prisma.cohort.deleteMany({ where: { id: { in: cohortIds } } });
    await prisma.conclusion.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.edge.deleteMany({ where: { runId } });
    await prisma.block.deleteMany({ where: { id: { in: blockIds } } });
    await prisma.runEvent.deleteMany({ where: { runId } });
    await prisma.runJob.deleteMany({ where: { runId } });
    await prisma.launchOutcome.deleteMany({ where: { runId } });
    await prisma.launchSimulation.deleteMany({ where: { runId } });
    await prisma.run.deleteMany({ where: { id: runId } });
  }
}

async function auditCompleteRun() {
  console.log("\n-- complete run lifecycle --");
  const runId = await createRun({ targetAudienceSize: 3 });
  await executeRun(runId);

  assert((await terminalStatus(runId)) === "complete", "mock run completes");
  const evts = await events(runId);
  assertTerminalStatusLast(evts, "complete", "complete run");
  assert(
    evts.some((e) => e.type === "world_model_ready"),
    "complete run emits world_model_ready before terminal status"
  );
  assert((await personaCount(runId)) === 3, "complete run creates exact tiny audience");
  return runId;
}

async function auditCappedRun() {
  console.log("\n-- capped run lifecycle --");
  const priorMaxTokens = process.env.MAX_TOKENS_PER_RUN;
  process.env.MAX_TOKENS_PER_RUN = "1";
  const runId = await createRun({ targetAudienceSize: 3, tokensUsed: 1 });
  await executeRun(runId);
  process.env.MAX_TOKENS_PER_RUN = priorMaxTokens;

  assert((await terminalStatus(runId)) === "capped", "over-cap run converges as capped");
  assertTerminalStatusLast(await events(runId), "capped", "capped run");
}

async function auditResumeNoPersonaDuplication(sourceRunId: string) {
  console.log("\n-- resume idempotence --");
  const before = await personaCount(sourceRunId);
  await resumeRun(sourceRunId);
  const after = await personaCount(sourceRunId);
  assert(after === before, "resume does not duplicate already-finished personas");
  assert((await terminalStatus(sourceRunId)) === "complete", "resume returns run to complete");
}

async function auditScopedAudienceCopy(sourceRunId: string) {
  console.log("\n-- scoped audience copy --");
  const scopedRunId = await createRun({
    mode: "scoped",
    sourceRunId,
    targetAudienceSize: 3,
  });
  await executeRun(scopedRunId);

  const sourceCount = await personaCount(sourceRunId);
  const scopedCount = await personaCount(scopedRunId);
  assert(scopedCount === sourceCount, "scoped run copies the source personas exactly once");

  const sourceAgg = await latestAggregate(sourceRunId);
  const scopedAgg = await latestAggregate(scopedRunId);
  assert(
    !!sourceAgg &&
      !!scopedAgg &&
      scopedAgg.totalPersonas === sourceAgg.totalPersonas &&
      scopedAgg.totalCohorts === sourceAgg.totalCohorts,
    "scoped run aggregates the copied audience"
  );
  assertTerminalStatusLast(await events(scopedRunId), "complete", "scoped run");
}

async function auditFailedBlockIsContained() {
  console.log("\n-- failed block containment --");
  const runId = await createRun({ targetAudienceSize: 0 });
  const block = await prisma.block.create({
    data: {
      runId,
      name: "Failing Desk",
      mission: "Deliberately fail for invariant coverage.",
      layer: 1,
      kind: "research",
      domain: "market",
      state: "spawning",
      inputBlockIds: "[]",
      params: "{}",
      logs: "[]",
    },
    select: { id: true },
  });
  const emitter = await RunEmitter.create(runId);
  const ok = await executeBlock(emitter, block.id, profile, [], async () => {
    throw new Error("intentional invariant failure");
  });
  const failed = await prisma.block.findUnique({
    where: { id: block.id },
    select: { state: true },
  });
  assert(!ok && failed?.state === "failed", "a failed desk is marked failed and contained");
  assert(
    (await events(runId)).some((e) => e.type === "block_failed"),
    "failed desk emits block_failed instead of throwing through the caller"
  );
}

async function main() {
  try {
    const sourceRunId = await auditCompleteRun();
    await auditCappedRun();
    await auditResumeNoPersonaDuplication(sourceRunId);
    await auditScopedAudienceCopy(sourceRunId);
    await auditFailedBlockIsContained();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} invariant check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll run invariants passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

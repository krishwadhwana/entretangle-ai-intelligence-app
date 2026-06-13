import { prisma } from "./db";
import { config } from "./config";
import { RunEmitter } from "./events";
import { executeBlock } from "./blocks";
import {
  callPlannerV2,
  callEntangler,
  callAudienceSynth,
  callDemographics,
  callFinalReport,
  callClassifyVenture,
} from "./llm";
import { ProjectRetriever, formatGroundTruth } from "./rag";
import { calibrateCohortPlan } from "./datasources/demographics";
import { expandPanIndiaCohortPlan } from "./audienceCoverage";
import {
  fetchStructuredForDesk,
  formatStructured,
  type StructuredData,
} from "./datasources/structured";
import { getIndustryLibrary, formatLibrary } from "./datasources/library";
import {
  getOrBuildIndustryKnowledge,
  formatIndustryKnowledge,
  formatPlanningTemplate,
} from "./datasources/knowledge";
import {
  spawnCohorts,
  simulateAllCohorts,
  aggregateAudience,
  copyAudienceFrom,
} from "./audience";
import { getCostUsd, getTokensUsed, isOverTokenCap } from "./usage";
import { getFinancialModel } from "./store";
import {
  isRunCancelledError,
  markRunCancelled,
  throwIfRunCancelled,
} from "./jobs";
import { blockToWire, conclusionToWire } from "./wire";
import {
  appendSimulationRun,
  buildRunRecord,
  saveAudienceConfig,
} from "./store";
import {
  ClientProfileSchema,
  type AudienceAggregate,
  type ClientProfile,
  type Conclusion,
} from "./schema";
import {
  addEdge,
  blockCount,
  concludedBlocks,
  setStatus,
  spawnBlock,
} from "./engine/graph";

// ---------------------------------------------------------------------------
// The orchestrator is a deterministic state machine; LLM calls fill in
// content, never control flow structure (SPEC §4). Only this module spawns
// blocks and draws edges (invariant §0.1).
// ---------------------------------------------------------------------------

export { blockToWire, conclusionToWire } from "./wire";

/** Mechanical verification of a shared_entity edge (SPEC §4.4). */
function sharesEntity(
  a: { conclusions: Conclusion[] },
  b: { conclusions: Conclusion[] }
): boolean {
  const tagsA = new Set(a.conclusions.flatMap((c) => c.entities));
  return b.conclusions.some((c) => c.entities.some((e) => tagsA.has(e)));
}

async function converge(
  emitter: RunEmitter,
  capped: boolean,
  profile: ClientProfile
): Promise<void> {
  const runId = emitter.runId;
  const [blocks, aggEvent] = await Promise.all([
    prisma.block.findMany({ where: { runId }, include: { conclusions: true } }),
    prisma.runEvent.findFirst({
      where: { runId, type: "audience_aggregated" },
      orderBy: { seq: "desc" },
    }),
  ]);
  const conclusionCount = blocks.reduce(
    (sum, block) => sum + block.conclusions.length,
    0
  );
  const aggregate = aggEvent
    ? JSON.parse(aggEvent.payload).aggregate as AudienceAggregate
    : null;

  try {
    const existingReport = await prisma.runEvent.findFirst({
      where: { runId, type: "final_report" },
      select: { id: true },
    });
    if (!existingReport) {
      await setStatus(emitter, "running", "Writing final business report");
      // Make economics quantitative if the founder already built a financial
      // model for this project (else the report stays qualitative).
      const run = await prisma.run.findUnique({
        where: { id: runId },
        select: { projectId: true },
      });
      const financials = run?.projectId
        ? await getFinancialModel(run.projectId)
        : null;
      const report = await callFinalReport(
        runId,
        profile,
        blocks.map((b) => blockToWire(b, b.conclusions)),
        aggregate,
        financials
      );
      await emitter.emit({ type: "final_report", report });
    }
  } catch (e) {
    console.error(`[orchestrator] final report generation failed:`, e);
  }

  const [finalTokensUsed, finalCostUsd] = await Promise.all([
    getTokensUsed(runId),
    getCostUsd(runId),
  ]);
  await emitter.emit({ type: "tokens_used", tokensUsed: finalTokensUsed });
  await emitter.emit({ type: "cost_used", costUsd: finalCostUsd });
  await emitter.emit({
    type: "world_model_ready",
    conclusionCount,
    blockCount: blocks.length,
  });
  // Terminal status last — the SSE route closes streams on terminal status.
  await setStatus(
    emitter,
    capped ? "capped" : "complete",
    capped ? "Converged early — token cap reached" : "World model ready"
  );
}

/**
 * Entangle → synthesize → repeat until caps, then converge (SPEC §4.4–4.6).
 * Shared by fresh runs (fromLayer = 1) and forks (fromLayer = fork layer).
 */
async function entangleAndConverge(
  emitter: RunEmitter,
  profile: ClientProfile,
  fromLayer: number
): Promise<void> {
  const runId = emitter.runId;
  let layer = fromLayer;
  let round = 1;

  while (true) {
    await throwIfRunCancelled(runId);
    if (await isOverTokenCap(runId)) {
      console.log(`[orchestrator] run ${runId}: token cap reached, converging`);
      await converge(emitter, true, profile);
      return;
    }
    const count = await blockCount(runId);
    if (layer >= config.maxLayers || count >= config.maxBlocksPerRun) break;

    await throwIfRunCancelled(runId);
    await setStatus(emitter, "running", `Entangling — round ${round}`);
    const concluded = await concludedBlocks(runId);
    if (concluded.length === 0) throw new Error("No blocks concluded");

    const byId = new Map(concluded.map((b) => [b.id, b]));
    let ent;
    try {
      ent = await callEntangler(runId, concluded, round);
    } catch (e) {
      // Entangler failure is non-fatal: converge with what we have.
      console.log(`[orchestrator] entangler failed, converging: ${e}`);
      break;
    }

    // Mechanical edge verification (SPEC §4.4). shared_entity edges must
    // actually share ≥1 entity tag; contradiction/dependency accepted on the
    // entangler's word in v0, logged with reason.
    const existing = await prisma.edge.findMany({
      where: { runId, kind: "entangle" },
    });
    const seenPairs = new Set(
      existing.map((e) => [e.fromBlockId, e.toBlockId].sort().join("|"))
    );
    for (const edge of ent.edges) {
      const from = byId.get(edge.fromBlockId);
      const to = byId.get(edge.toBlockId);
      if (!from || !to || from === to) {
        console.log(
          `[orchestrator] DROPPED edge (unknown block): ${edge.fromBlockId} -> ${edge.toBlockId} ("${edge.reason}")`
        );
        continue;
      }
      const pair = [from.id, to.id].sort().join("|");
      if (seenPairs.has(pair)) {
        console.log(
          `[orchestrator] DROPPED edge (duplicate pair): ${from.name} -> ${to.name}`
        );
        continue;
      }
      if (edge.trigger === "shared_entity" && !sharesEntity(from, to)) {
        console.log(
          `[orchestrator] DROPPED hallucinated shared_entity edge: ${from.name} -> ${to.name} ("${edge.reason}") — no shared entity tag`
        );
        continue;
      }
      console.log(
        `[orchestrator] edge accepted (${edge.trigger}): ${from.name} -> ${to.name}`
      );
      seenPairs.add(pair);
      await addEdge(emitter, {
        fromBlockId: from.id,
        toBlockId: to.id,
        kind: "entangle",
        reason: edge.reason,
      });
    }

    // Synthesis blocks: only with valid inputs, clamped to remaining budget.
    const budget = config.maxBlocksPerRun - (await blockCount(runId));
    const synth = ent.synthesisBlocks
      .filter((s) => s.inputBlockIds.every((id) => byId.has(id)))
      .slice(0, Math.max(0, budget));
    if (synth.length < ent.synthesisBlocks.length) {
      console.log(
        `[orchestrator] clamped synthesis blocks ${ent.synthesisBlocks.length} -> ${synth.length} (cap/invalid inputs)`
      );
    }
    if (synth.length === 0) break;

    if (await isOverTokenCap(runId)) {
      await converge(emitter, true, profile);
      return;
    }

    const nextLayer = layer + 1;
    await setStatus(emitter, "running", `Synthesizing — layer ${nextLayer}`);
    const spawned: { id: string; inputBlockIds: string[] }[] = [];
    for (const s of synth) {
      await throwIfRunCancelled(runId);
      const id = await spawnBlock(emitter, {
        name: s.name,
        mission: s.mission,
        layer: nextLayer,
        kind: "synthesis",
        domain: s.domain ?? "synthesis",
        inputBlockIds: s.inputBlockIds,
        params: {},
      });
      for (const inputId of s.inputBlockIds) {
        await addEdge(emitter, {
          fromBlockId: inputId,
          toBlockId: id,
          kind: "feeds",
          reason: "conclusions feed synthesis",
        });
      }
      spawned.push({ id, inputBlockIds: s.inputBlockIds });
    }

    await Promise.allSettled(
      spawned.map((s) => {
        const inputConclusions = s.inputBlockIds.flatMap(
          (id) => byId.get(id)?.conclusions ?? []
        );
        return executeBlock(emitter, s.id, profile, inputConclusions);
      })
    );

    layer = nextLayer;
    round += 1;
  }

  await converge(emitter, false, profile);
}

/**
 * Auto-save a finished (or failed) simulation into its project's append-only
 * simulation_runs JSONB. Never throws — persistence of the snapshot must not
 * take down a run that already succeeded.
 */
async function persistRunToProject(
  runId: string,
  profile: ClientProfile
): Promise<void> {
  try {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { projectId: true },
    });
    if (!run?.projectId) return;
    const record = await buildRunRecord(runId, profile);
    await appendSimulationRun(run.projectId, record);
    console.log(
      `[orchestrator] run ${runId} snapshot appended to project ${run.projectId}`
    );
  } catch (e) {
    console.error(`[orchestrator] failed to persist run ${runId} snapshot:`, e);
  }
}

/**
 * Entry point — launched fire-and-forget after run creation (SPEC §4).
 * Also resumes forks: a fork run arrives with copied concluded blocks plus
 * the fork-point block in "spawning" state (SPEC Shot 6).
 */
export async function executeRun(runId: string): Promise<void> {
  const emitter = await RunEmitter.create(runId);
  let profileForSnapshot: ClientProfile | null = null;
  try {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    profileForSnapshot = profile;
    await throwIfRunCancelled(runId);

    if (run.parentRunId && run.forkPointBlockId) {
      await executeForkPhase(emitter, profile, run.forkPointBlockId);
      await persistRunToProject(runId, profile);
      return;
    }

    // Follow-up steering: a focus question + extra context bias the whole run.
    const focus = {
      focusQuestion: run.focusQuestion,
      additionalContext: run.additionalContext,
    };
    // Scoped follow-up: reuse a prior run's audience instead of re-simulating.
    const scoped = run.mode === "scoped" && !!run.sourceRunId;
    // Audience size for this run (UI slider/number). null → env default;
    // 0 → research desks only (no audience).
    const audienceTarget = run.targetAudienceSize ?? config.targetAudienceSize;

    // RAG (option B): load the founder's uploaded documents so research desks
    // and audience synthesis can be grounded in their real data.
    const retriever = run.projectId
      ? await ProjectRetriever.load(run.projectId).catch((e) => {
          console.error(`[orchestrator] retriever load failed:`, e);
          return null;
        })
      : null;
    const planQuery = [
      run.brief,
      run.focusQuestion,
      run.additionalContext,
      profile.product,
    ]
      .filter(Boolean)
      .join(" ");
    const ragPlanGroundTruth =
      retriever?.hasDocs
        ? formatGroundTruth(await retriever.search(planQuery, 6))
        : "";

    // Classify the venture FIRST (before planning) so industry knowledge + the
    // planning template can shape which desks/cohorts/roles the planner picks.
    const industry = await callClassifyVenture(runId, profile).catch((e) => {
      console.error(`[orchestrator] industry classification failed:`, e);
      return null;
    });
    if (industry) {
      console.log(
        `[orchestrator] industry=${industry.industry} hs=[${industry.hsCodes.join(
          ","
        )}] shops=[${industry.osmShopTags.join(
          ","
        )}] openData=[${industry.openDataQueries.join(",")}] library=${industry.libraryKey}`
      );
    }

    // Auto-built industry knowledge (option A): cached-or-built, web-grounded,
    // with provenance + freshness. Falls back to the curated library if the
    // build fails AND nothing is cached.
    const knowledge = industry
      ? await getOrBuildIndustryKnowledge(
          runId,
          industry.industry,
          industry.libraryKey,
          profile.geography ?? []
        ).catch((e) => {
          console.error(`[orchestrator] knowledge build failed:`, e);
          return null;
        })
      : null;
    if (knowledge) {
      console.log(
        `[orchestrator] industry knowledge ${
          knowledge.fresh ? "cache-hit" : "built"
        } (as of ${knowledge.builtAt.toISOString().slice(0, 10)}, ${
          knowledge.sources.length
        } sources)`
      );
    }
    const curatedLib = industry ? getIndustryLibrary(industry.libraryKey) : null;
    // Prefer the auto-built pack; fall back to the curated library.
    const industryGroundTruth = knowledge
      ? formatIndustryKnowledge(knowledge)
      : curatedLib
        ? formatLibrary(curatedLib)
        : "";
    const planningTemplateGroundTruth = knowledge
      ? formatPlanningTemplate(knowledge)
      : "";

    // The planner sees the planning template + industry knowledge + founder RAG.
    const planGroundTruth = [
      planningTemplateGroundTruth,
      industryGroundTruth,
      ragPlanGroundTruth,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Phase 1 — Plan: research desks + the audience cohort matrix (V2 §4.1)
    await throwIfRunCancelled(runId);
    await setStatus(
      emitter,
      "planning",
      run.focusQuestion
        ? `Planning desks for: ${run.focusQuestion.slice(0, 60)}`
        : "Planning desks & audience matrix"
    );
    const rawPlan = await callPlannerV2(runId, profile, focus, planGroundTruth);
    const expandedCohortPlan = expandPanIndiaCohortPlan(
      rawPlan.cohortPlan,
      profile,
      config.maxCohorts
    );
    const plan = { ...rawPlan, cohortPlan: expandedCohortPlan };
    if (
      expandedCohortPlan.localities.length !== rawPlan.cohortPlan.localities.length ||
      expandedCohortPlan.cohorts.length !== rawPlan.cohortPlan.cohorts.length
    ) {
      console.log(
        `[orchestrator] PAN-India audience expanded ${rawPlan.cohortPlan.localities.length}->${expandedCohortPlan.localities.length} localities, ${rawPlan.cohortPlan.cohorts.length}->${expandedCohortPlan.cohorts.length} cohorts`
      );
    }
    const desks = plan.desks.slice(0, config.maxDesksPerRun);

    const deskIds: string[] = [];
    for (const d of desks) {
      await throwIfRunCancelled(runId);
      deskIds.push(
        await spawnBlock(emitter, {
          name: d.name,
          mission: d.mission,
          layer: 1,
          kind: "research",
          domain: d.domain,
          inputBlockIds: [],
          params: { ...d.params, webSearch: d.useWebSearch ? 1 : 0 },
        })
      );
    }

    // Structured real-data per desk domain (option C): fetch once per distinct
    // domain (pricing → FX, market → World Bank + Wikipedia, …) and reuse.
    const structuredCtx = {
      countries: Array.from(
        new Set(plan.cohortPlan.localities.map((l) => l.country))
      ),
      currency: plan.cohortPlan.currency,
      product: profile.product,
      // Industry routing for trade/tariff + local-competition + open-data.
      hsCodes: industry?.hsCodes ?? [],
      osmShopTags: industry?.osmShopTags ?? [],
      openDataQueries: industry?.openDataQueries ?? [],
      localities: plan.cohortPlan.localities,
    };
    const domains = Array.from(new Set(desks.map((d) => d.domain)));
    const structuredByDomain = new Map<string, StructuredData | null>(
      await Promise.all(
        domains.map(
          async (dom) =>
            [dom, await fetchStructuredForDesk(dom, structuredCtx)] as const
        )
      )
    );
    const structuredDomains = [...structuredByDomain.entries()]
      .filter(([, sd]) => sd)
      .map(([dom]) => dom);
    if (structuredDomains.length > 0) {
      console.log(
        `[orchestrator] structured real-data attached for domains: ${structuredDomains.join(
          ", "
        )}`
      );
    }

    // Per-desk ground truth = founder RAG chunks (option B) + structured real
    // data for the desk's domain (option C), injected into the desk prompt.
    const deskGroundTruth = new Map<string, string>();
    for (const [i, d] of desks.entries()) {
      await throwIfRunCancelled(runId);
      const parts: string[] = [];
      // Auto-built (or curated-fallback) industry knowledge — every desk.
      if (industryGroundTruth) parts.push(industryGroundTruth);
      if (retriever?.hasDocs) {
        const gt = formatGroundTruth(await retriever.search(d.mission, 4));
        if (gt) parts.push(gt);
      }
      const sd = structuredByDomain.get(d.domain);
      if (sd) parts.push(formatStructured(sd));
      if (parts.length > 0) deskGroundTruth.set(deskIds[i], parts.join("\n\n"));
    }

    // Build the audience: simulate fresh (full) or copy from the source run
    // (scoped). Either way Phase 3 aggregates from this run's `done` cohorts.
    let currency = plan.cohortPlan.currency;
    let cohortIds: string[] = [];
    let copiedCohorts = 0;
    if (scoped) {
      await throwIfRunCancelled(runId);
      await setStatus(
        emitter,
        "running",
        "Reusing prior simulated audience (scoped run)"
      );
      const copied = await copyAudienceFrom(emitter, run.sourceRunId!);
      copiedCohorts = copied.doneCohorts;
      currency = copied.currency ?? currency;
    } else {
      // Calibrate the cohort matrix with real demographics (option A) so
      // cohort SIZES mirror the real market before simulation.
      await throwIfRunCancelled(runId);
      await setStatus(
        emitter,
        "running",
        "Calibrating audience with real demographics"
      );
      const demographics = await callDemographics(
        runId,
        plan.cohortPlan.localities
      );
      let cohortPlan = plan.cohortPlan;
      if (demographics) {
        const calibrated = calibrateCohortPlan(plan.cohortPlan, demographics);
        cohortPlan = calibrated.cohortPlan;
        if (calibrated.changed) {
          console.log(
            `[orchestrator] cohort weights calibrated from real demographics`
          );
        }
      }
      // Auto-save the (calibrated) audience matrix + the demographics + sources.
      if (run.projectId) {
        await saveAudienceConfig(run.projectId, {
          desks,
          cohortPlan,
          demographics,
          focusQuestion: run.focusQuestion,
        }).catch((e) =>
          console.error(`[orchestrator] saveAudienceConfig failed:`, e)
        );
      }
      // audienceTarget === 0 → research-only run (no audience).
      cohortIds =
        audienceTarget > 0
          ? await spawnCohorts(emitter, cohortPlan, audienceTarget)
          : [];
    }

    // Phase 2 — desks research (web-grounded) WHILE cohorts simulate (V2 §4.2)
    await setStatus(
      emitter,
      "running",
      scoped
        ? `${desks.length} desks researching · ${copiedCohorts} reused cohorts`
        : cohortIds.length === 0
          ? `${desks.length} desks researching (no audience)`
          : `${desks.length} desks researching · ${cohortIds.length} cohorts (~${audienceTarget.toLocaleString()} personas) simulating`
    );
    const runDesks = async (): Promise<boolean> => {
      const wave = Math.max(1, config.deskConcurrency);
      let anyConcluded = false;
      for (let i = 0; i < deskIds.length; i += wave) {
        await throwIfRunCancelled(runId);
        const results = await Promise.allSettled(
          deskIds
            .slice(i, i + wave)
            .map((id) =>
              executeBlock(
                emitter,
                id,
                profile,
                [],
                undefined,
                deskGroundTruth.get(id)
              )
            )
        );
        anyConcluded =
          anyConcluded ||
          results.some((r) => r.status === "fulfilled" && r.value === true);
        if (await isOverTokenCap(runId)) {
          console.log(`[orchestrator] cap reached mid-desks — stopping waves`);
          break;
        }
      }
      return anyConcluded;
    };
    const [anyDeskConcluded, simulatedCohorts] = await Promise.all([
      runDesks(),
      scoped
        ? Promise.resolve(0)
        : simulateAllCohorts(emitter, cohortIds, profile, currency),
    ]);
    const cohortsDone = scoped ? copiedCohorts : simulatedCohorts;
    if (!anyDeskConcluded && cohortsDone === 0) {
      throw new Error("All desks and all cohorts failed");
    }

    // Phase 3 — aggregate the audience, then distill it into typed
    // conclusions so it entangles like any desk (V2 §4.3)
    let aggregate: AudienceAggregate | null = null;
    if (cohortsDone > 0) {
      await throwIfRunCancelled(runId);
      await setStatus(emitter, "running", "Aggregating simulated audience");
      aggregate = await aggregateAudience(emitter);
    }
    if (aggregate && !(await isOverTokenCap(runId))) {
      await throwIfRunCancelled(runId);
      const agg = aggregate;
      const focusLine = run.focusQuestion
        ? ` Prioritise what this implies for: ${run.focusQuestion}.`
        : "";
      const audienceBlockId = await spawnBlock(emitter, {
        name: "Audience Synthesis",
        mission: `Distill the simulated audience (${agg.totalPersonas} personas across ${agg.totalCohorts} cohorts) into decision-ready findings: converting segments and localities, willingness to pay, channel ranking, platform-by-segment social strategy, dominant objections.${focusLine}`,
        layer: 2,
        kind: "audience",
        domain: "audience",
        inputBlockIds: [],
        params: {},
      });
      const audienceGroundTruth = retriever?.hasDocs
        ? formatGroundTruth(
            await retriever.search(
              `target customers demographics willingness to pay objections channels ${profile.product}`,
              5
            )
          )
        : "";
      await executeBlock(emitter, audienceBlockId, profile, [], () =>
        callAudienceSynth(runId, profile, agg, audienceGroundTruth)
      );
    }

    // Phases 4–5 — entangle, synthesize, converge
    await entangleAndConverge(emitter, profile, 2);
    await persistRunToProject(runId, profile);
  } catch (e) {
    if (isRunCancelledError(e)) {
      await markRunCancelled(runId);
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[orchestrator] run ${runId} failed:`, e);
    try {
      await prisma.run.update({
        where: { id: runId },
        data: { status: "failed" },
      });
      await emitter.emit({ type: "run_error", message });
      await emitter.emit({
        type: "run_status",
        status: "failed",
        phaseLabel: "Run failed",
      });
      if (profileForSnapshot) {
        await persistRunToProject(runId, profileForSnapshot);
      }
    } catch {
      // Even error reporting failed; nothing left to do.
    }
  }
}

// In-process guard so a double-click / duplicate trigger can't run two resumes
// for the same run concurrently.
const resumingRuns = new Set<string>();

/**
 * Resume a run that stalled, capped, or failed mid-audience — WITHOUT redoing
 * the expensive research desks. Re-runs only the cohorts that never finished
 * (clearing any partial personas first), then aggregates, synthesises and
 * converges. Reuses the completed desks and existing personas, so the founder
 * never re-pays for work that already succeeded.
 */
export async function resumeRun(runId: string): Promise<void> {
  if (resumingRuns.has(runId)) {
    console.log(`[orchestrator] resume already in progress for ${runId}`);
    return;
  }
  resumingRuns.add(runId);
  const emitter = await RunEmitter.create(runId);
  let profileForSnapshot: ClientProfile | null = null;
  try {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    profileForSnapshot = profile;
    await throwIfRunCancelled(runId);

    // Cohorts that didn't finish (stuck "simulating", "failed", or never
    // started "pending") are reset — and their partial personas dropped so we
    // don't double-count — then re-run.
    const unfinished = await prisma.cohort.findMany({
      where: { runId, state: { in: ["simulating", "failed", "pending"] } },
      select: { id: true },
    });
    const unfinishedIds = unfinished.map((c) => c.id);
    if (unfinishedIds.length > 0) {
      await throwIfRunCancelled(runId);
      await prisma.persona.deleteMany({
        where: { cohortId: { in: unfinishedIds } },
      });
      await prisma.cohort.updateMany({
        where: { id: { in: unfinishedIds } },
        data: { state: "pending" },
      });
    }

    // Currency from an already-simulated persona (the planner's value is gone
    // by now); fall back to the client's geography-implied currency or USD.
    const sample = await prisma.persona.findFirst({
      where: { cohort: { runId } },
      select: { wtpCurrency: true },
    });
    const currency = sample?.wtpCurrency ?? "USD";

    await setStatus(
      emitter,
      "running",
      unfinishedIds.length > 0
        ? `Continuing — ${unfinishedIds.length} cohorts left to simulate`
        : "Continuing — finishing audience synthesis"
    );

    if (unfinishedIds.length > 0) {
      await throwIfRunCancelled(runId);
      await simulateAllCohorts(emitter, unfinishedIds, profile, currency);
    }

    // Aggregate + audience synthesis (only if not already present) + converge.
    const doneCount = await prisma.cohort.count({
      where: { runId, state: "done" },
    });
    let aggregate: AudienceAggregate | null = null;
    if (doneCount > 0) {
      await throwIfRunCancelled(runId);
      await setStatus(emitter, "running", "Aggregating simulated audience");
      aggregate = await aggregateAudience(emitter);
    }
    const hasAudienceBlock =
      (await prisma.block.count({ where: { runId, kind: "audience" } })) > 0;
    if (aggregate && !hasAudienceBlock && !(await isOverTokenCap(runId))) {
      await throwIfRunCancelled(runId);
      const agg = aggregate;
      const audienceBlockId = await spawnBlock(emitter, {
        name: "Audience Synthesis",
        mission: `Distill the simulated audience (${agg.totalPersonas} personas across ${agg.totalCohorts} cohorts) into decision-ready findings: converting segments and localities, willingness to pay, channel ranking, platform-by-segment social strategy, dominant objections.`,
        layer: 2,
        kind: "audience",
        domain: "audience",
        inputBlockIds: [],
        params: {},
      });
      await executeBlock(emitter, audienceBlockId, profile, [], () =>
        callAudienceSynth(runId, profile, agg)
      );
    }

    await entangleAndConverge(emitter, profile, 2);
    await persistRunToProject(runId, profile);
  } catch (e) {
    if (isRunCancelledError(e)) {
      await markRunCancelled(runId);
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[orchestrator] resume ${runId} failed:`, e);
    try {
      await prisma.run.update({
        where: { id: runId },
        data: { status: "failed" },
      });
      await emitter.emit({ type: "run_error", message });
      await emitter.emit({
        type: "run_status",
        status: "failed",
        phaseLabel: "Resume failed",
      });
      if (profileForSnapshot) await persistRunToProject(runId, profileForSnapshot);
    } catch {
      // nothing left to do
    }
  } finally {
    resumingRuns.delete(runId);
  }
}

/** Fork resume: re-execute only the fork-point block, then continue downstream. */
async function executeForkPhase(
  emitter: RunEmitter,
  profile: ClientProfile,
  forkBlockId: string
): Promise<void> {
  const forkBlock = await prisma.block.findUniqueOrThrow({
    where: { id: forkBlockId },
  });
  await setStatus(
    emitter,
    "running",
    `Fork — re-running "${forkBlock.name}"`
  );
  const inputIds: string[] = JSON.parse(forkBlock.inputBlockIds);
  const inputConclusions = (
    await prisma.conclusion.findMany({ where: { blockId: { in: inputIds } } })
  ).map(conclusionToWire);

  const ok = await executeBlock(emitter, forkBlockId, profile, inputConclusions);
  const siblings = await prisma.block.count({
    where: { runId: emitter.runId, state: "concluded" },
  });
  if (!ok && siblings === 0) throw new Error("Forked block failed");

  await entangleAndConverge(emitter, profile, forkBlock.layer);
}

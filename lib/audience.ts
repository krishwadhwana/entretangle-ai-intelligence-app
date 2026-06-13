import { prisma } from "./db";
import { config } from "./config";
import { callCohortSim } from "./llm";
import { spreadKmForLocality } from "./audienceCoverage";
import { getCostUsd, getTokensUsed, isOverTokenCap } from "./usage";
import { isRunCancelledError, throwIfRunCancelled } from "./jobs";
import type { RunEmitter } from "./events";
import type {
  AudienceAggregate,
  ClientProfile,
  Cohort,
  CohortStats,
  Persona,
  PlannerV2Output,
} from "./schema";

// ---------------------------------------------------------------------------
// Audience simulation engine (SPEC-V2 §1C, §1D).
// "Thousands of agents" = cohorts (locality x segment x role), each simulated
// in ONE mini-model call returning 25–50 personas; aggregation is pure code.
// ---------------------------------------------------------------------------

export { cohortToWire, personaToWire } from "./wire";
import { cohortToWire, personaToWire } from "./wire";

// Deterministic jitter (seeded by string) so replays look identical.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function jitter(base: number, seedStr: string, spread: number): number {
  return base + (hashSeed(seedStr) - 0.5) * spread;
}

function spreadPoint(
  baseLat: number,
  baseLng: number,
  seedStr: string,
  spreadKm: number
): [number, number] {
  const angle = hashSeed(seedStr + ":angle") * Math.PI * 2;
  const radiusKm = spreadKm * (0.35 + hashSeed(seedStr + ":radius") * 0.65);
  const lat = baseLat + (Math.cos(angle) * radiusKm) / 111;
  const lngScale = Math.max(0.25, Math.cos((baseLat * Math.PI) / 180));
  const lng = baseLng + (Math.sin(angle) * radiusKm) / (111 * lngScale);
  return [lat, lng];
}

/**
 * Distribute the target audience size across cohorts in proportion to their
 * audience share (weightPct). The per-cohort floor scales DOWN for small
 * targets so a custom size (e.g. 200 agents) is respected exactly.
 * Returns one persona-count per cohort; the sum is exactly target.
 */
function distributeAudience(weights: number[], target: number): number[] {
  if (target <= 0 || weights.length === 0) return weights.map(() => 0);
  if (target < weights.length) {
    return weights.map((_, i) => (i < target ? 1 : 0));
  }

  // Floor never exceeds the even-split size, so a small target is respected.
  const floor = Math.max(
    1,
    Math.min(config.minPersonasPerCohort, Math.floor(target / weights.length))
  );
  const totalW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const base = weights.map(() => floor);
  const remaining = target - floor * weights.length;
  if (remaining === 0) return base;

  const quotas = weights.map((w) => {
    const share = totalW > 0 ? Math.max(0, w) / totalW : 1 / weights.length;
    return remaining * share;
  });
  const extras = quotas.map(Math.floor);
  let assigned = extras.reduce((sum, n) => sum + n, 0);
  const order = quotas
    .map((quota, i) => ({ i, remainder: quota - Math.floor(quota) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { i } of order) {
    if (assigned >= remaining) break;
    extras[i] += 1;
    assigned += 1;
  }

  return base.map((n, i) => n + extras[i]);
}

/** Phase 1b: persist the planner's cohort matrix and emit spawn events. */
export async function spawnCohorts(
  emitter: RunEmitter,
  plan: PlannerV2Output["cohortPlan"],
  targetSize: number = config.targetAudienceSize
): Promise<string[]> {
  const localities = new Map(plan.localities.map((l) => [l.name, l]));
  const target = Math.max(0, Math.floor(targetSize));
  const maxCohorts = target > 0 ? Math.min(config.maxCohorts, target) : 0;
  const cohorts = plan.cohorts.slice(0, maxCohorts);
  const sizes = distributeAudience(
    cohorts.map((c) => c.weightPct),
    target
  );
  const ids: string[] = [];
  for (const [i, c] of cohorts.entries()) {
    await throwIfRunCancelled(emitter.runId);
    const loc = localities.get(c.locality) ?? plan.localities[0];
    const label = `${loc.name} · ${c.segment} · ${c.role.replace("_", " ")}`;
    const [lat, lng] = spreadPoint(
      loc.lat,
      loc.lng,
      label,
      spreadKmForLocality(loc.name, loc.country)
    );
    const row = await prisma.cohort.create({
      data: {
        runId: emitter.runId,
        label,
        locality: loc.name,
        country: loc.country,
        // Spread same-city cohorts across the metro/market area instead of
        // stacking them on the city centroid.
        lat,
        lng,
        segment: c.segment,
        role: c.role,
        weightPct: c.weightPct,
        size: sizes[i],
        state: "pending",
      },
    });
    ids.push(row.id);
    await emitter.emit({ type: "cohort_spawned", cohort: cohortToWire(row) });
  }
  return ids;
}

/**
 * Split a cohort's target size into per-call batches. Kept for callers that
 * want a precomputed schedule; the live simulation loop now requests the
 * remaining exact count directly so custom tiny audiences work too.
 */
export function batchSizes(total: number, perCall: number): number[] {
  if (total <= perCall) return [Math.max(1, total)];
  const batches: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const take = Math.min(perCall, remaining);
    if (take < 10 && batches.length > 0) {
      batches[batches.length - 1] += take; // fold tiny remainder back
    } else {
      batches.push(take);
    }
    remaining -= take;
  }
  return batches;
}

/**
 * Copy a prior run's simulated audience (cohorts + personas) into the current
 * run, replaying spawn/simulate events so the canvas shows them instantly.
 * Used by forks and by scoped follow-up runs that reuse an existing audience
 * instead of paying to re-simulate thousands of personas. Does NOT aggregate
 * — the caller decides when to emit `audience_aggregated`.
 * Returns how many `done` cohorts were copied and the audience currency.
 */
export async function copyAudienceFrom(
  emitter: RunEmitter,
  sourceRunId: string
): Promise<{ doneCohorts: number; currency: string | null }> {
  const cohorts = await prisma.cohort.findMany({
    where: { runId: sourceRunId },
    include: { personas: true },
  });
  let doneCohorts = 0;
  let currency: string | null = null;
  for (const c of cohorts) {
    await throwIfRunCancelled(emitter.runId);
    const newCohort = await prisma.cohort.create({
      data: {
        runId: emitter.runId,
        label: c.label,
        locality: c.locality,
        country: c.country,
        lat: c.lat,
        lng: c.lng,
        segment: c.segment,
        role: c.role,
        weightPct: c.weightPct,
        size: c.size,
        state: c.state,
        stats: c.stats,
        summary: c.summary,
      },
    });
    await emitter.emit({
      type: "cohort_spawned",
      cohort: { ...cohortToWire(newCohort), state: "pending" },
    });
    if (c.state !== "done") continue;
    const personas = [];
    for (const p of c.personas) {
      await throwIfRunCancelled(emitter.runId);
      currency = currency ?? p.wtpCurrency;
      personas.push(
        await prisma.persona.create({
          data: {
            cohortId: newCohort.id,
            name: p.name,
            age: p.age,
            gender: p.gender,
            occupation: p.occupation,
            incomeBand: p.incomeBand,
            lat: p.lat,
            lng: p.lng,
            intent: p.intent,
            wtp: p.wtp,
            wtpCurrency: p.wtpCurrency,
            channelPref: p.channelPref,
            platforms: p.platforms,
            objection: p.objection,
            quote: p.quote,
            lifestyle: p.lifestyle,
            lifeStage: p.lifeStage,
            values: p.values,
            shoppingHabits: p.shoppingHabits,
            priceSensitivity: p.priceSensitivity,
            reasoning: p.reasoning,
            personality: p.personality,
            personalityTraits: p.personalityTraits,
          },
        })
      );
    }
    if (c.stats) {
      await emitter.emit({
        type: "cohort_simulated",
        cohortId: newCohort.id,
        stats: JSON.parse(c.stats) as CohortStats,
        summary: c.summary ?? "",
        personas: personas.map(personaToWire),
      });
      doneCohorts += 1;
    }
  }
  return { doneCohorts, currency };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1)))
  );
  return sorted[idx];
}

function shares(values: string[], top: number): { name: string; share: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || k === "none") continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = values.length || 1;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([name, n]) => ({ name, share: Math.round((n / total) * 1000) / 10 }));
}

function computeCohortStats(
  personas: Persona[],
  currency: string
): CohortStats {
  const wtps = personas.map((p) => p.wtp).sort((a, b) => a - b);
  const meanIntent =
    personas.reduce((s, p) => s + p.intent, 0) / (personas.length || 1);
  return {
    n: personas.length,
    meanIntent: Math.round(meanIntent * 1000) / 1000,
    wtpP25: percentile(wtps, 25),
    wtpP50: percentile(wtps, 50),
    wtpP75: percentile(wtps, 75),
    wtpCurrency: currency,
    topChannels: shares(personas.map((p) => p.channelPref), 4),
    topPlatforms: shares(personas.flatMap((p) => p.platforms), 5),
    topObjections: Array.from(
      new Set(personas.map((p) => p.objection.trim()).filter(Boolean))
    ).slice(0, 4),
  };
}

/**
 * Simulate one cohort end-to-end. A cohort's target size is produced across
 * several mini-model calls (≤60 personas each), each a distinct batch — this
 * is how a cohort can hold hundreds of varied personas. A single batch
 * failing does not fail the cohort; only zero personas does. Returns true if
 * the cohort produced any personas.
 */
async function simulateCohort(
  emitter: RunEmitter,
  cohortId: string,
  profile: ClientProfile,
  currency: string
): Promise<boolean> {
  const cohort = await prisma.cohort.findUniqueOrThrow({
    where: { id: cohortId },
  });
  try {
    await throwIfRunCancelled(emitter.runId);
    await prisma.cohort.update({
      where: { id: cohortId },
      data: { state: "simulating" },
    });

    const personas: Persona[] = [];
    let summary = "";
    let idx = 0;
    let batchIndex = 0;
    const maxAttempts =
      Math.ceil(cohort.size / Math.max(1, config.personasPerCall)) + 3;
    while (personas.length < cohort.size && batchIndex < maxAttempts) {
      await throwIfRunCancelled(emitter.runId);
      // Cap-aware mid-cohort: keep whatever batches already landed.
      if (batchIndex > 0 && (await isOverTokenCap(emitter.runId))) break;
      const n = Math.min(config.personasPerCall, cohort.size - personas.length);
      const attemptIndex = batchIndex;
      batchIndex += 1;
      let out;
      try {
        // callCohortSim carries an SDK-level request timeout (config.
        // cohortTimeoutMs): a hung call is genuinely ABORTED — it doesn't
        // freeze the audience, and it isn't left running to bill for nothing.
        out = await callCohortSim(
          emitter.runId,
          cohortToWire(cohort),
          profile,
          currency,
          n,
          attemptIndex
        );
      } catch (e) {
        console.log(
          `[audience] cohort ${cohort.label} batch ${attemptIndex} failed: ${e}`
        );
        continue; // partial-failure tolerant
      }
      if (!summary) summary = out.summary;
      for (const p of out.personas.slice(0, n)) {
        await throwIfRunCancelled(emitter.runId);
        const row = await prisma.persona.create({
          data: {
            cohortId,
            name: p.name,
            age: p.age,
            gender: p.gender,
            occupation: p.occupation,
            incomeBand: p.incomeBand,
            lat: jitter(cohort.lat, `${cohortId}:${idx}:lat`, 0.08),
            lng: jitter(cohort.lng, `${cohortId}:${idx}:lng`, 0.08),
            intent: p.intent,
            wtp: p.wtp,
            wtpCurrency: currency,
            channelPref: p.channelPref,
            platforms: JSON.stringify(p.platforms),
            objection: p.objection,
            quote: p.quote,
            lifestyle: p.lifestyle,
            lifeStage: p.lifeStage,
            values: JSON.stringify(p.values),
            shoppingHabits: p.shoppingHabits,
            priceSensitivity: p.priceSensitivity,
            reasoning: p.reasoning,
            personality: p.personality,
            personalityTraits: JSON.stringify(p.personalityTraits),
          },
        });
        personas.push(personaToWire(row));
        idx += 1;
      }
    }

    if (personas.length === 0) throw new Error("all cohort batches failed");

    const stats = computeCohortStats(personas, currency);
    await prisma.cohort.update({
      where: { id: cohortId },
      data: {
        state: "done",
        stats: JSON.stringify(stats),
        summary,
      },
    });
    await emitter.emit({
      type: "cohort_simulated",
      cohortId,
      stats,
      summary,
      personas,
    });
    return true;
  } catch (e) {
    if (isRunCancelledError(e)) throw e;
    const error = e instanceof Error ? e.message : String(e);
    await prisma.cohort.update({
      where: { id: cohortId },
      data: { state: "failed" },
    });
    await emitter.emit({ type: "cohort_failed", cohortId, error });
    return false;
  }
}

/**
 * Phase 2b: simulate all cohorts with a fixed-size WORKER POOL (size
 * AUDIENCE_CONCURRENCY). Each worker independently pulls the next cohort the
 * moment it finishes — so a slow or stuck cohort only ties up its own slot and
 * NEVER blocks the others or the cohorts waiting behind it (no wave barrier).
 * Cost/token caps are checked before each cohort; once capped, workers stop
 * pulling new work and the run keeps whatever finished. After every cohort a
 * tokens/cost update is emitted so the dashboard tracks spend live. Returns
 * the number of cohorts that completed.
 */
export async function simulateAllCohorts(
  emitter: RunEmitter,
  cohortIds: string[],
  profile: ClientProfile,
  currency: string
): Promise<number> {
  const concurrency = Math.max(1, config.audienceConcurrency);
  let done = 0;
  let cursor = 0;
  let capped = false;

  async function worker(): Promise<void> {
    while (true) {
      if (capped) return;
      await throwIfRunCancelled(emitter.runId);
      if (await isOverTokenCap(emitter.runId)) {
        if (!capped) {
          capped = true;
          console.log(
            `[audience] cap reached after ${done} cohorts — stopping simulation`
          );
        }
        return;
      }
      const i = cursor++;
      if (i >= cohortIds.length) return;
      // simulateCohort never throws (it catches + marks the cohort failed), so
      // one bad cohort can't kill its worker — the worker just grabs the next.
      const ok = await simulateCohort(emitter, cohortIds[i], profile, currency);
      if (ok) done += 1;
      // Live spend tracking after each cohort.
      await emitter.emit({
        type: "cost_used",
        costUsd: await getCostUsd(emitter.runId),
      });
      await emitter.emit({
        type: "tokens_used",
        tokensUsed: await getTokensUsed(emitter.runId),
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return done;
}

/** Phase 3: pure-code aggregation across every simulated persona. */
export async function aggregateAudience(
  emitter: RunEmitter
): Promise<AudienceAggregate | null> {
  await throwIfRunCancelled(emitter.runId);
  const cohorts = await prisma.cohort.findMany({
    where: { runId: emitter.runId, state: "done" },
    include: { personas: true },
  });
  const personas = cohorts.flatMap((c) =>
    c.personas.map((p) => ({ ...personaToWire(p), cohort: c }))
  );
  if (personas.length === 0) return null;

  const group = (key: (p: (typeof personas)[number]) => string) => {
    const m = new Map<string, { intents: number[]; wtps: number[] }>();
    for (const p of personas) {
      const k = key(p);
      const g = m.get(k) ?? { intents: [], wtps: [] };
      g.intents.push(p.intent);
      g.wtps.push(p.wtp);
      m.set(k, g);
    }
    return Object.fromEntries(
      Array.from(m.entries()).map(([k, g]) => [
        k,
        {
          n: g.intents.length,
          meanIntent:
            Math.round(
              (g.intents.reduce((s, x) => s + x, 0) / g.intents.length) * 1000
            ) / 1000,
          wtpP50: percentile(
            g.wtps.slice().sort((a, b) => a - b),
            50
          ),
        },
      ])
    );
  };

  // platform -> segment -> share of that segment using the platform
  const platformMatrix: Record<string, Record<string, number>> = {};
  const segCounts = new Map<string, number>();
  for (const p of personas) {
    segCounts.set(p.cohort.segment, (segCounts.get(p.cohort.segment) ?? 0) + 1);
  }
  for (const p of personas) {
    for (const platRaw of p.platforms) {
      const plat = platRaw.trim().toLowerCase();
      if (!plat || plat === "none") continue;
      platformMatrix[plat] = platformMatrix[plat] ?? {};
      platformMatrix[plat][p.cohort.segment] =
        (platformMatrix[plat][p.cohort.segment] ?? 0) + 1;
    }
  }
  for (const plat of Object.keys(platformMatrix)) {
    for (const seg of Object.keys(platformMatrix[plat])) {
      platformMatrix[plat][seg] =
        Math.round(
          (platformMatrix[plat][seg] / (segCounts.get(seg) ?? 1)) * 1000
        ) / 10;
    }
  }

  const objectionCounts = new Map<string, number>();
  for (const p of personas) {
    const o = p.objection.trim().toLowerCase();
    if (o) objectionCounts.set(o, (objectionCounts.get(o) ?? 0) + 1);
  }

  const aggregate: AudienceAggregate = {
    totalPersonas: personas.length,
    totalCohorts: cohorts.length,
    bySegment: group((p) => p.cohort.segment),
    byLocality: group((p) => p.cohort.locality),
    byRole: group((p) => p.cohort.role),
    channelShare: shares(personas.map((p) => p.channelPref), 8),
    platformShare: shares(personas.flatMap((p) => p.platforms), 8),
    platformMatrix,
    topObjections: Array.from(objectionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([text, count]) => ({ text, count })),
  };
  await emitter.emit({ type: "audience_aggregated", aggregate });
  return aggregate;
}

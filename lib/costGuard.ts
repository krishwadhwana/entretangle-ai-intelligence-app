// Cost RESERVATION, not just post-hoc accounting.
//
// The problem: `isOverTokenCap` reads the committed spend from the DB and is
// checked BETWEEN spawn waves. But a wave fans desks + cohorts out
// concurrently (DESK_CONCURRENCY, AUDIENCE_CONCURRENCY), so several frontier
// calls can clear the gate together and blow past MAX_COST_USD before any of
// them records its usage. The "≤ $5/run" number is then aspirational, not
// enforced.
//
// The fix: before dispatching a model call we RESERVE its worst-case cost on an
// in-process per-run ledger. A call is refused when committed + in-flight
// reservations would exceed the cap AND other calls are already in flight — so
// the marginal call caps out (throws CostCapError) while in-flight calls finish.
// On completion the reservation is released; the real cost is recorded via
// `recordUsage` as before, and `syncCommitted` keeps the ledger's committed
// figure aligned with the authoritative DB total.
//
// Scope: a run is owned by exactly one worker (the RunJob lease guarantees it),
// so an in-process ledger is sufficient — no cross-process coordination needed.

import { config } from "./config";
import type { ModelTier } from "./usage";

type RunBudget = {
  committedUsd: number;
  committedTokens: number;
  reservedUsd: number;
  reservedTokens: number;
};

const ledgers = new Map<string, RunBudget>();

function ledger(runId: string): RunBudget {
  let b = ledgers.get(runId);
  if (!b) {
    b = { committedUsd: 0, committedTokens: 0, reservedUsd: 0, reservedTokens: 0 };
    ledgers.set(runId, b);
  }
  return b;
}

/** Thrown when a model call is refused because it would breach the run's cost
 *  or token cap. Callers should treat it as "capped", not a generic failure. */
export class CostCapError extends Error {
  constructor(
    public readonly runId: string,
    public readonly projected: { costUsd: number; tokens: number }
  ) {
    super(
      `run ${runId} cost-capped: projected $${projected.costUsd.toFixed(2)} / ` +
        `${projected.tokens} tok would exceed cap ($${config.maxCostUsd} / ` +
        `${config.maxTokensPerRun} tok)`
    );
    this.name = "CostCapError";
  }
}

export function isCostCapError(e: unknown): e is CostCapError {
  return e instanceof CostCapError;
}

/** Rough token count for budgeting (≈ 4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Dollar cost of a call given token counts — mirrors usage.ts costOf so the
 *  reservation uses the same pricing the ledger will later be charged. */
export function estimateCostUsd(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
  webSearchCalls = 0
): number {
  const p = config.pricing;
  const inRate = tier === "mini" ? p.miniIn : p.frontierIn;
  const outRate = tier === "mini" ? p.miniOut : p.frontierOut;
  return (
    (inputTokens / 1_000_000) * inRate +
    (outputTokens / 1_000_000) * outRate +
    webSearchCalls * p.webSearchPerCall
  );
}

/** Align the ledger's committed spend with the authoritative DB total. Called
 *  from recordUsage after every run.update. */
export function syncCommitted(
  runId: string,
  committedUsd: number,
  committedTokens: number
): void {
  const b = ledger(runId);
  b.committedUsd = committedUsd;
  b.committedTokens = committedTokens;
}

/** In-flight reserved (not yet committed) spend for a run. */
export function reservedSpend(runId: string): { costUsd: number; tokens: number } {
  const b = ledgers.get(runId);
  return { costUsd: b?.reservedUsd ?? 0, tokens: b?.reservedTokens ?? 0 };
}

/**
 * Try to reserve budget for a call. Returns true (and holds the reservation)
 * when the call may proceed; false when it must be refused. Always allows at
 * least one in-flight call while under cap, so a run can never deadlock.
 */
export function reserveBudget(
  runId: string,
  estUsd: number,
  estTokens: number
): boolean {
  const b = ledger(runId);
  // Hard stop: already at/over cap on committed spend alone.
  if (
    b.committedUsd >= config.maxCostUsd ||
    b.committedTokens >= config.maxTokensPerRun
  ) {
    return false;
  }
  const projUsd = b.committedUsd + b.reservedUsd + estUsd;
  const projTokens = b.committedTokens + b.reservedTokens + estTokens;
  const wouldExceed =
    projUsd > config.maxCostUsd || projTokens > config.maxTokensPerRun;
  // Refuse the marginal call only when others are in flight — otherwise we'd
  // stall a run whose single next call's worst-case estimate tops the cap.
  if (wouldExceed && b.reservedUsd > 0) return false;
  b.reservedUsd += estUsd;
  b.reservedTokens += estTokens;
  return true;
}

/** Release a previously held reservation (the real cost lands via recordUsage). */
export function releaseReservation(
  runId: string,
  estUsd: number,
  estTokens: number
): void {
  const b = ledgers.get(runId);
  if (!b) return;
  b.reservedUsd = Math.max(0, b.reservedUsd - estUsd);
  b.reservedTokens = Math.max(0, b.reservedTokens - estTokens);
}

/** committed + in-flight reservations for a run. */
export function projectedSpend(runId: string): { costUsd: number; tokens: number } {
  const b = ledgers.get(runId);
  if (!b) return { costUsd: 0, tokens: 0 };
  return {
    costUsd: b.committedUsd + b.reservedUsd,
    tokens: b.committedTokens + b.reservedTokens,
  };
}

/** Drop a finished run's ledger so the in-process map doesn't grow unbounded
 *  in a long-lived worker. Call on run termination. */
export function clearRunBudget(runId: string): void {
  ledgers.delete(runId);
}

/**
 * Reserve → run → release. Throws CostCapError (before calling `fn`) when the
 * reservation is refused. `estTokens` is the worst-case total tokens; `estUsd`
 * its dollar cost. Run-less calls (project-only features) pass runId === null
 * and are not gated.
 */
export async function withReservation<T>(
  runId: string | null,
  estUsd: number,
  estTokens: number,
  fn: () => Promise<T>
): Promise<T> {
  if (!runId) return fn();
  if (!reserveBudget(runId, estUsd, estTokens)) {
    throw new CostCapError(runId, projectedSpend(runId));
  }
  try {
    return await fn();
  } finally {
    releaseReservation(runId, estUsd, estTokens);
  }
}

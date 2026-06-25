import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import { RunEmitter } from "./events";
import { providerErrorMessage } from "./providerErrors";

// A worker renews its lock every LEASE_RENEW_MS while a job runs. If a job sits
// in "running" with a lock older than LEASE_MS, the worker that held it is
// presumed dead (crashed / restarted by a deploy) and the job is reclaimable.
// Without this, a worker restart orphans the in-flight job forever — the run
// hangs and "Continue run" no-ops because the dead job still looks active.
export const LEASE_MS = 120_000;
export const LEASE_RENEW_MS = 30_000;
// Hard ceiling on reclaims so a genuinely poisonous job can't crash-loop the
// worker indefinitely — past this it stays put (visible) rather than re-running.
const MAX_RECLAIM_ATTEMPTS = 5;

export type RunJobType =
  | "execute"
  | "resume"
  | "add_cohort"
  | "design_tokens"
  | "design_logo"
  | "design_collateral"
  | "design_site";
export type RunJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ClaimedRunJob = {
  id: string;
  runId: string | null;
  projectId: string | null;
  type: RunJobType;
  status: RunJobStatus;
  attempts: number;
  cancelRequested: boolean;
  payload: Prisma.JsonValue | null;
};

export class RunCancelledError extends Error {
  constructor(public readonly runId: string) {
    super(`run ${runId} was cancelled`);
    this.name = "RunCancelledError";
  }
}

export function isRunCancelledError(error: unknown): error is RunCancelledError {
  return error instanceof RunCancelledError;
}

export async function enqueueRunJob(
  runId: string,
  type: Extract<RunJobType, "execute" | "resume" | "add_cohort">
): Promise<{ id: string; alreadyQueued: boolean }> {
  // Release any job orphaned by a dead worker (running but lease expired) so it
  // no longer masks this run as "active" — otherwise "Continue run" would dedupe
  // against the zombie and silently do nothing.
  await prisma.runJob.updateMany({
    where: {
      runId,
      status: "running",
      lockedAt: { lt: new Date(Date.now() - LEASE_MS) },
    },
    data: {
      status: "failed",
      error: "worker lease expired (orphaned by worker restart)",
      finishedAt: new Date(),
      lockedBy: null,
    },
  });

  const existing = await prisma.runJob.findFirst({
    where: {
      runId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return { id: existing.id, alreadyQueued: true };

  const job = await prisma.runJob.create({
    data: { runId, type, status: "queued" },
    select: { id: true },
  });
  return { id: job.id, alreadyQueued: false };
}

export async function enqueueProjectJob(
  projectId: string,
  type: Exclude<RunJobType, "execute" | "resume" | "add_cohort">,
  payload: Prisma.InputJsonValue,
  opts: {
    priority?: number;
    dedupe?: boolean;
    cancelQueued?: boolean;
  } = {}
): Promise<{ id: string; alreadyQueued: boolean }> {
  await prisma.runJob.updateMany({
    where: {
      projectId,
      type,
      status: "running",
      lockedAt: { lt: new Date(Date.now() - LEASE_MS) },
    },
    data: {
      status: "failed",
      error: "worker lease expired (orphaned by worker restart)",
      finishedAt: new Date(),
      lockedBy: null,
    },
  });

  if (opts.cancelQueued) {
    await prisma.runJob.updateMany({
      where: { projectId, type, status: "queued" },
      data: {
        status: "cancelled",
        cancelRequested: true,
        finishedAt: new Date(),
        error: "superseded by a newer design generation request",
      },
    });
  }

  if (opts.dedupe !== false) {
    const existing = await prisma.runJob.findFirst({
      where: {
        projectId,
        type,
        status: { in: ["queued", "running"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) return { id: existing.id, alreadyQueued: true };
  }

  const job = await prisma.runJob.create({
    data: {
      projectId,
      type,
      status: "queued",
      payload,
      priority: opts.priority ?? 0,
    },
    select: { id: true },
  });
  return { id: job.id, alreadyQueued: false };
}

export async function requestRunCancellation(runId: string): Promise<{
  runningJobs: number;
  queuedJobsCancelled: number;
}> {
  const [running, queued] = await prisma.$transaction([
    prisma.runJob.updateMany({
      where: { runId, status: "running" },
      data: { cancelRequested: true },
    }),
    prisma.runJob.updateMany({
      where: { runId, status: "queued" },
      data: {
        status: "cancelled",
        cancelRequested: true,
        finishedAt: new Date(),
      },
    }),
  ]);

  const emitter = await RunEmitter.create(runId);
  if (running.count > 0) {
    await prisma.run.update({ where: { id: runId }, data: { status: "cancelling" } });
    await emitter.emit({
      type: "run_status",
      status: "cancelling",
      phaseLabel: "Cancelling run",
    });
  } else if (queued.count > 0) {
    await markRunCancelled(runId, "Run cancelled before worker start");
  }

  return { runningJobs: running.count, queuedJobsCancelled: queued.count };
}

export async function isRunCancellationRequested(
  runId: string
): Promise<boolean> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (run?.status === "cancelling" || run?.status === "cancelled") return true;

  const job = await prisma.runJob.findFirst({
    where: {
      runId,
      status: { in: ["queued", "running"] },
      cancelRequested: true,
    },
    select: { id: true },
  });
  return !!job;
}

export async function throwIfRunCancelled(runId: string): Promise<void> {
  if (await isRunCancellationRequested(runId)) {
    throw new RunCancelledError(runId);
  }
}

export async function markRunCancelled(
  runId: string,
  phaseLabel = "Run cancelled"
): Promise<void> {
  await prisma.run.update({ where: { id: runId }, data: { status: "cancelled" } });
  const emitter = await RunEmitter.create(runId);
  await emitter.emit({ type: "run_status", status: "cancelled", phaseLabel });
}

export async function claimNextRunJob(
  workerId: string
): Promise<ClaimedRunJob | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      run_id: string | null;
      project_id: string | null;
      type: string;
      status: string;
      attempts: number;
      cancel_requested: boolean;
      payload: Prisma.JsonValue | null;
    }>
  >`
    UPDATE run_jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = now(),
        started_at = COALESCE(started_at, now()),
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = (
      SELECT id
      FROM run_jobs
      AS candidate
      WHERE (
          candidate.status = 'queued'
          -- Reclaim a job orphaned by a dead/restarted worker: still 'running'
          -- but its lease lapsed. Bounded by attempts so a poison job can't loop.
          OR (
            candidate.status = 'running'
            AND candidate.locked_at < now() - interval '120 seconds'
            AND candidate.attempts < ${MAX_RECLAIM_ATTEMPTS}
          )
        )
        AND (
          candidate.cancel_requested = false
          OR (
            candidate.status = 'running'
            AND candidate.type IN (
              'design_tokens',
              'design_logo',
              'design_collateral',
              'design_site'
            )
            AND candidate.locked_at < now() - interval '120 seconds'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM run_jobs AS active
          WHERE (
              (candidate.run_id IS NOT NULL AND active.run_id = candidate.run_id)
              OR (
                candidate.run_id IS NULL
                AND candidate.project_id IS NOT NULL
                AND active.project_id = candidate.project_id
                AND active.type = candidate.type
              )
            )
            AND active.id <> candidate.id
            AND active.status = 'running'
            AND active.cancel_requested = false
            -- Only a LIVE sibling (fresh lease) blocks; a stale one is dead.
            AND active.locked_at > now() - interval '120 seconds'
        )
      ORDER BY candidate.priority DESC, candidate.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, run_id, project_id, type, status, attempts, cancel_requested, payload
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    type: row.type as RunJobType,
    status: row.status as RunJobStatus,
    attempts: row.attempts,
    cancelRequested: row.cancel_requested,
    payload: row.payload,
  };
}

// Keep a running job's lease fresh so the reclaim path doesn't steal it from a
// worker that's alive but legitimately slow (a long simulation). Scoped to the
// holder so a stale worker can't renew a lock it no longer owns.
export async function renewJobLease(
  jobId: string,
  workerId: string
): Promise<void> {
  await prisma.runJob.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "running" },
    data: { lockedAt: new Date() },
  });
}

export async function markJobSucceeded(jobId: string): Promise<void> {
  await prisma.runJob.update({
    where: { id: jobId },
    data: { status: "succeeded", finishedAt: new Date(), lockedBy: null },
  });
}

export async function markJobSucceededWithResult(
  jobId: string,
  result: Prisma.InputJsonValue
): Promise<void> {
  await prisma.runJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      result,
      finishedAt: new Date(),
      lockedBy: null,
    },
  });
}

export async function markJobCancelled(jobId: string): Promise<void> {
  await prisma.runJob.update({
    where: { id: jobId },
    data: {
      status: "cancelled",
      cancelRequested: true,
      finishedAt: new Date(),
      lockedBy: null,
    },
  });
}

export async function markJobFailed(
  job: ClaimedRunJob,
  error: unknown
): Promise<void> {
  const message = providerErrorMessage(error, "job failed");
  await prisma.runJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      error: message.slice(0, 8000),
      finishedAt: new Date(),
      lockedBy: null,
    },
  });
}

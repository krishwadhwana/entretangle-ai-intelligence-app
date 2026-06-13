import { prisma } from "./db";
import { RunEmitter } from "./events";

export type RunJobType = "execute" | "resume";
export type RunJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ClaimedRunJob = {
  id: string;
  runId: string;
  type: RunJobType;
  status: RunJobStatus;
  attempts: number;
  cancelRequested: boolean;
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
  type: RunJobType
): Promise<{ id: string; alreadyQueued: boolean }> {
  const existing = await prisma.runJob.findFirst({
    where: {
      runId,
      type,
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
      run_id: string;
      type: string;
      status: string;
      attempts: number;
      cancel_requested: boolean;
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
      WHERE status = 'queued'
        AND cancel_requested = false
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, run_id, type, status, attempts, cancel_requested
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type as RunJobType,
    status: row.status as RunJobStatus,
    attempts: row.attempts,
    cancelRequested: row.cancel_requested,
  };
}

export async function markJobSucceeded(jobId: string): Promise<void> {
  await prisma.runJob.update({
    where: { id: jobId },
    data: { status: "succeeded", finishedAt: new Date(), lockedBy: null },
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
  const message = error instanceof Error ? error.message : String(error);
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

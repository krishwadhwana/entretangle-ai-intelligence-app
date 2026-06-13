import { randomUUID } from "crypto";
import {
  claimNextRunJob,
  isRunCancelledError,
  markJobCancelled,
  markJobFailed,
  markJobSucceeded,
  markRunCancelled,
  throwIfRunCancelled,
  type ClaimedRunJob,
} from "../lib/jobs";
import { prisma } from "../lib/db";
import { executeRun, resumeRun } from "../lib/orchestrator";

const workerId = process.env.WORKER_ID ?? `run-worker-${randomUUID()}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "2000", 10);
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(job: ClaimedRunJob): Promise<void> {
  console.log(`[worker ${workerId}] ${job.type} ${job.runId} (${job.id})`);
  try {
    const run = await prisma.run.findUnique({
      where: { id: job.runId },
      select: {
        status: true,
        _count: { select: { blocks: true, cohorts: true, events: true } },
      },
    });
    if (!run) {
      throw new Error(`run not found: ${job.runId}`);
    }
    if (["complete", "failed", "capped", "cancelled"].includes(run.status)) {
      console.log(
        `[worker ${workerId}] skipping ${job.type} ${job.runId}; run is ${run.status}`
      );
      await markJobSucceeded(job.id);
      return;
    }
    if (
      job.type === "execute" &&
      (run._count.blocks > 0 || run._count.cohorts > 0 || run._count.events > 0)
    ) {
      console.log(
        `[worker ${workerId}] skipping stale execute ${job.runId}; run already has persisted work`
      );
      await markJobSucceeded(job.id);
      return;
    }
    await throwIfRunCancelled(job.runId);
    if (job.type === "execute") {
      await executeRun(job.runId);
    } else if (job.type === "resume") {
      await resumeRun(job.runId);
    } else {
      throw new Error(`unknown job type: ${job.type}`);
    }
    await markJobSucceeded(job.id);
  } catch (error) {
    if (isRunCancelledError(error)) {
      await markRunCancelled(job.runId);
      await markJobCancelled(job.id);
      console.log(`[worker ${workerId}] cancelled ${job.runId}`);
      return;
    }
    await markJobFailed(job, error);
    console.error(`[worker ${workerId}] failed ${job.runId}:`, error);
  }
}

async function main(): Promise<void> {
  console.log(`[worker ${workerId}] polling every ${pollMs}ms`);
  while (!shuttingDown) {
    const job = await claimNextRunJob(workerId);
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    await runJob(job);
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

main()
  .catch((error) => {
    console.error(`[worker ${workerId}] fatal:`, error);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(`[worker ${workerId}] stopped`);
  });

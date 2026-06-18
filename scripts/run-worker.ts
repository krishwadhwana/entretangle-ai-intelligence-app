import { randomUUID } from "crypto";
import {
  claimNextRunJob,
  isRunCancelledError,
  LEASE_RENEW_MS,
  markJobCancelled,
  markJobFailed,
  markJobSucceeded,
  markRunCancelled,
  renewJobLease,
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
  console.log(
    `[worker ${workerId}] ${job.type} ${job.runId} (${job.id}) attempt ${job.attempts}`
  );
  // Renew the lease while we work so the reclaim path never steals a job from
  // this live worker; cleared in finally so a dead worker's lease goes stale.
  const lease = setInterval(() => {
    renewJobLease(job.id, workerId).catch(() => {
      // A missed renewal is harmless — the next tick retries.
    });
  }, LEASE_RENEW_MS);
  if (typeof lease.unref === "function") lease.unref();
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
    const hasWork =
      run._count.blocks > 0 ||
      run._count.cohorts > 0 ||
      run._count.events > 0;
    if (job.type === "execute" && hasWork) {
      // attempts === 1 → a duplicate execute that never started: safe to skip.
      // attempts > 1 → THIS execute was reclaimed after a worker died mid-run;
      // finish it via resume (re-runs only unfinished cohorts, reuses the desks)
      // instead of skipping, which would strand the run "running" forever.
      if (job.attempts > 1) {
        console.log(
          `[worker ${workerId}] reclaimed interrupted execute ${job.runId}; resuming`
        );
        await throwIfRunCancelled(job.runId);
        await resumeRun(job.runId);
        await markJobSucceeded(job.id);
        return;
      }
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
  } finally {
    clearInterval(lease);
  }
}

async function main(): Promise<void> {
  console.log(`[worker ${workerId}] polling every ${pollMs}ms`);
  while (!shuttingDown) {
    // A transient DB error while claiming must NOT kill the loop — that exits
    // the process, and after restartPolicyMaxRetries Railway stops restarting
    // the worker, leaving every run permanently stuck. Log and keep polling.
    try {
      const job = await claimNextRunJob(workerId);
      if (!job) {
        await sleep(pollMs);
        continue;
      }
      await runJob(job);
    } catch (error) {
      console.error(`[worker ${workerId}] poll error:`, error);
      await sleep(pollMs);
    }
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});
// A stray rejection must not take the worker down (see the loop note above).
process.on("unhandledRejection", (reason) => {
  console.error(`[worker ${workerId}] unhandledRejection:`, reason);
});

main()
  .catch((error) => {
    console.error(`[worker ${workerId}] fatal:`, error);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(`[worker ${workerId}] stopped`);
  });

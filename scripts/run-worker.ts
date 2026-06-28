import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  claimNextRunJob,
  isRunCancelledError,
  LEASE_RENEW_MS,
  markJobCancelled,
  markJobFailed,
  markJobSucceeded,
  markJobSucceededWithResult,
  markRunCancelled,
  renewJobLease,
  throwIfRunCancelled,
  type ClaimedRunJob,
} from "../lib/jobs";
import { prisma } from "../lib/db";
import { executeRun, resumeRun, addPendingCohorts } from "../lib/orchestrator";
import { runDesignStudioJob } from "../lib/design/jobs";
import { runIntegrationSyncJob } from "../lib/integrations/jobs";
import { currentDeployInfo, deployInfoLabel } from "../lib/deployInfo";
import { log } from "../lib/log";
import { metrics, startMetricsFlush } from "../lib/metrics";
import { clearRunBudget } from "../lib/costGuard";

const workerId = process.env.WORKER_ID ?? `run-worker-${randomUUID()}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "2000", 10);
const workerLog = log.child({ component: "worker", workerId });
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(job: ClaimedRunJob): Promise<void> {
  const jlog = workerLog.child({
    jobId: job.id,
    runId: job.runId ?? undefined,
    projectId: job.projectId ?? undefined,
    jobType: job.type,
  });
  const startedAt = Date.now();
  let outcome: "succeeded" | "failed" | "cancelled" = "succeeded";
  jlog.info("job claimed", { attempt: job.attempts });
  metrics.incr("job.claimed", { type: job.type });
  // attempts > 1 means this job was reclaimed from a worker that died holding
  // its lease — the rate of this is the signal for "is a poison job thrashing?"
  if (job.attempts > 1) metrics.incr("job.reclaimed", { type: job.type });
  // Renew the lease while we work so the reclaim path never steals a job from
  // this live worker; cleared in finally so a dead worker's lease goes stale.
  const lease = setInterval(() => {
    renewJobLease(job.id, workerId).catch(() => {
      // A missed renewal is harmless — the next tick retries.
    });
  }, LEASE_RENEW_MS);
  if (typeof lease.unref === "function") lease.unref();
  try {
    if (job.type === "integration_sync") {
      const result = await runIntegrationSyncJob(job.payload);
      await markJobSucceededWithResult(job.id, result as Prisma.InputJsonValue);
      return;
    }
    if (job.type.startsWith("design_")) {
      if (!job.projectId) throw new Error(`${job.type} job missing projectId`);
      const result = await runDesignStudioJob({
        type: job.type as "design_tokens" | "design_logo" | "design_collateral" | "design_site",
        projectId: job.projectId,
        payload: job.payload,
        jobId: job.id,
      });
      await markJobSucceededWithResult(job.id, result as Prisma.InputJsonValue);
      return;
    }
    if (!job.runId) throw new Error(`${job.type} job missing runId`);
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
    // add_cohort runs ON a finished run. resume intentionally runs FROM failed,
    // capped, cancelled, or stale running states. Only execute jobs should be
    // skipped once their run has reached a terminal status.
    if (
      job.type === "execute" &&
      ["complete", "failed", "capped", "cancelled"].includes(run.status)
    ) {
      jlog.info("skipping job; run already terminal", { runStatus: run.status });
      await markJobSucceeded(job.id);
      return;
    }
    if (job.type === "resume" && run.status === "complete") {
      jlog.info("skipping resume; run already complete");
      await markJobSucceeded(job.id);
      return;
    }
    const hasSavedSimulationWork =
      run._count.blocks > 0 ||
      run._count.cohorts > 0;
    const hasAnyRunHistory =
      hasSavedSimulationWork ||
      run._count.events > 0;
    if (job.type === "execute" && hasAnyRunHistory) {
      // attempts === 1 → a duplicate execute that never started: safe to skip.
      // attempts > 1 → THIS execute was reclaimed after a worker died mid-run;
      // finish it via resume (re-runs only unfinished cohorts, reuses the desks)
      // instead of skipping, which would strand the run "running" forever.
      if (job.attempts > 1) {
        jlog.warn("reclaimed interrupted execute; resuming");
        await throwIfRunCancelled(job.runId);
        await resumeRun(job.runId);
        await markJobSucceeded(job.id);
        return;
      }
      jlog.info("skipping stale execute; run already has persisted work");
      await markJobSucceeded(job.id);
      return;
    }
    if (job.type === "resume" && !hasSavedSimulationWork) {
      jlog.info("resume has no saved work; starting from the beginning");
      await executeRun(job.runId);
      await markJobSucceeded(job.id);
      return;
    }
    if (job.type !== "resume") {
      await throwIfRunCancelled(job.runId);
    }
    if (job.type === "execute") {
      await executeRun(job.runId);
    } else if (job.type === "resume") {
      await resumeRun(job.runId);
    } else if (job.type === "add_cohort") {
      await addPendingCohorts(job.runId);
    } else {
      throw new Error(`unknown job type: ${job.type}`);
    }
    await markJobSucceeded(job.id);
    outcome = "succeeded";
  } catch (error) {
    if (isRunCancelledError(error)) {
      if (job.runId) await markRunCancelled(job.runId);
      await markJobCancelled(job.id);
      outcome = "cancelled";
      jlog.info("job cancelled");
      return;
    }
    await markJobFailed(job, error);
    outcome = "failed";
    jlog.error("job failed", { error });
  } finally {
    clearInterval(lease);
    const durationMs = Date.now() - startedAt;
    metrics.incr("job.finished", { type: job.type, outcome });
    metrics.observe(`job.duration_ms.${job.type}`, durationMs);
    // Run-terminal accounting: the orchestrator owns status/cost; we read the
    // settled row here so "are runs silently capping?" and the cost-per-run
    // distribution are answerable without touching orchestrator.ts.
    if (job.runId && (job.type === "execute" || job.type === "resume")) {
      try {
        const run = await prisma.run.findUnique({
          where: { id: job.runId },
          select: { status: true, costUsd: true, tokensUsed: true },
        });
        if (run) {
          metrics.incr("run.outcome", { status: run.status });
          metrics.observe("run.cost_usd", run.costUsd);
          metrics.observe("run.tokens", run.tokensUsed);
          if (run.status === "capped") {
            jlog.warn("run capped", { costUsd: run.costUsd, tokensUsed: run.tokensUsed });
          }
          // Free the in-process cost-reservation ledger for terminal runs so a
          // long-lived worker doesn't accumulate them.
          if (["complete", "failed", "capped", "cancelled"].includes(run.status)) {
            clearRunBudget(job.runId);
          }
        }
      } catch {
        // Metrics are best-effort; never let accounting fail a settled job.
      }
    }
    jlog.info("job finished", { outcome, durationMs });
  }
}

async function main(): Promise<void> {
  startMetricsFlush();
  workerLog.info("worker started", {
    pollMs,
    deploy: deployInfoLabel(currentDeployInfo("worker")),
  });
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
      metrics.incr("worker.poll_error");
      workerLog.error("poll error", { error });
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
  metrics.incr("worker.unhandled_rejection");
  workerLog.error("unhandledRejection", { reason: String(reason) });
});

main()
  .catch((error) => {
    workerLog.error("fatal", { error });
    process.exitCode = 1;
  })
  .finally(() => {
    metrics.flush();
    workerLog.info("worker stopped");
  });

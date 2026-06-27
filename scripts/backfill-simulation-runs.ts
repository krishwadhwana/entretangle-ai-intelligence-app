// Backfill stage (prisma/MIGRATIONS_RUNBOOK.md §3): copy every project's
// existing Project.simulation_runs JSONB array into the project_simulation_runs
// child table. Idempotent (upsert by runId) and resumable — safe to re-run.
//
//   npx tsx scripts/backfill-simulation-runs.ts [--dry-run] [projectId ...]
//
// Run AFTER the 20260626120000_simulation_runs_table migration is applied and
// BEFORE cutting the read path over to the table.

import { prisma } from "../lib/db";
import { log } from "../lib/log";
import type { SimulationRunRecord } from "../lib/schema";

const blog = log.child({ component: "backfill-simulation-runs" });

function isRecord(v: unknown): v is SimulationRunRecord {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { runId?: unknown }).runId === "string" &&
    typeof (v as { timestamp?: unknown }).timestamp === "string"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIds = args.filter((a) => !a.startsWith("--"));

  const projects = await prisma.project.findMany({
    where: onlyIds.length ? { id: { in: onlyIds } } : undefined,
    select: { id: true, simulationRuns: true },
  });

  let projectsTouched = 0;
  let runsWritten = 0;
  let skipped = 0;

  for (const p of projects) {
    const arr = Array.isArray(p.simulationRuns)
      ? (p.simulationRuns as unknown[])
      : [];
    const records = arr.filter(isRecord);
    if (records.length !== arr.length) {
      blog.warn("project has malformed snapshot entries", {
        projectId: p.id,
        total: arr.length,
        valid: records.length,
      });
    }
    if (records.length === 0) continue;
    projectsTouched += 1;

    for (const record of records) {
      if (dryRun) {
        runsWritten += 1;
        continue;
      }
      try {
        const timestamp = new Date(record.timestamp);
        await prisma.projectSimulationRun.upsert({
          where: { runId: record.runId },
          create: {
            projectId: p.id,
            runId: record.runId,
            timestamp,
            record: record as never,
          },
          update: { record: record as never, timestamp },
        });
        runsWritten += 1;
      } catch (error) {
        skipped += 1;
        blog.error("upsert failed", { projectId: p.id, runId: record.runId, error });
      }
    }
  }

  blog.info(dryRun ? "dry run complete" : "backfill complete", {
    projects: projects.length,
    projectsTouched,
    runsWritten,
    skipped,
    dryRun,
  });
}

main()
  .catch((error) => {
    blog.error("fatal", { error });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

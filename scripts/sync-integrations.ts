// Enqueue incremental syncs for connected integrations. Intended for cron:
//   npx tsx scripts/sync-integrations.ts            # all connected
//   npx tsx scripts/sync-integrations.ts <projectId> # one project
// The run worker drains the queued integration_sync jobs.
import "./load-env";
import { prisma } from "../lib/db";
import { enqueueProjectJob } from "../lib/jobs";
import { log } from "../lib/log";

async function main() {
  const projectId = process.argv[2];
  const integrations = await prisma.integration.findMany({
    where: {
      status: { in: ["connected", "error"] },
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true, projectId: true, provider: true },
  });
  for (const i of integrations) {
    await enqueueProjectJob(
      i.projectId,
      "integration_sync",
      { integrationId: i.id, type: "incremental" },
      { dedupe: true },
    );
  }
  log.info("enqueued integration syncs", { count: integrations.length });
  console.log(`Enqueued ${integrations.length} incremental sync(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

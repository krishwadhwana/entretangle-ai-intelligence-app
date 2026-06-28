// Shared connect helper: kick off a backfill sync after a real connection is
// established (OAuth callback or apiKey connect).
import { enqueueProjectJob } from "../jobs";

export async function enqueueBackfill(
  projectId: string,
  integrationId: string,
): Promise<void> {
  await enqueueProjectJob(
    projectId,
    "integration_sync",
    { integrationId, type: "backfill" },
    { dedupe: false },
  );
}

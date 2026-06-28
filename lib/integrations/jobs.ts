// ---------------------------------------------------------------------------
// The integration_sync worker job. Runs a connector against its window and
// lands normalized metrics in MetricSnapshot — always live (real provider
// data). A connection without a token, or a connector whose live sync isn't
// implemented yet, fails the job with a clear error rather than fabricating data.
// ---------------------------------------------------------------------------
import { prisma } from "../db";
import { log } from "../log";
import { requireConnector } from "./registry";
import { getFreshAccessToken, writeMetrics, seedFor } from "./service";
import type { SyncContext } from "./types";

export type IntegrationSyncPayload = {
  integrationId: string;
  type?: "backfill" | "incremental";
  /** Lookback window in days (defaults: backfill 90, incremental 7). */
  days?: number;
};

export async function runIntegrationSyncJob(
  payload: unknown,
): Promise<Record<string, unknown>> {
  const p = (payload ?? {}) as IntegrationSyncPayload;
  if (!p.integrationId) throw new Error("integration_sync job missing integrationId");
  const type = p.type ?? "incremental";

  const integration = await prisma.integration.findUnique({
    where: { id: p.integrationId },
  });
  if (!integration) throw new Error(`integration not found: ${p.integrationId}`);

  const connector = requireConnector(integration.provider);
  const until = new Date();
  const days = p.days ?? (type === "backfill" ? 90 : 7);
  const since = new Date(until.getTime() - days * 86_400_000);

  const syncRun = await prisma.integrationSyncRun.create({
    data: { integrationId: integration.id, type, status: "running" },
    select: { id: true },
  });
  await prisma.integration.update({
    where: { id: integration.id },
    data: { status: "syncing" },
  });

  try {
    const tok = await getFreshAccessToken(integration.id);
    if (!tok.accessToken) {
      throw new Error("integration has no access token — reconnect it");
    }

    const ctx: SyncContext = {
      integrationId: integration.id,
      projectId: integration.projectId,
      provider: integration.provider as SyncContext["provider"],
      accessToken: tok.accessToken,
      externalAccountId: integration.externalAccountId,
      metadata: (integration.metadata ?? {}) as Record<string, unknown>,
      since,
      until,
      seed: seedFor(integration.id),
    };

    const metrics = await connector.sync(ctx);
    const written = await writeMetrics(
      integration.projectId,
      integration.id,
      integration.provider,
      metrics,
    );

    await prisma.integrationSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        recordsIngested: written,
      },
    });
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: "connected", lastSyncedAt: new Date(), lastError: null },
    });
    log.info("integration sync complete", {
      integrationId: integration.id,
      provider: integration.provider,
      written,
    });
    return { ok: true, written };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.integrationSyncRun.update({
      where: { id: syncRun.id },
      data: { status: "failed", finishedAt: new Date(), error: msg.slice(0, 500) },
    });
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: "error", lastError: msg.slice(0, 500) },
    });
    throw e;
  }
}

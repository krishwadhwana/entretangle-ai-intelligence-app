// ---------------------------------------------------------------------------
// The integration_sync worker job. Runs a connector against its window and
// lands normalized metrics in MetricSnapshot. Live when the connector is
// configured and a token is present; otherwise (MOCK_MODE, or no creds yet) it
// uses the connector's seeded mockSync so the pipeline is always exercisable.
// ---------------------------------------------------------------------------
import { prisma } from "../db";
import { config } from "../config";
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
    // apiKey connectors are "live" when they hold a token; oauth connectors are
    // live when configured AND holding a token. MOCK_MODE forces mock.
    const live =
      !config.mockMode &&
      connector.isConfigured() &&
      Boolean(tok.accessToken);

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

    const metrics = live ? await connector.sync(ctx) : connector.mockSync(ctx);
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
      mode: live ? "live" : "mock",
      written,
    });
    return { ok: true, written, mode: live ? "live" : "mock" };
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

// Shared connect helpers used by the connect route + OAuth callback: create a
// mock integration (for MOCK_MODE / pre-credentials demos) and kick off a
// backfill sync. Keeping this out of the route files lets both the GET (oauth)
// and POST (apiKey) paths reuse identical logic.
import { config } from "../config";
import { enqueueProjectJob } from "../jobs";
import { requireConnector } from "./registry";
import { upsertIntegration } from "./service";

/** True when this provider should connect in mock mode (no real OAuth/creds). */
export function shouldMock(provider: string): boolean {
  const c = requireConnector(provider);
  // apiKey connectors (Shopify) are configured per-integration, so "configured"
  // is always true; they only mock under global MOCK_MODE.
  return config.mockMode || (c.authType === "oauth2" && !c.isConfigured());
}

/** Create a demo integration with no live token; the sync job will mockSync. */
export async function connectMock(
  projectId: string,
  provider: string,
): Promise<{ id: string }> {
  const c = requireConnector(provider);
  const res = await upsertIntegration({
    projectId,
    provider,
    token: { accessToken: "" },
    externalAccountId: `mock-${provider}`,
    displayName: `${c.label} (demo)`,
    metadata: { mock: true },
  });
  await enqueueBackfill(projectId, res.id);
  return res;
}

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

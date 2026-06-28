// ---------------------------------------------------------------------------
// Integration service layer: signed OAuth state, CRUD, token freshness, and
// the normalized-metric upsert. Routes and the sync job call these; nothing
// here returns a raw token to a caller.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { log } from "../log";
import { encryptSecret, decryptSecret } from "./crypto";
import { requireConnector } from "./registry";
import { hashSeed } from "./mock";
import type { NormalizedMetric, TokenSet } from "./types";

// --- Signed OAuth state (CSRF + carries projectId/provider through the IdP) --
function stateSecret(): string {
  return process.env.NEXTAUTH_SECRET || "dev-insecure-secret";
}

export function signState(payload: {
  projectId: string;
  provider: string;
  nonce: string;
}): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(
  state: string,
): { projectId: string; provider: string; nonce: string } | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function redirectUriFor(provider: string): string {
  return `${config.integrationsRedirectBase.replace(/\/$/, "")}/api/integrations/callback/${provider}`;
}

// --- Sanitized DTO (never leaks tokens) ------------------------------------
export type IntegrationDTO = {
  id: string;
  provider: string;
  category: string;
  status: string;
  displayName: string | null;
  externalAccountId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  metricCount: number;
};

export async function listIntegrations(
  projectId: string,
): Promise<IntegrationDTO[]> {
  const rows = await prisma.integration.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { metrics: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    category: r.category,
    status: r.status,
    displayName: r.displayName,
    externalAccountId: r.externalAccountId,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastError: r.lastError,
    metricCount: r._count.metrics,
  }));
}

// --- Create / update on connect --------------------------------------------
export async function upsertIntegration(args: {
  projectId: string;
  provider: string;
  token: TokenSet;
  externalAccountId: string;
  displayName: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const connector = requireConnector(args.provider);
  const data = {
    projectId: args.projectId,
    provider: args.provider,
    category: connector.category,
    status: "connected",
    displayName: args.displayName,
    externalAccountId: args.externalAccountId,
    scope: args.token.scope ?? null,
    accessToken: encryptSecret(args.token.accessToken),
    refreshToken: encryptSecret(args.token.refreshToken),
    expiresAt: args.token.expiresAt ?? null,
    metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
    lastError: null,
  };
  const row = await prisma.integration.upsert({
    where: {
      projectId_provider_externalAccountId: {
        projectId: args.projectId,
        provider: args.provider,
        externalAccountId: args.externalAccountId,
      },
    },
    create: data,
    update: data,
    select: { id: true },
  });
  return row;
}

export async function disconnectIntegration(
  projectId: string,
  integrationId: string,
): Promise<boolean> {
  const res = await prisma.integration.deleteMany({
    where: { id: integrationId, projectId },
  });
  return res.count > 0;
}

// --- Token freshness --------------------------------------------------------
/** Decrypt the access token, refreshing first if expired and possible. */
export async function getFreshAccessToken(integrationId: string): Promise<{
  accessToken: string | null;
  externalAccountId: string | null;
  provider: string;
  metadata: Record<string, unknown>;
}> {
  const row = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const connector = requireConnector(row.provider);
  let accessToken = decryptSecret(row.accessToken);
  const refreshToken = decryptSecret(row.refreshToken);
  const expired = row.expiresAt ? row.expiresAt.getTime() < Date.now() + 60_000 : false;

  if (expired && refreshToken && connector.refreshToken) {
    try {
      const fresh = await connector.refreshToken(refreshToken);
      accessToken = fresh.accessToken;
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          accessToken: encryptSecret(fresh.accessToken),
          refreshToken: encryptSecret(fresh.refreshToken ?? refreshToken),
          expiresAt: fresh.expiresAt ?? null,
        },
      });
    } catch (e) {
      log.warn("integration token refresh failed", {
        integrationId,
        provider: row.provider,
        error: String(e),
      });
    }
  }
  return {
    accessToken,
    externalAccountId: row.externalAccountId,
    provider: row.provider,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

// --- Normalized-metric upsert ----------------------------------------------
function dimKeyOf(dimensions?: Record<string, string | number>): string {
  if (!dimensions || Object.keys(dimensions).length === 0) return "";
  const sorted = Object.keys(dimensions)
    .sort()
    .map((k) => `${k}=${dimensions[k]}`)
    .join("&");
  return hashSeed(sorted).toString(36);
}

/** Idempotent upsert of normalized metrics into the fact table. Returns the
 *  number of rows written. Chunked so a wide backfill stays within pool limits. */
export async function writeMetrics(
  projectId: string,
  integrationId: string,
  provider: string,
  metrics: NormalizedMetric[],
): Promise<number> {
  let written = 0;
  const CHUNK = 50;
  for (let i = 0; i < metrics.length; i += CHUNK) {
    const slice = metrics.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((m) => {
        const date = new Date(`${m.date}T00:00:00.000Z`);
        const dimKey = dimKeyOf(m.dimensions);
        const base = {
          projectId,
          integrationId,
          provider,
          metric: m.metric,
          date,
          grain: "day",
          value: m.value,
          currency: m.currency ?? null,
          dimensions: (m.dimensions ?? {}) as Prisma.InputJsonValue,
          dimKey,
        };
        return prisma.metricSnapshot.upsert({
          where: {
            integrationId_metric_date_dimKey: {
              integrationId,
              metric: m.metric,
              date,
              dimKey,
            },
          },
          create: base,
          update: { value: m.value, currency: base.currency },
        });
      }),
    );
    written += slice.length;
  }
  return written;
}

/** Stable per-integration seed for deterministic mock generation. */
export function seedFor(integrationId: string): number {
  return hashSeed(integrationId);
}

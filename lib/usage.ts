import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import { UsageLedgerSchema } from "./schema";

// Single place for token AND dollar accounting (SPEC §10, SPEC-V2 §2).
// This will later grow into per-user spend metering — keep every usage
// write going through here.

export type ModelTier = "frontier" | "mini";
export type UsageFeatureKey =
  | "simulation.core"
  | "simulation.web_research"
  | "simulation.audience"
  | "simulation.report"
  | "simulation.chat"
  | "intake"
  | "website.analysis"
  | "market.data"
  | "brand.social"
  | "founder.story"
  | "design.tokens"
  | "design.logo"
  | "design.collateral"
  | "design.site"
  | "inspiration"
  | "financials"
  | "investor"
  | "playbook"
  | "industry.data";

const FEATURE_LABELS: Record<UsageFeatureKey, string> = {
  "simulation.core": "Simulation",
  "simulation.web_research": "Web research",
  "simulation.audience": "Audience simulation",
  "simulation.report": "Reports",
  "simulation.chat": "Chats and Q&A",
  intake: "Intake",
  "website.analysis": "Website analysis",
  "market.data": "Market data",
  "brand.social": "Brand & Social",
  "founder.story": "Founder Story",
  "design.tokens": "Design tokens",
  "design.logo": "Logo generation",
  "design.collateral": "Design collateral",
  "design.site": "Website generation",
  inspiration: "Inspiration",
  financials: "Financials",
  investor: "Investor OS",
  playbook: "Playbook",
  "industry.data": "Industry data",
};

function costOf(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
  webSearchCalls: number
): number {
  const p = config.pricing;
  const inRate = tier === "mini" ? p.miniIn : p.frontierIn;
  const outRate = tier === "mini" ? p.miniOut : p.frontierOut;
  return (
    (inputTokens / 1_000_000) * inRate +
    (outputTokens / 1_000_000) * outRate +
    webSearchCalls * p.webSearchPerCall
  );
}

function rawObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

async function recordProjectUsage(
  projectId: string,
  feature: UsageFeatureKey,
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier,
  webSearchCalls: number
): Promise<void> {
  const tokens = inputTokens + outputTokens;
  const costUsd = costOf(tier, inputTokens, outputTokens, webSearchCalls);
  const now = new Date().toISOString();

  try {
    const row = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerDashboard: true },
    });
    if (!row) return;

    const owner = rawObject(row.ownerDashboard);
    const parsed = UsageLedgerSchema.safeParse(owner.usage);
    const usage = parsed.success
      ? parsed.data
      : UsageLedgerSchema.parse({});
    const prev = usage.features[feature] ?? {
      key: feature,
      label: FEATURE_LABELS[feature],
      tokensUsed: 0,
      costUsd: 0,
      calls: 0,
      lastUsedAt: null,
    };

    usage.tokensUsed += tokens;
    usage.costUsd += costUsd;
    usage.updatedAt = now;
    usage.features[feature] = {
      ...prev,
      label: FEATURE_LABELS[feature],
      tokensUsed: prev.tokensUsed + tokens,
      costUsd: prev.costUsd + costUsd,
      calls: prev.calls + 1,
      lastUsedAt: now,
    };

    await prisma.project.update({
      where: { id: projectId },
      data: {
        ownerDashboard: {
          ...owner,
          usage,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[usage] project ledger update failed:", error);
  }
}

export async function recordUsage(
  runId: string,
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier = "frontier",
  webSearchCalls = 0,
  opts: { feature?: UsageFeatureKey; projectId?: string | null } = {}
): Promise<{ tokensUsed: number; costUsd: number }> {
  const run = await prisma.run.update({
    where: { id: runId },
    data: {
      tokensUsed: { increment: inputTokens + outputTokens },
      costUsd: { increment: costOf(tier, inputTokens, outputTokens, webSearchCalls) },
    },
    select: { tokensUsed: true, costUsd: true, projectId: true },
  });
  const projectId = opts.projectId ?? run.projectId;
  if (projectId) {
    await recordProjectUsage(
      projectId,
      opts.feature ?? "simulation.core",
      inputTokens,
      outputTokens,
      tier,
      webSearchCalls
    );
  }
  return { tokensUsed: run.tokensUsed, costUsd: run.costUsd };
}

export async function recordProjectOnlyUsage(
  projectId: string,
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier = "frontier",
  webSearchCalls = 0,
  feature: UsageFeatureKey = "simulation.core"
): Promise<void> {
  await recordProjectUsage(
    projectId,
    feature,
    inputTokens,
    outputTokens,
    tier,
    webSearchCalls
  );
}

export async function getTokensUsed(runId: string): Promise<number> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    select: { tokensUsed: true },
  });
  return run.tokensUsed;
}

export async function getCostUsd(runId: string): Promise<number> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    select: { costUsd: true },
  });
  return run.costUsd;
}

/** True when EITHER the token cap or the dollar cap is breached. */
export async function isOverTokenCap(runId: string): Promise<boolean> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    select: { tokensUsed: true, costUsd: true },
  });
  return (
    run.tokensUsed >= config.maxTokensPerRun ||
    run.costUsd >= config.maxCostUsd
  );
}

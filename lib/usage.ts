import { prisma } from "./db";
import { config } from "./config";

// Single place for token AND dollar accounting (SPEC §10, SPEC-V2 §2).
// This will later grow into per-user spend metering — keep every usage
// write going through here.

export type ModelTier = "frontier" | "mini";

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

export async function recordUsage(
  runId: string,
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier = "frontier",
  webSearchCalls = 0
): Promise<{ tokensUsed: number; costUsd: number }> {
  const run = await prisma.run.update({
    where: { id: runId },
    data: {
      tokensUsed: { increment: inputTokens + outputTokens },
      costUsd: { increment: costOf(tier, inputTokens, outputTokens, webSearchCalls) },
    },
    select: { tokensUsed: true, costUsd: true },
  });
  return run;
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

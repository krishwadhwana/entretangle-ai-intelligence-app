import { prisma } from "../db";
import { RunEmitter } from "../events";
import { callFinalReport } from "../llm";
import { getFinancialModel } from "../store";
import { getCostUsd, getTokensUsed } from "../usage";
import { blockToWire } from "../wire";
import { setStatus } from "../engine/graph";
import type { AudienceAggregate, ClientProfile } from "../schema";

export async function converge(
  emitter: RunEmitter,
  capped: boolean,
  profile: ClientProfile
): Promise<void> {
  const runId = emitter.runId;
  const [blocks, aggEvent] = await Promise.all([
    prisma.block.findMany({ where: { runId }, include: { conclusions: true } }),
    prisma.runEvent.findFirst({
      where: { runId, type: "audience_aggregated" },
      orderBy: { seq: "desc" },
    }),
  ]);
  const conclusionCount = blocks.reduce(
    (sum, block) => sum + block.conclusions.length,
    0
  );
  const aggregate = aggEvent
    ? (JSON.parse(aggEvent.payload).aggregate as AudienceAggregate)
    : null;

  try {
    const existingReport = await prisma.runEvent.findFirst({
      where: { runId, type: "final_report" },
      select: { id: true },
    });
    if (!existingReport) {
      await setStatus(emitter, "running", "Writing final business report");
      // Make economics quantitative if the founder already built a financial
      // model for this project (else the report stays qualitative).
      const run = await prisma.run.findUnique({
        where: { id: runId },
        select: { projectId: true },
      });
      const financials = run?.projectId
        ? await getFinancialModel(run.projectId, runId)
        : null;
      const report = await callFinalReport(
        runId,
        profile,
        blocks.map((b) => blockToWire(b, b.conclusions)),
        aggregate,
        financials
      );
      await emitter.emit({ type: "final_report", report });
    }
  } catch (e) {
    console.error(`[orchestrator] final report generation failed:`, e);
  }

  const [finalTokensUsed, finalCostUsd] = await Promise.all([
    getTokensUsed(runId),
    getCostUsd(runId),
  ]);
  await emitter.emit({ type: "tokens_used", tokensUsed: finalTokensUsed });
  await emitter.emit({ type: "cost_used", costUsd: finalCostUsd });
  await emitter.emit({
    type: "world_model_ready",
    conclusionCount,
    blockCount: blocks.length,
  });
  // Terminal status last — the SSE route closes streams on terminal status.
  await setStatus(
    emitter,
    capped ? "capped" : "complete",
    capped ? "Converged early — token cap reached" : "World model ready"
  );
}

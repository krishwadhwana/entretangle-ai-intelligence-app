import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { blockToWire, conclusionToWire } from "@/lib/orchestrator";
import { cohortToWire, personaToWire } from "@/lib/wire";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

// Full snapshot { run, blocks, edges } — fallback/refresh path (SPEC §6).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    include: {
      blocks: { include: { conclusions: true } },
      edges: true,
      cohorts: { include: { personas: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const aggregateEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  const finalReportEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "final_report" },
    orderBy: { seq: "desc" },
  });
  const latestStatusEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "run_status" },
    orderBy: { seq: "desc" },
  });
  const latestEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id },
    orderBy: { seq: "desc" },
    select: { seq: true, ts: true },
  });

  return NextResponse.json({
    run: {
      id: run.id,
      brief: run.brief,
      clientProfile: ClientProfileSchema.parse(JSON.parse(run.clientProfile)),
      status: run.status,
      parentRunId: run.parentRunId,
      forkPointBlockId: run.forkPointBlockId,
      tokensUsed: run.tokensUsed,
      costUsd: run.costUsd,
      createdAt: run.createdAt,
    },
    blocks: run.blocks.map((b) => blockToWire(b, b.conclusions)),
    edges: run.edges.map((e) => ({
      id: e.id,
      runId: e.runId,
      fromBlockId: e.fromBlockId,
      toBlockId: e.toBlockId,
      kind: e.kind,
      reason: e.reason,
    })),
    cohorts: run.cohorts.map((c) => ({
      ...cohortToWire(c),
      personas: c.personas.map(personaToWire),
    })),
    aggregate: aggregateEvent
      ? JSON.parse(aggregateEvent.payload).aggregate ?? null
      : null,
    finalReport: finalReportEvent
      ? JSON.parse(finalReportEvent.payload).report ?? null
      : null,
    phaseLabel: latestStatusEvent
      ? JSON.parse(latestStatusEvent.payload).phaseLabel ?? null
      : null,
    latestEvent,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { deleteSimulationRun, renameSimulationRun } from "@/lib/store";
import { blockToWire, conclusionToWire } from "@/lib/orchestrator";
import { cohortToWire, personaToWire } from "@/lib/wire";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

// Full snapshot { run, blocks, edges } — fallback/refresh path (SPEC §6).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
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
      mode: run.mode,
      targetMarket: run.targetMarket,
      focusQuestion: run.focusQuestion,
      additionalContext: run.additionalContext,
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
    latestEvent: latestEvent
      ? { seq: Number(latestEvent.seq), ts: Number(latestEvent.ts) }
      : null,
  });
}

const PatchRunSchema = z.object({
  brief: z.string().trim().min(1).max(500),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const body = PatchRunSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    await renameSimulationRun(params.id, body.data.brief);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, brief: body.data.brief });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  try {
    await deleteSimulationRun(params.id);
  } catch (e) {
    if (e instanceof Error && e.message === "run not found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error(`[runs] failed to delete run ${params.id}`, e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

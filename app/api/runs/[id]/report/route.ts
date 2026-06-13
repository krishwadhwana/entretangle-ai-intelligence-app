import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RunEmitter } from "@/lib/events";
import { callFinalReport } from "@/lib/llm";
import { ClientProfileSchema } from "@/lib/schema";
import { getCostUsd, getTokensUsed } from "@/lib/usage";
import { blockToWire } from "@/lib/wire";

export const dynamic = "force-dynamic";

const READY = new Set(["complete", "capped"]);

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    include: {
      blocks: { include: { conclusions: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!READY.has(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, report is not ready yet` },
      { status: 409 }
    );
  }

  const existing = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "final_report" },
    orderBy: { seq: "desc" },
  });
  if (existing) {
    const [tokensUsed, costUsd] = await Promise.all([
      getTokensUsed(run.id),
      getCostUsd(run.id),
    ]);
    return NextResponse.json({
      report: JSON.parse(existing.payload).report,
      tokensUsed,
      costUsd,
    });
  }

  const aggEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  const aggregate = aggEvent ? JSON.parse(aggEvent.payload).aggregate : null;
  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
  const report = await callFinalReport(
    run.id,
    profile,
    run.blocks.map((b) => blockToWire(b, b.conclusions)),
    aggregate
  );

  const emitter = await RunEmitter.create(run.id);
  await emitter.emit({ type: "final_report", report });
  const [tokensUsed, costUsd] = await Promise.all([
    getTokensUsed(run.id),
    getCostUsd(run.id),
  ]);
  await emitter.emit({ type: "tokens_used", tokensUsed });
  await emitter.emit({ type: "cost_used", costUsd });

  return NextResponse.json({ report, tokensUsed, costUsd });
}

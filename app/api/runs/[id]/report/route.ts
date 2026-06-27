import { NextRequest, NextResponse } from "next/server";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { RunEmitter } from "@/lib/events";
import { callFinalReport } from "@/lib/llm";
import { ClientProfileSchema } from "@/lib/schema";
import { getFinancialModel, getFounderStory } from "@/lib/store";
import { getCostUsd, getTokensUsed } from "@/lib/usage";
import { blockToWire } from "@/lib/wire";
import { toProviderErrorPayload } from "@/lib/providerErrors";

export const dynamic = "force-dynamic";

const READY = new Set(["complete", "capped"]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  // force=true regenerates even if a report exists — used to fold a freshly
  // built/overridden financial model into the report's economics.
  const force = (await req.json().catch(() => ({})))?.force === true;

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
  if (existing && !force) {
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
  const financials = run.projectId
    ? await getFinancialModel(run.projectId, run.id)
    : null;
  const founderStory = run.projectId
    ? await getFounderStory(run.projectId).catch(() => null)
    : null;
  try {
    const report = await callFinalReport(
      run.id,
      profile,
      run.blocks.map((b) => blockToWire(b, b.conclusions)),
      aggregate,
      financials,
      founderStory
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
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(
      e,
      "report generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

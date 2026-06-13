import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { blockToWire, conclusionToWire } from "@/lib/orchestrator";
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
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    run: {
      id: run.id,
      brief: run.brief,
      clientProfile: ClientProfileSchema.parse(JSON.parse(run.clientProfile)),
      status: run.status,
      parentRunId: run.parentRunId,
      forkPointBlockId: run.forkPointBlockId,
      tokensUsed: run.tokensUsed,
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
  });
}

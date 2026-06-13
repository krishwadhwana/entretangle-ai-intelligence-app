import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resumeRun } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";

// Continue a stalled / capped / failed run: re-run only the unfinished
// cohorts (reusing the completed desks + existing personas), then aggregate,
// synthesise and converge. Fire-and-forget — progress streams over SSE.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  resumeRun(params.id).catch((e) =>
    console.error(`[api] resumeRun(${params.id}) crashed:`, e)
  );
  return NextResponse.json({ ok: true }, { status: 202 });
}

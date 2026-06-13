import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forkRun } from "@/lib/fork";
import { executeRun } from "@/lib/orchestrator";
import { BlockParamsSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const ForkRequestSchema = z.object({
  blockId: z.string().min(1),
  params: BlockParamsSchema,
});

// Fork a run from a concluded block with new params (SPEC Shot 6).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = ForkRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    const newRunId = await forkRun(
      params.id,
      body.data.blockId,
      body.data.params
    );
    // Fire-and-forget: re-executes the forked block + downstream.
    executeRun(newRunId).catch((e) =>
      console.error(`[api] executeRun(${newRunId}) crashed:`, e)
    );
    return NextResponse.json({ runId: newRunId }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fork failed" },
      { status: 400 }
    );
  }
}

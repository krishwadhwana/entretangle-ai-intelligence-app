import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRunForApi } from "@/lib/apiAuth";
import { forkRun } from "@/lib/fork";
import { enqueueRunJob } from "@/lib/jobs";
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
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
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
    const job = await enqueueRunJob(newRunId, "execute");
    return NextResponse.json(
      { runId: newRunId, jobId: job.id },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fork failed" },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi } from "@/lib/apiAuth";
import { enqueueProjectJob } from "@/lib/jobs";
import { SOURCE_KEYS } from "@/lib/sourcing/registry";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    phase: z.enum(["discover", "refine"]).optional(),
    sourceKeys: z.array(z.enum(SOURCE_KEYS as [string, ...string[]])).optional(),
  })
  .optional();

// POST → enqueue a sourcing run (durable worker job) that fills the project's
// manufacturer table. Returns the jobId to poll via /api/jobs/:id.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  try {
    const { id, alreadyQueued } = await enqueueProjectJob(
      params.id,
      "sourcing_search",
      { projectId: params.id, ...(parsed.data ?? {}) },
      { dedupe: true },
    );
    return NextResponse.json({ jobId: id, alreadyQueued }, { status: alreadyQueued ? 200 : 202 });
  } catch (e) {
    console.error("[projects/:id/manufacturers/source] enqueue failed", e);
    return NextResponse.json({ error: "failed to start sourcing" }, { status: 500 });
  }
}

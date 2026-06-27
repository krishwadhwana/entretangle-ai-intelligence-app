import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi, requireRunForApi } from "@/lib/apiAuth";
import { getKnowHowProgress, saveKnowHowProgress } from "@/lib/store";
import { FollowUpTurnSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  runId: z.string().min(1),
  selectedModuleKey: z.string().min(1).max(80).optional(),
  completedTaskIds: z.record(z.array(z.string().min(1).max(160))).optional(),
  notesByModule: z.record(z.string().max(8000)).optional(),
  askHistoryByModule: z.record(z.array(FollowUpTurnSchema)).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  const runAuth = await requireRunForApi(runId);
  if (runAuth.response) return runAuth.response;
  try {
    const progress = await getKnowHowProgress(params.id, runId);
    return NextResponse.json({ progress });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = PatchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const { runId, ...patch } = body.data;
  const runAuth = await requireRunForApi(runId);
  if (runAuth.response) return runAuth.response;
  try {
    const progress = await saveKnowHowProgress(params.id, runId, patch);
    return NextResponse.json({ progress });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

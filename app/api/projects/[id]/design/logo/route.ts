import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi } from "@/lib/apiAuth";
import { enqueueProjectJob } from "@/lib/jobs";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  deleteLogoAsset,
  getDesignStudio,
  getProject,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Design Studio › Logo. The LLM authors geometric SVG marks;
// a deterministic wordmark is added server-side. Persisted onto the project's
// designStudio section. Always returns at least the wordmark variant.
const PostSchema = z.object({
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
  brief: z.string().trim().max(2000).default(""),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const studio = await getDesignStudio(params.id);
    return NextResponse.json({ logos: studio?.logos ?? [] });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const project = await getProject(params.id, auth.user.id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!project.ventureProfile) {
    return NextResponse.json(
      { error: "Finish the venture intake first." },
      { status: 409 }
    );
  }
  const tokens = project.ownerDashboard?.designStudio?.tokens ?? null;
  if (!tokens) {
    return NextResponse.json(
      { error: "Generate design tokens before creating a logo." },
      { status: 409 }
    );
  }

  const body = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    const job = await enqueueProjectJob(
      params.id,
      "design_logo",
      {
        sourceRunId: body.data.sourceRunId,
        brief: body.data.brief,
      },
      { dedupe: false, cancelQueued: true }
    );
    return NextResponse.json(
      { jobId: job.id, alreadyQueued: job.alreadyQueued },
      { status: 202 }
    );
  } catch (error) {
    const { payload, status } = toProviderErrorPayload(
      error,
      "logo generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const logoId = new URL(req.url).searchParams.get("logoId");
  if (!logoId) {
    return NextResponse.json({ error: "logoId required" }, { status: 400 });
  }
  try {
    const studio = await deleteLogoAsset(params.id, logoId);
    return NextResponse.json({ logos: studio.logos });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

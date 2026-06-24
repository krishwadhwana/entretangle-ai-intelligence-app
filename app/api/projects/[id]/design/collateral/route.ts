import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueProjectJob } from "@/lib/jobs";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  CollateralContentSchema,
  CollateralTypeSchema,
} from "@/lib/schema";
import {
  deleteDesignAsset,
  getDesignStudio,
  getProject,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Design Studio › Collateral. Generates one branded asset:
// the LLM writes the copy, then lib/design renders a self-contained SVG from the
// project's design tokens. Persisted onto the project's designStudio section.
const PostSchema = z.object({
  type: CollateralTypeSchema,
  brief: z.string().trim().max(2000).default(""),
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
  // Optional: re-render edited copy without another LLM call.
  content: CollateralContentSchema.optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const studio = await getDesignStudio(params.id);
    return NextResponse.json({ assets: studio?.assets ?? [] });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await getProject(params.id);
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
      { error: "Generate design tokens before creating collateral." },
      { status: 409 }
    );
  }

  const body = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    const job = await enqueueProjectJob(params.id, "design_collateral", {
      type: body.data.type,
      brief: body.data.brief,
      sourceRunId: body.data.sourceRunId,
      ...(body.data.content ? { content: body.data.content } : {}),
    });
    return NextResponse.json(
      { jobId: job.id, alreadyQueued: job.alreadyQueued },
      { status: 202 }
    );
  } catch (error) {
    const { payload, status } = toProviderErrorPayload(
      error,
      "collateral generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "assetId required" }, { status: 400 });
  }
  try {
    const studio = await deleteDesignAsset(params.id, assetId);
    return NextResponse.json({ assets: studio.assets });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi } from "@/lib/apiAuth";
import { runDesignStudioJob } from "@/lib/design/jobs";
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
  updateDesignCampaignPack,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Owner Dashboard › Design Studio › Collateral. Generates one branded asset:
// the LLM writes the copy, then lib/design renders a self-contained SVG from the
// project's design tokens. Persisted onto the project's designStudio section.
const PostSchema = z.object({
  type: CollateralTypeSchema,
  brief: z.string().trim().max(2000).default(""),
  useTemplates: z.boolean().default(true),
  useAiVisual: z.boolean().default(false),
  useProductImages: z.boolean().default(false),
  visualBrief: z.string().trim().max(2000).default(""),
  templateBrief: z.string().trim().max(1000).default(""),
  generationRunId: z.string().trim().max(160).default(""),
  generationRunLabel: z.string().trim().max(220).default(""),
  generationRunCreatedAt: z.string().trim().max(80).default(""),
  generationRunStamp: z.string().trim().max(80).default(""),
  socialPrompt: z
    .object({
      brief: z.string().trim().max(2000).default(""),
      visualBrief: z.string().trim().max(2000).default(""),
      templateBrief: z.string().trim().max(1000).default(""),
      useTemplates: z.boolean().default(false),
    })
    .optional(),
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
  sourceWebsiteUrl: z.string().trim().max(400).default(""),
  // Optional: re-render edited copy without another LLM call.
  content: CollateralContentSchema.optional(),
});

const PatchSchema = z.object({
  generationRunId: z.string().trim().min(1).max(160),
  campaignPackName: z.string().trim().max(120).default(""),
  campaignPackLabel: z.string().trim().max(80).default(""),
  campaignPackNote: z.string().trim().max(800).default(""),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
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
      { error: "Generate design tokens before creating collateral." },
      { status: 409 }
    );
  }

  const body = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    const shouldRunInline =
      process.env.NODE_ENV !== "production" ||
      process.env.DESIGN_JOBS_INLINE === "1" ||
      body.data.type === "ad";

    if (shouldRunInline) {
      const result = await runDesignStudioJob({
        type: "design_collateral",
        projectId: params.id,
        payload: {
          type: body.data.type,
          brief: body.data.brief,
          useTemplates: body.data.useTemplates,
          useAiVisual: body.data.useAiVisual,
          useProductImages: body.data.useProductImages,
          visualBrief: body.data.visualBrief,
          templateBrief: body.data.templateBrief,
          generationRunId: body.data.generationRunId,
          generationRunLabel: body.data.generationRunLabel,
          generationRunCreatedAt: body.data.generationRunCreatedAt,
          generationRunStamp: body.data.generationRunStamp,
          socialPrompt: body.data.socialPrompt,
          sourceRunId: body.data.sourceRunId,
          sourceWebsiteUrl: body.data.sourceWebsiteUrl,
          ...(body.data.content ? { content: body.data.content } : {}),
        },
      });
      return NextResponse.json(result);
    }

    const job = await enqueueProjectJob(
      params.id,
      "design_collateral",
      {
        type: body.data.type,
        brief: body.data.brief,
        useTemplates: body.data.useTemplates,
        useAiVisual: body.data.useAiVisual,
        useProductImages: body.data.useProductImages,
        visualBrief: body.data.visualBrief,
        templateBrief: body.data.templateBrief,
        generationRunId: body.data.generationRunId,
        generationRunLabel: body.data.generationRunLabel,
        generationRunCreatedAt: body.data.generationRunCreatedAt,
        generationRunStamp: body.data.generationRunStamp,
        socialPrompt: body.data.socialPrompt,
        sourceRunId: body.data.sourceRunId,
        sourceWebsiteUrl: body.data.sourceWebsiteUrl,
        ...(body.data.content ? { content: body.data.content } : {}),
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
      "collateral generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;

  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    const studio = await updateDesignCampaignPack(params.id, {
      generationRunId: body.data.generationRunId,
      name: body.data.campaignPackName,
      label: body.data.campaignPackLabel,
      note: body.data.campaignPackNote,
    });
    return NextResponse.json({ assets: studio.assets });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "campaign pack update failed";
    const status = message === "campaign pack not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
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

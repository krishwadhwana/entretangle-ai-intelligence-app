import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderCollateral, COLLATERAL_LABELS } from "@/lib/design/collateral";
import { callCollateralCopy } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  CollateralContentSchema,
  CollateralTypeSchema,
  DesignAssetSchema,
} from "@/lib/schema";
import {
  deleteDesignAsset,
  getDesignStudio,
  getProject,
  saveDesignAsset,
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

// Cheap unique id without Date.now()/Math.random churn in a hot path: type +
// a short suffix derived from the brand name + asset count.
function assetId(type: string, seed: string): string {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${type}-${slug || "asset"}-${Date.now().toString(36)}`;
}

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

  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;

  try {
    const content =
      body.data.content ??
      (await callCollateralCopy(
        body.data.sourceRunId,
        body.data.type,
        project.ventureProfile,
        brandKit,
        body.data.brief
      ));

    const { svg, width, height } = await renderCollateral(
      body.data.type,
      tokens,
      content
    );

    const asset = DesignAssetSchema.parse({
      id: assetId(body.data.type, content.brandName),
      type: body.data.type,
      title: `${COLLATERAL_LABELS[body.data.type]} — ${content.brandName}`,
      format: "svg",
      svg,
      width,
      height,
      content,
      createdAt: new Date().toISOString(),
    });

    const studio = await saveDesignAsset(params.id, asset);
    return NextResponse.json({ asset, assets: studio.assets });
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

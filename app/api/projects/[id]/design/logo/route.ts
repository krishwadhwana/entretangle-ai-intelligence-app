import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildLogoVariants } from "@/lib/design/logo";
import { callLogoMarks } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { LogoAssetSchema } from "@/lib/schema";
import {
  deleteLogoAsset,
  getDesignStudio,
  getProject,
  saveLogoAsset,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Design Studio › Logo. The LLM authors geometric SVG marks;
// a deterministic wordmark is added server-side. Persisted onto the project's
// designStudio section. Always returns at least the wordmark variant.
const PostSchema = z.object({
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
      { error: "Generate design tokens before creating a logo." },
      { status: 409 }
    );
  }

  const body = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const brandName = project.ventureProfile.product || project.name;
  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;

  try {
    // Marks are the creative part; if the model fails, still ship the wordmark.
    let concept = "Wordmark logo built from the brand's heading font.";
    let style = tokens.logo.style || "wordmark";
    let marks: { label: string; svg: string }[] = [];
    try {
      const out = await callLogoMarks(
        body.data.sourceRunId,
        project.ventureProfile,
        tokens,
        brandKit
      );
      concept = out.concept;
      style = out.style;
      marks = out.marks;
    } catch (markErr) {
      console.error("[logo] marks generation failed, wordmark only:", markErr);
    }

    const variants = await buildLogoVariants(brandName, tokens, marks);
    const logo = LogoAssetSchema.parse({
      id: `logo-${Date.now().toString(36)}`,
      brandName,
      style,
      concept,
      variants,
      createdAt: new Date().toISOString(),
    });
    const studio = await saveLogoAsset(params.id, logo);
    return NextResponse.json({ logo, logos: studio.logos });
  } catch (error) {
    // Reaching here means even the deterministic wordmark failed (e.g. font
    // fetch) — surface the provider error.
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callDesignTokens } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  getDesignStudio,
  getFounderStory,
  getProject,
  saveDesignTokens,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Design Studio. Distills the venture's CONCRETE design tokens
// (hex palette, Google-Font pairing, logo direction) from the brand kit +
// founder story + venture profile, and persists them at the project level so
// every downstream generator (collateral, logos, website) renders from one
// brand identity. POST (re)generates; GET returns the saved section.
const BodySchema = z.object({
  // Optional provenance: the run whose brand kit seeded these tokens.
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    return NextResponse.json({ designStudio: await getDesignStudio(params.id) });
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
      { error: "Finish the venture intake before generating design tokens." },
      { status: 409 }
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;
  const founderStory = await getFounderStory(params.id).catch(() => null);

  try {
    const tokens = await callDesignTokens(
      body.data.sourceRunId,
      project.ventureProfile,
      brandKit,
      founderStory
    );
    const generatedAt = new Date().toISOString();
    const designStudio = await saveDesignTokens(
      params.id,
      tokens,
      body.data.sourceRunId,
      generatedAt
    );
    return NextResponse.json({ designStudio });
  } catch (error) {
    const { payload, status } = toProviderErrorPayload(
      error,
      "design token generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

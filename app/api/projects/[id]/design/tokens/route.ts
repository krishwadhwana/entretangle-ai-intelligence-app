import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentDeployInfo } from "@/lib/deployInfo";
import { enqueueProjectJob } from "@/lib/jobs";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { DesignTokensSchema } from "@/lib/schema";
import type { WebsiteAnalysis } from "@/lib/schema";
import {
  getDesignStudio,
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
  sourceWebsiteUrl: z.string().trim().max(400).default(""),
  guidance: z.string().trim().max(2000).default(""),
  tokens: DesignTokensSchema.optional(),
});

function websiteImageRefs(analysis: WebsiteAnalysis | null) {
  const info = analysis?.infoCollected;
  if (!info) return [];
  const seen = new Set<string>();
  const refs: {
    url: string;
    name: string;
    kind: string;
    sourceUrl?: string;
    summary?: string;
  }[] = [];
  const add = (entry: {
    url?: string;
    name: string;
    kind: string;
    sourceUrl?: string;
    summary?: string;
  }) => {
    if (!entry.url || !/^https?:\/\//i.test(entry.url) || seen.has(entry.url)) {
      return;
    }
    seen.add(entry.url);
    refs.push({
      url: entry.url,
      name: entry.name,
      kind: entry.kind,
      sourceUrl: entry.sourceUrl,
      summary: entry.summary,
    });
  };
  for (const image of info.productImages) {
    if (image.kind === "logo" || image.kind === "founder") continue;
    add({
      url: image.url,
      name: image.alt || image.caption || "Website image",
      kind: image.kind,
      sourceUrl: image.sourceUrl,
      summary: image.caption,
    });
  }
  for (const product of info.products) {
    add({
      url: product.imageUrl,
      name: product.name,
      kind: "product",
      sourceUrl: product.url,
      summary: product.description || product.priceText,
    });
  }
  for (const listing of info.listingEvidence) {
    add({
      url: listing.imageUrl,
      name: listing.productName,
      kind: "listing",
      sourceUrl: listing.url,
      summary: [listing.source, listing.priceText, listing.availability]
        .filter(Boolean)
        .join(" - "),
    });
  }
  return refs.slice(0, 24);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await getProject(params.id);
    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    return NextResponse.json({
      designStudio: await getDesignStudio(params.id),
      sourceWebsiteUrl: project.websiteAnalysis?.url ?? "",
      websiteImageRefs: websiteImageRefs(project.websiteAnalysis),
    });
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

  try {
    if (!body.data.tokens) {
      const job = await enqueueProjectJob(
        params.id,
        "design_tokens",
        {
          sourceRunId: body.data.sourceRunId,
          sourceWebsiteUrl: body.data.sourceWebsiteUrl,
          guidance: body.data.guidance,
          requestedDeploy: currentDeployInfo("web"),
        },
        { dedupe: false, cancelQueued: true, cancelRunning: true }
      );
      return NextResponse.json({ jobId: job.id, alreadyQueued: job.alreadyQueued }, { status: 202 });
    }
    const generatedAt = new Date().toISOString();
    const designStudio = await saveDesignTokens(
      params.id,
      body.data.tokens,
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

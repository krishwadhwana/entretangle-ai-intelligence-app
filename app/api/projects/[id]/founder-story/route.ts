import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi } from "@/lib/apiAuth";
import { companyIntelEvidence } from "@/lib/companyIntel";
import {
  documentChunkEvidence,
  fetchFounderStoryUrl,
  websiteAnalysisEvidence,
  type FounderStoryPromptEvidence,
  type FounderStorySkippedUrl,
} from "@/lib/founderStory";
import { callFounderStory } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { FounderStorySectionSchema } from "@/lib/schema";
import {
  getFounderStory,
  getProject,
  getProjectChunks,
  saveFounderStory,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  urls: z.array(z.string().trim().min(1).max(600)).max(12).default([]),
  companyIds: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  companyNames: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  notes: z.string().trim().max(20_000).default(""),
  includeWebsiteAnalysis: z.boolean().default(true),
  includeDocuments: z.boolean().default(true),
});

function pushEvidence(
  target: FounderStoryPromptEvidence[],
  item: FounderStoryPromptEvidence | null
) {
  if (!item || item.text.trim().length < 20) return;
  if (target.some((existing) => existing.id === item.id)) return;
  target.push({ ...item, text: item.text.trim() });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      founderStory: await getFounderStory(params.id),
    });
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

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const evidence: FounderStoryPromptEvidence[] = [];
  const skippedUrls: FounderStorySkippedUrl[] = [];

  pushEvidence(
    evidence,
    body.data.notes
      ? {
          id: "manual-notes",
          sourceType: "manual",
          title: "Founder notes",
          url: null,
          text: body.data.notes,
        }
      : null
  );

  if (body.data.includeWebsiteAnalysis) {
    pushEvidence(evidence, websiteAnalysisEvidence(project.websiteAnalysis));
  }

  if (body.data.includeDocuments) {
    const { chunks } = await getProjectChunks(params.id);
    for (const item of documentChunkEvidence(chunks)) pushEvidence(evidence, item);
  }

  for (const item of await companyIntelEvidence({
    companyIds: body.data.companyIds,
    companyNames: body.data.companyNames,
  })) {
    pushEvidence(evidence, item);
  }

  const fetched = await Promise.all(
    body.data.urls.map((url, index) => fetchFounderStoryUrl(url, index))
  );
  for (const result of fetched) {
    pushEvidence(evidence, result.evidence);
    if (result.skipped) skippedUrls.push(result.skipped);
  }

  const limitedEvidence = evidence.slice(0, 16);
  if (!limitedEvidence.length) {
    return NextResponse.json(
      {
        error:
          "No founder-story evidence found. Add notes, upload docs, save a website analysis, or pass story URLs.",
        skippedUrls,
      },
      { status: 400 }
    );
  }

  const inputSources = limitedEvidence
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));

  try {
    const generated = await callFounderStory(
      {
        projectId: params.id,
        venture: project.ventureProfile,
        evidence: limitedEvidence,
      },
      params.id
    );
    const founderStory = FounderStorySectionSchema.parse({
      ...generated,
      sources: Array.from(new Set([...generated.sources, ...inputSources])),
      generatedAt: new Date().toISOString(),
    });
    await saveFounderStory(params.id, founderStory);
    return NextResponse.json({
      founderStory,
      evidenceCount: limitedEvidence.length,
      skippedUrls,
    });
  } catch (error) {
    const { payload, status } = toProviderErrorPayload(
      error,
      "founder story extraction failed"
    );
    return NextResponse.json({ ...payload, skippedUrls }, { status });
  }
}

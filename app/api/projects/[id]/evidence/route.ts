import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectForApi } from "@/lib/apiAuth";
import { buildInvestorSnapshot } from "@/lib/investor";
import { addInvestorEvidence } from "@/lib/store";
import { EvidenceItemSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const ManualEvidenceSchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().max(1200).default(""),
  confidence: z.number().min(0).max(1).default(0.7),
  citation: z.string().max(500).nullable().default(null),
  investorRelevance: z.string().max(500).default("Manual investor evidence."),
  tags: z.array(z.string().min(1).max(40)).default(["manual"]),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({ evidence: snapshot.evidence });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = ManualEvidenceSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const now = new Date().toISOString();
    const evidence = EvidenceItemSchema.parse({
      id: `manual-${Date.now()}`,
      sourceType: "manual",
      title: body.data.title,
      summary: body.data.summary,
      confidence: body.data.confidence,
      citation: body.data.citation,
      investorRelevance: body.data.investorRelevance,
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "manual",
      tags: Array.from(new Set([...body.data.tags, "manual"])),
      createdAt: now,
    });
    await addInvestorEvidence(params.id, evidence);
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({
      evidence,
      readiness: snapshot.readiness,
      allEvidence: snapshot.evidence,
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

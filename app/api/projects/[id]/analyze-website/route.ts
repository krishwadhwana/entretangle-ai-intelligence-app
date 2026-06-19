import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callWebsiteAnalysis } from "@/lib/llm";
import { saveWebsiteAnalysis } from "@/lib/store";
import { WebsiteAnalysisSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  url: z.string().trim().min(3).max(400),
});

// Analyse the founder's website + online consumer opinion (web-grounded), then
// persist it on the project so the intake can ask only the gaps and the run can
// be seeded with real consumer sentiment.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  // Normalise a bare domain into a URL.
  const raw = body.data.url.trim();
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const out = await callWebsiteAnalysis(url);
    const analysis = WebsiteAnalysisSchema.parse({
      ...out,
      url,
      analyzedAt: new Date().toISOString(),
    });
    await saveWebsiteAnalysis(params.id, analysis).catch(() => undefined);
    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "website analysis failed" },
      { status: 502 }
    );
  }
}

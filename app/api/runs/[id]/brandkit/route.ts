import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callBrandKit } from "@/lib/llm";
import { conclusionToWire } from "@/lib/orchestrator";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { getFounderStory, saveBrandKit } from "@/lib/store";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Brand & Social Action Plan. Generates the brand kit from
// the converged world model (social/market-brand/competitor/synthesis findings
// + audience aggregate + venture profile) and persists it onto the project so
// the founder's checkbox progress has a stable home. Mirrors the query route.
const KIT_DOMAINS = ["social", "market", "competitor", "synthesis"];

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for an action plan yet` },
      { status: 409 }
    );
  }

  const conclusions = (
    await prisma.conclusion.findMany({
      where: {
        block: {
          runId: run.id,
          state: "concluded",
          domain: { in: KIT_DOMAINS },
        },
      },
    })
  ).map(conclusionToWire);

  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  const aggEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  const aggregate = aggEvent
    ? (JSON.parse(aggEvent.payload).aggregate ?? null)
    : null;

  try {
    const founderStory = run.projectId
      ? await getFounderStory(run.projectId).catch(() => null)
      : null;
    const kit = await callBrandKit(
      run.id,
      profile,
      conclusions,
      aggregate,
      founderStory
    );
    const generatedAt = new Date().toISOString();

    // Persist onto the project (keeps checkbox progress across regenerates and
    // sibling runs). Runs created without a project still get a usable kit.
    if (run.projectId) {
      const brandSocial = await saveBrandKit(
        run.projectId,
        kit,
        run.id,
        generatedAt
      );
      return NextResponse.json({
        kit: brandSocial.kit,
        checks: brandSocial.checks,
        generatedAt: brandSocial.generatedAt,
      });
    }

    return NextResponse.json({ kit, checks: {}, generatedAt });
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(
      e,
      "brand kit generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

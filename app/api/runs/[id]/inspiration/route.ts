import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callInspiration, verifyInspiration } from "@/lib/llm";
import { conclusionToWire } from "@/lib/orchestrator";
import { saveInspiration } from "@/lib/store";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Inspiration ("swipe file"). Generates real video examples,
// product-placement patterns, and social success stories from the converged
// world model, VERIFIES every link (verified-only), then persists to the
// project. Mirrors the brandkit route.
const INSPO_DOMAINS = ["social", "market", "competitor", "product", "synthesis"];

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for inspiration yet` },
      { status: 409 }
    );
  }

  const conclusions = (
    await prisma.conclusion.findMany({
      where: {
        block: {
          runId: run.id,
          state: "concluded",
          domain: { in: INSPO_DOMAINS },
        },
      },
    })
  ).map(conclusionToWire);

  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  try {
    const raw = await callInspiration(run.id, profile, conclusions);
    const kit = await verifyInspiration(raw); // drop dead/unverifiable links
    const generatedAt = new Date().toISOString();

    if (run.projectId) {
      const inspiration = await saveInspiration(
        run.projectId,
        kit,
        run.id,
        generatedAt
      );
      return NextResponse.json({
        kit: inspiration.kit,
        generatedAt: inspiration.generatedAt,
      });
    }

    return NextResponse.json({ kit, generatedAt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "inspiration generation failed" },
      { status: 502 }
    );
  }
}

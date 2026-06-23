import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callGeneratePlaybook } from "@/lib/llm";
import { savePlaybook, getPlaybook } from "@/lib/store";
import { config } from "@/lib/config";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The Playbook deepener: turn the run's world model into a richer, web-grounded,
// founder-ready playbook (expanded taxes/duties + named competitors). Regenerated
// independently of the simulation engine.
//   GET  → the persisted playbook for this run, or null
//   POST → generate a fresh one (web-grounded), persist it, and return it

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: { projectId: true },
  });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const playbook = run.projectId
    ? await getPlaybook(run.projectId, params.id).catch(() => null)
    : null;
  return NextResponse.json({ playbook });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for a playbook yet` },
      { status: 409 }
    );
  }

  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  // Group the run's concluded findings by business module so the model can build
  // on (and not contradict) what the simulation already established.
  const blocks = await prisma.block.findMany({
    where: { runId: run.id, state: "concluded" },
    include: { conclusions: true },
  });
  const byDomain: Record<string, { claim: string; value: string }[]> = {};
  for (const b of blocks) {
    if (!b.conclusions.length) continue;
    (byDomain[b.domain] ??= []).push(
      ...b.conclusions.map((c) => ({ claim: c.claim, value: c.value }))
    );
  }

  try {
    const generated = await callGeneratePlaybook(run.id, profile, byDomain);
    const playbook = {
      ...generated,
      generatedAt: new Date().toISOString(),
      model: config.model,
    };
    if (run.projectId)
      await savePlaybook(run.projectId, run.id, playbook).catch((e) =>
        console.error(`[playbook] persist failed:`, e)
      );
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "playbook generation failed" },
      { status: 502 }
    );
  }
}

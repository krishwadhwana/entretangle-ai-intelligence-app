import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callAssumptionUpdate } from "@/lib/llm";
import { removeImplicitMonthlyGrowthChanges } from "@/lib/launchGrowth";
import { ClientProfileSchema } from "@/lib/schema";
import { benchmarksForProfile } from "@/lib/datasources/benchmarks";
import { toProviderErrorPayload } from "@/lib/providerErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Knowledge-driven re-run, step 1 of 2: the founder adds a real-world fact and we
// PROPOSE justified assumption deltas (never applied here). The UI shows the
// proposals for approval, then merges the accepted ones into the scenario inputs
// and calls the normal launch-sim POST to re-run deterministically.

const BodySchema = z.object({
  scenarioId: z.string(),
  knowledge: z.string().trim().min(1).max(4000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const scenario = await prisma.launchSimulation.findFirst({
    where: { id: body.data.scenarioId, runId: params.id },
  });
  if (!scenario) {
    return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  }

  const profile = ClientProfileSchema.safeParse(
    JSON.parse(run.clientProfile || "{}")
  );
  const result = scenario.result as Record<string, unknown>;
  // Category benchmark priors give the model the plausible ranges to stay within.
  const benchmarkBlock = profile.success
    ? benchmarksForProfile(profile.data).block
    : "";
  const context = JSON.stringify({
    profile: profile.success
      ? {
          product: profile.data.product,
          category: profile.data.category,
          geography: profile.data.geography,
        }
      : null,
    currentInputs: scenario.inputs,
    benchmarks: benchmarkBlock,
    currentResultSummary: result.summary,
  });

  try {
    const update = await callAssumptionUpdate(
      params.id,
      context,
      body.data.knowledge
    );
    return NextResponse.json({
      update: removeImplicitMonthlyGrowthChanges(update, body.data.knowledge),
    });
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "propose failed");
    return NextResponse.json(payload, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callDataQuestion } from "@/lib/llm";
import {
  ClientProfileSchema,
  FollowUpTurnSchema,
  type FollowUpTurn,
} from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  scenarioId: z.string(),
  question: z.string().trim().min(1).max(2000),
});

function parseFollowUp(raw: unknown): FollowUpTurn[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((t) => FollowUpTurnSchema.safeParse(t))
    .filter((r): r is { success: true; data: FollowUpTurn } => r.success)
    .map((r) => r.data);
}

// "Ask about this launch scenario": answer a founder's question grounded in the
// scenario's summary + diagnostics, and persist the exchange on the scenario.
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
  const inputs = scenario.inputs as Record<string, unknown>;
  const context = JSON.stringify({
    profile: profile.success
      ? {
          product: profile.data.product,
          category: profile.data.category,
          geography: profile.data.geography,
        }
      : null,
    scenario: scenario.name,
    inputs,
    summary: result.summary,
    diagnostics: result.diagnostics,
  });
  const history = parseFollowUp(scenario.followUp);

  let answer: string;
  try {
    answer = await callDataQuestion(
      params.id,
      "a launch-simulation scenario",
      context,
      body.data.question,
      history
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ask failed" },
      { status: 502 }
    );
  }

  const turn: FollowUpTurn = {
    question: body.data.question,
    answer,
    ts: new Date().toISOString(),
  };
  const followUp = [...history, turn];
  await prisma.launchSimulation.update({
    where: { id: scenario.id },
    data: { followUp: followUp as unknown as object },
  });

  return NextResponse.json({ answer, followUp });
}

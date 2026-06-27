import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { ClientProfileSchema } from "@/lib/schema";
import { categoryKeyFromProfile } from "@/lib/datasources/benchmarks";
import { runBacktest, type ActualOutcome, type BacktestOutcome } from "@/lib/backtest";
import type { LaunchPersona } from "@/lib/launchSim";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// First-party launch-outcome capture (the moat).
//   • POST { actual, scenarioId | inputs, ... } → snapshot the run's frozen
//     audience + the inputs used + the ACTUAL observed metrics, save it.
//   • GET → list captured outcomes, each replayed through the backtest harness
//     (predicted-vs-actual error + the benchmark refund-calibration A/B).
// This is what fills the backtest set with real launches instead of fixtures.

const ActualSchema = z
  .object({
    totalOrders: z.number().optional(),
    newOrders: z.number().optional(),
    repeatOrders: z.number().optional(),
    unitsSold: z.number().optional(),
    refundRatePct: z.number().optional(),
    grossRevenue: z.number().optional(),
    netRevenue: z.number().optional(),
    blendedCac: z.number().optional(),
    netProfit: z.number().optional(),
  })
  .strict();

const BodySchema = z.object({
  actual: ActualSchema,
  scenarioId: z.string().optional(), // copy inputs from a saved launch-sim scenario
  inputs: z.record(z.unknown()).optional(), // …or pass them directly
  label: z.string().max(120).default("Outcome"),
  source: z.string().max(60).default("founder-reported"),
  horizonLabel: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
});

// Frozen audience snapshot in the LaunchPersona shape the harness/sim need.
async function snapshotPersonas(runId: string): Promise<LaunchPersona[]> {
  const rows = await prisma.persona.findMany({
    where: { cohort: { runId } },
    select: {
      intent: true,
      wtp: true,
      priceSensitivity: true,
      channelPref: true,
      platforms: true,
      objection: true,
      age: true,
      gender: true,
      cohort: { select: { segment: true, locality: true, country: true } },
    },
  });
  return rows.map((p) => ({
    intent: p.intent,
    wtp: p.wtp,
    priceSensitivity: p.priceSensitivity,
    segment: p.cohort.segment,
    channelPref: p.channelPref,
    platforms: safeJsonArray(p.platforms),
    objection: p.objection,
    age: p.age,
    gender: p.gender,
    locality: p.cohort.locality,
    country: p.cohort.country,
  }));
}

function categoryForRun(clientProfile: string) {
  try {
    const parsed = ClientProfileSchema.safeParse(JSON.parse(clientProfile || "{}"));
    return parsed.success ? categoryKeyFromProfile(parsed.data) : "general";
  } catch {
    return "general";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  // Inputs come from a saved scenario or the request body.
  let inputs = body.data.inputs ?? null;
  if (!inputs && body.data.scenarioId) {
    const scenario = await prisma.launchSimulation.findFirst({
      where: { id: body.data.scenarioId, runId: run.id },
    });
    inputs = (scenario?.inputs as Record<string, unknown>) ?? null;
  }
  if (!inputs) {
    return NextResponse.json(
      { error: "provide inputs or a scenarioId to copy them from" },
      { status: 400 }
    );
  }

  const audience = await snapshotPersonas(run.id);
  if (audience.length === 0) {
    return NextResponse.json(
      { error: "no simulated personas to freeze for this outcome" },
      { status: 409 }
    );
  }

  const row = await prisma.launchOutcome.create({
    data: {
      runId: run.id,
      projectId: run.projectId ?? null,
      label: body.data.label,
      source: body.data.source,
      horizonLabel: body.data.horizonLabel ?? null,
      notes: body.data.notes ?? null,
      inputs: inputs as object,
      audience: audience as unknown as object,
      actual: body.data.actual as object,
    },
  });

  return NextResponse.json(scoreRow(row, categoryForRun(run.clientProfile)));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows = await prisma.launchOutcome.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "desc" },
  });
  const category = categoryForRun(run.clientProfile);
  return NextResponse.json({ outcomes: rows.map((r) => scoreRow(r, category)) });
}

// Replay one stored outcome through the harness and return the record + score.
function scoreRow(
  row: {
    id: string;
    label: string;
    inputs: unknown;
    audience: unknown;
    actual: unknown;
    createdAt: Date;
  },
  category: string
) {
  const outcome: BacktestOutcome = {
    id: row.id,
    label: row.label,
    category: category as BacktestOutcome["category"],
    inputs: row.inputs as BacktestOutcome["inputs"],
    personas: row.audience as LaunchPersona[],
    actual: row.actual as ActualOutcome,
  };
  let score = null;
  let error: string | null = null;
  try {
    score = runBacktest(outcome);
  } catch (e) {
    error = e instanceof Error ? e.message : "backtest failed";
  }
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    actual: row.actual,
    score,
    error,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { RunEmitter } from "@/lib/events";
import { enqueueRunJob } from "@/lib/jobs";
import { getCostUsd, getTokensUsed } from "@/lib/usage";
import { RoleSchema, SegmentSchema, type AudienceAggregate } from "@/lib/schema";
import { cohortToWire, personaToWire } from "@/lib/wire";

export const dynamic = "force-dynamic";

const AddAudienceLocalitySchema = z.object({
  locality: z.string().trim().min(2).max(180),
  country: z.string().trim().min(2).max(80).default("India"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  segment: SegmentSchema.default("middle"),
  role: RoleSchema.default("consumer"),
  size: z.number().int().min(5).max(120).default(30),
  weightPct: z.number().min(0.1).max(20).default(1),
});

const ACTIVE_RUN_STATUSES = new Set([
  "interviewing",
  "planning",
  "running",
  "cancelling",
]);

async function latestAggregate(
  runId: string
): Promise<AudienceAggregate | null> {
  const ev = await prisma.runEvent.findFirst({
    where: { runId, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
    select: { payload: true },
  });
  if (!ev) return null;
  try {
    return (JSON.parse(ev.payload) as { aggregate: AudienceAggregate })
      .aggregate;
  } catch {
    return null;
  }
}

// POST: queue a new cohort to be simulated on the WORKER (not inline — a batch
// of up to 120 personas is multi-call LLM work that times out in a serverless
// function). Returns the pending cohort immediately; the client polls GET below.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = AddAudienceLocalitySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (ACTIVE_RUN_STATUSES.has(run.status)) {
    return NextResponse.json(
      { error: "wait for the current run to finish before adding an audience" },
      { status: 409 }
    );
  }

  const input = body.data;
  const roleLabel = input.role.replace("_", " ");
  const label = `${input.locality} · ${input.segment} · ${roleLabel}`;

  try {
    const cohort = await prisma.cohort.create({
      data: {
        runId: run.id,
        label,
        locality: input.locality,
        country: input.country,
        lat: input.lat,
        lng: input.lng,
        segment: input.segment,
        role: input.role,
        weightPct: input.weightPct,
        size: input.size,
        state: "pending",
      },
    });
    const emitter = await RunEmitter.create(run.id);
    await emitter.emit({ type: "cohort_spawned", cohort: cohortToWire(cohort) });

    // The worker picks this up and simulates every pending cohort
    // (orchestrator.addPendingCohorts) — no serverless timeout.
    const job = await enqueueRunJob(run.id, "add_cohort");

    return NextResponse.json(
      { cohort: cohortToWire(cohort), jobId: job.id, pending: true },
      { status: 202 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "audience batch failed" },
      { status: 500 }
    );
  }
}

// GET ?cohortId=… : poll a queued cohort until it finishes. Returns the cohort
// (with personas once done), the refreshed audience aggregate, and live spend.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cohortId = req.nextUrl.searchParams.get("cohortId");
  if (!cohortId) {
    return NextResponse.json({ error: "cohortId required" }, { status: 400 });
  }
  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, runId: params.id },
    include: { personas: true },
  });
  if (!cohort) {
    return NextResponse.json({ error: "cohort not found" }, { status: 404 });
  }
  const [aggregate, tokensUsed, costUsd] = await Promise.all([
    latestAggregate(params.id),
    getTokensUsed(params.id),
    getCostUsd(params.id),
  ]);
  return NextResponse.json({
    state: cohort.state, // "pending" | "simulating" | "done" | "failed"
    cohort: cohortToWire(cohort),
    personas: cohort.personas.map(personaToWire),
    aggregate,
    tokensUsed,
    costUsd,
  });
}

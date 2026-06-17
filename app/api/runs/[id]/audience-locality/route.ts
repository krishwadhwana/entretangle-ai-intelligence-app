import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { RunEmitter } from "@/lib/events";
import { aggregateAudience, simulateCohort } from "@/lib/audience";
import { getCostUsd, getTokensUsed } from "@/lib/usage";
import {
  ClientProfileSchema,
  RoleSchema,
  SegmentSchema,
  type RunStatus,
} from "@/lib/schema";
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

const ACTIVE_RUN_STATUSES = new Set(["interviewing", "planning", "running", "cancelling"]);

async function setRunStatus(
  emitter: RunEmitter,
  status: RunStatus,
  phaseLabel: string
) {
  await prisma.run.update({ where: { id: emitter.runId }, data: { status } });
  await emitter.emit({ type: "run_status", status, phaseLabel });
}

async function inferCurrency(runId: string): Promise<string> {
  const persona = await prisma.persona.findFirst({
    where: { cohort: { runId } },
    select: { wtpCurrency: true },
    orderBy: { id: "desc" },
  });
  if (persona?.wtpCurrency) return persona.wtpCurrency;

  const cohort = await prisma.cohort.findFirst({
    where: { runId, stats: { not: null } },
    select: { stats: true },
  });
  if (cohort?.stats) {
    try {
      const parsed = JSON.parse(cohort.stats) as { wtpCurrency?: string };
      if (parsed.wtpCurrency) return parsed.wtpCurrency;
    } catch {
      // fall through
    }
  }
  return "INR";
}

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

  const emitter = await RunEmitter.create(run.id);
  const previousStatus = run.status as RunStatus;
  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
  const input = body.data;
  const roleLabel = input.role.replace("_", " ");
  const label = `${input.locality} · ${input.segment} · ${roleLabel}`;

  try {
    await setRunStatus(emitter, "running", `Adding audience: ${input.locality}`);
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
    await emitter.emit({ type: "cohort_spawned", cohort: cohortToWire(cohort) });

    const currency = await inferCurrency(run.id);
    const focus = {
      focusQuestion: run.focusQuestion,
      additionalContext: [
        run.additionalContext,
        `Manual audience batch pinned to ${input.locality}, ${input.country} (${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}). Segment: ${input.segment}. Role: ${roleLabel}. Treat this as a precise local neighborhood audience, not a broad city average.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };

    const ok = await simulateCohort(emitter, cohort.id, profile, currency, focus);
    const aggregate = await aggregateAudience(emitter);
    const [tokensUsed, costUsd] = await Promise.all([
      getTokensUsed(run.id),
      getCostUsd(run.id),
    ]);
    await emitter.emit({ type: "tokens_used", tokensUsed });
    await emitter.emit({ type: "cost_used", costUsd });

    const full = await prisma.cohort.findUniqueOrThrow({
      where: { id: cohort.id },
      include: { personas: true },
    });
    await setRunStatus(
      emitter,
      previousStatus === "capped" ? "capped" : "complete",
      previousStatus === "capped" ? "Audience batch added; run remains capped" : "World model ready"
    );

    if (!ok) {
      return NextResponse.json(
        { error: "audience batch failed", cohortId: cohort.id },
        { status: 502 }
      );
    }

    return NextResponse.json({
      cohort: cohortToWire(full),
      personas: full.personas.map(personaToWire),
      aggregate,
      tokensUsed,
      costUsd,
    });
  } catch (e) {
    await setRunStatus(
      emitter,
      previousStatus === "capped" ? "capped" : "complete",
      previousStatus === "capped" ? "Audience batch failed; run remains capped" : "World model ready"
    ).catch(() => undefined);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "audience batch failed" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueRunJob } from "@/lib/jobs";
import { ClientProfileSchema, RunModeSchema } from "@/lib/schema";
import {
  isPanIndiaProfile,
  PAN_INDIA_MIN_RELEVANT_SPOTS,
} from "@/lib/audienceCoverage";

export const dynamic = "force-dynamic";

const CreateRunSchema = z.object({
  brief: z.string().min(1),
  clientProfile: ClientProfileSchema,
  projectId: z.string().optional(),
  // Follow-up simulation inputs (all optional; first run omits them).
  focusQuestion: z.string().max(2000).optional(),
  additionalContext: z.string().max(8000).optional(),
  mode: RunModeSchema.default("full"),
  sourceRunId: z.string().optional(),
  // Audience size chosen in the UI (0–10,000). Omit to use the env default.
  targetAudienceSize: z.number().int().min(0).max(10000).optional(),
});

export async function POST(req: NextRequest) {
  const body = CreateRunSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  // A scoped run reuses a prior run's audience — it needs a source that
  // actually has a SIMULATED audience (a `done` cohort with personas). A
  // capped/failed run with no finished cohorts can't be reused, so fall back
  // to a full run rather than silently produce an empty audience.
  let mode = body.data.mode;
  let sourceRunId = body.data.sourceRunId ?? null;
  if (mode === "scoped") {
    const reusable = sourceRunId
      ? await prisma.cohort.findMany({
          where: { runId: sourceRunId, state: "done" },
          select: { locality: true },
          distinct: ["locality"],
        })
      : [];
    const hasAudience = reusable.length > 0;
    const panIndiaSourceTooNarrow =
      isPanIndiaProfile(body.data.clientProfile) &&
      reusable.length < PAN_INDIA_MIN_RELEVANT_SPOTS;
    if (!hasAudience || panIndiaSourceTooNarrow) {
      mode = "full";
      sourceRunId = null;
    }
  }

  const run = await prisma.run.create({
    data: {
      brief: body.data.brief,
      clientProfile: JSON.stringify(body.data.clientProfile),
      status: "planning",
      projectId: body.data.projectId ?? null,
      focusQuestion: body.data.focusQuestion ?? null,
      additionalContext: body.data.additionalContext ?? null,
      mode,
      sourceRunId,
      targetAudienceSize: body.data.targetAudienceSize ?? null,
    },
  });
  if (body.data.projectId) {
    await prisma.project.update({
      where: { id: body.data.projectId },
      data: { updatedAt: new Date() },
    });
  }

  const job = await enqueueRunJob(run.id, "execute");

  return NextResponse.json({ runId: run.id, jobId: job.id }, { status: 201 });
}

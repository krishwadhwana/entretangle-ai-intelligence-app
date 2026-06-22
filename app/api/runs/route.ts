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
  // brief + clientProfile are required for full/scoped runs, but an export run
  // derives both from its parent server-side, so they're optional here and
  // validated per-mode below.
  brief: z.string().min(1).optional(),
  clientProfile: ClientProfileSchema.optional(),
  projectId: z.string().optional(),
  // Follow-up simulation inputs (all optional; first run omits them).
  focusQuestion: z.string().max(2000).optional(),
  additionalContext: z.string().max(8000).optional(),
  mode: RunModeSchema.default("full"),
  sourceRunId: z.string().optional(),
  // Cross-border export run (mode "export"): parentRunId is the completed
  // home-market run carried forward as priors; targetMarket is the destination
  // country (e.g. "United States") whose audience/economics we re-simulate.
  parentRunId: z.string().optional(),
  targetMarket: z.string().min(1).max(120).optional(),
  // Export-only: tweak the inherited parent profile for the destination market
  // (e.g. a different US target audience / price band) before the branch runs.
  // Only these fields are overridable; everything else is inherited verbatim.
  profileOverrides: z
    .object({
      targetAudience: z.string().max(2000),
      priceBand: z.string().max(200),
      priceMin: z.number().min(0),
      priceMax: z.number().min(0),
      targetMarginPct: z.number().min(0).max(100),
    })
    .partial()
    .optional(),
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

  // Export run: a dependent run rooted at a completed home-market parent. We
  // base the child profile on the PARENT's venture (same product) and just point
  // its geography at the destination market — that flips currency + benchmarks
  // to the destination automatically (marketFromGeography / resolveBenchmarks).
  let clientProfile = body.data.clientProfile;
  let parentRunId: string | null = null;
  let targetMarket: string | null = null;
  let brief = body.data.brief;
  if (mode === "export") {
    if (!body.data.parentRunId || !body.data.targetMarket) {
      return NextResponse.json(
        { error: "export run requires parentRunId and targetMarket" },
        { status: 400 }
      );
    }
    const parent = await prisma.run.findUnique({
      where: { id: body.data.parentRunId },
    });
    const parentProfile = (() => {
      try {
        return parent ? ClientProfileSchema.parse(JSON.parse(parent.clientProfile)) : null;
      } catch {
        return null;
      }
    })();
    // The parent's profile (or, as a fallback, one supplied in the body) is what
    // we re-point at the destination. Without either, there's nothing to export.
    const base = parentProfile ?? body.data.clientProfile;
    if (!parent || !base) {
      return NextResponse.json(
        { error: "export parent run not found or has no usable profile" },
        { status: 400 }
      );
    }
    parentRunId = parent.id;
    targetMarket = body.data.targetMarket;
    clientProfile = { ...base, geography: [targetMarket] };
    // Apply the founder's destination-market tweaks on top of the inherited profile.
    const ov = body.data.profileOverrides;
    if (ov) {
      clientProfile = {
        ...clientProfile,
        ...(ov.targetAudience ? { targetAudience: ov.targetAudience } : {}),
        ...(ov.priceBand ? { priceBand: ov.priceBand } : {}),
        ...(ov.priceMin != null ? { priceMin: ov.priceMin } : {}),
        ...(ov.priceMax != null ? { priceMax: ov.priceMax } : {}),
        ...(ov.targetMarginPct != null ? { targetMarginPct: ov.targetMarginPct } : {}),
      };
    }
    brief = `Export viability: ${base.product} into ${targetMarket}`;
  }

  // Full/scoped runs need an explicit profile + brief (export derived its own above).
  if (!clientProfile || !brief) {
    return NextResponse.json(
      { error: "brief and clientProfile are required" },
      { status: 400 }
    );
  }

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
      isPanIndiaProfile(clientProfile) &&
      reusable.length < PAN_INDIA_MIN_RELEVANT_SPOTS;
    if (!hasAudience || panIndiaSourceTooNarrow) {
      mode = "full";
      sourceRunId = null;
    }
  }

  const run = await prisma.run.create({
    data: {
      brief,
      clientProfile: JSON.stringify(clientProfile),
      status: "planning",
      projectId: body.data.projectId ?? null,
      focusQuestion: body.data.focusQuestion ?? null,
      additionalContext: body.data.additionalContext ?? null,
      mode,
      sourceRunId,
      parentRunId,
      targetMarket,
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

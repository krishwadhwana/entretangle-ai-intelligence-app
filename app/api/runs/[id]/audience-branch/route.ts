import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueRunJob } from "@/lib/jobs";
import { toProviderErrorPayload } from "@/lib/providerErrors";

export const dynamic = "force-dynamic";

const MAX_CONTEXT_CHARS = 8000;

const AudienceBranchRequestSchema = z.object({
  information: z.string().trim().min(1).max(4000),
});

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`;
}

// Create a child run that re-simulates the audience with one added fact.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = AudienceBranchRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const parent = await prisma.run.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      brief: true,
      clientProfile: true,
      projectId: true,
      focusQuestion: true,
      additionalContext: true,
      targetAudienceSize: true,
    },
  });
  if (!parent) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const info = body.data.information;
  const branchContext = [
    "Audience variant added for this branch:",
    info,
    "",
    `Parent run: ${parent.id}`,
    "Treat the added information as true for this branch only and compare the response quality against the base audience.",
  ].join("\n");
  const parentBudget = Math.max(0, MAX_CONTEXT_CHARS - branchContext.length - 2);
  const inheritedContext = parent.additionalContext
    ? parent.additionalContext.slice(0, parentBudget)
    : "";
  const additionalContext = [inheritedContext, branchContext]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
  const focusQuestion = truncate(`Audience variant: ${oneLine(info)}`, 2000);

  try {
    const run = await prisma.run.create({
      data: {
        brief: parent.brief,
        clientProfile: parent.clientProfile,
        status: "planning",
        parentRunId: parent.id,
        projectId: parent.projectId,
        focusQuestion,
        additionalContext,
        mode: "full",
        targetAudienceSize: parent.targetAudienceSize,
      },
    });

    if (parent.projectId) {
      await prisma.project.update({
        where: { id: parent.projectId },
        data: { updatedAt: new Date() },
      });
    }

    const job = await enqueueRunJob(run.id, "execute");
    return NextResponse.json(
      { runId: run.id, jobId: job.id },
      { status: 201 }
    );
  } catch (e) {
    const { payload } = toProviderErrorPayload(
      e,
      "audience branch creation failed"
    );
    return NextResponse.json(payload, { status: 400 });
  }
}

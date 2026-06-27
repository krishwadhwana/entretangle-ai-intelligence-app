import { NextRequest, NextResponse } from "next/server";
import {
  requireApiUser,
  requireProjectForApi,
  requireRunForApi,
} from "@/lib/apiAuth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const job = await prisma.runJob.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      runId: true,
      projectId: true,
      type: true,
      status: true,
      attempts: true,
      error: true,
      result: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  if (job.runId) {
    const runAuth = await requireRunForApi(job.runId);
    if (runAuth.response) return runAuth.response;
  } else if (job.projectId) {
    const projectAuth = await requireProjectForApi(job.projectId);
    if (projectAuth.response) return projectAuth.response;
  } else {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

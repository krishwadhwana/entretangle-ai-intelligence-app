import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
  return NextResponse.json({ job });
}

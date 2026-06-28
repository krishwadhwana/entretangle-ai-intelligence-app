import { NextResponse, type NextRequest } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { enqueueProjectJob } from "@/lib/jobs";

// POST — enqueue an incremental sync for one integration. The worker drains it.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; integrationId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;

  const integration = await prisma.integration.findFirst({
    where: { id: params.integrationId, projectId: params.id },
    select: { id: true },
  });
  if (!integration) {
    return NextResponse.json({ error: "integration not found" }, { status: 404 });
  }

  const job = await enqueueProjectJob(
    params.id,
    "integration_sync",
    { integrationId: integration.id, type: "incremental" },
    { dedupe: false },
  );
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

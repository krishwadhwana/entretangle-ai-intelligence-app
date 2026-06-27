import { NextRequest, NextResponse } from "next/server";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { RunEmitter } from "@/lib/events";
import { enqueueRunJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const RESUMABLE_STATUSES = new Set(["running", "failed", "capped", "cancelled"]);

// Continue a stalled / capped / failed / cancelled run by enqueueing durable
// worker work. The route immediately reactivates the run so the UI does not
// sit on "cancelled" while the worker waits for its next poll.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run.status === "complete") {
    return NextResponse.json(
      { error: "run is already complete" },
      { status: 409 }
    );
  }
  if (run.status === "cancelling") {
    return NextResponse.json(
      { error: "run is still cancelling; wait until it is cancelled, then resume" },
      { status: 409 }
    );
  }
  if (!RESUMABLE_STATUSES.has(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not resumable yet` },
      { status: 409 }
    );
  }

  const job = await enqueueRunJob(params.id, "resume");
  const emitter = await RunEmitter.create(params.id);
  await prisma.run.update({
    where: { id: params.id },
    data: { status: "running" },
  });
  await emitter.emit({
    type: "run_status",
    status: "running",
    phaseLabel:
      run.status === "cancelled"
        ? "Resuming cancelled run"
        : "Resume queued",
  });
  return NextResponse.json(
    {
      ok: true,
      jobId: job.id,
      alreadyQueued: job.alreadyQueued,
      previousStatus: run.status,
      status: "running",
    },
    { status: 202 }
  );
}

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { subscribeRunEvents } from "@/lib/bus";
import { loadPersistedEvents } from "@/lib/events";
import type { RunEvent } from "@/lib/schema";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["complete", "failed", "capped"]);

// SSE: replay all persisted RunEvents in seq order, then live-subscribe.
// Heartbeat comment every 15s. Reconnect with Last-Event-ID resumes from seq.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const runId = params.id;
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) return new Response("not found", { status: 404 });

  const lastEventId = req.headers.get("last-event-id");
  const resumeAfterSeq = lastEventId ? parseInt(lastEventId, 10) || 0 : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let maxSeq = resumeAfterSeq;

      const send = (event: RunEvent) => {
        if (closed) return;
        if (event.seq <= maxSeq) return; // replay/live overlap dedupe
        maxSeq = event.seq;
        controller.enqueue(
          encoder.encode(
            `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(
              event
            )}\n\n`
          )
        );
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          close();
        }
      }, 15000);

      // Subscribe BEFORE replaying so no live event falls in the gap;
      // `send` dedupes any overlap by seq.
      const buffered: RunEvent[] = [];
      let replaying = true;
      const unsubscribe = subscribeRunEvents(runId, (event) => {
        if (replaying) buffered.push(event);
        else {
          send(event);
          if (event.type === "run_status" && TERMINAL.has(event.status)) {
            close();
          }
        }
      });

      const persisted = await loadPersistedEvents(runId);
      for (const event of persisted) send(event);
      for (const event of buffered) send(event);
      replaying = false;

      // If the run already terminated, replay is complete — close.
      const current = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (current && TERMINAL.has(current.status)) close();

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

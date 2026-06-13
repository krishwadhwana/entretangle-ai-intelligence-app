import { prisma } from "./db";
import { publishRunEvent } from "./bus";
import type { RunEvent } from "./schema";

// Payload = event minus the envelope fields the emitter fills in.
type EventPayload = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "runId" | "seq" | "ts">
    : never
  : never;

/**
 * Per-run event emitter. Every event is persisted BEFORE being published so
 * the canvas state is always reconstructable from the RunEvent table
 * (invariant §0.4: canvas state is a pure function of the event log).
 */
export class RunEmitter {
  private seq: number;

  private constructor(public readonly runId: string, lastSeq: number) {
    this.seq = lastSeq;
  }

  static async create(runId: string): Promise<RunEmitter> {
    const last = await prisma.runEvent.findFirst({
      where: { runId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    return new RunEmitter(runId, last?.seq ?? 0);
  }

  async emit(payload: EventPayload): Promise<RunEvent> {
    this.seq += 1;
    const event = {
      ...payload,
      runId: this.runId,
      seq: this.seq,
      ts: Date.now(),
    } as RunEvent;

    await prisma.runEvent.create({
      data: {
        runId: this.runId,
        seq: event.seq,
        type: event.type,
        payload: JSON.stringify(event),
        ts: BigInt(event.ts),
      },
    });
    publishRunEvent(event);
    return event;
  }
}

export async function loadPersistedEvents(runId: string): Promise<RunEvent[]> {
  const rows = await prisma.runEvent.findMany({
    where: { runId },
    orderBy: { seq: "asc" },
  });
  return rows.map((r) => JSON.parse(r.payload) as RunEvent);
}

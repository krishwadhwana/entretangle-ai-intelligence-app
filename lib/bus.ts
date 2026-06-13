import { EventEmitter } from "events";
import type { RunEvent } from "./schema";

// In-process pub/sub keyed by runId. Acceptable for v0 single-instance;
// NOTE: multi-instance deployment needs Redis pub/sub here instead.
const globalForBus = globalThis as unknown as { runBus?: EventEmitter };

export const runBus = globalForBus.runBus ?? new EventEmitter();
runBus.setMaxListeners(100);

if (process.env.NODE_ENV !== "production") globalForBus.runBus = runBus;

export function publishRunEvent(event: RunEvent) {
  runBus.emit(`run:${event.runId}`, event);
}

export function subscribeRunEvents(
  runId: string,
  listener: (event: RunEvent) => void
): () => void {
  const channel = `run:${runId}`;
  runBus.on(channel, listener);
  return () => runBus.off(channel, listener);
}

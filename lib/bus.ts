import { EventEmitter } from "events";
import type { RunEvent } from "./schema";
import { log } from "./log";

// Pub/sub for live run events. Two transports:
//
//  - "memory" (default): an in-process EventEmitter. Correct and fast for a
//    single instance, but a client connected to instance A never sees events a
//    worker publishes on instance B.
//
//  - "postgres" (EVENT_BUS=postgres): adds CROSS-INSTANCE wakeups on top of the
//    in-process path. The publisher sends `pg_notify('run_events', {runId,seq})`
//    over the normal pooled Prisma connection; every instance LISTENs on a
//    dedicated session connection and, on a wakeup, the SSE route fetches the
//    new rows from the durable event log (events are persisted before publish).
//
// Why a wakeup carrying only {runId, seq} rather than the whole event:
//   1. Postgres NOTIFY payloads are capped at ~8000 bytes; a `cohort_simulated`
//      event (up to 50 personas) blows past that.
//   2. The event log is already the source of truth — re-reading by seq is
//      cheap and keeps "persist-before-publish" the single ordering guarantee.
//
// PgBouncer caveat (Neon/Railway): LISTEN does NOT work through a transaction
// -mode pooler, so the listener connects via DIRECT_URL (a real session). NOTIFY
// is just a statement and works fine over the pooled DATABASE_URL.

const globalForBus = globalThis as unknown as {
  runBus?: EventEmitter;
  pgWakeup?: PgWakeupHub;
};

export const runBus = globalForBus.runBus ?? new EventEmitter();
runBus.setMaxListeners(0); // unbounded: one listener per open SSE connection
if (process.env.NODE_ENV !== "production") globalForBus.runBus = runBus;

const NOTIFY_CHANNEL = "run_events";
const busLog = log.child({ component: "bus" });

function postgresTransportEnabled(): boolean {
  return (process.env.EVENT_BUS ?? "memory").toLowerCase() === "postgres";
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/** Deliver an event to same-instance subscribers and, when the postgres
 *  transport is on, wake subscribers on other instances. */
export function publishRunEvent(event: RunEvent): void {
  runBus.emit(`run:${event.runId}`, event);
  if (postgresTransportEnabled()) {
    void notifyCrossInstance(event.runId, event.seq);
  }
}

async function notifyCrossInstance(runId: string, seq: number): Promise<void> {
  try {
    // Imported lazily to avoid a cycle (db -> nothing, but keep bus importable
    // from low-level modules without pulling Prisma when memory transport).
    const { prisma } = await import("./db");
    await prisma.$executeRawUnsafe(
      "SELECT pg_notify($1, $2)",
      NOTIFY_CHANNEL,
      JSON.stringify({ runId, seq })
    );
  } catch (err) {
    // A missed wakeup is non-fatal: the SSE route's periodic poll still
    // delivers the persisted event. Log so a misconfigured transport is visible.
    busLog.warn("pg_notify failed", { runId, seq, err });
  }
}

// ---------------------------------------------------------------------------
// Same-instance subscription (full event, fast path) — unchanged contract
// ---------------------------------------------------------------------------

export function subscribeRunEvents(
  runId: string,
  listener: (event: RunEvent) => void
): () => void {
  const channel = `run:${runId}`;
  runBus.on(channel, listener);
  return () => runBus.off(channel, listener);
}

// ---------------------------------------------------------------------------
// Cross-instance wakeups (postgres transport only)
// ---------------------------------------------------------------------------

/**
 * Subscribe to cross-instance "there are new events for this run up to `seq`"
 * signals. The callback should fetch from the event log by seq. No-op (returns
 * an empty unsubscribe) when the postgres transport is disabled — same-instance
 * delivery via {@link subscribeRunEvents} already covers that case.
 */
export function subscribeRunWakeups(
  runId: string,
  onWakeup: (seq: number) => void
): () => void {
  if (!postgresTransportEnabled()) return () => {};
  const hub = ensureWakeupHub();
  return hub.subscribe(runId, onWakeup);
}

type WakeupListener = (seq: number) => void;

/** Single shared LISTEN connection that fans `run_events` notifications out to
 *  per-run in-process listeners, with auto-reconnect. */
class PgWakeupHub {
  private listeners = new Map<string, Set<WakeupListener>>();
  private client: { query: (sql: string) => Promise<unknown>; end: () => Promise<void>; on: (ev: string, cb: (...a: unknown[]) => void) => void } | null = null;
  private connecting: Promise<void> | null = null;

  subscribe(runId: string, cb: WakeupListener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(cb);
    void this.ensureConnected();
    return () => {
      const s = this.listeners.get(runId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.listeners.delete(runId);
    };
  }

  private dispatch(runId: string, seq: number): void {
    const set = this.listeners.get(runId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(seq);
      } catch {
        // a faulty listener must not break fan-out to the others
      }
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    // LISTEN needs a real session — use DIRECT_URL (PgBouncer transaction mode
    // can't hold a LISTEN). Falls back to DATABASE_URL only if no direct URL.
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      busLog.warn("postgres transport enabled but no DIRECT_URL/DATABASE_URL set");
      return;
    }
    try {
      // Lazy require so `pg` is only needed when the postgres transport is on,
      // and so typecheck/build don't require the dependency to be installed.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pg = require("pg");
      const client = new pg.Client({ connectionString });
      client.on("notification", (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
        try {
          const { runId, seq } = JSON.parse(msg.payload) as {
            runId: string;
            seq: number;
          };
          this.dispatch(runId, seq);
        } catch {
          // ignore malformed payloads
        }
      });
      client.on("error", (err: unknown) => {
        busLog.warn("listen connection error; will reconnect", { err });
        this.client = null;
        // Reconnect if anyone is still listening.
        if (this.listeners.size > 0) {
          setTimeout(() => void this.ensureConnected(), 1000);
        }
      });
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      this.client = client;
      busLog.info("listening for cross-instance run events", {
        channel: NOTIFY_CHANNEL,
      });
    } catch (err) {
      busLog.error("failed to start LISTEN connection", { err });
      this.client = null;
    }
  }
}

function ensureWakeupHub(): PgWakeupHub {
  if (!globalForBus.pgWakeup) globalForBus.pgWakeup = new PgWakeupHub();
  return globalForBus.pgWakeup;
}

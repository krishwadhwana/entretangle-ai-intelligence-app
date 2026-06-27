// Structured, correlation-friendly logging. Replaces bare console.* so a
// queued, multi-agent, billable pipeline emits machine-parseable lines you can
// filter by runId / jobId / component and ship to any log aggregator.
//
// Design goals:
// - Zero dependencies, zero config — works the same in the worker and in
//   Next.js route handlers.
// - One line per event. In production: JSON (greppable, ingestible). In dev:
//   a compact human-readable line so local logs stay readable.
// - A child logger binds context (runId, jobId, component) once so call sites
//   stay terse: `log.info("cohort simulated", { cohortId })`.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in LEVEL_RANK) return raw as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const PRETTY = process.env.LOG_FORMAT
  ? process.env.LOG_FORMAT === "pretty"
  : process.env.NODE_ENV !== "production";

export type LogFields = Record<string, unknown>;

function emit(level: LogLevel, ctx: LogFields, msg: string, fields?: LogFields) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel()]) return;

  const merged: LogFields = { ...ctx, ...fields };
  // Errors get unwrapped to a message + stack so they survive JSON.stringify.
  for (const [k, v] of Object.entries(merged)) {
    if (v instanceof Error) {
      merged[k] = { message: v.message, stack: v.stack, name: v.name };
    }
  }

  if (PRETTY) {
    const tag = [merged.component, merged.runId ?? merged.jobId ?? merged.projectId]
      .filter(Boolean)
      .join(" ");
    const rest = Object.entries(merged)
      .filter(([k]) => !["component", "runId", "jobId", "projectId"].includes(k))
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    const line = `${level.toUpperCase().padEnd(5)} ${tag ? `[${tag}] ` : ""}${msg}${rest ? ` · ${rest}` : ""}`;
    sink(level)(line);
    return;
  }

  sink(level)(
    JSON.stringify({ level, ts: new Date().toISOString(), msg, ...merged })
  );
}

function sink(level: LogLevel): (line: string) => void {
  // Keep stdout/stderr separation so platform log routers classify correctly.
  return level === "error" || level === "warn" ? console.error : console.log;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Derive a logger that carries additional bound context. */
  child(ctx: LogFields): Logger;
}

function make(ctx: LogFields): Logger {
  return {
    debug: (msg, fields) => emit("debug", ctx, msg, fields),
    info: (msg, fields) => emit("info", ctx, msg, fields),
    warn: (msg, fields) => emit("warn", ctx, msg, fields),
    error: (msg, fields) => emit("error", ctx, msg, fields),
    child: (extra) => make({ ...ctx, ...extra }),
  };
}

/** Root logger. Use `.child({ component, runId })` to bind correlation IDs. */
export const log = make({});

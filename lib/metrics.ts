// Lightweight in-process metrics for the run pipeline. No external dependency
// (no Prometheus/StatsD client) — counters and distributions accumulate in
// memory and are flushed to the structured log on an interval, so you can
// answer "are runs silently capping?", "is a poison job thrashing reclaim?",
// "what's the cost-per-run distribution?" by grepping the metrics lines.
//
// To export to a real TSDB later, swap the flush() body for a push to your
// collector — the call sites (incr/observe) stay unchanged.

import { log } from "./log";

type CounterKey = string; // "name" or "name{label=value,...}"

const counters = new Map<CounterKey, number>();
const distributions = new Map<string, number[]>();

function keyOf(name: string, labels?: Record<string, string | number>): CounterKey {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${name}{${parts}}`;
}

/** Increment a counter (default +1). e.g. metrics.incr("run.completed"). */
export function incr(
  name: string,
  labels?: Record<string, string | number>,
  by = 1
): void {
  const key = keyOf(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

/** Record a sample into a distribution. e.g. metrics.observe("run.cost_usd", 3.41). */
export function observe(name: string, value: number): void {
  const arr = distributions.get(name) ?? [];
  arr.push(value);
  distributions.set(name, arr);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Snapshot current metrics without clearing — for an inline status endpoint. */
export function snapshot(): {
  counters: Record<string, number>;
  distributions: Record<string, { n: number; p50: number; p95: number; max: number }>;
} {
  const c: Record<string, number> = {};
  for (const [k, v] of counters) c[k] = v;
  const d: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
  for (const [k, vals] of distributions) {
    const sorted = [...vals].sort((a, b) => a - b);
    d[k] = {
      n: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }
  return { counters: c, distributions: d };
}

/** Emit accumulated metrics to the log and reset distribution buffers. */
export function flush(): void {
  const snap = snapshot();
  if (
    Object.keys(snap.counters).length === 0 &&
    Object.keys(snap.distributions).length === 0
  ) {
    return;
  }
  log.child({ component: "metrics" }).info("metrics flush", snap);
  // Counters are cumulative (keep), distributions reset so percentiles reflect
  // the most recent window rather than all-time.
  distributions.clear();
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start periodic metric flushing. Call once at worker startup. Idempotent. */
export function startMetricsFlush(everyMs = 60_000): () => void {
  if (timer) return () => {};
  timer = setInterval(flush, everyMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export const metrics = { incr, observe, snapshot, flush, startMetricsFlush };

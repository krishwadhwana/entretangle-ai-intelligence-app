// ---------------------------------------------------------------------------
// Deterministic mock data for connectors. Mirrors the fixtures philosophy used
// elsewhere (seeded PRNG → identical inputs produce identical output) so a
// MOCK_MODE demo is stable and the whole pipeline is exercisable with zero
// external credentials. A mild upward trend + weekly seasonality + seeded
// jitter make the series look like a real business instead of a flat line.
// ---------------------------------------------------------------------------
import type { NormalizedMetric, MetricName, SyncContext } from "./types";

/** Mulberry32 — small, fast, seedable PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash so a string (e.g. integrationId) seeds the PRNG. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function eachDay(since: Date, until: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
  );
  const end = Date.UTC(
    until.getUTCFullYear(),
    until.getUTCMonth(),
    until.getUTCDate(),
  );
  while (cur.getTime() <= end) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

type SeriesSpec = {
  metric: MetricName;
  /** Day-0 baseline value. */
  base: number;
  /** Fractional daily growth (0.01 = +1%/day compounding). */
  growth?: number;
  /** ± jitter as a fraction of the trend value. */
  noise?: number;
  /** Weekend multiplier (e.g. 1.3 = busier weekends, 0.7 = quieter). */
  weekend?: number;
  currency?: string | null;
  dimensions?: Record<string, string | number>;
  round?: boolean;
};

/** Generate one daily series across the sync window. */
export function genSeries(
  ctx: SyncContext,
  spec: SeriesSpec,
  salt = 0,
): NormalizedMetric[] {
  const rng = makeRng((ctx.seed ^ hashSeed(spec.metric)) + salt);
  const days = eachDay(ctx.since, ctx.until);
  const growth = spec.growth ?? 0.004;
  const noise = spec.noise ?? 0.18;
  return days.map((d, i) => {
    const trend = spec.base * Math.pow(1 + growth, i);
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const season = isWeekend ? spec.weekend ?? 1 : 1;
    const jitter = 1 + (rng() * 2 - 1) * noise;
    let value = Math.max(0, trend * season * jitter);
    if (spec.round !== false) value = Math.round(value);
    return {
      metric: spec.metric,
      date: dayKey(d),
      value,
      currency: spec.currency,
      dimensions: spec.dimensions,
    };
  });
}

// ---------------------------------------------------------------------------
// Backtest harness — the thing that lets us PROVE the launch sim is more than a
// dressed-up guess: replay a recorded real launch through simulateLaunch and
// measure predicted-vs-actual error. This is fixture-based (no DB): a
// BacktestOutcome bundles the inputs that were used, a frozen audience, and the
// ACTUAL observed results over the launch horizon. Until real launches are
// captured (the first-party moat), fixtures under data/backtest/ are synthetic
// placeholders — the harness mechanics are what matter; the numbers are not real.
//
// It also runs a small A/B on the benchmark refund calibration (targetRefundRate
// from the benchmark layer vs. the legacy heuristic) and reports which lands
// closer to the actual refund rate — i.e. whether the added data helped.
// ---------------------------------------------------------------------------

import {
  simulateLaunch,
  type LaunchPersona,
  type LaunchContext,
} from "./launchSim";
import { LaunchSimInputsSchema, type LaunchSimInputs, type Segment } from "./schema";
import {
  resolveBenchmarks,
  geoTierFromPlace,
  type CategoryKey,
} from "./datasources/benchmarks";

// A compact, deterministic spec for a slice of the frozen audience — keeps
// fixtures small. Expanded into LaunchPersona[] by synthPersonas (seeded by
// index, no RNG, so a fixture always yields the same audience).
export type PersonaSpec = {
  count: number;
  segment: Segment;
  locality: string;
  country: string;
  wtp: number; // segment center willingness-to-pay
  intentMean: number; // 0–1
  priceSensitivity: number; // 0–1
  channelPref: string;
  platforms: string[];
  /** fraction (0–1) whose objection is returns/fit-flavoured (drives refunds). */
  returnsObjectionShare?: number;
};

// The metrics a captured launch can report. All optional — the harness compares
// whatever is present. Keys mirror LaunchSimResult.summary.
export type ActualOutcome = Partial<{
  totalOrders: number;
  newOrders: number;
  repeatOrders: number;
  unitsSold: number;
  refundRatePct: number;
  grossRevenue: number;
  netRevenue: number;
  blendedCac: number;
  netProfit: number;
}>;

export type BacktestOutcome = {
  id: string;
  label: string;
  category: CategoryKey;
  synthetic?: boolean; // true for placeholder fixtures
  notes?: string;
  inputs: Partial<LaunchSimInputs>;
  ctx?: LaunchContext;
  audience: PersonaSpec[];
  actual: ActualOutcome;
};

export type MetricError = {
  metric: keyof ActualOutcome;
  predicted: number;
  actual: number;
  absPctError: number; // |pred-actual| / |actual| * 100
};

export type BacktestResult = {
  id: string;
  label: string;
  synthetic: boolean;
  personaCount: number;
  errors: MetricError[];
  mapePct: number | null; // mean abs % error across compared metrics
  refundAb: {
    actual: number | null;
    calibratedPred: number;
    uncalibratedPred: number;
    winner: "calibrated" | "uncalibrated" | "tie" | "n/a";
  };
};

// Tiny deterministic hash → [0,1), so a (specIndex, personIndex, salt) triple
// gives stable pseudo-variation without Math.random.
function unit(a: number, b: number, salt: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  return (h % 100000) / 100000;
}

/** Expand persona specs into a deterministic LaunchPersona[]. */
export function synthPersonas(specs: PersonaSpec[]): LaunchPersona[] {
  const out: LaunchPersona[] = [];
  specs.forEach((s, si) => {
    for (let i = 0; i < s.count; i++) {
      const intent = Math.max(
        0,
        Math.min(1, s.intentMean + (unit(si, i, 1) - 0.5) * 0.5)
      );
      const wtp = Math.round(s.wtp * (0.75 + unit(si, i, 2) * 0.5));
      const isReturnsObjector = unit(si, i, 3) < (s.returnsObjectionShare ?? 0.3);
      out.push({
        intent,
        wtp,
        priceSensitivity: s.priceSensitivity,
        segment: s.segment,
        channelPref: s.channelPref,
        platforms: s.platforms,
        objection: isReturnsObjector
          ? "worried about fit and returns"
          : "a bit pricey",
        age: 22 + Math.floor(unit(si, i, 4) * 40),
        gender: unit(si, i, 5) < 0.5 ? "f" : "m",
        locality: s.locality,
        country: s.country,
      });
    }
  });
  return out;
}

function pctErr(pred: number, actual: number): number {
  if (actual === 0) return pred === 0 ? 0 : 100;
  return Math.round((Math.abs(pred - actual) / Math.abs(actual)) * 1000) / 10;
}

/** Replay one recorded outcome through the sim and score it. */
export function runBacktest(o: BacktestOutcome): BacktestResult {
  const personas = synthPersonas(o.audience);
  const baseInputs = LaunchSimInputsSchema.parse(o.inputs);
  const ctx = o.ctx ?? {};

  // Benchmark refund target for this category × the audience's geo tiers.
  const geoTiers = Array.from(
    new Set(personas.map((p) => geoTierFromPlace(p.locality, p.country)))
  );
  const priors = resolveBenchmarks(o.category, geoTiers);

  const calibrated = simulateLaunch(
    personas,
    { ...baseInputs, targetRefundRatePct: priors.returnRatePct.mid },
    ctx
  );
  const uncalibrated = simulateLaunch(
    personas,
    { ...baseInputs, targetRefundRatePct: null },
    ctx
  );

  // Score the calibrated run against whatever actuals are present.
  const summary = calibrated.summary as unknown as Record<string, unknown>;
  const errors: MetricError[] = [];
  for (const [k, actual] of Object.entries(o.actual)) {
    if (actual == null) continue;
    const predicted = summary[k];
    if (typeof predicted !== "number") continue;
    errors.push({
      metric: k as keyof ActualOutcome,
      predicted: Math.round(predicted * 100) / 100,
      actual,
      absPctError: pctErr(predicted, actual),
    });
  }
  const mapePct = errors.length
    ? Math.round((errors.reduce((s, e) => s + e.absPctError, 0) / errors.length) * 10) / 10
    : null;

  // A/B on the refund calibration specifically.
  const actualRefund = o.actual.refundRatePct ?? null;
  const cPred = calibrated.summary.refundRatePct;
  const uPred = uncalibrated.summary.refundRatePct;
  let winner: BacktestResult["refundAb"]["winner"] = "n/a";
  if (actualRefund != null) {
    const cErr = Math.abs(cPred - actualRefund);
    const uErr = Math.abs(uPred - actualRefund);
    winner = cErr < uErr ? "calibrated" : uErr < cErr ? "uncalibrated" : "tie";
  }

  return {
    id: o.id,
    label: o.label,
    synthetic: !!o.synthetic,
    personaCount: personas.length,
    errors,
    mapePct,
    refundAb: {
      actual: actualRefund,
      calibratedPred: Math.round(cPred * 10) / 10,
      uncalibratedPred: Math.round(uPred * 10) / 10,
      winner,
    },
  };
}

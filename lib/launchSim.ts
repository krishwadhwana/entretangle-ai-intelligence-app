// ---------------------------------------------------------------------------
// simulateLaunch — the deterministic heart of the Launch Simulation module.
//
// Philosophy (mirrors computeFinancials): the simulated personas supply the
// demand SHAPE; market sizing supplies the SCALE; this module does ALL the
// arithmetic — no LLM call anywhere. It fast-forwards a product launch step by
// step (day or month) over the FROZEN persona rows and reports the whole
// trajectory: reach → consideration → purchase (by channel) → refunds, plus
// the full P&L, inventory/deadstock, repeat customers and demographics.
//
// HYBRID engine: each step we compute every persona's *expected* flows
// analytically (a smooth diffusion + a smooth price-elastic conversion), then
// perturb them with a single seeded jitter so the trajectory looks like a real
// launch instead of a textbook curve. The seed is hash(inputs), so:
//   • identical inputs  → identical seed → identical trajectory (the rerun test)
//   • different ad spend → different seed → a legitimately different trajectory
// Nothing about that equality is hardcoded — it falls out of the engine being a
// pure function of its inputs. scripts/launch-sim-check.ts asserts it.
// ---------------------------------------------------------------------------

import {
  LaunchSimInputsSchema,
  type LaunchSimInputs,
  type LaunchSimResult,
  type LaunchSimStep,
  type Segment,
} from "./schema";

// The minimum we need from a simulated buyer. Pulled from Persona + Cohort rows.
export type LaunchPersona = {
  intent: number; // 0–1
  wtp: number; // willingness to pay, in the model currency
  priceSensitivity: number; // 0–1, 1 = extremely price-sensitive
  segment: Segment | string | null;
  channelPref: string;
  platforms: string[];
  objection: string;
  age: number;
  gender: string;
  locality: string;
  country: string;
};

export type LaunchContext = {
  // Derived reach ceiling source (financials' reachable prospects/month). Used
  // only to default reachablePool when the founder didn't set one.
  reachableProspectsPerMonth?: number | null;
  // Optional financial-model CAC. When present, paid first-time orders are
  // bounded by ad spend ÷ CAC so CPM reach cannot imply impossible acquisition.
  blendedCac?: number | null;
};

// --- deterministic PRNG ----------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 — tiny, fast, fully deterministic given the seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- small helpers ---------------------------------------------------------

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

function round(n: number, dp: number): number {
  if (!isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

const money = (n: number) => round(n, 2);
const count = (n: number) => round(n, 2);

// Annual probability that an active customer reorders, by income segment. A
// luxury furniture buyer rarely repeats; a budget consumer churns through more.
// Scaled by repeatRateMult and dampened by the buyer's own refund propensity
// (an unhappy customer doesn't come back). Derived defaults, all overridable.
const ANNUAL_REPEAT_BY_SEGMENT: Record<string, number> = {
  budget: 0.35,
  middle: 0.45,
  affluent: 0.6,
  luxury: 0.75,
};

const REFUND_OBJECTION_RE =
  /damage|deliver|return|see and touch|touch it|quality|fake|warranty|fragile|broke/i;

function ageBand(age: number): string {
  if (age < 25) return "Under 25";
  if (age < 35) return "25–34";
  if (age < 45) return "35–44";
  if (age < 55) return "45–54";
  return "55+";
}

// ---------------------------------------------------------------------------
// Resolve defaults / derivations. Anything the founder left null is filled in
// from the run + the headline knobs, so the engine always runs on a complete,
// echo-able input set.
// ---------------------------------------------------------------------------

export function resolveLaunchInputs(
  raw: LaunchSimInputs,
  personas: LaunchPersona[],
  ctx: LaunchContext = {}
): LaunchSimInputs {
  const i = LaunchSimInputsSchema.parse(raw); // apply schema defaults first
  const stepsPerMonth = i.granularity === "day" ? 30 : 1;

  // Reach ceiling: a finite pool the ad spend saturates over time.
  let reachablePool = i.reachablePool;
  if (reachablePool == null) {
    const monthly = ctx.reachableProspectsPerMonth ?? null;
    const horizonMonths = Math.max(1, i.horizon / stepsPerMonth);
    reachablePool =
      monthly && monthly > 0
        ? Math.round(monthly * Math.min(horizonMonths, 12))
        : 20000;
  }

  // Decision speed: how quickly considerers resolve. A day-step audience decides
  // a small slice per day; a month-step audience resolves most of it per month.
  const decisionSpeed =
    i.decisionSpeed ?? (i.granularity === "day" ? 0.1 : 0.5);

  const returnShippingPerOrder =
    i.returnShippingPerOrder ?? i.shippingPerOrder;

  // Initial inventory: cover ~1.5× the expected first-month demand if the
  // founder didn't pin a MOQ. Size it from first-month reachable demand, not
  // the whole pool, so a zero-acquisition scenario does not buy deadstock.
  let initialInventoryUnits = i.initialInventoryUnits;
  if (initialInventoryUnits == null) {
    const meanBuy = meanBuyProb(personas, i.salePrice);
    const paidImpressions =
      i.cpm > 0 && i.adSpendPerMonth > 0
        ? (i.adSpendPerMonth / i.cpm) * 1000
        : 0;
    const paidReach = paidImpressions / Math.max(i.frequencyCap, 1);
    const organicReach =
      i.granularity === "day"
        ? i.organicReachPerStep * 30
        : i.organicReachPerStep;
    const firstMonthReach = Math.min(reachablePool, paidReach + organicReach);
    const decisionCoverage = 1 - Math.pow(1 - decisionSpeed, stepsPerMonth);
    const estMonthlyOrders = firstMonthReach * meanBuy * decisionCoverage;
    initialInventoryUnits =
      estMonthlyOrders > 0 ? Math.max(10, Math.ceil(estMonthlyOrders * 1.5)) : 0;
  }

  return {
    ...i,
    reachablePool,
    decisionSpeed,
    returnShippingPerOrder,
    initialInventoryUnits,
  };
}

// Smooth, price-elastic purchase probability for one persona at `price`.
// Replaces the hard wtp≥price step with a logistic centred on the persona's
// wtp whose steepness is set by their priceSensitivity — so a price change
// moves demand continuously, and priceSensitivity finally does work.
function buyProbability(p: LaunchPersona, price: number): number {
  if (p.wtp <= 0 || p.intent <= 0) return 0;
  const softness = p.wtp * (0.08 + 0.5 * (1 - clamp(p.priceSensitivity, 0, 1)));
  const afford = 1 / (1 + Math.exp(-(p.wtp - price) / Math.max(softness, 1e-6)));
  return clamp(p.intent * afford, 0, 1);
}

function meanBuyProb(personas: LaunchPersona[], price: number): number {
  if (personas.length === 0) return 0;
  let s = 0;
  for (const p of personas) s += buyProbability(p, price);
  return s / personas.length;
}

// Per-persona base refund propensity, from signals we actually have: a returns-
// flavoured objection, an export destination, a marketplace channel.
function refundPropensity(
  p: LaunchPersona,
  homeCountry: string,
  mult: number
): number {
  let r = 0.04;
  if (REFUND_OBJECTION_RE.test(p.objection)) r += 0.06;
  if (p.country && homeCountry && p.country !== homeCountry) r += 0.04; // export shipping
  if (/marketplace|amazon|flipkart/i.test(p.channelPref)) r += 0.03;
  return clamp(r * mult, 0, 0.5);
}

// How attractive this persona is to the ad delivery, before normalisation:
// platform fit × a targeting tilt toward higher buy-probability. targetingQuality
// = 0 → broad (everyone equal on platform fit); 1 → strongly optimised.
function adAttractiveness(
  affinity: number,
  buyProb: number,
  meanBuy: number,
  targetingQuality: number
): number {
  const tilt = 1 + targetingQuality * 3 * (buyProb - meanBuy);
  return Math.max(0.02, affinity * Math.max(0.05, tilt));
}

function platformAffinity(platforms: string[], funded: Set<string>): number {
  if (platforms.length === 0) return 0.2; // unknown → reachable, but weakly
  let hit = 0;
  for (const pl of platforms) if (funded.has(pl.toLowerCase())) hit++;
  return Math.max(0.05, hit / platforms.length);
}

// --- a NameCount accumulator -----------------------------------------------

class Bucket {
  private orders = new Map<string, number>();
  private revenue = new Map<string, number>();
  private refunds = new Map<string, number>();
  add(key: string, orders: number, revenue: number, refunds = 0) {
    if (!key) key = "—";
    this.orders.set(key, (this.orders.get(key) ?? 0) + orders);
    this.revenue.set(key, (this.revenue.get(key) ?? 0) + revenue);
    this.refunds.set(key, (this.refunds.get(key) ?? 0) + refunds);
  }
  list(withRefunds = false) {
    return Array.from(this.orders.keys())
      .map((name) => ({
        name,
        orders: count(this.orders.get(name) ?? 0),
        revenue: money(this.revenue.get(name) ?? 0),
        ...(withRefunds ? { refunds: count(this.refunds.get(name) ?? 0) } : {}),
      }))
      .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));
  }
}

// ---------------------------------------------------------------------------
// The simulation.
// ---------------------------------------------------------------------------

export function simulateLaunch(
  personas: LaunchPersona[],
  rawInputs: LaunchSimInputs,
  ctx: LaunchContext = {}
): LaunchSimResult {
  const inputs = resolveLaunchInputs(rawInputs, personas, ctx);
  const N = personas.length;

  // Seed from the resolved inputs only — NOT the personas (those are fixed for a
  // run). Same inputs ⇒ same seed ⇒ same trajectory.
  const seed = hashString(JSON.stringify(inputs));
  const rng = mulberry32(seed);

  const stepsPerMonth = inputs.granularity === "day" ? 30 : 1;
  const stepsPerYear = inputs.granularity === "day" ? 365 : 12;
  const daysPerStep = inputs.granularity === "day" ? 1 : 30;
  const reachablePool = inputs.reachablePool ?? 20000;
  const scaleFactor = N > 0 ? reachablePool / N : 0; // real people per persona
  const returnWindowSteps = Math.round(inputs.returnWindowDays / daysPerStep);
  const reorderLeadSteps = Math.round(inputs.reorderLeadTimeDays / daysPerStep);
  const returnShipping = inputs.returnShippingPerOrder ?? inputs.shippingPerOrder;
  const decisionSpeed =
    inputs.decisionSpeed ?? (inputs.granularity === "day" ? 0.1 : 0.5);
  const blendedCac =
    ctx.blendedCac && ctx.blendedCac > 0 ? ctx.blendedCac : null;

  const funded = new Set(inputs.adPlatforms.map((p) => p.toLowerCase()));
  const homeCountry = modal(personas.map((p) => p.country));
  const meanBuy = meanBuyProb(personas, inputs.salePrice);

  // Precompute per-persona constants.
  const pre = personas.map((p) => {
    const buyProb = buyProbability(p, inputs.salePrice);
    const affinity = platformAffinity(p.platforms, funded);
    const attract = adAttractiveness(
      affinity,
      buyProb,
      meanBuy,
      inputs.targetingQuality
    );
    const refundP = refundPropensity(p, homeCountry, inputs.refundRateMult);
    const seg = (p.segment ?? "middle") as string;
    const annualRepeat =
      (ANNUAL_REPEAT_BY_SEGMENT[seg] ?? 0.4) * inputs.repeatRateMult;
    const repeatHazard = (annualRepeat / stepsPerYear) * (1 - refundP);
    return { p, buyProb, attract, refundP, repeatHazard };
  });
  const totalAttract = pre.reduce((s, x) => s + x.attract, 0) || 1;

  // Compartment state (fractions of each persona's represented sub-population).
  const unaware = new Array(N).fill(1);
  const considering = new Array(N).fill(0);
  const active = new Array(N).fill(0); // bought ≥1, eligible to repeat

  // Schedules (real-count, indexed by absolute step).
  const refundArrivals = new Array(inputs.horizon + returnWindowSteps + 2).fill(0);
  const inventoryArrivals = new Array(inputs.horizon + reorderLeadSteps + 2).fill(0);

  let inventory = inputs.initialInventoryUnits ?? 0;
  let onOrder = 0;
  let emaDemand = 0;
  let lastStepNewBuyers = 0;

  // Breakdowns + running totals.
  const byChannel = new Bucket();
  const bySegment = new Bucket();
  const byLocality = new Bucket();
  const byAge = new Bucket();
  const byGender = new Bucket();
  let newCustomers = 0;
  let returningOrders = 0;
  let refundsGenerated = 0;

  const timeline: LaunchSimStep[] = [];
  let cumulativeNetProfit = 0;
  let cumulativeCash = -(inputs.initialInventoryUnits ?? 0) * inputs.costPrice;
  let minCash = cumulativeCash;
  let breakEvenStep: number | null = null;

  for (let t = 0; t < inputs.horizon; t++) {
    // Inventory ordered earlier arrives at the top of its step.
    if (inventoryArrivals[t]) {
      inventory += inventoryArrivals[t];
      onOrder = Math.max(0, onOrder - inventoryArrivals[t]);
    }

    // One seeded jitter per step (the only randomness). Centred on 1.
    const jitter = 1 + (rng() * 2 - 1) * inputs.jitterAmplitude;

    const adSpend = inputs.adSpendPerMonth / stepsPerMonth;
    const impressions =
      inputs.cpm > 0 ? (adSpend / inputs.cpm) * 1000 * jitter : 0;

    // Word-of-mouth + organic awareness, as per-person fractions of the pool.
    const woMPerPerson =
      reachablePool > 0
        ? (inputs.viralityK * lastStepNewBuyers) / reachablePool
        : 0;
    const organicPerPerson =
      reachablePool > 0 ? inputs.organicReachPerStep / reachablePool : 0;

    let stepNewlyReached = 0;
    let stepNewOrders = 0;
    let stepRepeatOrders = 0;
    // Desired (pre-inventory) orders, kept per-persona so we can apply the fill
    // rate and attribute refunds/breakdowns proportionally.
    const desired: { idx: number; first: number; repeat: number; firstFrac: number }[] = [];
    let demand = 0;
    let repeatDemand = 0;

    for (let k = 0; k < N; k++) {
      const { buyProb, attract, repeatHazard } = pre[k];
      // Ad impressions reaching one person in this group, then awareness.
      const imprPerPerson = (impressions * attract) / (totalAttract * scaleFactor || 1);
      const adAware = 1 - Math.exp(-imprPerPerson / inputs.frequencyCap);
      const awareProb = clamp(adAware + organicPerPerson + woMPerPerson, 0, 1);

      const newlyAware = unaware[k] * awareProb;
      unaware[k] -= newlyAware;
      considering[k] += newlyAware;

      const decideRate = clamp(buyProb * decisionSpeed * jitter, 0, 1);
      const firstBuyers = considering[k] * decideRate;
      const abandon = considering[k] * inputs.abandonRate;
      considering[k] = Math.max(0, considering[k] - firstBuyers - abandon);
      active[k] += firstBuyers;

      const repeatBuyers = active[k] * clamp(repeatHazard * jitter, 0, 1);

      const mi = scaleFactor;
      const first = firstBuyers * mi;
      const repeat = repeatBuyers * mi;
      stepNewlyReached += newlyAware * mi;
      stepNewOrders += first;
      stepRepeatOrders += repeat;
      desired.push({ idx: k, first, repeat, firstFrac: firstBuyers });
      demand += first + repeat;
      repeatDemand += repeat;
    }

    // If the financial model has a CAC, paid first-time acquisition cannot
    // exceed the number of new customers this step's ad budget can buy.
    if (blendedCac && adSpend > 0 && stepNewOrders > 0) {
      const paidNewCustomerCap = adSpend / blendedCac;
      const firstScale = Math.min(1, paidNewCustomerCap / stepNewOrders);
      if (firstScale < 1) {
        for (const d of desired) {
          const unconverted = d.firstFrac * (1 - firstScale);
          active[d.idx] = Math.max(0, active[d.idx] - unconverted);
          considering[d.idx] += unconverted;
          d.first *= firstScale;
        }
        stepNewOrders *= firstScale;
        demand = stepNewOrders + repeatDemand;
      }
    }

    // Fulfilment capped by inventory.
    const fillRate = demand > 0 ? Math.min(1, inventory / demand) : 0;
    const unitsFulfilled = demand * fillRate;
    const unitsStockedOut = demand - unitsFulfilled;
    inventory -= unitsFulfilled;

    // Attribute fulfilled orders + schedule refunds, per persona.
    let stepRefundsArrivalUnits = refundArrivals[t]; // refunds landing now
    for (const d of desired) {
      const { p, refundP } = pre[d.idx];
      const first = d.first * fillRate;
      const repeat = d.repeat * fillRate;
      const orders = first + repeat;
      if (orders <= 0) continue;
      const rev = orders * inputs.salePrice;
      byChannel.add(p.channelPref, orders, rev);
      byLocality.add(p.locality, orders, rev);
      byAge.add(ageBand(p.age), orders, rev);
      byGender.add(p.gender || "—", orders, rev);
      const refunds = orders * refundP;
      bySegment.add(String(p.segment ?? "—"), orders, rev, refunds);
      refundsGenerated += refunds;
      newCustomers += first;
      returningOrders += repeat;
      // Refund lands after the return window (clamped into the array).
      const arriveAt = Math.min(t + returnWindowSteps, refundArrivals.length - 1);
      refundArrivals[arriveAt] += refunds;
    }

    // Refunds landing this step: reverse revenue, pay return cost, restock the
    // resellable share.
    const refundsLanding = stepRefundsArrivalUnits;
    const refundedRevenue = refundsLanding * inputs.salePrice;
    const refundCost =
      refundsLanding *
      (returnShipping + (1 - inputs.resellablePct) * inputs.costPrice);
    inventory += refundsLanding * inputs.resellablePct;

    // Reorder policy: keep enough to cover lead-time demand + a half-step buffer.
    emaDemand = t === 0 ? demand : 0.3 * demand + 0.7 * emaDemand;
    let reorderCashOut = 0;
    if (inputs.reorderEnabled) {
      const target = emaDemand * (reorderLeadSteps + 1.5);
      const gap = target - inventory - onOrder;
      if (gap > 0) {
        const qty = Math.ceil(gap);
        onOrder += qty;
        reorderCashOut = qty * inputs.costPrice;
        const arriveAt = Math.min(
          t + reorderLeadSteps,
          inventoryArrivals.length - 1
        );
        inventoryArrivals[arriveAt] += qty;
      }
    }

    // Step P&L (accrual).
    const revenue = unitsFulfilled * inputs.salePrice;
    const cogs = unitsFulfilled * inputs.costPrice;
    const shippingCost = unitsFulfilled * inputs.shippingPerOrder;
    const paymentFees = revenue * inputs.paymentFeePct;
    const fixedCosts = inputs.fixedCostsPerMonth / stepsPerMonth;
    const netProfit =
      revenue -
      refundedRevenue -
      cogs -
      shippingCost -
      paymentFees -
      refundCost -
      fixedCosts -
      adSpend;
    cumulativeNetProfit += netProfit;

    // Cash basis (working capital): COGS isn't a cash item — inventory purchases
    // are. Add COGS back, subtract the reorder cash outflow.
    cumulativeCash += netProfit + cogs - reorderCashOut;
    if (cumulativeCash < minCash) minCash = cumulativeCash;
    if (breakEvenStep === null && cumulativeNetProfit >= 0) breakEvenStep = t;

    lastStepNewBuyers = stepNewOrders * fillRate;

    const scrolledPast = Math.max(0, stepNewlyReached - stepNewOrders * fillRate);

    timeline.push({
      step: t,
      label: stepLabel(inputs.granularity, t),
      impressions: count(impressions),
      newlyReached: count(stepNewlyReached),
      cumulativeReached: count(
        (timeline[t - 1]?.cumulativeReached ?? 0) + stepNewlyReached
      ),
      scrolledPast: count(scrolledPast),
      newOrders: count(stepNewOrders * fillRate),
      repeatOrders: count(stepRepeatOrders * fillRate),
      unitsFulfilled: count(unitsFulfilled),
      unitsStockedOut: count(unitsStockedOut),
      refunds: count(refundsLanding),
      inventoryOnHand: count(inventory),
      adSpend: money(adSpend),
      revenue: money(revenue),
      refundedRevenue: money(refundedRevenue),
      cogs: money(cogs),
      shippingCost: money(shippingCost),
      paymentFees: money(paymentFees),
      refundCost: money(refundCost),
      fixedCosts: money(fixedCosts),
      netProfit: money(netProfit),
      cumulativeNetProfit: money(cumulativeNetProfit),
      cumulativeCash: money(cumulativeCash),
    });
  }

  // --- summary ---
  const sum = (sel: (s: LaunchSimStep) => number) =>
    timeline.reduce((a, s) => a + sel(s), 0);
  const totalAdSpend = sum((s) => s.adSpend);
  const grossRevenue = sum((s) => s.revenue);
  const refundedRevenue = sum((s) => s.refundedRevenue);
  const netRevenue = grossRevenue - refundedRevenue;
  const totalCogs = sum((s) => s.cogs);
  const totalShipping = sum((s) => s.shippingCost);
  const totalPaymentFees = sum((s) => s.paymentFees);
  const totalRefundCost = sum((s) => s.refundCost);
  const totalFixedCosts = sum((s) => s.fixedCosts);
  const netProfit = sum((s) => s.netProfit);
  const unitsSold = sum((s) => s.unitsFulfilled);
  const refundsLanded = sum((s) => s.refunds);
  const stockoutUnits = sum((s) => s.unitsStockedOut);
  const totalNewOrders = sum((s) => s.newOrders);
  const totalRepeatOrders = sum((s) => s.repeatOrders);
  const totalOrders = totalNewOrders + totalRepeatOrders;
  const totalReached = timeline[timeline.length - 1]?.cumulativeReached ?? 0;
  const totalScrolledPast = sum((s) => s.scrolledPast);
  const grossProfit = netRevenue - totalCogs;
  const deadstockUnits = Math.max(0, inventory);
  const deadstockValue = deadstockUnits * inputs.costPrice;
  const summary = {
    totalImpressions: count(sum((s) => s.impressions)),
    totalReached: count(totalReached),
    totalScrolledPast: count(totalScrolledPast),
    totalOrders: count(totalOrders),
    newOrders: count(totalNewOrders),
    repeatOrders: count(totalRepeatOrders),
    returningCustomerSharePct:
      totalOrders > 0 ? round((totalRepeatOrders / totalOrders) * 100, 1) : 0,
    unitsSold: count(unitsSold),
    stockoutUnits: count(stockoutUnits),
    refunds: count(refundsLanded),
    refundRatePct:
      unitsSold > 0 ? round((refundsGenerated / unitsSold) * 100, 1) : 0,
    grossRevenue: money(grossRevenue),
    netRevenue: money(netRevenue),
    totalAdSpend: money(totalAdSpend),
    adSpendPerConversion:
      totalOrders > 0 ? money(totalAdSpend / totalOrders) : 0,
    blendedCac: totalNewOrders > 0 ? money(totalAdSpend / totalNewOrders) : 0,
    totalCogs: money(totalCogs),
    totalShipping: money(totalShipping),
    totalPaymentFees: money(totalPaymentFees),
    totalRefundCost: money(totalRefundCost),
    totalFixedCosts: money(totalFixedCosts),
    grossProfit: money(grossProfit),
    netProfit: money(netProfit),
    grossMarginPct:
      netRevenue > 0 ? round((grossProfit / netRevenue) * 100, 1) : 0,
    netMarginPct:
      netRevenue > 0 ? round((netProfit / netRevenue) * 100, 1) : 0,
    deadstockUnits: count(deadstockUnits),
    deadstockValue: money(deadstockValue),
    peakCapitalNeeded: money(Math.max(0, -minCash)),
    breakEvenStep,
    breakEvenLabel:
      breakEvenStep === null
        ? null
        : stepLabel(inputs.granularity, breakEvenStep),
  };
  const breakdowns = {
    byChannel: byChannel.list(),
    bySegment: bySegment.list(true) as {
      name: string;
      orders: number;
      revenue: number;
      refunds: number;
    }[],
    byLocality: byLocality.list(),
    byAgeBand: byAge.list(),
    byGender: byGender.list(),
    newVsReturning: {
      newCustomers: count(newCustomers),
      returningOrders: count(returningOrders),
    },
  };

  return {
    seed,
    resolvedInputs: inputs,
    scaleFactor: round(scaleFactor, 4),
    personaCount: N,
    timeline,
    diagnostics: buildDiagnostics(inputs, summary, breakdowns),
    summary,
    breakdowns,
  };
}

function buildDiagnostics(
  inputs: LaunchSimInputs,
  summary: LaunchSimResult["summary"],
  breakdowns: LaunchSimResult["breakdowns"]
): LaunchSimResult["diagnostics"] {
  const topChannel = breakdowns.byChannel[0];
  const topSegment = breakdowns.bySegment[0];
  const topLocality = breakdowns.byLocality[0];
  const drivers: string[] = [];
  const risks: string[] = [];
  const nextMoves: string[] = [];

  const horizon =
    inputs.granularity === "month"
      ? `${inputs.horizon} months`
      : `${inputs.horizon} days`;
  const headline =
    summary.totalOrders > 0
      ? `${horizon} produces ${fmtCount(summary.totalOrders)} orders and ${fmtMoney(summary.netProfit)} net profit at ${fmtMoney(inputs.salePrice)} sale price.`
      : `${horizon} produces no orders because the scenario does not put enough qualified buyers into the funnel.`;

  if (summary.totalImpressions <= 0 && summary.totalReached <= 0) {
    drivers.push("No paid or organic acquisition is active, so the audience never enters consideration.");
    nextMoves.push("Add launch spend, organic reach, or a channel with existing demand before judging price fit.");
  } else {
    drivers.push(
      `${fmtCount(summary.totalReached)} people are reached from ${fmtCount(summary.totalImpressions)} impressions.`
    );
  }
  if (topChannel && topChannel.orders > 0) {
    drivers.push(`${topChannel.name} is the strongest purchase path with ${fmtCount(topChannel.orders)} orders.`);
  }
  if (topSegment && topSegment.orders > 0) {
    drivers.push(`${topSegment.name} buyers carry the result with ${fmtCount(topSegment.orders)} orders.`);
  }
  if (topLocality && topLocality.orders > 0) {
    drivers.push(`${topLocality.name} is the leading market with ${fmtCount(topLocality.orders)} orders.`);
  }
  if (summary.returningCustomerSharePct > 25) {
    drivers.push(`${summary.returningCustomerSharePct}% of orders come from repeat buyers, so retention is doing meaningful work.`);
  }

  if (summary.netProfit < 0) {
    risks.push(`Fixed costs and launch spend do not pay back within this horizon; peak capital need is ${fmtMoney(summary.peakCapitalNeeded)}.`);
  }
  if (summary.stockoutUnits > summary.unitsSold * 0.1) {
    risks.push(`${fmtCount(summary.stockoutUnits)} units of demand are lost to stockouts, so inventory is constraining upside.`);
    nextMoves.push("Raise opening inventory or shorten reorder lead time, then rerun.");
  }
  if (summary.deadstockValue > summary.grossRevenue * 0.2 && summary.deadstockUnits > 0) {
    risks.push(`${fmtMoney(summary.deadstockValue)} remains tied up in deadstock, which is high relative to sales.`);
    nextMoves.push("Lower opening inventory or run a smaller first batch before scaling spend.");
  }
  if (summary.refundRatePct > 15) {
    risks.push(`${summary.refundRatePct}% refund rate is a margin leak, likely tied to fit, delivery, or expectation mismatch.`);
    nextMoves.push("Test better sizing guidance, return policy, and product-page proof before increasing spend.");
  }
  if (summary.blendedCac > 0 && summary.blendedCac > inputs.salePrice * 0.4) {
    risks.push(`CAC is ${fmtMoney(summary.blendedCac)}, heavy for a ${fmtMoney(inputs.salePrice)} product.`);
    nextMoves.push("Shift budget toward the channels and segments with the lowest CAC before increasing total spend.");
  }
  if (summary.totalOrders > 0 && summary.breakEvenLabel == null) {
    nextMoves.push("Raise margin, reduce fixed costs, or shorten payback before treating this as launch-ready.");
  }
  if (nextMoves.length === 0 && summary.netProfit >= 0) {
    nextMoves.push("Rerun with higher price and lower inventory to test whether profit survives tighter assumptions.");
  }

  return {
    headline,
    drivers: drivers.slice(0, 4),
    risks: risks.slice(0, 4),
    nextMoves: nextMoves.slice(0, 4),
  };
}

function fmtCount(n: number): string {
  return count(n).toLocaleString("en-IN");
}

function fmtMoney(n: number): string {
  return money(n).toLocaleString("en-IN");
}

function stepLabel(g: "day" | "month", t: number): string {
  return g === "day" ? `Day ${t + 1}` : `Month ${t + 1}`;
}

function modal(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n));
  return best;
}

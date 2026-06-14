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
  type LaunchAssumption,
  type LaunchBusinessModel,
  type LaunchChannelInput,
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

const BUSINESS_PRESETS: Record<
  LaunchBusinessModel,
  {
    repeatMult: number;
    refundMult: number;
    decisionMult: number;
    abandonMult: number;
    inventoryBuffer: number;
    defaultChannels: LaunchChannelInput[];
  }
> = {
  generic: {
    repeatMult: 1,
    refundMult: 1,
    decisionMult: 1,
    abandonMult: 1,
    inventoryBuffer: 1.5,
    defaultChannels: [
      channel("paid_social", "Paid social", "paid", 0.7, 250, 0, 3, 0.18, 0.35, 0.45, 1, 1, 1),
      channel("search", "Search", "paid", 0.3, 350, 0, 2, 0.32, 0.55, 0.55, 1.15, 0.9, 1),
    ],
  },
  apparel: {
    repeatMult: 1.2,
    refundMult: 1.35,
    decisionMult: 1.1,
    abandonMult: 1,
    inventoryBuffer: 1.4,
    defaultChannels: [
      channel("paid_social", "Paid social", "paid", 0.65, 230, 0, 3, 0.2, 0.38, 0.42, 1, 1.2, 1.1),
      channel("creator", "Creators", "paid", 0.2, 500, 0, 2.5, 0.28, 0.45, 0.48, 1.2, 0.95, 1.2),
      channel("marketplace", "Marketplace", "marketplace", 0.15, 300, 0, 2, 0.3, 0.6, 0.6, 1.25, 1.15, 1),
    ],
  },
  furniture: {
    repeatMult: 0.45,
    refundMult: 1.15,
    decisionMult: 0.55,
    abandonMult: 0.7,
    inventoryBuffer: 1.2,
    defaultChannels: [
      channel("search", "Search", "paid", 0.45, 600, 0, 2, 0.35, 0.6, 0.5, 1.25, 0.9, 0.6),
      channel("paid_social", "Paid social", "paid", 0.35, 350, 0, 4, 0.16, 0.32, 0.35, 0.9, 1.05, 0.5),
      channel("showroom", "Showroom / retail", "retail", 0.2, 700, 0, 1.5, 0.45, 0.7, 0.65, 1.4, 0.8, 0.4),
    ],
  },
  consumable: {
    repeatMult: 2.2,
    refundMult: 0.65,
    decisionMult: 1.25,
    abandonMult: 1.05,
    inventoryBuffer: 1.8,
    defaultChannels: [
      channel("paid_social", "Paid social", "paid", 0.55, 220, 0, 3, 0.16, 0.35, 0.55, 1, 0.75, 1.6),
      channel("search", "Search", "paid", 0.25, 320, 0, 2, 0.3, 0.55, 0.65, 1.15, 0.7, 1.5),
      channel("owned", "Owned audience", "owned", 0.2, 180, 0, 1.5, 0.4, 0.65, 0.7, 1.3, 0.6, 2),
    ],
  },
  saas: {
    repeatMult: 3,
    refundMult: 0.4,
    decisionMult: 0.8,
    abandonMult: 0.85,
    inventoryBuffer: 0,
    defaultChannels: [
      channel("search", "Search", "paid", 0.45, 500, 0, 2, 0.35, 0.7, 0.45, 1.25, 0.5, 2),
      channel("content", "Content / organic", "organic", 0.2, 250, 0, 1.5, 0.3, 0.65, 0.4, 1.15, 0.5, 2.5),
      channel("paid_social", "Paid social", "paid", 0.35, 300, 0, 3, 0.14, 0.35, 0.3, 0.85, 0.7, 1.5),
    ],
  },
  services: {
    repeatMult: 0.9,
    refundMult: 0.5,
    decisionMult: 0.65,
    abandonMult: 0.75,
    inventoryBuffer: 0,
    defaultChannels: [
      channel("search", "Search", "paid", 0.55, 450, 0, 2, 0.4, 0.7, 0.45, 1.25, 0.5, 0.9),
      channel("referral", "Referral / network", "owned", 0.25, 200, 0, 1.5, 0.5, 0.75, 0.55, 1.5, 0.4, 1.1),
      channel("paid_social", "Paid social", "paid", 0.2, 300, 0, 3, 0.15, 0.35, 0.3, 0.85, 0.6, 0.8),
    ],
  },
  marketplace: {
    repeatMult: 1.1,
    refundMult: 1.1,
    decisionMult: 1.15,
    abandonMult: 0.9,
    inventoryBuffer: 1.3,
    defaultChannels: [
      channel("marketplace", "Marketplace", "marketplace", 0.55, 280, 0, 2, 0.35, 0.65, 0.65, 1.35, 1.1, 1),
      channel("search", "Search", "paid", 0.25, 350, 0, 2, 0.28, 0.55, 0.55, 1.15, 0.95, 1),
      channel("paid_social", "Paid social", "paid", 0.2, 230, 0, 3, 0.16, 0.35, 0.45, 0.95, 1.1, 1),
    ],
  },
};

function channel(
  id: string,
  label: string,
  kind: LaunchChannelInput["kind"],
  spendPct: number,
  cpm: number,
  reachPerStep: number,
  frequencyCap: number,
  engagementRate: number,
  visitRate: number,
  checkoutRate: number,
  trustMultiplier: number,
  refundMultiplier: number,
  repeatMultiplier: number
): LaunchChannelInput {
  return {
    id,
    label,
    kind,
    spendPct,
    cpm,
    reachPerStep,
    frequencyCap,
    engagementRate,
    visitRate,
    checkoutRate,
    trustMultiplier,
    refundMultiplier,
    repeatMultiplier,
  };
}

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
  const preset = BUSINESS_PRESETS[i.businessModel] ?? BUSINESS_PRESETS.generic;
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
    i.decisionSpeed ??
    clamp((i.granularity === "day" ? 0.1 : 0.5) * preset.decisionMult, 0.01, 1);

  const returnShippingPerOrder =
    i.returnShippingPerOrder ?? i.shippingPerOrder;
  const channels = normalizeChannels(i, preset);

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
      estMonthlyOrders > 0
        ? Math.max(10, Math.ceil(estMonthlyOrders * preset.inventoryBuffer))
        : 0;
  }

  return {
    ...i,
    reachablePool,
    decisionSpeed,
    channels,
    returnShippingPerOrder,
    initialInventoryUnits,
    refundRateMult: i.refundRateMult * preset.refundMult,
    repeatRateMult: i.repeatRateMult * preset.repeatMult,
    abandonRate: clamp(i.abandonRate * preset.abandonMult, 0, 1),
  };
}

function normalizeChannels(
  inputs: LaunchSimInputs,
  preset: (typeof BUSINESS_PRESETS)[LaunchBusinessModel]
): LaunchChannelInput[] {
  const base = inputs.channels.length > 0 ? inputs.channels : preset.defaultChannels;
  const parsed = base.map((c) => ({
    ...c,
    id: c.id || c.label.toLowerCase().replace(/\W+/g, "_"),
    label: c.label || c.id,
  }));
  const paidTotal = parsed
    .filter((c) => c.kind === "paid" || c.kind === "marketplace" || c.kind === "retail")
    .reduce((s, c) => s + c.spendPct, 0);
  return parsed.map((c) => ({
    ...c,
    spendPct:
      c.kind === "paid" || c.kind === "marketplace" || c.kind === "retail"
        ? paidTotal > 0
          ? c.spendPct / paidTotal
          : 0
        : 0,
    reachPerStep:
      c.reachPerStep > 0
        ? c.reachPerStep
        : c.kind === "organic" || c.kind === "owned"
          ? inputs.organicReachPerStep
          : 0,
    cpm: c.cpm > 0 ? c.cpm : inputs.cpm,
    frequencyCap: c.frequencyCap > 0 ? c.frequencyCap : inputs.frequencyCap,
  }));
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

function channelPlatformAffinity(p: LaunchPersona, ch: LaunchChannelInput): number {
  const id = `${ch.id} ${ch.label}`.toLowerCase();
  if (/social|instagram|meta|facebook|creator|tiktok/.test(id)) {
    return platformAffinity(p.platforms, new Set(["instagram", "facebook", "tiktok"]));
  }
  if (/search|google|youtube|content/.test(id)) {
    return platformAffinity(p.platforms, new Set(["google", "youtube", "search"]));
  }
  if (/marketplace|amazon|flipkart/.test(id)) {
    return /marketplace|amazon|flipkart/i.test(p.channelPref) ? 1.2 : 0.55;
  }
  if (/retail|showroom|store/.test(id)) {
    return /retail|showroom|store/i.test(p.channelPref) ? 1.2 : 0.5;
  }
  if (/owned|email|whatsapp|referral|network/.test(id)) {
    return platformAffinity(p.platforms, new Set(["whatsapp", "email", "referral"]));
  }
  return 0.8;
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

class ChannelBucket {
  private rows = new Map<
    string,
    {
      id: string;
      name: string;
      kind: LaunchChannelInput["kind"];
      impressions: number;
      reached: number;
      engaged: number;
      productVisits: number;
      checkoutsStarted: number;
      orders: number;
      revenue: number;
      adSpend: number;
    }
  >();
  ensure(ch: LaunchChannelInput) {
    if (!this.rows.has(ch.id)) {
      this.rows.set(ch.id, {
        id: ch.id,
        name: ch.label,
        kind: ch.kind,
        impressions: 0,
        reached: 0,
        engaged: 0,
        productVisits: 0,
        checkoutsStarted: 0,
        orders: 0,
        revenue: 0,
        adSpend: 0,
      });
    }
    return this.rows.get(ch.id)!;
  }
  addFunnel(
    ch: LaunchChannelInput,
    impressions: number,
    reached: number,
    engaged: number,
    visits: number,
    checkouts: number,
    adSpend: number
  ) {
    const r = this.ensure(ch);
    r.impressions += impressions;
    r.reached += reached;
    r.engaged += engaged;
    r.productVisits += visits;
    r.checkoutsStarted += checkouts;
    r.adSpend += adSpend;
  }
  addOrders(ch: LaunchChannelInput, orders: number, revenue: number) {
    const r = this.ensure(ch);
    r.orders += orders;
    r.revenue += revenue;
  }
  list() {
    return Array.from(this.rows.values())
      .map((r) => ({
        ...r,
        impressions: count(r.impressions),
        reached: count(r.reached),
        engaged: count(r.engaged),
        productVisits: count(r.productVisits),
        checkoutsStarted: count(r.checkoutsStarted),
        orders: count(r.orders),
        revenue: money(r.revenue),
        adSpend: money(r.adSpend),
        cac: r.orders > 0 ? money(r.adSpend / r.orders) : 0,
      }))
      .sort((a, b) => b.orders - a.orders || b.reached - a.reached);
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
  const channels = inputs.channels;
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
  const hasChannelOrganic = channels.some(
    (c) => c.kind === "organic" || c.kind === "owned"
  );

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
  const consideringTrust = new Array(N).fill(1);
  const consideringRefundMult = new Array(N).fill(1);
  const consideringRepeatMult = new Array(N).fill(1);
  const active = new Array(N).fill(0); // bought ≥1, eligible to repeat
  const activeRepeatMult = new Array(N).fill(1);

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
  const byAcquisitionChannel = new ChannelBucket();
  const returningChannel = channel(
    "returning",
    "Returning customers",
    "owned",
    0,
    inputs.cpm,
    0,
    inputs.frequencyCap,
    0,
    0,
    0,
    1,
    1,
    1
  );
  for (const ch of channels) byAcquisitionChannel.ensure(ch);
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
    const channelMedia = channels.map((ch) => {
      const paid =
        ch.kind === "paid" || ch.kind === "marketplace" || ch.kind === "retail";
      const spend = paid ? adSpend * ch.spendPct : 0;
      const impressions =
        paid && ch.cpm > 0
          ? (spend / ch.cpm) * 1000 * jitter
          : ch.reachPerStep * ch.frequencyCap * jitter;
      return { ch, spend, impressions };
    });
    const impressions = channelMedia.reduce((s, c) => s + c.impressions, 0);

    // Word-of-mouth + organic awareness, as per-person fractions of the pool.
    const woMPerPerson =
      reachablePool > 0
        ? (inputs.viralityK * lastStepNewBuyers) / reachablePool
        : 0;
    const organicPerPerson =
      !hasChannelOrganic && reachablePool > 0
        ? inputs.organicReachPerStep / reachablePool
        : 0;

    let stepNewlyReached = 0;
    let stepEngaged = 0;
    let stepProductVisits = 0;
    let stepCheckoutsStarted = 0;
    const stepChannelFunnel = new Map<
      string,
      {
        ch: LaunchChannelInput;
        reached: number;
        engaged: number;
        visits: number;
        checkouts: number;
      }
    >();
    for (const { ch } of channelMedia) {
      stepChannelFunnel.set(ch.id, {
        ch,
        reached: 0,
        engaged: 0,
        visits: 0,
        checkouts: 0,
      });
    }
    let stepNewOrders = 0;
    let stepRepeatOrders = 0;
    // Desired (pre-inventory) orders, kept per-persona so we can apply the fill
    // rate and attribute refunds/breakdowns proportionally.
    const desired: {
      idx: number;
      first: number;
      repeat: number;
      firstFrac: number;
      refundMult: number;
      channelShares: { ch: LaunchChannelInput; share: number }[];
    }[] = [];
    let demand = 0;
    let repeatDemand = 0;

    for (let k = 0; k < N; k++) {
      const { buyProb, attract, repeatHazard } = pre[k];
      const channelAwareness = channelMedia.map(({ ch, spend, impressions }) => {
        const chAffinity = channelPlatformAffinity(pre[k].p, ch);
        const chAttract = Math.max(0.02, attract * chAffinity);
        const imprPerPerson =
          (impressions * chAttract) / (totalAttract * scaleFactor || 1);
        const paidAware = 1 - Math.exp(-imprPerPerson / ch.frequencyCap);
        const directAware =
          ch.kind === "organic" || ch.kind === "owned"
            ? ch.reachPerStep / Math.max(reachablePool, 1)
            : 0;
        return {
          ch,
          spend,
          impressions,
          prob: clamp(paidAware + directAware, 0, 1),
        };
      });
      const paidOrganicAware = 1 - channelAwareness.reduce(
        (survival, x) => survival * (1 - x.prob),
        1
      );
      const awareProb = clamp(paidOrganicAware + organicPerPerson + woMPerPerson, 0, 1);

      const newlyAware = unaware[k] * awareProb;
      const channelProbSum =
        channelAwareness.reduce((s, x) => s + x.prob, 0) || 1;
      const channelShares = channelAwareness
        .filter((x) => x.prob > 0)
        .map((x) => ({ ch: x.ch, share: x.prob / channelProbSum }));
      const trust =
        channelShares.reduce((s, x) => s + x.share * x.ch.trustMultiplier, 0) || 1;
      const refundMult =
        channelShares.reduce((s, x) => s + x.share * x.ch.refundMultiplier, 0) || 1;
      const repeatMult =
        channelShares.reduce((s, x) => s + x.share * x.ch.repeatMultiplier, 0) || 1;

      unaware[k] -= newlyAware;
      const oldConsidering = considering[k];
      considering[k] += newlyAware;
      if (considering[k] > 0 && newlyAware > 0) {
        consideringTrust[k] =
          (consideringTrust[k] * oldConsidering + trust * newlyAware) /
          considering[k];
        consideringRefundMult[k] =
          (consideringRefundMult[k] * oldConsidering + refundMult * newlyAware) /
          considering[k];
        consideringRepeatMult[k] =
          (consideringRepeatMult[k] * oldConsidering + repeatMult * newlyAware) /
          considering[k];
      }

      for (const x of channelShares) {
        const reached = newlyAware * scaleFactor * x.share;
        const engaged = reached * x.ch.engagementRate;
        const visits = engaged * x.ch.visitRate;
        const checkouts = visits * x.ch.checkoutRate;
        stepEngaged += engaged;
        stepProductVisits += visits;
        stepCheckoutsStarted += checkouts;
        const row = stepChannelFunnel.get(x.ch.id);
        if (row) {
          row.reached += reached;
          row.engaged += engaged;
          row.visits += visits;
          row.checkouts += checkouts;
        }
      }

      const decideRate = clamp(
        buyProb * consideringTrust[k] * decisionSpeed * jitter,
        0,
        1
      );
      const firstBuyers = considering[k] * decideRate;
      const abandon = considering[k] * inputs.abandonRate;
      considering[k] = Math.max(0, considering[k] - firstBuyers - abandon);
      const oldActive = active[k];
      active[k] += firstBuyers;
      if (active[k] > 0 && firstBuyers > 0) {
        activeRepeatMult[k] =
          (activeRepeatMult[k] * oldActive +
            consideringRepeatMult[k] * firstBuyers) /
          active[k];
      }

      const repeatBuyers =
        active[k] * clamp(repeatHazard * activeRepeatMult[k] * jitter, 0, 1);

      const mi = scaleFactor;
      const first = firstBuyers * mi;
      const repeat = repeatBuyers * mi;
      stepNewlyReached += newlyAware * mi;
      stepNewOrders += first;
      stepRepeatOrders += repeat;
      desired.push({
        idx: k,
        first,
        repeat,
        firstFrac: firstBuyers,
        refundMult: consideringRefundMult[k],
        channelShares,
      });
      demand += first + repeat;
      repeatDemand += repeat;
    }

    for (const { ch, spend, impressions } of channelMedia) {
      const row = stepChannelFunnel.get(ch.id);
      byAcquisitionChannel.addFunnel(
        ch,
        impressions,
        row?.reached ?? 0,
        row?.engaged ?? 0,
        row?.visits ?? 0,
        row?.checkouts ?? 0,
        spend
      );
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
      for (const share of d.channelShares) {
        const chOrders = first * share.share;
        if (chOrders > 0) byAcquisitionChannel.addOrders(share.ch, chOrders, chOrders * inputs.salePrice);
      }
      if (repeat > 0) {
        byAcquisitionChannel.addOrders(returningChannel, repeat, repeat * inputs.salePrice);
      }
      const refunds = orders * clamp(refundP * d.refundMult, 0, 0.8);
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
      engaged: count(stepEngaged),
      productVisits: count(stepProductVisits),
      checkoutsStarted: count(stepCheckoutsStarted),
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
  const totalEngaged = sum((s) => s.engaged);
  const totalProductVisits = sum((s) => s.productVisits);
  const totalCheckoutsStarted = sum((s) => s.checkoutsStarted);
  const totalScrolledPast = sum((s) => s.scrolledPast);
  const grossProfit = netRevenue - totalCogs;
  const deadstockUnits = Math.max(0, inventory);
  const deadstockValue = deadstockUnits * inputs.costPrice;
  const summary = {
    totalImpressions: count(sum((s) => s.impressions)),
    totalReached: count(totalReached),
    totalEngaged: count(totalEngaged),
    totalProductVisits: count(totalProductVisits),
    totalCheckoutsStarted: count(totalCheckoutsStarted),
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
    byAcquisitionChannel: byAcquisitionChannel.list(),
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
    assumptions: buildAssumptions(inputs, ctx),
  };
}

function buildDiagnostics(
  inputs: LaunchSimInputs,
  summary: LaunchSimResult["summary"],
  breakdowns: LaunchSimResult["breakdowns"]
): LaunchSimResult["diagnostics"] {
  const topChannel = breakdowns.byChannel[0];
  const topAcquisitionChannel = breakdowns.byAcquisitionChannel[0];
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
      `${fmtCount(summary.totalReached)} people are reached from ${fmtCount(summary.totalImpressions)} impressions, creating ${fmtCount(summary.totalProductVisits)} product visits.`
    );
  }
  if (topAcquisitionChannel && topAcquisitionChannel.orders > 0) {
    drivers.push(
      `${topAcquisitionChannel.name} is the strongest acquisition channel with ${fmtCount(topAcquisitionChannel.orders)} orders at ${fmtMoney(topAcquisitionChannel.cac)} CAC.`
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
  if (summary.totalReached > 0 && summary.totalProductVisits / summary.totalReached < 0.05) {
    risks.push("The launch creates awareness but weak product-visit depth, so the channel mix may be too low-intent.");
    nextMoves.push("Shift budget toward channels with higher visit and checkout rates before increasing total spend.");
  }
  if (summary.totalProductVisits > 0 && summary.totalOrders / summary.totalProductVisits < 0.01) {
    risks.push("Product visits are not turning into enough orders, which points to price, proof, trust, or checkout friction.");
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

function buildAssumptions(
  inputs: LaunchSimInputs,
  ctx: LaunchContext
): LaunchAssumption[] {
  const preset = BUSINESS_PRESETS[inputs.businessModel] ?? BUSINESS_PRESETS.generic;
  const channelLabels = inputs.channels.map((c) => c.label).join(", ");
  const presetChannelIds = preset.defaultChannels.map((c) => c.id).join("|");
  const resolvedChannelIds = inputs.channels.map((c) => c.id).join("|");
  const channelsFromPreset = resolvedChannelIds === presetChannelIds;
  const fromFinancials = ctx.reachableProspectsPerMonth != null && ctx.reachableProspectsPerMonth > 0;
  return [
    {
      key: "businessModel",
      label: "Business model preset",
      value: inputs.businessModel,
      unit: "",
      source: "founder_entered",
      confidence: 0.7,
      basis: "Controls default channel mix, repeat behavior, refund pressure, decision speed, and inventory buffer.",
    },
    {
      key: "channels",
      label: "Acquisition channels",
      value: channelLabels || preset.defaultChannels.map((c) => c.label).join(", "),
      unit: "",
      source: channelsFromPreset ? "preset" : "founder_entered",
      confidence: channelsFromPreset ? 0.45 : 0.65,
      basis: "Each channel has its own spend share, CPM, frequency, engagement, visit, checkout, trust, refund, and repeat assumptions.",
    },
    {
      key: "reachablePool",
      label: "Reachable pool",
      value: inputs.reachablePool ?? 0,
      unit: "people",
      source: fromFinancials ? "financial_model" : "computed",
      confidence: fromFinancials ? 0.6 : 0.35,
      basis: fromFinancials
        ? "Derived from the project's reachable prospects per month."
        : "Fallback ceiling used because the financial model did not provide reachable prospects.",
    },
    {
      key: "blendedCac",
      label: "CAC bound",
      value: ctx.blendedCac ?? 0,
      unit: inputs.currency,
      source: ctx.blendedCac ? "financial_model" : "computed",
      confidence: ctx.blendedCac ? 0.55 : 0.25,
      basis: ctx.blendedCac
        ? "Paid first-time acquisition is capped by ad spend divided by the financial model's blended CAC."
        : "No CAC bound was available, so acquisition is driven by channel funnel assumptions only.",
    },
    {
      key: "repeatRateMult",
      label: "Repeat behavior",
      value: inputs.repeatRateMult,
      unit: "multiplier",
      source: "preset",
      confidence: 0.4,
      basis: "Segment repeat rates are adjusted by the selected business model and the repeat-rate multiplier.",
    },
    {
      key: "refundRateMult",
      label: "Refund pressure",
      value: inputs.refundRateMult,
      unit: "multiplier",
      source: "preset",
      confidence: 0.4,
      basis: "Persona objections, country mismatch, channel risk, and business model preset determine refund propensity.",
    },
  ];
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

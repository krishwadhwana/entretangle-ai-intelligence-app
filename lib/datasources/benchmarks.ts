import type { ClientProfile } from "../schema";
import comtradeImports from "../../data/benchmarks/collected/comtrade-imports.json";
import {
  VERIFIED_GROSS_MARGIN_PCT,
  REPORTED_GROSS_MARGIN_PCT,
  citeRef,
} from "./verified";

// Sourced per-category India import value (USD mn), snapshotted by
// scripts/scrape/ from UN Comtrade. A real market-size / import-served-share
// signal; absent for categories with no clean HS-chapter mapping (e.g. food).
const COMTRADE_IMPORTS = comtradeImports as Record<
  string,
  { usdMn: number; year: string; hsChapter: string; desc: string }
>;

// ---------------------------------------------------------------------------
// Benchmark / priors layer (SPEC-V2 §1A — replace LLM-guessed launch & finance
// rates with empirically-anchored ranges keyed by category × geo-tier).
//
// WHY THIS EXISTS
// The launch sim ([launchSim.ts]) and financials engine ([financials.ts]) do all
// arithmetic deterministically, but every INPUT rate they consume (CPM, CVR,
// CAC, RTO/refund, repeat, COD share, AOV, gross margin, seasonality) is today
// either a universal hardcoded constant (cpm 250, shipping 120, refundMult 1)
// or invented by the LLM in the financials prompt. That is what makes the
// outputs feel generic. This module supplies REAL, source-cited ranges so both
// engines anchor to the market instead of guessing.
//
// PROVENANCE
// The seed numbers are public-report RANGES for the Indian D2C market, each cell
// tagged with its source and an overall confidence. They are deliberately
// coarse (low/mid/high) and meant to be VERIFIED and SWAPPED as better data
// arrives — first-party outcome data, licensed panels (CMIE/Nielsen), or live
// scrapes. Treat every number as a prior, not a fact. All monetary figures are
// in INR (the app's default market); convert with live FX for other currencies.
//
// CONTRACT (mirrors structured.ts): pure, deterministic, never throws, no
// network. Same (category, geo) in → same priors out, so wiring it into the
// deterministic launch sim preserves its rerun-equality guarantee.
// ---------------------------------------------------------------------------

export type CategoryKey =
  | "apparel"
  | "footwear"
  | "beauty"
  | "personal_care"
  | "food_beverage"
  | "furniture"
  | "home_decor"
  | "electronics"
  | "jewellery"
  | "services"
  | "general";

export type GeoTier =
  | "metro"
  | "tier1"
  | "tier2"
  | "tier3"
  | "rural"
  | "international";

export type ChannelKey =
  | "meta"
  | "google_search"
  | "youtube"
  | "marketplace_ads"
  | "influencer";

/** A coarse low/mid/high prior. `mid` is the working point estimate. */
export type Range = { low: number; mid: number; high: number };

// --- Per-category economics (INR; metro baseline) --------------------------
// landingCvrPct = D2C storefront visit→order conversion. returnRatePct =
// blended return/RTO across payment modes. cacInr = blended new-customer CAC.
//
// PROVENANCE: every cell here is a MODEL ESTIMATE — a reasoned prior informed by
// general market knowledge of Indian D2C. None is traced to a saved document, so
// none claims a source (see DATA_PLAN.md §3: CPM/CAC/CVR have no free primary
// source). Verified figures live in verified.ts and OVERRIDE the matching cell
// at resolve time (currently: beauty gross margin ← Honasa DRHP); only those are
// rendered as `sourced`. Do NOT add a citation here without a saved document.
type CategoryBenchmark = {
  grossMarginPct: Range;
  aovInr: Range;
  landingCvrPct: Range;
  repeatRatePct: Range; // annual repeat-purchase rate
  returnRatePct: Range; // blended returns + RTO
  cacInr: Range;
};

const r = (low: number, mid: number, high: number): Range => ({ low, mid, high });

const CATEGORY: Record<CategoryKey, CategoryBenchmark> = {
  apparel: {
    grossMarginPct: r(55, 64, 72),
    aovInr: r(1200, 1800, 2800),
    landingCvrPct: r(1.0, 1.6, 2.4),
    repeatRatePct: r(22, 30, 40),
    returnRatePct: r(20, 30, 40),
    cacInr: r(350, 600, 1100),
  },
  footwear: {
    grossMarginPct: r(50, 60, 68),
    aovInr: r(1500, 2200, 3500),
    landingCvrPct: r(1.0, 1.5, 2.2),
    repeatRatePct: r(18, 26, 35),
    returnRatePct: r(18, 28, 38),
    cacInr: r(400, 700, 1200),
  },
  beauty: {
    grossMarginPct: r(60, 72, 82),
    aovInr: r(600, 1000, 1800),
    landingCvrPct: r(1.5, 2.5, 3.5),
    repeatRatePct: r(35, 48, 60),
    returnRatePct: r(8, 14, 22),
    cacInr: r(250, 450, 900),
  },
  // Personal-care / hygiene ESSENTIALS (menstrual care, intimate hygiene,
  // sanitary, baby/incontinence). Replenished, so high repeat; hygiene products
  // see low returns (often non-returnable) — NOT fashion-apparel economics.
  personal_care: {
    grossMarginPct: r(55, 65, 75),
    aovInr: r(600, 1100, 2000),
    landingCvrPct: r(1.5, 2.5, 3.6),
    repeatRatePct: r(35, 50, 65),
    returnRatePct: r(6, 10, 16),
    cacInr: r(250, 500, 1000),
  },
  food_beverage: {
    grossMarginPct: r(50, 60, 70),
    aovInr: r(700, 1100, 1900),
    landingCvrPct: r(1.8, 2.8, 4.0),
    repeatRatePct: r(40, 55, 70),
    returnRatePct: r(4, 8, 14),
    cacInr: r(200, 400, 800),
  },
  furniture: {
    grossMarginPct: r(40, 50, 58),
    aovInr: r(8000, 18000, 40000),
    landingCvrPct: r(0.5, 1.0, 1.6),
    repeatRatePct: r(8, 15, 25),
    returnRatePct: r(8, 14, 22),
    cacInr: r(800, 1800, 4000),
  },
  home_decor: {
    grossMarginPct: r(50, 60, 70),
    aovInr: r(1200, 2200, 4500),
    landingCvrPct: r(0.9, 1.5, 2.4),
    repeatRatePct: r(20, 30, 42),
    returnRatePct: r(10, 18, 28),
    cacInr: r(400, 800, 1600),
  },
  electronics: {
    grossMarginPct: r(12, 22, 32),
    aovInr: r(2000, 4500, 12000),
    landingCvrPct: r(0.8, 1.4, 2.2),
    repeatRatePct: r(12, 20, 30),
    returnRatePct: r(6, 12, 20),
    cacInr: r(500, 1100, 2500),
  },
  jewellery: {
    grossMarginPct: r(20, 35, 55),
    aovInr: r(2500, 6000, 20000),
    landingCvrPct: r(0.7, 1.2, 2.0),
    repeatRatePct: r(15, 25, 38),
    returnRatePct: r(6, 12, 22),
    cacInr: r(600, 1300, 3000),
  },
  services: {
    grossMarginPct: r(50, 65, 80),
    aovInr: r(1500, 4000, 12000),
    landingCvrPct: r(1.5, 3.0, 5.0),
    repeatRatePct: r(30, 45, 60),
    returnRatePct: r(2, 5, 10),
    cacInr: r(400, 900, 2500),
  },
  general: {
    grossMarginPct: r(45, 58, 70),
    aovInr: r(1000, 2000, 4000),
    landingCvrPct: r(1.0, 1.8, 2.8),
    repeatRatePct: r(20, 30, 42),
    returnRatePct: r(10, 18, 28),
    cacInr: r(400, 800, 1600),
  },
};

// --- Per-geo-tier modifiers (relative to metro baseline = 1.0) -------------
// codSharePct & shippingInr are absolutes; the *Mult fields scale the category
// baselines. Tier-C/D India: cheaper reach, lower CVR/AOV, far higher COD→RTO.
type GeoModifier = {
  cpmMult: number;
  cvrMult: number;
  aovMult: number;
  rtoMult: number; // scales returnRatePct (COD-driven)
  codSharePct: number;
  shippingInr: number;
};

const GEO: Record<GeoTier, GeoModifier> = {
  metro: { cpmMult: 1.0, cvrMult: 1.0, aovMult: 1.0, rtoMult: 0.85, codSharePct: 38, shippingInr: 60 },
  tier1: { cpmMult: 0.8, cvrMult: 0.95, aovMult: 0.85, rtoMult: 1.0, codSharePct: 50, shippingInr: 70 },
  tier2: { cpmMult: 0.6, cvrMult: 0.85, aovMult: 0.7, rtoMult: 1.2, codSharePct: 62, shippingInr: 85 },
  tier3: { cpmMult: 0.45, cvrMult: 0.75, aovMult: 0.6, rtoMult: 1.45, codSharePct: 72, shippingInr: 100 },
  rural: { cpmMult: 0.35, cvrMult: 0.6, aovMult: 0.5, rtoMult: 1.7, codSharePct: 80, shippingInr: 120 },
  international: { cpmMult: 2.5, cvrMult: 1.1, aovMult: 2.2, rtoMult: 0.6, codSharePct: 5, shippingInr: 600 },
};

// --- Channel CPM (INR, metro baseline; geo cpmMult applied at resolve) ------
const CHANNEL_CPM: Record<ChannelKey, Range> = {
  meta: r(120, 200, 320), // Instagram + Facebook feed/reels
  google_search: r(200, 350, 600), // CPM-equivalent of search CPC
  youtube: r(80, 150, 280),
  marketplace_ads: r(180, 300, 500), // Amazon/Flipkart sponsored
  influencer: r(250, 500, 1200), // effective CPM on creator content
};

// --- Seasonality: India demand multiplier by calendar month (1=Jan..12=Dec) -
// Oct–Nov festive (Navratri/Dussehra/Diwali + BBD/GOSF + wedding) is the peak;
// monsoon (Jun) is the trough; EOSS lifts Jan & Jul.
const SEASONALITY: number[] = [
  1.05, 1.0, 0.95, 0.9, 0.85, 0.8, 0.95, 1.0, 1.1, 1.6, 1.7, 1.15,
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// MARKETS: the venture's country dimension. The audience/sim currency already
// follows the planner (cohortPlan.currency), so a US venture runs in USD — but
// the benchmark priors were India-only. "US" carries USD, US-realistic per-
// industry economics (no COD/RTO, BFCM seasonality) and ALSO serves as the
// generic USD/Western baseline for any non-India (cross-border) venture until a
// dedicated per-country table exists. Add more markets by adding a table here.
// All values below are MODEL ESTIMATES (see PROVENANCE note above).
// ---------------------------------------------------------------------------
export type Market = "IN" | "US";

// US D2C per-category economics (USD). aovInr/cacInr field names are retained to
// avoid a codebase-wide rename — the VALUES are in the market's currency.
const US_CATEGORY: Record<CategoryKey, CategoryBenchmark> = {
  apparel: { grossMarginPct: r(50, 60, 68), aovInr: r(55, 85, 140), landingCvrPct: r(1.8, 2.6, 3.6), repeatRatePct: r(25, 38, 52), returnRatePct: r(20, 28, 38), cacInr: r(22, 40, 75) },
  footwear: { grossMarginPct: r(45, 55, 64), aovInr: r(75, 110, 170), landingCvrPct: r(1.5, 2.3, 3.2), repeatRatePct: r(20, 30, 42), returnRatePct: r(18, 26, 36), cacInr: r(28, 50, 90) },
  beauty: { grossMarginPct: r(62, 74, 84), aovInr: r(35, 55, 90), landingCvrPct: r(2.5, 3.6, 5.0), repeatRatePct: r(35, 50, 65), returnRatePct: r(4, 8, 14), cacInr: r(18, 35, 65) },
  personal_care: { grossMarginPct: r(58, 70, 80), aovInr: r(20, 38, 70), landingCvrPct: r(2.2, 3.4, 4.8), repeatRatePct: r(35, 52, 68), returnRatePct: r(5, 9, 15), cacInr: r(15, 32, 60) },
  food_beverage: { grossMarginPct: r(45, 58, 68), aovInr: r(35, 55, 95), landingCvrPct: r(2.5, 3.8, 5.2), repeatRatePct: r(45, 60, 75), returnRatePct: r(2, 4, 8), cacInr: r(18, 35, 65) },
  furniture: { grossMarginPct: r(40, 52, 60), aovInr: r(350, 800, 2000), landingCvrPct: r(0.6, 1.1, 1.8), repeatRatePct: r(8, 16, 26), returnRatePct: r(5, 10, 18), cacInr: r(70, 160, 360) },
  home_decor: { grossMarginPct: r(50, 60, 70), aovInr: r(55, 110, 220), landingCvrPct: r(1.0, 1.7, 2.6), repeatRatePct: r(20, 32, 44), returnRatePct: r(6, 12, 20), cacInr: r(25, 55, 110) },
  electronics: { grossMarginPct: r(15, 25, 35), aovInr: r(90, 220, 600), landingCvrPct: r(1.0, 1.7, 2.6), repeatRatePct: r(12, 20, 30), returnRatePct: r(8, 14, 22), cacInr: r(35, 80, 180) },
  jewellery: { grossMarginPct: r(35, 52, 68), aovInr: r(120, 320, 1100), landingCvrPct: r(0.8, 1.4, 2.2), repeatRatePct: r(15, 26, 38), returnRatePct: r(5, 10, 18), cacInr: r(45, 110, 260) },
  services: { grossMarginPct: r(55, 70, 85), aovInr: r(60, 180, 600), landingCvrPct: r(2.0, 3.5, 5.5), repeatRatePct: r(30, 48, 65), returnRatePct: r(2, 4, 8), cacInr: r(35, 90, 260) },
  general: { grossMarginPct: r(45, 57, 68), aovInr: r(45, 90, 180), landingCvrPct: r(1.6, 2.6, 3.8), repeatRatePct: r(20, 32, 45), returnRatePct: r(6, 12, 20), cacInr: r(25, 55, 110) },
};

// US channel CPMs (USD).
const US_CHANNEL_CPM: Record<ChannelKey, Range> = {
  meta: r(7, 12, 20),
  google_search: r(18, 35, 70),
  youtube: r(6, 11, 20),
  marketplace_ads: r(12, 25, 45),
  influencer: r(15, 35, 80),
};

// US demand: Black-Friday/Cyber-Monday (Nov) + December holidays peak; January
// post-holiday dip; a late-summer back-to-school bump.
const US_SEASONALITY: number[] = [
  0.9, 0.88, 0.92, 0.95, 1.0, 0.95, 0.95, 1.05, 1.0, 1.05, 1.55, 1.45,
];
const US_SHIPPING_USD = 8;

// ---------------------------------------------------------------------------
// Resolved priors for one (category × geo-tiers) lookup.
// ---------------------------------------------------------------------------
export type BenchmarkPriors = {
  category: CategoryKey;
  market: Market;
  geoTiers: GeoTier[];
  // ISO-ish currency code; all monetary fields below are in this currency
  // (field names keep the legacy `Inr`/`Usd` suffix to avoid a wide rename).
  currency: string;
  grossMarginPct: Range;
  /** sourced = saved filing+page+quote; reported = company primary disclosure; estimate = model prior. */
  grossMarginProvenance: "sourced" | "reported" | "estimate";
  aovInr: Range;
  landingCvrPct: Range;
  repeatRatePct: Range;
  returnRatePct: Range;
  cacInr: Range;
  cpmByChannelInr: Record<ChannelKey, Range>;
  /** Headline blended CPM (meta) after geo adjustment — the launch-sim default. */
  cpmInr: Range;
  codSharePct: number;
  shippingPerOrderInr: number;
  seasonality: number[]; // 12 monthly multipliers
  peakMonths: string[];
  /** Sourced India import value for the category (USD mn, UN Comtrade), if mapped. */
  marketImportsUsdMn: { value: number; year: string; desc: string } | null;
  confidence: number; // 0–1
  sources: string[];
  notes: string[];
};

function scaleRange(range: Range, mult: number): Range {
  return {
    low: Math.round(range.low * mult),
    mid: Math.round(range.mid * mult),
    high: Math.round(range.high * mult),
  };
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

/**
 * Resolve benchmark priors for a category across one or more geo tiers. When
 * several tiers are given (a multi-city run), their modifiers are averaged so
 * the priors reflect the run's actual geographic spread.
 */
export function resolveBenchmarks(
  category: CategoryKey,
  geoTiers: GeoTier[],
  market: Market = "IN"
): BenchmarkPriors {
  const isUS = market === "US";
  const table = isUS ? US_CATEGORY : CATEGORY;
  const channelTable = isUS ? US_CHANNEL_CPM : CHANNEL_CPM;
  const cat = table[category] ?? table.general;
  const tiers = geoTiers.length ? Array.from(new Set(geoTiers)) : ["tier2" as GeoTier];
  // India scales the metro baseline by city-tier modifiers; the US table is
  // already a national baseline (no COD/RTO), so it isn't geo-scaled here.
  const mods = isUS ? [] : tiers.map((t) => GEO[t] ?? GEO.tier2);

  const cpmMult = isUS ? 1 : avg(mods.map((m) => m.cpmMult));
  const cvrMult = isUS ? 1 : avg(mods.map((m) => m.cvrMult));
  const aovMult = isUS ? 1 : avg(mods.map((m) => m.aovMult));
  const rtoMult = isUS ? 1 : avg(mods.map((m) => m.rtoMult));
  const codSharePct = isUS ? 0 : Math.round(avg(mods.map((m) => m.codSharePct)));
  const shippingPerOrderInr = isUS
    ? US_SHIPPING_USD
    : Math.round(avg(mods.map((m) => m.shippingInr)));

  const cpmByChannelInr = Object.fromEntries(
    (Object.keys(channelTable) as ChannelKey[]).map((k) => [
      k,
      scaleRange(channelTable[k], cpmMult),
    ])
  ) as Record<ChannelKey, Range>;

  const hasInternational = !isUS && tiers.includes("international");

  // Gross margin provenance ladder: a SOURCED figure (saved filing + quote)
  // wins; else a REPORTED figure; else the category estimate. The verified
  // figures + Comtrade imports are INDIA-specific, so US uses the estimate.
  const vgm = isUS ? undefined : VERIFIED_GROSS_MARGIN_PCT[category];
  const rgm = isUS ? undefined : REPORTED_GROSS_MARGIN_PCT[category];
  const gm = vgm ?? rgm;
  const grossMarginPct = gm
    ? { low: gm.low, mid: gm.mid, high: gm.high }
    : cat.grossMarginPct;
  const grossMarginProvenance: "sourced" | "reported" | "estimate" = vgm
    ? "sourced"
    : rgm
      ? "reported"
      : "estimate";

  const imports = isUS ? undefined : COMTRADE_IMPORTS[category];
  const marketImportsUsdMn = imports
    ? { value: imports.usdMn, year: imports.year, desc: imports.desc }
    : null;

  // Sources list = ONLY verified provenance actually used (no agency
  // placeholders). The rate priors below are model estimates, never attributed.
  const sources = [
    ...(gm ? [citeRef(gm.ref)] : []),
    ...(imports
      ? [`UN Comtrade — India imports HS ${imports.hsChapter} (${imports.year})`]
      : []),
  ];

  const currency = isUS ? "USD" : "INR";
  const seasonality = isUS ? US_SEASONALITY : SEASONALITY;
  const notes: string[] = [
    "Rate priors (CPM, CAC, CVR, AOV, returns, repeat) are MODEL ESTIMATES — no free primary source (DATA_PLAN §3); treat as ranges, not facts.",
    `All monetary figures are ${currency}; convert with live FX for other currencies.`,
  ];
  if (isUS)
    notes.push(
      "US market: prepaid (no COD/RTO); returns are category-driven (apparel/footwear highest). Also used as the USD/Western baseline for non-India ventures until a per-country table exists — refine with a web-search enrichment for the specific market."
    );
  if (!sources.length)
    notes.push("No verified source for this category yet — every figure here is an estimate.");
  if (hasInternational)
    notes.push(
      "International tier present: India-baseline figures only roughly approximate export economics — lower confidence."
    );

  // Confidence: estimate-grade by default; a verified gross margin nudges it up.
  // Degrade for broad/unknown geo spreads and for international.
  let confidence = 0.5;
  if (grossMarginProvenance === "sourced") confidence += 0.05;
  else if (grossMarginProvenance === "reported") confidence += 0.03;
  if (tiers.length > 3) confidence -= 0.1;
  if (hasInternational) confidence -= 0.15;
  confidence = Math.max(0.25, Math.min(0.7, confidence));

  return {
    category,
    market,
    geoTiers: tiers,
    currency,
    grossMarginPct,
    grossMarginProvenance,
    aovInr: scaleRange(cat.aovInr, aovMult),
    landingCvrPct: scaleRange(cat.landingCvrPct, cvrMult),
    repeatRatePct: cat.repeatRatePct,
    returnRatePct: scaleRange(cat.returnRatePct, rtoMult),
    cacInr: scaleRange(cat.cacInr, cpmMult), // CAC tracks CPM by geo
    cpmByChannelInr,
    cpmInr: cpmByChannelInr.meta,
    codSharePct,
    shippingPerOrderInr,
    seasonality,
    peakMonths: seasonality
      .map((m, i) => ({ m, i }))
      .filter((x) => x.m >= 1.3)
      .map((x) => MONTHS[x.i]),
    marketImportsUsdMn,
    confidence,
    sources,
    notes,
  };
}

// --- Market detection from a venture's countries / geography ----------------
const INDIA_RE = /\bindia\b/i;

/** Pick a market from a set of country strings. Non-India → US (USD baseline). */
export function marketFromCountries(
  countries: (string | null | undefined)[]
): Market {
  let india = 0;
  let other = 0;
  for (const c of countries) {
    const s = (c ?? "").trim();
    if (!s) continue;
    if (INDIA_RE.test(s)) india++;
    else other++;
  }
  if (other > india) return "US";
  if (india > 0) return "IN";
  return "IN";
}

// Geography is free text that may be cities, not countries — so require an
// EXPLICIT non-India country signal to switch to the US/USD baseline; otherwise
// default to the home market (India). (The launch sim routes off persona.country
// via marketFromCountries, which is reliable; this guards research grounding +
// market-data sourcing from a bare city name misrouting the market.)
const NON_INDIA_MARKET_RE =
  /\b(united states|u\.?s\.?a?|america|united kingdom|u\.?k\.?|canada|australia|uae|emirates|singapore|europe|european|germany|france|usd|gbp|eur)\b/i;

export function marketFromGeography(geography?: string[] | null): Market {
  const g = (geography ?? []).join(" ");
  if (!g.trim()) return "IN";
  if (INDIA_RE.test(g)) return "IN";
  if (NON_INDIA_MARKET_RE.test(g)) return "US";
  return "IN";
}

// ---------------------------------------------------------------------------
// Mapping helpers: turn a venture profile / place names into the lookup keys.
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: [CategoryKey, RegExp][] = [
  ["footwear", /\b(footwear|shoe|shoes|sneaker|sandal|sandals|heels|loafer)\b/i],
  ["jewellery", /\b(jewellery|jewelry|jewel|gold|silver|diamond|earring|necklace|kundan|polki)\b/i],
  // Hygiene/menstrual essentials FIRST — "period pants/underwear" must not fall
  // through to the apparel regex (it matches "pants"/"wear") and inherit fashion
  // return rates. These are high-repeat, low-return replenishment products.
  ["personal_care", /\b(menstrual|period\s*(care|pant|pants|panty|panties|underwear|wear)|sanitary\s*(pad|pads|napkin|napkins)|tampon|tampons|intimate\s*(care|hygiene|wash)|feminine\s*(care|hygiene)|incontinence|diaper|diapers|nappy|nappies)\b/i],
  ["beauty", /\b(beauty|cosmetic|skincare|skin care|makeup|make-up|fragrance|perfume|haircare|grooming|personal care)\b/i],
  ["food_beverage", /\b(food|beverage|drink|snack|supplement|nutrition|protein|coffee|tea|grocery|gourmet|confection|bakery|wellness|nutraceutical)\b/i],
  ["furniture", /\b(furniture|sofa|chair|table|bed|mattress|wardrobe|cabinet|desk|recliner)\b/i],
  ["home_decor", /\b(home decor|home décor|decor|décor|furnishing|cushion|rug|carpet|curtain|lamp|tableware|crockery|planter|candle)\b/i],
  ["electronics", /\b(electronic|electronics|gadget|device|appliance|wearable|headphone|earbud|smart\s?\w+|charger|speaker)\b/i],
  ["apparel", /\b(apparel|fashion|clothing|clothes|garment|wear|shirt|t-?shirt|trouser|pant|pants|jeans|denim|dress|jacket|coat|suit|saree|kurta|ethnicwear|streetwear|lingerie|activewear|innerwear)\b/i],
  ["services", /\b(service|services|agency|consult|consulting|clinic|salon|studio|course|training|subscription|saas|software|platform|app)\b/i],
];

/** Best-effort category key from a venture profile (category + product text). */
export function categoryKeyFromProfile(profile: ClientProfile): CategoryKey {
  const text = [profile.category, profile.product, profile.targetAudience]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [key, re] of CATEGORY_KEYWORDS) if (re.test(text)) return key;
  return "general";
}

/** Map the launch-sim business model to a category key. */
export function categoryKeyFromBusinessModel(model: string): CategoryKey {
  switch (model) {
    case "apparel":
      return "apparel";
    case "furniture":
      return "furniture";
    case "consumable":
      return "food_beverage";
    case "saas":
    case "services":
      return "services";
    default:
      return "general";
  }
}

// Indian settlement hierarchy (lowercased). Anything in India not listed falls
// back to tier2 (a conservative middle); non-India places are "international".
const METROS = new Set([
  "mumbai", "delhi", "new delhi", "bengaluru", "bangalore", "hyderabad",
  "chennai", "kolkata", "pune", "ahmedabad",
]);
const TIER1 = new Set([
  "jaipur", "surat", "lucknow", "kanpur", "nagpur", "indore", "thane",
  "bhopal", "visakhapatnam", "vizag", "patna", "vadodara", "ghaziabad",
  "ludhiana", "agra", "nashik", "chandigarh", "coimbatore", "kochi", "cochin",
  "gurugram", "gurgaon", "noida", "faridabad",
]);
const TIER2 = new Set([
  "guwahati", "mysore", "mysuru", "madurai", "rajkot", "jodhpur", "raipur",
  "ranchi", "amritsar", "varanasi", "allahabad", "prayagraj", "jabalpur",
  "gwalior", "vijayawada", "trivandrum", "thiruvananthapuram", "tiruchirappalli",
  "trichy", "salem", "warangal", "dehradun", "jamshedpur", "bhubaneswar",
  "aurangabad", "kota", "udaipur", "siliguri", "bareilly", "moradabad",
]);

const INDIA_NAMES = new Set(["india", "in", "bharat"]);

/** Best-effort geo tier from a place name + country. */
export function geoTierFromPlace(name: string, country?: string): GeoTier {
  const c = (country ?? "").trim().toLowerCase();
  if (c && !INDIA_NAMES.has(c)) return "international";
  const n = (name ?? "").trim().toLowerCase();
  if (METROS.has(n)) return "metro";
  if (TIER1.has(n)) return "tier1";
  if (TIER2.has(n)) return "tier2";
  // Unknown Indian place: treat as tier3 long-tail when clearly a small town,
  // else tier2. Without more signal, tier2 is the safer central estimate.
  return "tier2";
}

/** Resolve the distinct geo tiers present across a set of localities. */
export function geoTiersFromLocalities(
  localities: { name: string; country?: string }[]
): GeoTier[] {
  const tiers = localities.map((l) => geoTierFromPlace(l.name, l.country));
  return tiers.length ? Array.from(new Set(tiers)) : ["tier2"];
}

/** Geo tiers from a profile's free-text geography list (best-effort). */
export function geoTiersFromGeography(geography?: string[] | null): GeoTier[] {
  if (!geography?.length) return ["tier2"];
  const tiers = geography.map((g) => {
    const lower = g.toLowerCase();
    // Broad "pan-India / nationwide" → span the hierarchy.
    if (/pan.?india|nationwide|all of india|across india|tier.?[23]|small town|rural/.test(lower))
      return null; // handled below as a spread
    // Non-India market names → international.
    if (/uae|dubai|usa|united states|uk|united kingdom|singapore|canada|australia|europe|gulf|export/.test(lower))
      return "international" as GeoTier;
    return geoTierFromPlace(g);
  });
  const concrete = tiers.filter((t): t is GeoTier => t != null);
  const broad = tiers.length !== concrete.length;
  const out = broad
    ? Array.from(new Set([...concrete, "metro", "tier2", "tier3"] as GeoTier[]))
    : Array.from(new Set(concrete));
  return out.length ? out : ["tier2"];
}

// ---------------------------------------------------------------------------
// Prompt rendering — a labeled ground-truth block (mirrors formatStructured).
// ---------------------------------------------------------------------------
function rng(x: Range): string {
  return `${x.low}–${x.high} (≈${x.mid})`;
}

export function formatBenchmarks(p: BenchmarkPriors): string {
  const gm = `[${p.grossMarginProvenance}]`;
  const cur = p.currency;
  const isUS = p.market === "US";
  const marketLabel = isUS ? "US D2C" : "Indian D2C";
  const seasonNote = isUS
    ? "Nov BFCM + Dec holidays peak, Jan trough"
    : "Oct–Nov festive, Jun monsoon trough";
  const returnsLine = isUS
    ? `- Returns % (blended): ${rng(p.returnRatePct)} (prepaid; no COD/RTO) [estimate]`
    : `- Returns + RTO % (blended): ${rng(p.returnRatePct)} | COD share ~${p.codSharePct}% [estimate]`;
  return `BENCHMARK PRIORS for ${marketLabel} (${cur}). Each line is tagged [sourced]
(saved document + page + quote), [reported] (a company's own primary disclosure,
corroborated but not transcribed), or [estimate] (model prior, no public source —
DATA_PLAN §3). Anchor your assumptions to these unless the research conclusions
give better, more specific numbers; do not output figures wildly outside an
[estimate] range without saying why, and do not treat [estimate] as fact:
Category: ${p.category} | Market: ${p.market} | Geo tiers: ${p.geoTiers.join(", ")} | confidence ${(p.confidence * 100).toFixed(0)}%
- Gross margin %: ${rng(p.grossMarginPct)} ${gm}
- AOV (${cur}): ${rng(p.aovInr)} [estimate]
- Landing→order CVR %: ${rng(p.landingCvrPct)} [estimate]
- Annual repeat-purchase %: ${rng(p.repeatRatePct)} [estimate]
${returnsLine}
- Blended new-customer CAC (${cur}): ${rng(p.cacInr)} [estimate]
- CPM by channel (${cur}): Meta ${rng(p.cpmByChannelInr.meta)}, Search ${rng(p.cpmByChannelInr.google_search)}, YouTube ${rng(p.cpmByChannelInr.youtube)}, Marketplace ${rng(p.cpmByChannelInr.marketplace_ads)}, Influencer ${rng(p.cpmByChannelInr.influencer)} [estimate]
- Shipping per order (${cur}): ~${p.shippingPerOrderInr} [estimate]${
    p.marketImportsUsdMn
      ? `\n- India category imports: ≈ US$${p.marketImportsUsdMn.value}M/yr (${p.marketImportsUsdMn.desc}) — demand + import-served-share signal [sourced]`
      : ""
  }
- Seasonality peak months: ${p.peakMonths.join(", ") || "n/a"} (${seasonNote}) [estimate]
Sources (sourced/reported only): ${p.sources.length ? p.sources.join("; ") : "none yet for this category — all figures are estimates"}
Notes: ${p.notes.join(" ")}
END BENCHMARK PRIORS.`;
}

/** Convenience: priors + formatted block straight from a venture profile. */
export function benchmarksForProfile(profile: ClientProfile): {
  priors: BenchmarkPriors;
  block: string;
} {
  const category = categoryKeyFromProfile(profile);
  const geoTiers = geoTiersFromGeography(profile.geography);
  const market = marketFromGeography(profile.geography);
  const priors = resolveBenchmarks(category, geoTiers, market);
  return { priors, block: formatBenchmarks(priors) };
}

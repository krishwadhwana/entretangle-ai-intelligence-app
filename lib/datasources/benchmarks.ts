import type { ClientProfile } from "../schema";
import comtradeImports from "../../data/benchmarks/collected/comtrade-imports.json";
import { VERIFIED_GROSS_MARGIN_PCT, citeRef } from "./verified";

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
// Resolved priors for one (category × geo-tiers) lookup.
// ---------------------------------------------------------------------------
export type BenchmarkPriors = {
  category: CategoryKey;
  geoTiers: GeoTier[];
  currency: "INR";
  grossMarginPct: Range;
  /** True when grossMarginPct came from a verified saved filing (verified.ts). */
  grossMarginSourced: boolean;
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
  geoTiers: GeoTier[]
): BenchmarkPriors {
  const cat = CATEGORY[category] ?? CATEGORY.general;
  const tiers = geoTiers.length ? Array.from(new Set(geoTiers)) : ["tier2" as GeoTier];
  const mods = tiers.map((t) => GEO[t] ?? GEO.tier2);

  const cpmMult = avg(mods.map((m) => m.cpmMult));
  const cvrMult = avg(mods.map((m) => m.cvrMult));
  const aovMult = avg(mods.map((m) => m.aovMult));
  const rtoMult = avg(mods.map((m) => m.rtoMult));
  const codSharePct = Math.round(avg(mods.map((m) => m.codSharePct)));
  const shippingPerOrderInr = Math.round(avg(mods.map((m) => m.shippingInr)));

  const cpmByChannelInr = Object.fromEntries(
    (Object.keys(CHANNEL_CPM) as ChannelKey[]).map((k) => [
      k,
      scaleRange(CHANNEL_CPM[k], cpmMult),
    ])
  ) as Record<ChannelKey, Range>;

  const hasInternational = tiers.includes("international");

  // Verified override: use a SOURCED gross margin where verified.ts has one
  // (traced to a saved filing); otherwise the category estimate. This is the
  // only metric here that can currently be `sourced`.
  const vgm = VERIFIED_GROSS_MARGIN_PCT[category];
  const grossMarginPct = vgm
    ? { low: vgm.low, mid: vgm.mid, high: vgm.high }
    : cat.grossMarginPct;
  const grossMarginSourced = !!vgm;

  const imports = COMTRADE_IMPORTS[category];
  const marketImportsUsdMn = imports
    ? { value: imports.usdMn, year: imports.year, desc: imports.desc }
    : null;

  // Sources list = ONLY verified provenance actually used (no agency
  // placeholders). The rate priors below are model estimates, never attributed.
  const sources = [
    ...(vgm ? [citeRef(vgm.ref)] : []),
    ...(imports
      ? [`UN Comtrade — India imports HS ${imports.hsChapter} (${imports.year})`]
      : []),
  ];

  const notes: string[] = [
    "Rate priors (CPM, CAC, CVR, AOV, returns/RTO, repeat) are MODEL ESTIMATES — no free primary source (DATA_PLAN §3); treat as ranges, not facts.",
    "All monetary figures are INR; convert with live FX for other currencies.",
  ];
  if (!sources.length)
    notes.push("No verified source for this category yet — every figure here is an estimate.");
  if (hasInternational)
    notes.push(
      "International tier present: India-baseline figures only roughly approximate export economics — lower confidence."
    );

  // Confidence: estimate-grade by default; a verified gross margin nudges it up.
  // Degrade for broad/unknown geo spreads and for international.
  let confidence = 0.5;
  if (grossMarginSourced) confidence += 0.05;
  if (tiers.length > 3) confidence -= 0.1;
  if (hasInternational) confidence -= 0.15;
  confidence = Math.max(0.25, Math.min(0.7, confidence));

  return {
    category,
    geoTiers: tiers,
    currency: "INR",
    grossMarginPct,
    grossMarginSourced,
    aovInr: scaleRange(cat.aovInr, aovMult),
    landingCvrPct: scaleRange(cat.landingCvrPct, cvrMult),
    repeatRatePct: cat.repeatRatePct,
    returnRatePct: scaleRange(cat.returnRatePct, rtoMult),
    cacInr: scaleRange(cat.cacInr, cpmMult), // CAC tracks CPM by geo
    cpmByChannelInr,
    cpmInr: cpmByChannelInr.meta,
    codSharePct,
    shippingPerOrderInr,
    seasonality: SEASONALITY,
    peakMonths: SEASONALITY.map((m, i) => ({ m, i }))
      .filter((x) => x.m >= 1.3)
      .map((x) => MONTHS[x.i]),
    marketImportsUsdMn,
    confidence,
    sources,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers: turn a venture profile / place names into the lookup keys.
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: [CategoryKey, RegExp][] = [
  ["footwear", /\b(footwear|shoe|shoes|sneaker|sandal|sandals|heels|loafer)\b/i],
  ["jewellery", /\b(jewellery|jewelry|jewel|gold|silver|diamond|earring|necklace|kundan|polki)\b/i],
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
  const gm = p.grossMarginSourced ? "[sourced]" : "[estimate]";
  return `BENCHMARK PRIORS for Indian D2C (INR). Each line is tagged [sourced]
(traced to a saved document) or [estimate] (model prior, no public source —
DATA_PLAN §3). Anchor your assumptions to these unless the research conclusions
give better, more specific numbers; do not output figures wildly outside an
[estimate] range without saying why, and do not treat [estimate] as fact:
Category: ${p.category} | Geo tiers: ${p.geoTiers.join(", ")} | confidence ${(p.confidence * 100).toFixed(0)}%
- Gross margin %: ${rng(p.grossMarginPct)} ${gm}
- AOV (INR): ${rng(p.aovInr)} [estimate]
- Landing→order CVR %: ${rng(p.landingCvrPct)} [estimate]
- Annual repeat-purchase %: ${rng(p.repeatRatePct)} [estimate]
- Returns + RTO % (blended): ${rng(p.returnRatePct)} | COD share ~${p.codSharePct}% [estimate]
- Blended new-customer CAC (INR): ${rng(p.cacInr)} [estimate]
- CPM by channel (INR): Meta ${rng(p.cpmByChannelInr.meta)}, Search ${rng(p.cpmByChannelInr.google_search)}, YouTube ${rng(p.cpmByChannelInr.youtube)}, Marketplace ${rng(p.cpmByChannelInr.marketplace_ads)}, Influencer ${rng(p.cpmByChannelInr.influencer)} [estimate]
- Shipping per order (INR): ~${p.shippingPerOrderInr} [estimate]${
    p.marketImportsUsdMn
      ? `\n- India category imports: ≈ US$${p.marketImportsUsdMn.value}M/yr (${p.marketImportsUsdMn.desc}) — demand + import-served-share signal [sourced]`
      : ""
  }
- Seasonality peak months: ${p.peakMonths.join(", ") || "n/a"} (Oct–Nov festive, Jun monsoon trough) [estimate]
Sources (verified only): ${p.sources.length ? p.sources.join("; ") : "none yet for this category — all figures are estimates"}
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
  const priors = resolveBenchmarks(category, geoTiers);
  return { priors, block: formatBenchmarks(priors) };
}

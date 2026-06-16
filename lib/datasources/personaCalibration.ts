import type { BenchmarkPriors, CategoryKey, Range } from "./benchmarks";

// ---------------------------------------------------------------------------
// Persona calibration — turn the benchmark priors layer into a ground-truth
// block for cohortSimSystem, so synthetic personas anchor their distribution to
// real category × geo numbers instead of model guesses. This is the personas
// counterpart to how callFinancialInputs and the launch-sim route already
// consume benchmarks. Numeric anchors (order value, returns) come from the
// sourced/estimate benchmark ranges; the qualitative objection/discovery hints
// below are category priors flagged ESTIMATE (voice-of-customer data would
// replace them — see DATA_PLAN.md item 3).
// ---------------------------------------------------------------------------

// Qualitative per-category context (ESTIMATE — no public number behind it).
const QUALITATIVE: Record<CategoryKey, { objections: string; discovery: string }> = {
  apparel: {
    objections: "size/fit uncertainty; fabric quality vs photos; delivery time; return hassle",
    discovery: "Instagram reels/UGC for discovery; marketplace search for intent",
  },
  footwear: {
    objections: "size/fit uncertainty; comfort over time; durability/sole quality; return hassle",
    discovery: "Instagram for discovery; marketplace search + brand stores for intent",
  },
  beauty: {
    objections: "skin/hair suitability; authenticity (fear of fakes); will it actually work; ingredient/safety",
    discovery: "Instagram + YouTube tutorials/reviews for discovery; Nykaa + marketplace for intent",
  },
  food_beverage: {
    objections: "freshness/shelf-life; taste vs expectation; price vs local alternative; trust in ingredients",
    discovery: "Instagram/food creators for discovery; quick-commerce + kirana for repeat",
  },
  furniture: {
    objections: "damage in transit; can't see/touch before buying; assembly hassle; long delivery time",
    discovery: "Google/Pinterest/Instagram for inspiration; long research before purchase",
  },
  home_decor: {
    objections: "quality vs photos; fragile-item damage; whether it fits existing decor",
    discovery: "Instagram/Pinterest inspiration; marketplace for purchase",
  },
  electronics: {
    objections: "authenticity/warranty; spec confusion; price vs marketplace deals",
    discovery: "YouTube reviews + marketplace search; spec comparison",
  },
  jewellery: {
    objections: "authenticity/hallmark trust; making charges; can't try on; resale value",
    discovery: "Instagram for discovery; in-store/marketplace cross-check before buying",
  },
  services: {
    objections: "trust/credibility; outcome uncertainty; price vs alternatives; commitment",
    discovery: "Google search + referrals; Instagram for proof/social validation",
  },
  general: {
    objections: "price vs alternatives; quality uncertainty; trust in a new brand; delivery/returns",
    discovery: "Instagram + marketplace search; word of mouth",
  },
};

// Per-segment scaling of the category order-value range into a price anchor.
function segmentOrderValue(aov: Range, segment: string): number {
  switch (segment) {
    case "budget":
      return aov.low;
    case "affluent":
      return aov.high;
    case "luxury":
      return Math.round(aov.high * 1.8);
    case "middle":
    default:
      return aov.mid;
  }
}

/**
 * A labelled CALIBRATION block for cohortSimSystem, built from resolved
 * benchmark priors + a cohort's income segment. Empty string when no priors
 * (caller then renders nothing — behaviour unchanged without benchmarks).
 */
export function cohortCalibrationBlock(
  priors: BenchmarkPriors,
  segment: string
): string {
  const q = QUALITATIVE[priors.category] ?? QUALITATIVE.general;
  const orderValue = segmentOrderValue(priors.aovInr, segment);
  return `INDUSTRY CALIBRATION (benchmark priors for ${priors.category} × ${priors.geoTiers.join(
    ", "
  )}, INR, confidence ${(priors.confidence * 100).toFixed(0)}% — anchor the
cohort's DISTRIBUTION to these; individuals still vary, do NOT collapse everyone onto them):
- Typical order value for the ${segment} segment: ≈ ₹${orderValue}. Center this cohort's "wtp" spread near this, not on a generic guess.
- Category returns/RTO rate: ${priors.returnRatePct.low}–${priors.returnRatePct.high}% (≈${priors.returnRatePct.mid}%) — reflect this level of post-purchase friction/hesitation.
- Real purchase objections (category prior, ESTIMATE): ${q.objections}. Draw each persona's "objection" from these where it fits, in their own words.
- Discovery behaviour (ESTIMATE): ${q.discovery}. Bias "channelPref"/"platforms" toward this.
Sources: ${priors.sources.join("; ")}.`;
}

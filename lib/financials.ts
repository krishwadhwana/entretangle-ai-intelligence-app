// ---------------------------------------------------------------------------
// computeFinancials — the deterministic heart of the Financials module.
//
// Philosophy (mirrors the orchestrator): the LLM/founder supply *assumptions*
// (FinancialInputs); this module does ALL arithmetic. No model call here, so
// every figure is auditable and recomputes the instant a founder overrides an
// input cell.
//
// The economic decomposition that makes this honest:
//   • the simulated personas give the demand SHAPE — what fraction of prospects
//     buy at each price (conversion curve from wtp × intent);
//   • market sizing gives the absolute SCALE — how many prospects we can reach;
//   • units = reach × conversion(price). Revenue/margin/break-even follow.
// Reconciling this bottom-up number against the top-down SOM is the hero insight.
// ---------------------------------------------------------------------------

import type {
  AudienceAggregate,
  FinancialInputs,
  FinancialModel,
  FinNum,
  FinPriceTier,
  FinSource,
  Segment,
} from "./schema";

// The minimum we need from a simulated buyer to build the conversion curve.
// Pulled from Persona rows (wtp, intent, cohort.segment).
export type PersonaPoint = {
  wtp: number;
  intent: number;
  segment?: Segment | null;
};

export type DemandSource = {
  personas?: PersonaPoint[]; // richest: full conversion curve
  aggregate?: AudienceAggregate | null; // fallback: per-segment P50 + meanIntent
};

export type CapitalInput = {
  capitalAvailable: number;
  source?: FinSource;
  basis?: string;
};

// --- provenance helpers ----------------------------------------------------

function num(
  value: number,
  unit: string,
  opts: Partial<Omit<FinNum, "value" | "unit">> = {}
): FinNum {
  return {
    value: round(value),
    unit,
    source: opts.source ?? "ai_estimated",
    confidence: opts.confidence ?? 0.5,
    basis: opts.basis ?? "",
    sourceConclusionIds: opts.sourceConclusionIds ?? [],
  };
}

const computed = (
  value: number,
  unit: string,
  basis: string,
  confidence = 0.6
): FinNum => num(value, unit, { source: "computed", basis, confidence });

function round(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  // Keep cents for small numbers, whole units for money figures.
  const dp = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return Number(n.toFixed(dp));
}

// --- conversion curve from the simulated audience --------------------------

function cleanPersonaPoints(demand: DemandSource): PersonaPoint[] {
  return (demand.personas ?? []).filter(
    (p) =>
      Number.isFinite(p.wtp) &&
      p.wtp > 0 &&
      Number.isFinite(p.intent) &&
      p.intent > 0
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// A deterministic soft affordability curve around the group's median WTP. This
// keeps sparse or cliff-edge samples from turning a plausible launch into
// exactly zero orders simply because every sampled WTP landed just below price.
function softAffordability(price: number, wtpP50: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(wtpP50) || wtpP50 <= 0) return 0;
  const slope = Math.max(wtpP50 * 0.35, 1);
  return clamp01(1 / (1 + Math.exp((price - wtpP50) / slope)));
}

function aggregateConversionAtPrice(p: number, demand: DemandSource): number {
  const agg = demand.aggregate;
  if (!agg || agg.totalPersonas <= 0) return 0;
  let weighted = 0;
  let n = 0;
  for (const seg of Object.values(agg.bySegment)) {
    if (!Number.isFinite(seg.n) || seg.n <= 0) continue;
    weighted += seg.n * clamp01(seg.meanIntent) * softAffordability(p, seg.wtpP50);
    n += seg.n;
  }
  return n > 0 ? clamp01(weighted / n) : 0;
}

// Expected buyers per prospect at retail price `p`: the mean over simulated
// personas of (purchase intent × can-afford-it). Returns a rate in [0, 1].
function conversionAtPrice(p: number, demand: DemandSource): number {
  const ps = cleanPersonaPoints(demand);
  if (ps.length > 0) {
    let acc = 0;
    for (const x of ps) acc += clamp01(x.intent) * (x.wtp >= p ? 1 : 0);
    const exact = acc / ps.length;
    if (exact > 0) return clamp01(exact);
  }
  // Fallback: per-segment P50 wtp + meanIntent. This also smooths the exact
  // persona curve when the sample produces an all-or-nothing cliff.
  const fromAggregate = aggregateConversionAtPrice(p, demand);
  if (fromAggregate > 0) return fromAggregate;
  return 0;
}

// --- the compute -----------------------------------------------------------

// Keys a founder can override in the UI (each maps to one input FinNum). When
// passed in meta.editedKeys, the matching figure is re-tagged founder_entered.
//   "capital" | "fixedCostsPerMonth" | "moqCashRequired"
//   | "reachableProspectsPerMonth" | `cost:<index>:amount`
//   | `tier:<label>:price`
export function computeFinancials(
  inputs: FinancialInputs,
  demand: DemandSource,
  capital: CapitalInput,
  meta: {
    generatedAt?: string | null;
    sourceRunId?: string | null;
    editedKeys?: string[];
  } = {}
): FinancialModel {
  const cur = inputs.currency;
  const perUnit = `${cur}/unit`;

  // Cost build-up → default landed cost when a tier doesn't override it.
  const costStructure = inputs.costStructure.map((c) => ({
    label: c.label,
    amount: num(c.amount, perUnit, {
      source: "ai_estimated",
      basis: c.note,
      sourceConclusionIds: c.sourceConclusionIds,
    }),
    note: c.note,
  }));
  const cogsSum = inputs.costStructure.reduce((s, c) => s + c.amount, 0);

  // Price tiers: contribution, margin, and persona-driven demand at each price.
  const tiers: FinPriceTier[] = inputs.priceTiers.map((t) => {
    const landed = t.landedCogs ?? cogsSum;
    const contribution = t.price - landed;
    const marginPct = t.price > 0 ? (contribution / t.price) * 100 : 0;
    // Demand = anyone in the audience who can afford the price and intends to
    // buy. `segment` is a positioning label, NOT a demand filter — a 120k table
    // is bought by whoever's wtp clears 120k, not only the "middle" segment.
    const conv = conversionAtPrice(t.price, demand);
    const units = inputs.reachableProspectsPerMonth * conv;
    const revenue = units * t.price;
    const grossProfit = units * contribution;
    return {
      label: t.label,
      segment: t.segment ?? null,
      price: num(t.price, perUnit, { source: "ai_estimated" }),
      landedCogs: num(landed, perUnit, {
        source: t.landedCogs != null ? "ai_estimated" : "computed",
        basis: t.landedCogs != null ? "" : "sum of cost structure",
      }),
      contributionPerUnit: computed(contribution, perUnit, "price − landed COGS"),
      grossMarginPct: computed(marginPct, "%", "contribution ÷ price"),
      estUnitsPerMonth: computed(
        units,
        "units/mo",
        `reach ${inputs.reachableProspectsPerMonth} × conversion ${(conv * 100).toFixed(1)}% at ${cur}${t.price}`,
        0.5
      ),
      estRevenuePerMonth: computed(revenue, `${cur}/mo`, "units × price", 0.5),
      estGrossProfitPerMonth: computed(
        grossProfit,
        `${cur}/mo`,
        "units × contribution",
        0.5
      ),
    };
  });

  const baseTier =
    tiers.find((t) => t.label === inputs.baseTierLabel) ?? tiers[0];

  // Break-even at the base/recommended tier. null (not 0/Infinity) when the
  // metric is genuinely undefined — JSONB can't hold Infinity and 0 would read
  // as a dangerously wrong "breaks even at zero units".
  const baseContribution = baseTier.contributionPerUnit.value;
  const beUnits =
    baseContribution > 0 ? inputs.fixedCostsPerMonth / baseContribution : null;
  const beRevenue = beUnits != null ? beUnits * baseTier.price.value : null;
  // Months for cumulative gross profit (net of fixed) to repay the MOQ outlay.
  const monthlyNet = baseTier.estGrossProfitPerMonth.value - inputs.fixedCostsPerMonth;
  const monthsToBE =
    monthlyNet > 0 ? Math.ceil(inputs.moqCashRequired / monthlyNet) : null;

  // Runway & funding fit. null when there is no monthly burn (unbounded).
  const burn = inputs.fixedCostsPerMonth;
  const runwayMonths = burn > 0 ? capital.capitalAvailable / burn : null;
  const fundsMoq = capital.capitalAvailable >= inputs.moqCashRequired;
  const runwayVerdict = fundsMoq
    ? `Capital covers the ${cur}${round(inputs.moqCashRequired)} MOQ cycle${runwayMonths != null ? ` with ~${round(runwayMonths)} months of runway at current burn` : ""}.`
    : `Capital (${cur}${round(capital.capitalAvailable)}) is short of the ${cur}${round(inputs.moqCashRequired)} needed to fund one MOQ cycle — working capital is the binding constraint.`;

  // Unit economics. null ratios when the denominator is unavailable.
  const channelShare = demand.aggregate?.channelShare ?? [];
  const blendedCac = blendCac(inputs.cacByChannel, channelShare);
  const ltvVal =
    inputs.ltv ?? baseContribution; // single-purchase proxy when no repeat data
  const ltvCac = blendedCac > 0 ? ltvVal / blendedCac : null;
  const paybackPurchases = baseContribution > 0 ? blendedCac / baseContribution : null;

  // Market sizing & the bottom-up vs top-down reconciliation.
  const bottomUpAnnual = baseTier.estRevenuePerMonth.value * 12;
  const reconciliation = reconcile(bottomUpAnnual, inputs.som, inputs.sam, cur);

  const model: FinancialModel = {
    currency: cur,
    costStructure,
    priceTiers: tiers,
    unitEconomics: {
      cacByChannel: inputs.cacByChannel.map((c) => ({
        channel: c.channel,
        cac: num(c.cac, cur, { source: "ai_estimated" }),
      })),
      blendedCac: computed(
        blendedCac,
        cur,
        channelShare.length ? "channel-share weighted" : "mean of channel CACs"
      ),
      ltv: num(ltvVal, cur, {
        source: inputs.ltv != null ? "ai_estimated" : "computed",
        basis: inputs.ltv != null ? "" : "single-purchase contribution proxy",
        confidence: inputs.ltv != null ? 0.5 : 0.35,
      }),
      ltvCacRatio:
        ltvCac != null ? computed(ltvCac, "x", "LTV ÷ blended CAC") : null,
      paybackMonths:
        paybackPurchases != null
          ? computed(
              paybackPurchases,
              "purchases",
              "CAC ÷ contribution per purchase"
            )
          : null,
    },
    marketSizing: {
      tam: num(inputs.tam, `${cur}/yr`, { source: "ai_estimated" }),
      sam: num(inputs.sam, `${cur}/yr`, { source: "ai_estimated" }),
      som: num(inputs.som, `${cur}/yr`, { source: "ai_estimated" }),
      reachableProspectsPerMonth: num(
        inputs.reachableProspectsPerMonth,
        "prospects/mo",
        { source: "ai_estimated" }
      ),
      bottomUpAnnualRevenue: computed(
        bottomUpAnnual,
        `${cur}/yr`,
        "base-tier monthly revenue × 12 (persona conversion × reach)",
        0.45
      ),
      reconciliationNote: reconciliation,
    },
    breakEven: {
      fixedCostsPerMonth: num(inputs.fixedCostsPerMonth, `${cur}/mo`, {
        source: "ai_estimated",
      }),
      contributionPerUnit: computed(
        baseContribution,
        perUnit,
        `at base tier "${baseTier.label}"`
      ),
      breakEvenUnitsPerMonth:
        beUnits != null
          ? computed(beUnits, "units/mo", "fixed costs ÷ contribution")
          : null,
      breakEvenRevenuePerMonth:
        beRevenue != null
          ? computed(beRevenue, `${cur}/mo`, "break-even units × price")
          : null,
      monthsToBreakEven:
        monthsToBE == null
          ? null
          : computed(
              monthsToBE,
              "months",
              "MOQ outlay ÷ (monthly gross profit − fixed costs)"
            ),
    },
    runwayFit: {
      capitalAvailable: num(capital.capitalAvailable, cur, {
        source: capital.source ?? "ai_estimated",
        basis: capital.basis ?? "",
      }),
      monthlyBurn: computed(burn, `${cur}/mo`, "fixed costs (pre-revenue)"),
      moqCashRequired: num(inputs.moqCashRequired, cur, { source: "ai_estimated" }),
      runwayMonths:
        runwayMonths != null
          ? computed(runwayMonths, "months", "capital ÷ monthly burn")
          : null,
      fundsMoq,
      verdict: runwayVerdict,
    },
    assumptions: inputs.assumptions,
    dataMaturityPct: 0, // set below, after override marking
    generatedAt: meta.generatedAt ?? null,
    sourceRunId: meta.sourceRunId ?? null,
  };

  // Re-tag any founder-overridden inputs as founder_entered (raises their
  // confidence and firms up the data-maturity meter).
  applyOverrides(model, new Set(meta.editedKeys ?? []));
  model.dataMaturityPct = inputMaturity(inputs, capital, new Set(meta.editedKeys ?? []));
  return model;
}

// Flip the provenance of each overridden input figure to founder_entered.
function applyOverrides(model: FinancialModel, edited: Set<string>) {
  const flip = (n: FinNum | null) => {
    if (!n) return;
    n.source = "founder_entered";
    n.confidence = 0.9;
  };
  if (edited.has("capital")) flip(model.runwayFit.capitalAvailable);
  if (edited.has("fixedCostsPerMonth")) flip(model.breakEven.fixedCostsPerMonth);
  if (edited.has("moqCashRequired")) flip(model.runwayFit.moqCashRequired);
  if (edited.has("reachableProspectsPerMonth"))
    flip(model.marketSizing.reachableProspectsPerMonth);
  model.costStructure.forEach((c, i) => {
    if (edited.has(`cost:${i}:amount`) || edited.has(`cost:${c.label}:amount`))
      flip(c.amount);
  });
  for (const t of model.priceTiers) {
    if (edited.has(`tier:${t.label}:price`)) flip(t.price);
  }
}

// Channel-share-weighted blend when shares are available, else a simple mean.
function blendCac(
  cacByChannel: { channel: string; cac: number }[],
  channelShare: { name: string; share: number }[]
): number {
  if (cacByChannel.length === 0) return 0;
  if (channelShare.length > 0) {
    let wsum = 0;
    let w = 0;
    for (const c of cacByChannel) {
      const share =
        channelShare.find(
          (s) => s.name.toLowerCase() === c.channel.toLowerCase()
        )?.share ?? 0;
      wsum += c.cac * share;
      w += share;
    }
    if (w > 0) return wsum / w;
  }
  return cacByChannel.reduce((s, c) => s + c.cac, 0) / cacByChannel.length;
}

function reconcile(
  bottomUp: number,
  som: number,
  sam: number,
  cur: string
): string {
  if (som <= 0) return "No top-down SOM supplied to reconcile against.";
  const ratio = bottomUp / som;
  const fmt = (n: number) => `${cur}${round(n).toLocaleString()}`;
  if (ratio < 0.5) {
    return `Bottom-up demand (${fmt(bottomUp)}/yr from simulated buyers) is well below the ${fmt(som)} top-down SOM — the market is real but the venture's reach/conversion at these prices captures only ~${Math.round(ratio * 100)}% of it. Growth lever is reach, not price.`;
  }
  if (ratio > 2) {
    return `Bottom-up demand (${fmt(bottomUp)}/yr) runs ahead of the ${fmt(som)} SOM — either reach assumptions are optimistic or the SOM is understated relative to ${fmt(sam)} SAM. Pressure-test the reach figure.`;
  }
  return `Bottom-up demand (${fmt(bottomUp)}/yr) lines up with the ${fmt(som)} top-down SOM (~${Math.round(ratio * 100)}%) — the two independent estimates agree, which raises confidence in the plan.`;
}

// Fraction (0–100) of the key input numbers that are real vs ai_estimated.
// First pass = 0; rises as founder overrides + doc-derived figures replace
// estimates. Counts: each cost line (real if it cites a conclusion), capital,
// and the editable scalar/price knobs (real if the founder overrode them).
function inputMaturity(
  inputs: FinancialInputs,
  capital: CapitalInput,
  edited: Set<string>
): number {
  let total = 0;
  let real = 0;
  inputs.costStructure.forEach((c, i) => {
    total += 1;
    if (
      c.sourceConclusionIds.length > 0 ||
      edited.has(`cost:${i}:amount`) ||
      edited.has(`cost:${c.label}:amount`)
    )
      real += 1;
  });
  const knobs = [
    "capital",
    "fixedCostsPerMonth",
    "moqCashRequired",
    "reachableProspectsPerMonth",
    ...inputs.priceTiers.map((t) => `tier:${t.label}:price`),
  ];
  for (const k of knobs) {
    total += 1;
    if (edited.has(k)) real += 1;
  }
  // Capital can also arrive real from the funding profile, not just an override.
  if (
    !edited.has("capital") &&
    (capital.source === "founder_entered" ||
      capital.source === "derived_from_data")
  )
    real += 1;
  return total > 0 ? Math.round((real / total) * 100) : 0;
}

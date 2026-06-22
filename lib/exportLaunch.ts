import { simulateLaunch, type LaunchPersona } from "./launchSim";
import { LaunchSimInputsSchema, type ExportLaunchSummary, type LaunchBusinessModel } from "./schema";
import {
  categoryKeyFromProfile,
  type BenchmarkPriors,
  type CategoryKey,
} from "./datasources/benchmarks";
import type { ClientProfile } from "./schema";

// ---------------------------------------------------------------------------
// Export launch (Phase 4). Runs the deterministic launch engine over the
// DESTINATION audience using a scenario's landed cost as the cost price and its
// required price as the sale price — so each fulfillment path gets a full
// destination-market trajectory (orders, break-even, peak capital) that is
// directly comparable to the home-market launch sim. Deterministic: same
// personas + inputs → same summary.
// ---------------------------------------------------------------------------

const CATEGORY_TO_MODEL: Partial<Record<CategoryKey, LaunchBusinessModel>> = {
  apparel: "apparel",
  footwear: "apparel",
  furniture: "furniture",
  food_beverage: "consumable",
  services: "services",
};

export function launchBusinessModelForProfile(profile: ClientProfile): LaunchBusinessModel {
  return CATEGORY_TO_MODEL[categoryKeyFromProfile(profile)] ?? "generic";
}

/** A sensible default monthly ad budget: ~150 new customers at benchmark CAC. */
export function suggestExportAdSpend(priors: BenchmarkPriors): number {
  return Math.max(500, Math.round(priors.cacInr.mid * 150));
}

export function runExportLaunch(opts: {
  personas: LaunchPersona[];
  priors: BenchmarkPriors;
  businessModel: LaunchBusinessModel;
  currency: string;
  costPrice: number; // landed cost per unit (destination currency)
  salePrice: number; // required list price (destination currency)
  adSpendPerMonth: number;
  launchStartMonth?: number | null;
  horizon?: number; // day-steps; default 90
}): ExportLaunchSummary {
  const horizon = opts.horizon ?? 90;
  const inputs = LaunchSimInputsSchema.parse({
    currency: opts.currency,
    businessModel: opts.businessModel,
    costPrice: opts.costPrice,
    salePrice: opts.salePrice,
    adSpendPerMonth: opts.adSpendPerMonth,
    granularity: "day",
    horizon,
    cpm: opts.priors.cpmInr.mid,
    shippingPerOrder: opts.priors.shippingPerOrderInr,
    // The destination shipping is already inside the landed cost; keep the launch's
    // shipping line modest so it isn't double-counted (storefront handling only).
    paymentFeePct: 0.029,
    targetRefundRatePct: opts.priors.returnRatePct.mid,
    launchStartMonth: opts.launchStartMonth ?? null,
  });

  const result = simulateLaunch(opts.personas, inputs, {
    // Benchmark CAC fallback caps paid acquisition (see launch-sim route).
    blendedCac: opts.priors.cacInr.mid,
    seasonality: opts.priors.seasonality,
  });
  const s = result.summary;
  return {
    currency: opts.currency,
    horizonLabel: `${horizon} days`,
    adSpendPerMonth: opts.adSpendPerMonth,
    totalOrders: Math.round(s.totalOrders),
    unitsSold: Math.round(s.unitsSold),
    netRevenue: Math.round(s.netRevenue),
    netProfit: Math.round(s.netProfit),
    grossMarginPct: Math.round(s.grossMarginPct * 10) / 10,
    netMarginPct: Math.round(s.netMarginPct * 10) / 10,
    blendedCac: Math.round(s.blendedCac * 100) / 100,
    breakEvenLabel: s.breakEvenLabel,
    peakCapitalNeeded: Math.round(s.peakCapitalNeeded),
  };
}

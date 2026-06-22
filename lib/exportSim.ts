import {
  ExportSimInputsSchema,
  type ExportSimInputs,
  type ExportScenarioResult,
  type ExportViabilityReport,
  type ExportWaterfallLine,
  type FulfillmentPath,
} from "./schema";
import {
  FREIGHT,
  US_ENTRY,
  US_3PL,
  MARKETPLACE,
  DE_MINIMIS_NOTE,
} from "./datasources/exportCosts";

// ---------------------------------------------------------------------------
// Export-pricing engine (Phase 3). Deterministic: builds a home-market unit COGS
// up to a destination shelf price across fulfillment paths, then scores the
// required price against the destination audience's WTP. Pure arithmetic over the
// resolved inputs — same inputs in → same report out (network/LLM happen in the
// builder that assembles the inputs, never here). Mirrors launchSim's contract.
// ---------------------------------------------------------------------------

const PATH_LABEL: Record<FulfillmentPath, string> = {
  dtc_parcel: "DTC cross-border parcel",
  bulk_warehouse: "Bulk import + US 3PL",
  marketplace: "Marketplace (Amazon US)",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Fraction of the audience whose WTP ≥ the required list price (0–1). */
function coverage(wtp: number[], price: number): number | null {
  if (!wtp.length) return null;
  return wtp.filter((w) => w >= price).length / wtp.length;
}

function verdictFor(cov: number | null): ExportScenarioResult["verdict"] {
  if (cov == null) return "unknown";
  if (cov >= 0.5) return "viable";
  if (cov >= 0.2) return "marginal";
  return "unviable";
}

/** Statutory US entry fees (MPF + optional HMF + brokerage), amortized per unit. */
function entryFeesPerUnit(
  shipmentValuePerUnit: number,
  units: number,
  ocean: boolean
): number {
  const shipmentValue = shipmentValuePerUnit * units;
  const mpf = Math.min(
    Math.max(shipmentValue * US_ENTRY.mpfPct, US_ENTRY.mpfMinUsd),
    US_ENTRY.mpfMaxUsd
  );
  const hmf = ocean ? shipmentValue * US_ENTRY.hmfPct : 0;
  return (mpf + hmf + US_ENTRY.brokerageUsd) / units;
}

/**
 * Build one fulfillment scenario's landed cost + required price. The required
 * price solves price = landed + price·(payment% + referral% + margin%), i.e.
 * price = landed / (1 − payment% − referral% − margin%).
 */
function computeScenario(
  inp: ExportSimInputs,
  path: FulfillmentPath
): ExportScenarioResult {
  const notes: string[] = [];
  const exFactory = inp.unitCogsHome * inp.fxRate; // home COGS → dest currency
  const origin = inp.originLogisticsUsd;

  // --- freight by mode ---
  let international: number;
  let ocean = false;
  if (path === "dtc_parcel") {
    international = FREIGHT.airParcelBaseUsd + FREIGHT.airParcelUsdPerKg * inp.unitWeightKg;
  } else {
    international = FREIGHT.seaLclUsdPerKg * inp.unitWeightKg;
    ocean = true;
  }
  const cifBeforeInsurance = exFactory + origin + international;
  const insurance = cifBeforeInsurance * FREIGHT.insurancePctOfCif;
  const cif = cifBeforeInsurance + insurance;

  // --- duty + entry fees ---
  // Customs value ≈ transaction (ex-works) value. DTC parcels under the de-minimis
  // threshold clear duty-free; commercial bulk/marketplace entries always pay.
  let duty = 0;
  let entryFees = 0;
  const deMinimisApplies =
    path === "dtc_parcel" && inp.deMinimisActive && exFactory < inp.deMinimisThresholdUsd;
  if (path === "dtc_parcel") {
    if (deMinimisApplies) {
      notes.push(
        `De-minimis applied: parcel value ${inp.destCurrency} ${round2(exFactory)} < $${inp.deMinimisThresholdUsd} → duty-free informal entry. ${DE_MINIMIS_NOTE}`
      );
    } else {
      duty = (inp.dutyRatePct / 100) * exFactory;
      entryFees = entryFeesPerUnit(exFactory, 1, false); // per-parcel formal entry
      if (!inp.deMinimisActive)
        notes.push("De-minimis treated as OFF — DTC parcels pay full duty + formal-entry fees.");
    }
  } else {
    duty = (inp.dutyRatePct / 100) * exFactory;
    entryFees = entryFeesPerUnit(exFactory, inp.bulkUnitsPerEntry, ocean);
  }

  // --- destination fulfillment ---
  let fulfillment = 0;
  let referralPct = 0;
  if (path === "bulk_warehouse") {
    fulfillment = US_3PL.pickPackUsd + US_3PL.lastMileUsd + US_3PL.storagePerUnitUsd;
  } else if (path === "marketplace") {
    fulfillment = MARKETPLACE.fbaBaseUsd + MARKETPLACE.fbaUsdPerKg * inp.unitWeightKg;
    referralPct = MARKETPLACE.referralPct;
    notes.push(
      `Marketplace referral ${(referralPct * 100).toFixed(0)}% replaces ad CAC — acquisition is not modeled here.`
    );
  }

  const landed = cif + duty + entryFees + fulfillment;

  // --- solve required price for the target margin ---
  const marginFrac = inp.targetMarginPct / 100;
  const denom = 1 - inp.paymentFeePct - referralPct - marginFrac;
  const requiredPrice = denom > 0.05 ? landed / denom : landed / 0.05;
  if (denom <= 0.05)
    notes.push("Target margin + fees leave no headroom; required price is a floor, not a true margin.");
  const unitMargin = requiredPrice * marginFrac;
  const consumerPriceWithTax = requiredPrice * (1 + inp.salesTaxPct / 100);

  const wtpMed = median(inp.wtpSamplesDest);
  const cov = coverage(inp.wtpSamplesDest, requiredPrice);

  const waterfall: ExportWaterfallLine[] = [
    {
      label: `Ex-works COGS (${inp.homeCurrency} ${round2(inp.unitCogsHome)} × FX ${inp.fxRate})`,
      amount: round2(exFactory),
    },
    { label: "Origin logistics + export docs", amount: round2(origin) },
    {
      label: path === "dtc_parcel" ? "International air parcel" : "International ocean freight",
      amount: round2(international),
    },
    { label: "Cargo insurance", amount: round2(insurance) },
    {
      label: "Import duty",
      amount: round2(duty),
      note: deMinimisApplies ? "de-minimis: duty-free" : `${inp.dutyRatePct}% of customs value`,
    },
    {
      label: "US entry fees (MPF/HMF/brokerage)",
      amount: round2(entryFees),
      note: path === "dtc_parcel" ? "per parcel" : `amortized over ${inp.bulkUnitsPerEntry}/entry`,
    },
    {
      label:
        path === "marketplace"
          ? "FBA fulfillment"
          : path === "bulk_warehouse"
            ? "US 3PL pick/pack + last-mile + storage"
            : "Destination fulfillment (carrier door-to-door)",
      amount: round2(fulfillment),
    },
    { label: "Landed cost per unit", amount: round2(landed) },
  ];

  return {
    path,
    label: PATH_LABEL[path],
    waterfall,
    landedCostPerUnit: round2(landed),
    requiredPrice: round2(requiredPrice),
    unitMargin: round2(unitMargin),
    marginPct: inp.targetMarginPct,
    consumerPriceWithTax: round2(consumerPriceWithTax),
    wtpMedian: wtpMed == null ? null : round2(wtpMed),
    wtpCoveragePct: cov == null ? null : round2(cov * 100),
    verdict: verdictFor(cov),
    launch: null, // filled by the route (Phase 4) after the cost build-up
    notes,
  };
}

/** Required price for a path under an input override — used for sensitivity bands. */
function priceUnder(inp: ExportSimInputs, path: FulfillmentPath, patch: Partial<ExportSimInputs>): number {
  return computeScenario({ ...inp, ...patch }, path).requiredPrice;
}

/**
 * Full export-viability report: every requested fulfillment path's landed-cost
 * waterfall + required price + WTP coverage, a recommended path, and ± sensitivity
 * bands on the live-sourced inputs (FX, duty, de-minimis) that move the answer most.
 */
export function computeExportViability(raw: ExportSimInputs): ExportViabilityReport {
  const inp = ExportSimInputsSchema.parse(raw);
  const paths = Array.from(new Set(inp.scenarios));
  const scenarios = paths.map((p) => computeScenario(inp, p));

  // Recommend the highest WTP coverage; tie-break on the lower required price.
  // With no audience (coverage unknown), fall back to lowest required price.
  const ranked = [...scenarios].sort((a, b) => {
    const ca = a.wtpCoveragePct ?? -1;
    const cb = b.wtpCoveragePct ?? -1;
    if (cb !== ca) return cb - ca;
    return a.requiredPrice - b.requiredPrice;
  });
  const best = ranked[0] ?? null;
  const recommended = best
    ? {
        path: best.path,
        requiredPrice: best.requiredPrice,
        reason:
          best.wtpCoveragePct == null
            ? `Lowest required price (${inp.destCurrency} ${best.requiredPrice}); no destination audience to score coverage.`
            : `${best.wtpCoveragePct}% of the destination audience would pay the required ${inp.destCurrency} ${best.requiredPrice} — the best coverage of the modeled paths.`,
      }
    : null;

  const basePath = best?.path ?? null;
  const sensitivity = {
    basePath,
    fxPlus10Pct: basePath ? priceUnder(inp, basePath, { fxRate: inp.fxRate * 1.1 }) : null,
    fxMinus10Pct: basePath ? priceUnder(inp, basePath, { fxRate: inp.fxRate * 0.9 }) : null,
    dutyZero: basePath ? priceUnder(inp, basePath, { dutyRatePct: 0 }) : null,
    dutyDoubled: basePath
      ? priceUnder(inp, basePath, { dutyRatePct: Math.min(100, inp.dutyRatePct * 2) })
      : null,
    // The de-minimis question only moves the DTC path; report it there.
    deMinimisOff: inp.scenarios.includes("dtc_parcel")
      ? priceUnder(inp, "dtc_parcel", { deMinimisActive: false })
      : null,
  };

  const notes = [...inp.notes];
  if (!inp.wtpSamplesDest.length)
    notes.push("No destination WTP samples supplied — coverage and verdict are unknown; required prices are still exact.");
  notes.push(DE_MINIMIS_NOTE);

  return {
    resolvedInputs: inp,
    scenarios,
    recommended,
    sensitivity,
    sources: inp.sources,
    notes,
  };
}

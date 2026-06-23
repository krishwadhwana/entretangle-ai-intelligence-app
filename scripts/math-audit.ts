// Focused arithmetic audit for the financial/export/owner data paths.
// Run: npx tsx scripts/math-audit.ts
// Optional live-FX assertion: REQUIRE_LIVE_FX=1 npx tsx scripts/math-audit.ts

import { buildRunDossier } from "../components/runDossier";
import { computeExportViability } from "../lib/exportSim";
import {
  ExportSimInputsSchema,
  ExportViabilityReportSchema,
  OwnerDashboardSchema,
  type ExportViabilityReport,
} from "../lib/schema";
import { fetchFxRate } from "../lib/datasources/exportCosts";

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("OK:", msg);
  }
}

function approx(actual: number, expected: number, tolerance: number, msg: string) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${msg} (actual=${actual}, expected=${expected}, tolerance=${tolerance})`
  );
}

function roundedPct(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10000) / 100;
}

function auditExportPricing() {
  console.log("\n-- export viability algebra --");

  const inputs = ExportSimInputsSchema.parse({
    homeCurrency: "INR",
    destCurrency: "USD",
    destCountry: "United States",
    fxRate: 1 / 95,
    unitCogsHome: 950,
    unitWeightKg: 0.75,
    dutyRatePct: 12,
    deMinimisActive: true,
    deMinimisThresholdUsd: 800,
    targetMarginPct: 45,
    salesTaxPct: 7.5,
    paymentFeePct: 0.029,
    originLogisticsUsd: 1.2,
    bulkUnitsPerEntry: 500,
    scenarios: ["dtc_parcel", "bulk_warehouse", "marketplace"],
    wtpSamplesDest: [25, 40, 55, 80, 120, 160],
    sources: ["audit fixture"],
    notes: [],
  });

  const report = computeExportViability(inputs);
  ExportViabilityReportSchema.parse(report);
  assert(report.scenarios.length === 3, "all requested export scenarios are returned");

  for (const scenario of report.scenarios) {
    const landedLine = scenario.waterfall.find((w) => w.label === "Landed cost per unit");
    assert(!!landedLine, `${scenario.path} includes a landed-cost total line`);
    if (!landedLine) continue;

    const componentSum = scenario.waterfall
      .filter((w) => w.label !== "Landed cost per unit")
      .reduce((sum, w) => sum + w.amount, 0);
    approx(componentSum, scenario.landedCostPerUnit, 0.1, `${scenario.path} waterfall components sum to landed cost`);
    approx(landedLine.amount, scenario.landedCostPerUnit, 0.01, `${scenario.path} landed line equals scenario landed cost`);

    const referralPct = scenario.path === "marketplace" ? 0.15 : 0;
    const denominator = Math.max(
      1 - inputs.paymentFeePct - referralPct - inputs.targetMarginPct / 100,
      0.05
    );
    approx(
      scenario.requiredPrice * denominator,
      scenario.landedCostPerUnit,
      0.25,
      `${scenario.path} required price solves landed / (1 - fees - margin)`
    );
    approx(
      scenario.consumerPriceWithTax,
      Math.round(scenario.requiredPrice * (1 + inputs.salesTaxPct / 100) * 100) / 100,
      0.01,
      `${scenario.path} consumer price applies sales tax exactly once`
    );

    const expectedCoverage = roundedPct(
      inputs.wtpSamplesDest.filter((w) => w >= scenario.requiredPrice).length,
      inputs.wtpSamplesDest.length
    );
    approx(
      scenario.wtpCoveragePct ?? -1,
      expectedCoverage,
      0.01,
      `${scenario.path} WTP coverage matches destination samples`
    );
  }

  const dtc = report.scenarios.find((s) => s.path === "dtc_parcel");
  const dtcDuty = dtc?.waterfall.find((w) => w.label === "Import duty")?.amount;
  assert(dtcDuty === 0, "DTC parcel under de-minimis has zero import duty");

  const ranked = [...report.scenarios].sort((a, b) => {
    const ca = a.wtpCoveragePct ?? -1;
    const cb = b.wtpCoveragePct ?? -1;
    if (cb !== ca) return cb - ca;
    return a.requiredPrice - b.requiredPrice;
  });
  assert(report.recommended?.path === ranked[0]?.path, "recommended export path uses coverage, then lower price, as tie-breaker");
  assert((report.sensitivity.fxPlus10Pct ?? 0) > (report.sensitivity.fxMinus10Pct ?? 0), "FX +10% raises required export price versus FX -10%");
}

function auditDossierFxBridge() {
  console.log("\n-- run dossier FX bridge --");

  const exportReport: ExportViabilityReport = ExportViabilityReportSchema.parse({
    resolvedInputs: {
      homeCurrency: "INR",
      destCurrency: "USD",
      destCountry: "United States",
      fxRate: 1 / 95,
      unitCogsHome: 1000,
      unitWeightKg: 0.5,
      hsCode: "",
      dutyRatePct: 0,
      deMinimisActive: true,
      deMinimisThresholdUsd: 800,
      targetMarginPct: 50,
      salesTaxPct: 7.5,
      paymentFeePct: 0.029,
      originLogisticsUsd: 1.2,
      bulkUnitsPerEntry: 500,
      scenarios: ["dtc_parcel"],
      wtpSamplesDest: [150],
      sources: ["FX INR->USD 0.0105263158 - audit fixture"],
      notes: [],
    },
    scenarios: [
      {
        path: "dtc_parcel",
        label: "DTC cross-border parcel",
        waterfall: [{ label: "Landed cost per unit", amount: 50 }],
        landedCostPerUnit: 50,
        requiredPrice: 100,
        unitMargin: 50,
        marginPct: 50,
        consumerPriceWithTax: 107.5,
        wtpMedian: 150,
        wtpCoveragePct: 100,
        verdict: "viable",
        launch: null,
        notes: [],
      },
    ],
    recommended: {
      path: "dtc_parcel",
      requiredPrice: 100,
      reason: "audit",
    },
    sensitivity: {
      basePath: "dtc_parcel",
      fxPlus10Pct: 110,
      fxMinus10Pct: 90,
      dutyZero: 100,
      dutyDoubled: 100,
      deMinimisOff: 110,
    },
    sources: [],
    notes: [],
  });

  const dossier = buildRunDossier({
    brief: "Audit export run",
    mode: "export",
    targetMarket: "United States",
    currency: "INR",
    audienceCurrency: "USD",
    report: null,
    aggregate: null,
    worldModel: null,
    blocks: [],
    launch: null,
    exportReport,
    generatedOn: "2026-06-23",
  });

  const serialized = JSON.stringify(dossier);
  assert(serialized.includes("Rs 9,500"), "dossier uses resolved report FX: USD 100 -> INR 9,500 at 95");
  assert(!serialized.includes("Rs 8,500"), "dossier does not fall back to the old INR 85/USD prior when report FX exists");
}

function auditOwnerRunScoping() {
  console.log("\n-- owner dashboard run scoping --");

  const owner = OwnerDashboardSchema.parse({
    financialsByRun: {
      india_run: {
        model: null,
        inputs: null,
        editedKeys: [],
        generatedAt: "2026-06-23T00:00:00.000Z",
        sourceRunId: "india_run",
      },
      us_run: {
        model: null,
        inputs: null,
        editedKeys: ["tam", "sam", "cacByChannel"],
        generatedAt: "2026-06-23T00:00:00.000Z",
        sourceRunId: "us_run",
      },
    },
    brandSocialByRun: {
      india_run: { kit: null, checks: { script: true }, generatedAt: null, sourceRunId: "india_run" },
      us_run: { kit: null, checks: { script: false }, generatedAt: null, sourceRunId: "us_run" },
    },
    inspirationByRun: {
      india_run: { kit: null, generatedAt: null, sourceRunId: "india_run" },
      us_run: { kit: null, generatedAt: null, sourceRunId: "us_run" },
    },
  });

  assert(Object.keys(owner.financialsByRun).length === 2, "financials are stored per run, not as one shared project blob");
  assert(owner.financialsByRun.india_run.sourceRunId === "india_run", "India financials retain India run id");
  assert(owner.financialsByRun.us_run.sourceRunId === "us_run", "US financials retain US run id");
  assert(owner.brandSocialByRun.india_run.checks.script !== owner.brandSocialByRun.us_run.checks.script, "brand/social checklist can differ by regional run");
}

async function auditLiveFx() {
  console.log("\n-- live FX smoke --");

  const fx = await fetchFxRate("USD", "INR");
  assert(fx.rate > 60 && fx.rate < 130, `USD->INR rate is in a plausible corridor (${fx.rate} from ${fx.source})`);
  if (process.env.REQUIRE_LIVE_FX === "1") {
    assert(!fx.source.includes("prior"), `live FX source is used (${fx.source})`);
  } else if (fx.source.includes("prior")) {
    console.warn("WARN: live FX fetch fell back to prior; set REQUIRE_LIVE_FX=1 to fail this audit on fallback.");
  } else {
    console.log(`OK: live FX source is used (${fx.source})`);
  }
}

async function main() {
  auditExportPricing();
  auditDossierFxBridge();
  auditOwnerRunScoping();
  await auditLiveFx();

  if (failures) {
    console.error(`\nMath audit failed with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nMath audit passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Smoke-check the deterministic financial core. Run: npx tsx scripts/financials-smoke.ts
// Not a test framework (the repo has none) — just exercises computeFinancials
// with a furniture-venture-shaped scenario and asserts the arithmetic holds.

import { computeFinancials, type PersonaPoint } from "../lib/financials";
import { FinancialInputsSchema, FinancialModelSchema } from "../lib/schema";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("✓", msg);
  }
}

// A spread of simulated buyers: budget folks with low wtp, affluent with high.
const personas: PersonaPoint[] = [
  ...Array.from({ length: 40 }, () => ({ wtp: 60000, intent: 0.5, segment: "budget" as const })),
  ...Array.from({ length: 40 }, () => ({ wtp: 110000, intent: 0.6, segment: "middle" as const })),
  ...Array.from({ length: 20 }, () => ({ wtp: 200000, intent: 0.7, segment: "affluent" as const })),
];

const inputs = FinancialInputsSchema.parse({
  currency: "INR",
  costStructure: [
    { label: "Timber", amount: 24000, note: "solid teak", sourceConclusionIds: [] },
    { label: "Labour", amount: 11000, note: "" },
    { label: "Hardware & finish", amount: 7000, note: "" },
  ],
  priceTiers: [
    { label: "Entry", segment: "budget", price: 80000, landedCogs: null },
    { label: "Core", segment: "middle", price: 120000, landedCogs: null },
    { label: "Premium", segment: "affluent", price: 180000, landedCogs: null },
  ],
  fixedCostsPerMonth: 300000,
  moqCashRequired: 4000000,
  reachableProspectsPerMonth: 2000,
  cacByChannel: [
    { channel: "instagram", cac: 4000 },
    { channel: "google", cac: 6000 },
  ],
  ltv: null,
  tam: 5_000_000_000,
  sam: 800_000_000,
  som: 60_000_000,
  baseTierLabel: "Core",
  assumptions: ["Single-purchase LTV proxy; no repeat modelled yet"],
});

const model = computeFinancials(
  inputs,
  { personas },
  { capitalAvailable: 4000000, source: "founder_entered", basis: "₹40 lakh stated at intake" },
  { generatedAt: "2026-06-13T00:00:00Z", sourceRunId: "run_demo" }
);

// Schema round-trips.
FinancialModelSchema.parse(model);
console.log("\n— round-trips through FinancialModelSchema —\n");

const core = model.priceTiers.find((t) => t.label === "Core")!;
const cogsSum = 24000 + 11000 + 7000; // 42000

assert(core.landedCogs.value === cogsSum, "Core landed COGS = sum of cost structure (42000)");
assert(core.contributionPerUnit.value === 120000 - cogsSum, "Core contribution = price − COGS (78000)");
assert(Math.abs(core.grossMarginPct.value - 65) < 0.1, "Core gross margin ≈ 65%");

// Conversion at 120k: only middle (40 @ wtp 110k? no — 110k < 120k) … budget 60k<120k.
// affluent 200k≥120k @ intent .7 → 20 personas. So conv = (20×0.7)/100 = 0.14.
assert(Math.abs(core.estUnitsPerMonth.value - 2000 * 0.14) < 1, "Core units = reach × conversion (280/mo)");
assert(core.estRevenuePerMonth.value === core.estUnitsPerMonth.value * 120000, "Core revenue = units × price");

// Break-even: fixed 300k ÷ contribution 78k ≈ 3.85 units/mo.
assert(Math.abs(model.breakEven.breakEvenUnitsPerMonth.value - 300000 / 78000) < 0.05, "Break-even units = fixed ÷ contribution");

// Runway: capital 4M ÷ burn 300k ≈ 13.3 months; funds MOQ exactly.
assert(Math.abs(model.runwayFit.runwayMonths.value - 4000000 / 300000) < 0.05, "Runway = capital ÷ burn");
assert(model.runwayFit.fundsMoq === true, "Capital (4M) funds the 4M MOQ cycle");

// Blended CAC simple mean (no channel shares supplied) = 5000.
assert(model.unitEconomics.blendedCac.value === 5000, "Blended CAC = mean of channel CACs (5000)");

// Provenance: computed fields are tagged computed; capital is founder_entered.
assert(core.contributionPerUnit.source === "computed", "Contribution tagged source=computed");
assert(model.runwayFit.capitalAvailable.source === "founder_entered", "Capital tagged source=founder_entered");

console.log("\nReconciliation:", model.marketSizing.reconciliationNote);
console.log("Runway verdict:", model.runwayFit.verdict);
console.log("Data maturity:", model.dataMaturityPct + "%");

// --- override / recompute path -------------------------------------------
console.log("\n— override: founder raises Core price to 150k + edits reach —\n");
const editedInputs = FinancialInputsSchema.parse({
  ...inputs,
  priceTiers: inputs.priceTiers.map((t) =>
    t.label === "Core" ? { ...t, price: 150000 } : t
  ),
  reachableProspectsPerMonth: 3000,
});
const edited = computeFinancials(
  editedInputs,
  { personas },
  { capitalAvailable: 4000000, source: "founder_entered" },
  { editedKeys: ["tier:Core:price", "reachableProspectsPerMonth"] }
);
const core2 = edited.priceTiers.find((t) => t.label === "Core")!;

assert(core2.price.source === "founder_entered", "Overridden Core price tagged founder_entered");
assert(core2.price.value === 150000, "Core price reflects override (150000)");
assert(
  edited.marketSizing.reachableProspectsPerMonth.source === "founder_entered",
  "Overridden reach tagged founder_entered"
);
// At 150k, still only affluent (200k) buy: 20×0.7/100 = 0.14 conv × 3000 reach = 420.
assert(Math.abs(core2.estUnitsPerMonth.value - 3000 * 0.14) < 1, "Units recomputed with new reach (420/mo)");
assert(
  edited.dataMaturityPct > model.dataMaturityPct,
  `Data maturity rises after overrides (${model.dataMaturityPct}% → ${edited.dataMaturityPct}%)`
);
console.log("Data maturity after overrides:", edited.dataMaturityPct + "%");

console.log("\nDone.");

// Check the deterministic Launch Simulation core.
//   Run: npx tsx scripts/launch-sim-check.ts
//
// The repo has no test framework — this script exercises simulateLaunch with a
// furniture-venture-shaped audience and asserts the contract that makes the
// feature trustworthy:
//   1. DETERMINISM   — identical inputs reproduce a byte-identical trajectory.
//   2. SENSITIVITY   — changing ad spend produces a *different* trajectory
//                      (so the model genuinely responds to inputs, not noise).
//   3. CONSERVATION  — the accounting holds (orders ≥ refunds, P&L identity,
//                      reach never exceeds the pool, etc.).
//
// Determinism is asserted, NEVER hardcoded: the engine is a pure function of
// its inputs, so equality emerges. If (1) ever fails we've found a real
// predictiveness bug (ambient nondeterminism leaked into the model).

import { simulateLaunch, type LaunchPersona } from "../lib/launchSim";
import { LaunchSimInputsSchema, LaunchSimResultSchema } from "../lib/schema";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    failures++;
  } else {
    console.log("✓", msg);
  }
}

// A realistic spread of simulated buyers across segments / localities / platforms.
const SEGMENTS = ["budget", "middle", "affluent", "luxury"] as const;
const LOCS = [
  { locality: "Mumbai", country: "India" },
  { locality: "Delhi NCR", country: "India" },
  { locality: "Dubai", country: "UAE" },
  { locality: "London", country: "UK" },
];
const personas: LaunchPersona[] = [];
for (let i = 0; i < 200; i++) {
  const seg = SEGMENTS[i % SEGMENTS.length];
  const loc = LOCS[i % LOCS.length];
  const wtpBase = { budget: 30000, middle: 70000, affluent: 140000, luxury: 280000 }[seg];
  personas.push({
    intent: 0.2 + ((i * 7) % 60) / 100, // 0.2–0.8, deterministic spread
    wtp: wtpBase * (0.8 + ((i * 13) % 40) / 100),
    priceSensitivity: ((i * 11) % 100) / 100,
    segment: seg,
    channelPref: ["d2c website", "marketplace", "instagram shop", "showroom"][i % 4],
    platforms: i % 3 === 0 ? ["instagram", "pinterest"] : i % 3 === 1 ? ["facebook", "whatsapp"] : ["youtube"],
    objection: i % 5 === 0 ? "worried about delivery damage" : "too expensive for an unknown brand",
    age: 22 + (i % 45),
    gender: i % 2 === 0 ? "female" : "male",
    locality: loc.locality,
    country: loc.country,
  });
}

const baseInputs = LaunchSimInputsSchema.parse({
  currency: "INR",
  costPrice: 35000,
  salePrice: 90000,
  adSpendPerMonth: 500000,
  granularity: "day",
  horizon: 90,
});

// --- 1. DETERMINISM --------------------------------------------------------
const a = simulateLaunch(personas, baseInputs, { reachableProspectsPerMonth: 8000 });
const b = simulateLaunch(personas, baseInputs, { reachableProspectsPerMonth: 8000 });
assert(
  JSON.stringify(a) === JSON.stringify(b),
  "identical inputs reproduce a byte-identical trajectory (determinism)"
);
assert(a.seed === b.seed, "identical inputs derive the identical seed");

// Persona ORDER must not matter for the seed (seed is inputs-only)…
const reordered = [...personas].reverse();
const c = simulateLaunch(reordered, baseInputs, { reachableProspectsPerMonth: 8000 });
assert(c.seed === a.seed, "seed depends only on inputs, not persona ordering");

// --- 2. SENSITIVITY --------------------------------------------------------
const moreAds = simulateLaunch(
  personas,
  { ...baseInputs, adSpendPerMonth: 2000000 },
  { reachableProspectsPerMonth: 8000 }
);
assert(moreAds.seed !== a.seed, "changing ad spend changes the seed");
assert(
  moreAds.summary.totalOrders !== a.summary.totalOrders,
  "changing ad spend changes total orders (the model responds to inputs)"
);
assert(
  moreAds.summary.totalReached >= a.summary.totalReached,
  "more ad spend reaches at least as many people"
);

// Price sensitivity: a higher sale price should not increase orders.
const pricier = simulateLaunch(
  personas,
  { ...baseInputs, salePrice: 160000 },
  { reachableProspectsPerMonth: 8000 }
);
assert(
  pricier.summary.totalOrders <= a.summary.totalOrders,
  "raising the price does not increase orders (downward-sloping demand)"
);

// --- 3. CONSERVATION / SANITY ---------------------------------------------
const s = a.summary;
assert(LaunchSimResultSchema.safeParse(a).success, "result validates against LaunchSimResultSchema");
assert(s.refunds <= s.unitsSold + 1e-6, "refunds never exceed units sold");
assert(s.totalReached <= (a.resolvedInputs.reachablePool ?? Infinity) + 1, "cumulative reach never exceeds the reachable pool");
assert(s.repeatOrders + s.newOrders >= s.totalOrders - 1e-6, "new + repeat orders reconcile with total orders");

// P&L identity: netProfit == netRevenue − every cost line.
const reconstructed =
  s.netRevenue -
  s.totalCogs -
  s.totalShipping -
  s.totalPaymentFees -
  s.totalRefundCost -
  s.totalFixedCosts -
  s.totalAdSpend;
assert(
  Math.abs(reconstructed - s.netProfit) < 1, // within rounding
  "net profit reconciles with net revenue minus all cost lines (P&L identity)"
);

// Every timeline step's cumulative net profit equals the running sum.
let running = 0;
let cumOk = true;
for (const step of a.timeline) {
  running += step.netProfit;
  if (Math.abs(running - step.cumulativeNetProfit) > 1) cumOk = false;
}
assert(cumOk, "cumulative net profit equals the running sum of step profits");

assert(s.deadstockUnits >= 0 && s.stockoutUnits >= 0, "deadstock and stockouts are non-negative");

console.log(
  `\nScenario: ${s.totalOrders.toFixed(0)} orders · ${(s.netProfit).toLocaleString()} net profit · ` +
    `${s.refundRatePct}% refunds · break-even ${a.summary.breakEvenLabel ?? "never"} · ` +
    `${s.returningCustomerSharePct}% returning`
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll Launch Simulation checks passed.");
}

// Check the integrations reconciliation core (no DB, no network).
//   Run: npx tsx scripts/reconciliation-check.ts
//
// The repo has no test framework — this script exercises the pure functions
// that turn (a) connector output and (b) simulation output into a Plan vs
// Actual report, asserting the contract that makes the feature trustworthy:
//   1. DETERMINISM   — a connector's mockSync reproduces identical metrics for
//                      the same seed/window.
//   2. NORMALIZATION — Shopify order aggregation rolls orders/revenue/units/
//                      refunds/new-vs-returning to the right daily totals.
//   3. RECONCILE     — predicted vs actual deltas + on_track/over/under
//                      classification compute correctly.
import { shopifyConnector, aggregateOrders } from "../lib/integrations/connectors/shopify";
import { reconcile, predictedFromLaunchSim } from "../lib/reconciliation";
import type { SyncContext } from "../lib/integrations/types";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    failures++;
  } else {
    console.log("✓", msg);
  }
}

const ctx = (overrides: Partial<SyncContext> = {}): SyncContext => ({
  integrationId: "int_test",
  projectId: "proj_test",
  provider: "shopify",
  accessToken: null,
  externalAccountId: "test.myshopify.com",
  metadata: { currency: "USD" },
  since: new Date("2026-01-01T00:00:00Z"),
  until: new Date("2026-03-31T00:00:00Z"),
  seed: 12345,
  ...overrides,
});

// 1. DETERMINISM — same seed/window → identical mock output.
const a = shopifyConnector.mockSync(ctx());
const b = shopifyConnector.mockSync(ctx());
assert(JSON.stringify(a) === JSON.stringify(b), "mockSync is deterministic");
assert(a.length > 0 && a.every((m) => m.value >= 0), "mock metrics are non-negative");
const c = shopifyConnector.mockSync(ctx({ seed: 999 }));
assert(JSON.stringify(a) !== JSON.stringify(c), "a different seed yields different data");

// 2. NORMALIZATION — Shopify order aggregation.
const orders = [
  {
    created_at: "2026-02-10T10:00:00Z",
    current_total_price: "100.00",
    total_discounts: "0",
    currency: "USD",
    line_items: [{ quantity: 2 }],
    refunds: [],
    customer: { id: 1 },
  },
  {
    created_at: "2026-02-10T15:00:00Z",
    current_total_price: "50.00",
    total_discounts: "0",
    currency: "USD",
    line_items: [{ quantity: 1 }],
    refunds: [
      {
        created_at: "2026-02-11T09:00:00Z",
        refund_line_items: [{ subtotal: "50.00", quantity: 1 }],
        transactions: [{ amount: "50.00" }],
      },
    ],
    customer: { id: 1 }, // same customer → returning
  },
];
const agg = aggregateOrders(orders, ctx());
const get = (metric: string, date: string) =>
  agg.find((m) => m.metric === metric && m.date === date)?.value ?? 0;
assert(get("orders", "2026-02-10") === 2, "orders/day aggregates correctly");
assert(get("revenue", "2026-02-10") === 150, "revenue/day sums order totals");
assert(get("units", "2026-02-10") === 3, "units/day sums line-item quantities");
assert(get("new_customers", "2026-02-10") === 1, "first order = new customer");
assert(get("returning_customers", "2026-02-10") === 1, "repeat order = returning customer");
assert(get("refunds", "2026-02-11") === 1, "refund lands on its own day");
assert(get("refund_amount", "2026-02-11") === 50, "refund amount uses transaction total");

// 3. RECONCILE — predicted (from a launch sim summary) vs actual totals.
const fakeSim = {
  timeline: new Array(30).fill({}),
  resolvedInputs: { currency: "USD", granularity: "day" },
  summary: {
    totalOrders: 300, // 10/day over 30 days
    grossRevenue: 30000, // 1000/day
    unitsSold: 450,
    totalAdSpend: 6000, // 200/day
    refundRatePct: 5,
    returningCustomerSharePct: 30,
    blendedCac: 20,
    grossMarginPct: 60,
    totalProductVisits: 6000,
  },
} as unknown as Parameters<typeof predictedFromLaunchSim>[0];
const predicted = predictedFromLaunchSim(fakeSim);
assert(Math.abs((predicted.ordersPerDay ?? 0) - 10) < 0.01, "predicted orders/day = 10");
assert(Math.abs((predicted.refundRate ?? 0) - 0.05) < 1e-9, "predicted refund rate = 5%");

const actuals = {
  totals: {
    orders: 270, // 9/day over 30 days → 10% under
    revenue: 33000,
    units: 400,
    refunds: 16,
    refundAmount: 1600,
    adSpend: 6300,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    newCustomers: 200,
    returningCustomers: 70,
    sessions: 0,
    cogs: 12000,
    currency: "USD",
  },
  days: 30,
};
const report = reconcile(predicted, actuals, {
  since: new Date("2026-01-01"),
  until: new Date("2026-01-31"),
});
const lineByKey = (k: string) => report.lines.find((l) => l.key === k);
assert(report.predictedSource === "launch_sim", "report records the predicted source");
assert(lineByKey("orders_per_day")?.status === "on_track", "9 vs 10 orders/day is on_track (<15%)");
const cac = lineByKey("blended_cac");
assert(
  cac != null && Math.abs((cac.actual ?? 0) - 6300 / 200) < 1e-9,
  "actual blended CAC = ad spend / new customers",
);
const repeat = lineByKey("repeat_rate");
assert(
  repeat != null && Math.abs((repeat.actual ?? 0) - 70 / 270) < 1e-9,
  "actual repeat rate = returning / (new + returning)",
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll reconciliation checks passed.");

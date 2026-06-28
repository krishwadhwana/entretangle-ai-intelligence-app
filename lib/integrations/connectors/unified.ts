// ---------------------------------------------------------------------------
// Unified-API aggregator adapter (Merge.dev / Codat / Rutter-style). One
// adapter that, once an aggregator account is configured, lets the long tail of
// providers (Xero, Salesforce, WooCommerce, NetSuite, …) come online as config
// rather than new connector code: each appears as a "linked account" the
// aggregator normalizes for us, and we map its normalized models onto our
// MetricSnapshot metrics.
//
// Interface-complete but intentionally minimal: the exact request shapes vary
// by aggregator, so `sync()` throws a clear "configure UNIFIED_API_*" error
// until wired to a specific vendor. The point is that the registry and the rest
// of the system already treat it as a first-class connector.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type { Connector, NormalizedMetric, SyncContext } from "../types";
import { genSeries } from "../mock";

export const unifiedConnector: Connector = {
  provider: "unified",
  category: "commerce",
  label: "More (via aggregator)",
  authType: "oauth2",
  metrics: ["orders", "revenue", "units", "new_customers", "cogs"],

  isConfigured() {
    const c = config.integrations.unified;
    return Boolean(c.provider && c.apiKey);
  },

  authorizeUrl() {
    // Aggregators issue a hosted "link" session; that URL is vendor-specific.
    throw new Error(
      "Unified aggregator link flow not configured. Set UNIFIED_API_PROVIDER and UNIFIED_API_KEY and wire the vendor link session.",
    );
  },

  async sync(): Promise<NormalizedMetric[]> {
    throw new Error(
      "Unified aggregator sync not wired to a vendor yet. Configure UNIFIED_API_* and implement the model mapping.",
    );
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "revenue", base: 1800, growth: 0.004, noise: 0.2, currency: "USD" }),
      ...genSeries(ctx, { metric: "orders", base: 24, growth: 0.004, noise: 0.2 }),
    ];
  },
};

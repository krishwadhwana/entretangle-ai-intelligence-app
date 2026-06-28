// The connector registry. Everything else (OAuth routes, the sync job, the UI
// catalog) resolves providers through here, so adding a provider is a one-line
// registration. `CATALOG` is the ordered list the Integrations UI renders.
import type { Connector, IntegrationProvider } from "./types";
import { shopifyConnector } from "./connectors/shopify";
import { metaAdsConnector } from "./connectors/metaAds";
import { ga4Connector, googleAdsConnector } from "./connectors/google";
import { stripeConnector } from "./connectors/stripe";
import { quickbooksConnector } from "./connectors/quickbooks";
import { unifiedConnector } from "./connectors/unified";

const CONNECTORS: Connector[] = [
  shopifyConnector,
  metaAdsConnector,
  googleAdsConnector,
  ga4Connector,
  stripeConnector,
  quickbooksConnector,
  unifiedConnector,
];

const BY_PROVIDER = new Map<IntegrationProvider, Connector>(
  CONNECTORS.map((c) => [c.provider, c]),
);

export function getConnector(provider: string): Connector | undefined {
  return BY_PROVIDER.get(provider as IntegrationProvider);
}

export function requireConnector(provider: string): Connector {
  const c = getConnector(provider);
  if (!c) throw new Error(`unknown integration provider: ${provider}`);
  return c;
}

/** Provider catalog for the UI — Core 5 (+ aggregator), in display order. */
export const CATALOG = CONNECTORS.map((c) => ({
  provider: c.provider,
  label: c.label,
  category: c.category,
  authType: c.authType,
  metrics: c.metrics,
}));

export type IntegrationCatalogItem = (typeof CATALOG)[number];

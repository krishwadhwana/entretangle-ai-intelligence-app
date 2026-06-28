// The connector registry. Everything else (OAuth routes, the sync job, the UI
// catalog) resolves providers through here, so adding a provider is a one-line
// registration. `CATALOG` is the ordered list the Integrations UI renders.
import type { Connector, IntegrationProvider } from "./types";
import { shopifyConnector } from "./connectors/shopify";
import { metaAdsConnector } from "./connectors/metaAds";
import { ga4Connector, googleAdsConnector } from "./connectors/google";
import { stripeConnector } from "./connectors/stripe";
import { quickbooksConnector } from "./connectors/quickbooks";
import { tiktokShopConnector, tiktokAdsConnector } from "./connectors/tiktok";
import { amazonConnector, etsyConnector } from "./connectors/marketplaces";
import { faireConnector } from "./connectors/faire";
import { klaviyoConnector } from "./connectors/klaviyo";
import { salesforceConnector } from "./connectors/salesforce";
import { unifiedConnector } from "./connectors/unified";

const CONNECTORS: Connector[] = [
  shopifyConnector,
  tiktokShopConnector,
  amazonConnector,
  etsyConnector,
  faireConnector,
  metaAdsConnector,
  tiktokAdsConnector,
  googleAdsConnector,
  ga4Connector,
  stripeConnector,
  klaviyoConnector,
  quickbooksConnector,
  salesforceConnector,
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

// Providers that are live and connectable today. Everything else renders as
// "Coming soon" in the UI. Flip a provider in here once its setup is ready.
const AVAILABLE = new Set<string>([
  "shopify",
  "stripe",
  "meta_ads",
  "ga4",
]);

/** Provider catalog for the UI — available providers first, coming-soon after
 *  (stable sort preserves the order within each group). */
export const CATALOG = CONNECTORS.map((c) => ({
  provider: c.provider,
  label: c.label,
  category: c.category,
  authType: c.authType,
  metrics: c.metrics,
  connectFields: c.connectFields ?? null,
  comingSoon: !AVAILABLE.has(c.provider),
})).sort((a, b) => Number(a.comingSoon) - Number(b.comingSoon));

export type IntegrationCatalogItem = (typeof CATALOG)[number];

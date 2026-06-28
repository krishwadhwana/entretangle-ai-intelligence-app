// ---------------------------------------------------------------------------
// The connector contract. Every provider (Shopify, Meta Ads, Google, Stripe,
// QuickBooks, the unified aggregator) implements `Connector`. The rest of the
// system — OAuth routes, the sync job, reconciliation — only ever talks to this
// interface, never to a provider SDK directly. Connectors normalize whatever
// they pull into provider-agnostic `NormalizedMetric` rows that land in the
// MetricSnapshot fact table.
// ---------------------------------------------------------------------------

export type IntegrationProvider =
  | "shopify"
  | "meta_ads"
  | "google_ads"
  | "ga4"
  | "stripe"
  | "quickbooks"
  | "unified";

export type IntegrationCategory =
  | "commerce"
  | "ads"
  | "analytics"
  | "payments"
  | "accounting";

// Canonical metric names. Connectors map their native fields onto these so
// reconciliation can compare like-for-like across providers. Keep this list and
// lib/reconciliation.ts in sync.
export type MetricName =
  | "orders"
  | "revenue"
  | "units"
  | "new_customers"
  | "returning_customers"
  | "refunds"
  | "refund_amount"
  | "cogs"
  | "ad_spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "sessions"
  | "mrr"
  | "churn";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  /** Absolute expiry; connectors compute from `expires_in` at exchange time. */
  expiresAt?: Date | null;
  scope?: string | null;
};

/** A provider sub-account discovered after OAuth (an ad account, a GA4
 *  property, a QuickBooks realm). The UI lets the founder pick one. */
export type ExternalAccount = {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
};

/** One normalized fact, day-grained, ready to upsert into MetricSnapshot. */
export type NormalizedMetric = {
  metric: MetricName;
  /** YYYY-MM-DD (UTC day). */
  date: string;
  value: number;
  currency?: string | null;
  /** Optional breakdown dims: channel, campaign, region, segment, product. */
  dimensions?: Record<string, string | number>;
};

export type AuthorizeArgs = {
  /** Signed state we round-trip through the provider for CSRF + projectId. */
  state: string;
  redirectUri: string;
};

export type SyncContext = {
  integrationId: string;
  projectId: string;
  provider: IntegrationProvider;
  /** Decrypted, freshly-refreshed access token (null in mock mode). */
  accessToken: string | null;
  externalAccountId: string | null;
  metadata: Record<string, unknown>;
  /** Inclusive window the sync should cover. */
  since: Date;
  until: Date;
  /** Deterministic seed for mock generation (stable per integration). */
  seed: number;
};

export interface Connector {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  label: string;
  authType: "oauth2" | "apiKey";
  scopes?: string[];
  /** The canonical metrics this connector can produce. */
  metrics: MetricName[];

  /** True when real credentials are configured (else the job uses mockSync). */
  isConfigured(): boolean;

  // --- OAuth2 lifecycle (omit/throw for apiKey connectors) ---
  authorizeUrl?(args: AuthorizeArgs): string;
  exchangeCode?(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken?(refreshToken: string): Promise<TokenSet>;
  /** Provider sub-accounts to choose from after auth (optional). */
  listExternalAccounts?(token: TokenSet): Promise<ExternalAccount[]>;

  // --- apiKey connect (omit for oauth2 connectors) ---
  connectWithKey?(input: Record<string, string>): Promise<{
    token: TokenSet;
    externalAccountId: string;
    displayName: string;
    metadata?: Record<string, unknown>;
  }>;

  // --- Sync ---
  /** Pull from the live API and normalize. Only called when isConfigured(). */
  sync(ctx: SyncContext): Promise<NormalizedMetric[]>;
  /** Deterministic, seeded fixture used in MOCK_MODE / before creds land. */
  mockSync(ctx: SyncContext): NormalizedMetric[];
}

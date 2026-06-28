// ---------------------------------------------------------------------------
// Google connectors — GA4 (Analytics Data API) and Google Ads. Both use Google
// OAuth2; they differ in scope and the API they read.
//
// GA4 (live): runReport over the property → daily sessions, conversions,
//   revenue. Calibrates the funnel + reach side of the launch sim.
// Google Ads (OAuth + mock for now): the Ads API needs a developer token and
//   GAQL; OAuth + a correct GAQL sync are wired, but live pulls depend on the
//   developer token being approved, so MOCK_MODE / unconfigured falls back to
//   seeded data. ad_spend/impressions/clicks/conversions like Meta.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type {
  AuthorizeArgs,
  Connector,
  ExternalAccount,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl, postTokenForm } from "./oauth";
import { genSeries } from "../mock";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function googleAuthorizeUrl(scope: string, args: AuthorizeArgs): string {
  return buildAuthorizeUrl(AUTH_ENDPOINT, {
    client_id: config.integrations.google.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: args.state,
    scope,
  });
}

function googleExchange(code: string, redirectUri: string): Promise<TokenSet> {
  const c = config.integrations.google;
  return postTokenForm(TOKEN_ENDPOINT, {
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

function googleRefresh(refreshToken: string): Promise<TokenSet> {
  const c = config.integrations.google;
  return postTokenForm(TOKEN_ENDPOINT, {
    refresh_token: refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
  });
}

function googleConfigured(): boolean {
  const c = config.integrations.google;
  return Boolean(c.clientId && c.clientSecret);
}

// --- GA4 -------------------------------------------------------------------
export const ga4Connector: Connector = {
  provider: "ga4",
  category: "analytics",
  label: "Google Analytics 4",
  authType: "oauth2",
  scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  metrics: ["sessions", "conversions", "revenue"],

  isConfigured: googleConfigured,
  authorizeUrl(args) {
    return googleAuthorizeUrl((this.scopes ?? []).join(" "), args);
  },
  exchangeCode: googleExchange,
  refreshToken: googleRefresh,

  async listExternalAccounts(token: TokenSet): Promise<ExternalAccount[]> {
    // Admin API: account summaries → property ids.
    const res = await fetch(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );
    const body = (await res.json()) as {
      accountSummaries?: {
        displayName: string;
        propertySummaries?: { property: string; displayName: string }[];
      }[];
    };
    const out: ExternalAccount[] = [];
    for (const a of body.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        out.push({
          id: p.property.replace("properties/", ""),
          name: `${a.displayName} — ${p.displayName}`,
        });
      }
    }
    return out;
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const propertyId = ctx.externalAccountId;
    if (!ctx.accessToken || !propertyId) {
      throw new Error("GA4 integration missing token or property id");
    }
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [
            {
              startDate: ctx.since.toISOString().slice(0, 10),
              endDate: ctx.until.toISOString().slice(0, 10),
            },
          ],
          dimensions: [{ name: "date" }],
          metrics: [
            { name: "sessions" },
            { name: "conversions" },
            { name: "totalRevenue" },
          ],
        }),
      },
    );
    if (!res.ok) throw new Error(`GA4 runReport failed (HTTP ${res.status})`);
    const body = (await res.json()) as {
      rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    };
    const out: NormalizedMetric[] = [];
    for (const row of body.rows ?? []) {
      const raw = row.dimensionValues[0].value; // YYYYMMDD
      const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      out.push({ metric: "sessions", date, value: Number(row.metricValues[0].value || 0) });
      out.push({ metric: "conversions", date, value: Number(row.metricValues[1].value || 0) });
      out.push({ metric: "revenue", date, value: Number(row.metricValues[2].value || 0) });
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "sessions", base: 5400, growth: 0.005, noise: 0.22, weekend: 0.85 }),
      ...genSeries(ctx, { metric: "conversions", base: 64, growth: 0.006, noise: 0.3 }),
      ...genSeries(ctx, { metric: "revenue", base: 3100, growth: 0.006, noise: 0.25, currency: "USD" }),
    ];
  },
};

// --- Google Ads ------------------------------------------------------------
export const googleAdsConnector: Connector = {
  provider: "google_ads",
  category: "ads",
  label: "Google Ads",
  authType: "oauth2",
  scopes: ["https://www.googleapis.com/auth/adwords"],
  metrics: ["ad_spend", "impressions", "clicks", "conversions"],

  isConfigured() {
    return googleConfigured() && Boolean(config.integrations.google.adsDeveloperToken);
  },
  authorizeUrl(args) {
    return googleAuthorizeUrl((this.scopes ?? []).join(" "), args);
  },
  exchangeCode: googleExchange,
  refreshToken: googleRefresh,

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const customerId = ctx.externalAccountId;
    const devToken = config.integrations.google.adsDeveloperToken;
    if (!ctx.accessToken || !customerId || !devToken) {
      throw new Error("Google Ads integration missing token, customer id, or developer token");
    }
    const gaql =
      "SELECT segments.date, metrics.cost_micros, metrics.impressions, " +
      "metrics.clicks, metrics.conversions FROM customer " +
      `WHERE segments.date BETWEEN '${ctx.since.toISOString().slice(0, 10)}' ` +
      `AND '${ctx.until.toISOString().slice(0, 10)}'`;
    const res = await fetch(
      `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "developer-token": devToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaql }),
      },
    );
    if (!res.ok) throw new Error(`Google Ads query failed (HTTP ${res.status})`);
    const batches = (await res.json()) as {
      results?: {
        segments: { date: string };
        metrics: {
          costMicros?: string;
          impressions?: string;
          clicks?: string;
          conversions?: number;
        };
      }[];
    }[];
    const out: NormalizedMetric[] = [];
    for (const batch of batches) {
      for (const r of batch.results ?? []) {
        const date = r.segments.date;
        out.push({ metric: "ad_spend", date, value: Number(r.metrics.costMicros || 0) / 1e6 });
        out.push({ metric: "impressions", date, value: Number(r.metrics.impressions || 0) });
        out.push({ metric: "clicks", date, value: Number(r.metrics.clicks || 0) });
        out.push({ metric: "conversions", date, value: Number(r.metrics.conversions || 0) });
      }
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "ad_spend", base: 310, growth: 0.004, noise: 0.2, currency: "USD" }),
      ...genSeries(ctx, { metric: "impressions", base: 47000, growth: 0.004, noise: 0.25 }),
      ...genSeries(ctx, { metric: "clicks", base: 980, growth: 0.004, noise: 0.25 }),
      ...genSeries(ctx, { metric: "conversions", base: 24, growth: 0.005, noise: 0.3 }),
    ];
  },
};

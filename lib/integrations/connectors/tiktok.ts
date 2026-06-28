// ---------------------------------------------------------------------------
// TikTok connectors — TikTok Shop (commerce) and TikTok Ads (marketing). The
// creator-commerce channel a Pietra-style audience actually sells and advertises
// on, and the major ad network the Core 5 was missing.
//
// Both use TikTok OAuth. TikTok Shop's Open API uses request signing that must
// be finalized against the live partner app, so its sync is scaffolded and the
// connector runs on seeded data until then; TikTok Ads' reporting API is a
// straightforward authorized GET and is implemented.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type {
  AuthorizeArgs,
  Connector,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl } from "./oauth";
import { genSeries } from "../mock";

// --- TikTok Shop -----------------------------------------------------------
export const tiktokShopConnector: Connector = {
  provider: "tiktok_shop",
  category: "commerce",
  label: "TikTok Shop",
  authType: "oauth2",
  scopes: [],
  metrics: ["orders", "revenue", "units", "refunds", "new_customers"],

  isConfigured() {
    const c = config.integrations.tiktokShop;
    return Boolean(c.appKey && c.appSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl("https://services.tiktokshop.com/open/authorize", {
      app_key: config.integrations.tiktokShop.appKey,
      state: args.state,
    });
  },

  async exchangeCode(code: string): Promise<TokenSet> {
    const c = config.integrations.tiktokShop;
    const url = buildAuthorizeUrl("https://auth.tiktok-shops.com/api/v2/token/get", {
      app_key: c.appKey,
      app_secret: c.appSecret,
      auth_code: code,
      grant_type: "authorized_code",
    });
    const res = await fetch(url);
    const body = (await res.json()) as {
      data?: { access_token: string; refresh_token?: string; access_token_expire_in?: number };
    };
    if (!body.data?.access_token) throw new Error("TikTok Shop token exchange failed");
    return {
      accessToken: body.data.access_token,
      refreshToken: body.data.refresh_token ?? null,
      expiresAt: body.data.access_token_expire_in
        ? new Date(body.data.access_token_expire_in * 1000)
        : null,
    };
  },

  async sync(): Promise<NormalizedMetric[]> {
    // TikTok Shop's Open API requires HMAC request signing + shop cipher that
    // must be finalized against the live partner app. Until then, connected
    // accounts surface seeded data rather than silently returning nothing.
    throw new Error(
      "TikTok Shop live sync needs request-signing finalization against the partner app",
    );
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "orders", base: 44, growth: 0.012, weekend: 1.4 }),
      ...genSeries(ctx, { metric: "revenue", base: 1500, growth: 0.012, weekend: 1.4, currency: "USD" }),
      ...genSeries(ctx, { metric: "units", base: 70, growth: 0.012, weekend: 1.4 }),
      ...genSeries(ctx, { metric: "refunds", base: 3, noise: 0.5 }),
      ...genSeries(ctx, { metric: "new_customers", base: 30, growth: 0.012, weekend: 1.3 }),
    ];
  },
};

// --- TikTok Ads ------------------------------------------------------------
const ADS_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export const tiktokAdsConnector: Connector = {
  provider: "tiktok_ads",
  category: "ads",
  label: "TikTok Ads",
  authType: "oauth2",
  scopes: [],
  metrics: ["ad_spend", "impressions", "clicks", "conversions"],

  isConfigured() {
    const c = config.integrations.tiktokAds;
    return Boolean(c.appId && c.appSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl("https://business-api.tiktok.com/portal/auth", {
      app_id: config.integrations.tiktokAds.appId,
      state: args.state,
      redirect_uri: args.redirectUri,
    });
  },

  async exchangeCode(code: string): Promise<TokenSet> {
    const c = config.integrations.tiktokAds;
    const res = await fetch(`${ADS_BASE}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: c.appId, secret: c.appSecret, auth_code: code }),
    });
    const body = (await res.json()) as {
      data?: { access_token: string; advertiser_ids?: string[] };
    };
    if (!body.data?.access_token) throw new Error("TikTok Ads token exchange failed");
    return { accessToken: body.data.access_token };
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const advertiserId = ctx.externalAccountId;
    if (!ctx.accessToken || !advertiserId) {
      throw new Error("TikTok Ads integration missing token or advertiser id");
    }
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_ADVERTISER",
      dimensions: JSON.stringify(["stat_time_day"]),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion"]),
      start_date: ctx.since.toISOString().slice(0, 10),
      end_date: ctx.until.toISOString().slice(0, 10),
    });
    const res = await fetch(`${ADS_BASE}/report/integrated/get/?${params}`, {
      headers: { "Access-Token": ctx.accessToken },
    });
    if (!res.ok) throw new Error(`TikTok Ads report failed (HTTP ${res.status})`);
    const body = (await res.json()) as {
      data?: { list?: { dimensions: { stat_time_day: string }; metrics: Record<string, string> }[] };
    };
    const out: NormalizedMetric[] = [];
    for (const row of body.data?.list ?? []) {
      const date = row.dimensions.stat_time_day.slice(0, 10);
      out.push({ metric: "ad_spend", date, value: Number(row.metrics.spend || 0) });
      out.push({ metric: "impressions", date, value: Number(row.metrics.impressions || 0) });
      out.push({ metric: "clicks", date, value: Number(row.metrics.clicks || 0) });
      out.push({ metric: "conversions", date, value: Number(row.metrics.conversion || 0) });
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "ad_spend", base: 360, growth: 0.008, noise: 0.3, currency: "USD" }),
      ...genSeries(ctx, { metric: "impressions", base: 120000, growth: 0.006, noise: 0.35 }),
      ...genSeries(ctx, { metric: "clicks", base: 2400, growth: 0.008, noise: 0.35 }),
      ...genSeries(ctx, { metric: "conversions", base: 28, growth: 0.01, noise: 0.4, weekend: 1.2 }),
    ];
  },
};

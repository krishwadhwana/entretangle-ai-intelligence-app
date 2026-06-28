// ---------------------------------------------------------------------------
// Meta (Facebook/Instagram) Ads connector. OAuth2 via the Facebook Login +
// Marketing API. Pulls daily ad insights — spend, impressions, clicks,
// conversions — per ad account. These give the REAL CAC/ROAS that the launch
// sim's predicted ad-spend → reach → CAC curve reconciles against.
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
import { buildAuthorizeUrl, getTokenJson } from "./oauth";
import { genSeries } from "../mock";

const GRAPH = "https://graph.facebook.com/v21.0";

export const metaAdsConnector: Connector = {
  provider: "meta_ads",
  category: "ads",
  label: "Meta Ads",
  authType: "oauth2",
  scopes: ["ads_read", "read_insights"],
  metrics: ["ad_spend", "impressions", "clicks", "conversions"],

  isConfigured() {
    const c = config.integrations.metaAds;
    return Boolean(c.appId && c.appSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl("https://www.facebook.com/v21.0/dialog/oauth", {
      client_id: config.integrations.metaAds.appId,
      redirect_uri: args.redirectUri,
      state: args.state,
      scope: (this.scopes ?? []).join(","),
      response_type: "code",
    });
  },

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const c = config.integrations.metaAds;
    const url = buildAuthorizeUrl(`${GRAPH}/oauth/access_token`, {
      client_id: c.appId,
      client_secret: c.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    // Exchange the short-lived token for a long-lived one (~60 days).
    const short = await getTokenJson(url);
    const longUrl = buildAuthorizeUrl(`${GRAPH}/oauth/access_token`, {
      grant_type: "fb_exchange_token",
      client_id: c.appId,
      client_secret: c.appSecret,
      fb_exchange_token: short.accessToken,
    });
    return getTokenJson(longUrl).catch(() => short);
  },

  async listExternalAccounts(token: TokenSet): Promise<ExternalAccount[]> {
    const res = await fetch(
      `${GRAPH}/me/adaccounts?fields=account_id,name&access_token=${token.accessToken}`,
    );
    const body = (await res.json()) as {
      data?: { account_id: string; name: string }[];
    };
    return (body.data ?? []).map((a) => ({
      id: `act_${a.account_id}`,
      name: a.name,
    }));
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const acct = ctx.externalAccountId;
    if (!ctx.accessToken || !acct) {
      throw new Error("Meta Ads integration missing token or ad account");
    }
    const params = new URLSearchParams({
      access_token: ctx.accessToken,
      level: "account",
      time_increment: "1",
      fields: "spend,impressions,clicks,actions",
      time_range: JSON.stringify({
        since: ctx.since.toISOString().slice(0, 10),
        until: ctx.until.toISOString().slice(0, 10),
      }),
    });
    const out: NormalizedMetric[] = [];
    let url = `${GRAPH}/${acct}/insights?${params.toString()}`;
    for (let page = 0; page < 40 && url; page++) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Meta insights failed (HTTP ${res.status})`);
      const body = (await res.json()) as {
        data?: {
          date_start: string;
          spend?: string;
          impressions?: string;
          clicks?: string;
          actions?: { action_type: string; value: string }[];
        }[];
        paging?: { next?: string };
      };
      for (const row of body.data ?? []) {
        const date = row.date_start;
        out.push({ metric: "ad_spend", date, value: Number(row.spend || 0) });
        out.push({ metric: "impressions", date, value: Number(row.impressions || 0) });
        out.push({ metric: "clicks", date, value: Number(row.clicks || 0) });
        const purchases = (row.actions ?? []).find((a) =>
          a.action_type.includes("purchase"),
        );
        if (purchases)
          out.push({ metric: "conversions", date, value: Number(purchases.value || 0) });
      }
      url = body.paging?.next ?? "";
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "ad_spend", base: 420, growth: 0.005, noise: 0.25, currency: "USD" }),
      ...genSeries(ctx, { metric: "impressions", base: 84000, growth: 0.004, noise: 0.3 }),
      ...genSeries(ctx, { metric: "clicks", base: 1500, growth: 0.005, noise: 0.3 }),
      ...genSeries(ctx, { metric: "conversions", base: 31, growth: 0.006, noise: 0.35, weekend: 1.15 }),
    ];
  },
};

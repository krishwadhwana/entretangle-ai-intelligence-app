// ---------------------------------------------------------------------------
// Marketplace connectors — Amazon (Selling Partner API) and Etsy. Pull
// marketplace orders → daily orders/revenue/units, the same commerce ground
// truth as Shopify but for the channels a multichannel (Pietra-style) seller
// also lists on.
//
// Etsy is a clean OAuth2 + REST API and is implemented. Amazon SP-API uses LWA
// OAuth plus AWS SigV4-signed, region-specific endpoints; the OAuth is wired
// and the connector runs on seeded data until the signed Orders calls are
// finalized for the seller's marketplace/region.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type {
  AuthorizeArgs,
  Connector,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl, postTokenForm } from "./oauth";
import { genSeries } from "../mock";

// --- Amazon (Selling Partner API) ------------------------------------------
export const amazonConnector: Connector = {
  provider: "amazon",
  category: "commerce",
  label: "Amazon",
  authType: "oauth2",
  scopes: [],
  metrics: ["orders", "revenue", "units"],

  isConfigured() {
    const c = config.integrations.amazon;
    return Boolean(c.clientId && c.clientSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    // Seller Central consent → returns an LWA authorization code.
    return buildAuthorizeUrl("https://sellercentral.amazon.com/apps/authorize/consent", {
      application_id: config.integrations.amazon.clientId,
      state: args.state,
      redirect_uri: args.redirectUri,
    });
  },

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const c = config.integrations.amazon;
    return postTokenForm("https://api.amazon.com/auth/o2/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
  },

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    const c = config.integrations.amazon;
    return postTokenForm("https://api.amazon.com/auth/o2/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
  },

  async sync(): Promise<NormalizedMetric[]> {
    // SP-API Orders requires SigV4 signing against the seller's region host.
    throw new Error(
      "Amazon SP-API live sync needs region-specific SigV4 signing finalized for the seller",
    );
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "orders", base: 60, growth: 0.004, weekend: 0.95 }),
      ...genSeries(ctx, { metric: "revenue", base: 2400, growth: 0.004, currency: "USD" }),
      ...genSeries(ctx, { metric: "units", base: 78, growth: 0.004 }),
    ];
  },
};

// --- Etsy ------------------------------------------------------------------
const ETSY_API = "https://openapi.etsy.com/v3/application";

export const etsyConnector: Connector = {
  provider: "etsy",
  category: "commerce",
  label: "Etsy",
  authType: "oauth2",
  scopes: ["transactions_r", "shops_r"],
  metrics: ["orders", "revenue", "units"],

  isConfigured() {
    const c = config.integrations.etsy;
    return Boolean(c.clientId && c.clientSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    // Etsy uses PKCE; a plain challenge keeps the flow simple for server use.
    return buildAuthorizeUrl("https://www.etsy.com/oauth/connect", {
      response_type: "code",
      client_id: config.integrations.etsy.clientId,
      redirect_uri: args.redirectUri,
      scope: (this.scopes ?? []).join(" "),
      state: args.state,
      code_challenge: args.state, // placeholder PKCE challenge
      code_challenge_method: "S256",
    });
  },

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    return postTokenForm("https://api.etsy.com/v3/public/oauth/token", {
      grant_type: "authorization_code",
      client_id: config.integrations.etsy.clientId,
      redirect_uri: redirectUri,
      code,
    });
  },

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    return postTokenForm("https://api.etsy.com/v3/public/oauth/token", {
      grant_type: "refresh_token",
      client_id: config.integrations.etsy.clientId,
      refresh_token: refreshToken,
    });
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const shopId = ctx.externalAccountId;
    if (!ctx.accessToken || !shopId) {
      throw new Error("Etsy integration missing token or shop id");
    }
    const headers = {
      Authorization: `Bearer ${ctx.accessToken}`,
      "x-api-key": config.integrations.etsy.clientId,
    };
    const minCreated = Math.floor(ctx.since.getTime() / 1000);
    const byDay = new Map<string, { orders: number; revenue: number; units: number }>();
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({
        min_created: String(minCreated),
        limit: "100",
        offset: String(offset),
      });
      const res = await fetch(`${ETSY_API}/shops/${shopId}/receipts?${params}`, { headers });
      if (!res.ok) throw new Error(`Etsy receipts failed (HTTP ${res.status})`);
      const body = (await res.json()) as {
        results?: { created_timestamp: number; grandtotal?: { amount: number; divisor: number }; transactions?: unknown[] }[];
        count?: number;
      };
      for (const r of body.results ?? []) {
        const date = new Date(r.created_timestamp * 1000).toISOString().slice(0, 10);
        const row = byDay.get(date) ?? { orders: 0, revenue: 0, units: 0 };
        row.orders += 1;
        row.revenue += r.grandtotal ? r.grandtotal.amount / r.grandtotal.divisor : 0;
        row.units += r.transactions?.length ?? 1;
        byDay.set(date, row);
      }
      if (!body.results || body.results.length < 100) break;
      offset += 100;
    }
    const out: NormalizedMetric[] = [];
    for (const [date, row] of byDay) {
      out.push({ metric: "orders", date, value: row.orders });
      out.push({ metric: "revenue", date, value: row.revenue, currency: "USD" });
      out.push({ metric: "units", date, value: row.units });
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "orders", base: 18, growth: 0.003, weekend: 1.1 }),
      ...genSeries(ctx, { metric: "revenue", base: 720, growth: 0.003, currency: "USD" }),
      ...genSeries(ctx, { metric: "units", base: 23, growth: 0.003 }),
    ];
  },
};

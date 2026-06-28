// ---------------------------------------------------------------------------
// Stripe connector. Stripe Connect OAuth (read_only): the merchant clicks
// Connect and approves on Stripe's own screen — no key pasting. Pulls succeeded
// charges in the window → daily revenue + refunds + new customers; MRR/churn
// are mock for now (they need subscription enumeration). The per-account token
// from OAuth is stored encrypted.
//
// One-time operator setup: enable Stripe Connect, then set STRIPE_CLIENT_ID
// (the ca_… OAuth client id) and STRIPE_SECRET_KEY (used to authenticate the
// token exchange) in the environment. See docs/integrations-setup.md.
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

export const stripeConnector: Connector = {
  provider: "stripe",
  category: "payments",
  label: "Stripe",
  authType: "oauth2",
  // Stripe gates the read_only scope behind a support request; read_write is the
  // default every platform can use immediately. We only ever GET (never write),
  // so the broader grant is unused — it's just what Stripe allows out of the box.
  scopes: ["read_write"],
  metrics: ["revenue", "refunds", "refund_amount", "new_customers", "mrr", "churn"],

  isConfigured() {
    const c = config.integrations.stripe;
    return Boolean(c.clientId && c.secretKey);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl("https://connect.stripe.com/oauth/authorize", {
      response_type: "code",
      client_id: config.integrations.stripe.clientId,
      scope: "read_write",
      redirect_uri: args.redirectUri,
      state: args.state,
    });
  },

  async exchangeCode(code: string): Promise<TokenSet> {
    // Stripe authenticates the token request with the platform secret key; the
    // returned access_token is scoped to the connected account.
    return postTokenForm("https://connect.stripe.com/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_secret: config.integrations.stripe.secretKey,
    });
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    if (!ctx.accessToken) throw new Error("Stripe integration missing token");
    const out: NormalizedMetric[] = [];
    const gte = Math.floor(ctx.since.getTime() / 1000);
    const lte = Math.floor(ctx.until.getTime() / 1000);
    let starting_after: string | undefined;
    type Charge = {
      id: string;
      created: number;
      amount: number;
      currency: string;
      paid: boolean;
      refunded: boolean;
      amount_refunded: number;
      customer?: string | null;
    };
    const seenCustomers = new Set<string>();
    const byDayRevenue = new Map<string, number>();
    const byDayRefund = new Map<string, number>();
    const byDayNew = new Map<string, number>();
    let currency = "usd";
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({
        "created[gte]": String(gte),
        "created[lte]": String(lte),
        limit: "100",
      });
      if (starting_after) params.set("starting_after", starting_after);
      const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });
      if (!res.ok) throw new Error(`Stripe charges failed (HTTP ${res.status})`);
      const body = (await res.json()) as { data: Charge[]; has_more: boolean };
      for (const ch of body.data) {
        if (!ch.paid) continue;
        const date = new Date(ch.created * 1000).toISOString().slice(0, 10);
        currency = ch.currency || currency;
        byDayRevenue.set(date, (byDayRevenue.get(date) ?? 0) + ch.amount / 100);
        if (ch.amount_refunded > 0)
          byDayRefund.set(date, (byDayRefund.get(date) ?? 0) + ch.amount_refunded / 100);
        if (ch.customer && !seenCustomers.has(ch.customer)) {
          seenCustomers.add(ch.customer);
          byDayNew.set(date, (byDayNew.get(date) ?? 0) + 1);
        }
      }
      if (!body.has_more || body.data.length === 0) break;
      starting_after = body.data[body.data.length - 1].id;
    }
    const cur = currency.toUpperCase();
    for (const [date, value] of byDayRevenue)
      out.push({ metric: "revenue", date, value, currency: cur });
    for (const [date, value] of byDayRefund)
      out.push({ metric: "refund_amount", date, value, currency: cur });
    for (const [date, value] of byDayNew)
      out.push({ metric: "new_customers", date, value });
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "revenue", base: 2900, growth: 0.006, noise: 0.2, currency: "USD" }),
      ...genSeries(ctx, { metric: "refund_amount", base: 95, noise: 0.5, currency: "USD" }),
      ...genSeries(ctx, { metric: "new_customers", base: 26, growth: 0.006, noise: 0.25 }),
      ...genSeries(ctx, { metric: "mrr", base: 18000, growth: 0.01, noise: 0.05, currency: "USD" }),
      ...genSeries(ctx, { metric: "churn", base: 3.2, growth: -0.001, noise: 0.3, round: false }),
    ];
  },
};

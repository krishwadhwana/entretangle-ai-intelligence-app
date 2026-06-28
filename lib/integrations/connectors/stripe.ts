// ---------------------------------------------------------------------------
// Stripe connector. Authenticates with a restricted (read-only) API key the
// merchant pastes — the simplest path to read your OWN account's revenue, with
// no Stripe Connect platform setup. Pulls succeeded charges in the window →
// daily revenue + refunds + new customers; MRR/churn are mock for now (they
// need subscription enumeration). The key is stored per-integration, encrypted.
// Needs only the "Charges: Read" permission.
//
// (Multi-tenant note: to connect OTHER businesses' accounts later, swap this
// for Stripe Connect OAuth — the connector interface supports authType oauth2.)
// ---------------------------------------------------------------------------
import type { Connector, NormalizedMetric, SyncContext } from "../types";
import { genSeries } from "../mock";

const STRIPE_API = "https://api.stripe.com/v1";

export const stripeConnector: Connector = {
  provider: "stripe",
  category: "payments",
  label: "Stripe",
  authType: "apiKey",
  metrics: ["revenue", "refunds", "refund_amount", "new_customers", "mrr", "churn"],
  connectFields: [
    {
      name: "secretKey",
      label: "Stripe restricted key",
      placeholder: "rk_live_… (grant Charges: Read)",
    },
  ],

  isConfigured() {
    return true; // per-account key, validated at connect time
  },

  async connectWithKey(input) {
    const key = (input.secretKey || "").trim();
    if (!key) throw new Error("Stripe restricted key is required");
    // Validate (and confirm Charges: Read) with a 1-row charges call.
    const res = await fetch(`${STRIPE_API}/charges?limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(
        `Stripe rejected the key (HTTP ${res.status}). Make sure it has "Charges: Read".`,
      );
    }
    const mode =
      key.startsWith("rk_live_") || key.startsWith("sk_live_") ? "live" : "test";
    return {
      token: { accessToken: key },
      externalAccountId: "stripe",
      displayName: `Stripe (${mode})`,
      metadata: { mode },
    };
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

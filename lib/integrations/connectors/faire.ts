// ---------------------------------------------------------------------------
// Faire connector — wholesale / B2B orders. Faire is where a brand sells to
// retail buyers, so it grounds the retail-buyer + distributor personas with
// real wholesale order volume, AOV and revenue. Auth is a per-brand API token
// the seller pastes (Faire → Settings → Integrations), so there's no
// platform-wide OAuth app to configure.
// ---------------------------------------------------------------------------
import type { Connector, NormalizedMetric, SyncContext } from "../types";
import { genSeries } from "../mock";

const FAIRE_API = "https://www.faire.com/external-api/v2";

type FaireOrder = { created_at: string; items?: { quantity: number }[]; total?: { amount_cents: number; currency: string } };

export const faireConnector: Connector = {
  provider: "faire",
  category: "commerce",
  label: "Faire (wholesale)",
  authType: "apiKey",
  metrics: ["orders", "revenue", "units"],
  connectFields: [{ name: "apiKey", label: "Faire API token", placeholder: "Settings → Integrations" }],

  isConfigured() {
    return true; // per-account token
  },

  async connectWithKey(input) {
    const apiKey = (input.apiKey || "").trim();
    if (!apiKey) throw new Error("Faire API token is required");
    const res = await fetch(`${FAIRE_API}/orders?limit=1`, {
      headers: { "X-FAIRE-ACCESS-TOKEN": apiKey },
    });
    if (!res.ok) throw new Error(`Faire rejected the token (HTTP ${res.status})`);
    return {
      token: { accessToken: apiKey },
      externalAccountId: "faire",
      displayName: "Faire wholesale",
      metadata: {},
    };
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    if (!ctx.accessToken) throw new Error("Faire integration missing token");
    const headers = { "X-FAIRE-ACCESS-TOKEN": ctx.accessToken };
    const byDay = new Map<string, { orders: number; revenue: number; units: number }>();
    let currency = "USD";
    let page = 1;
    for (; page <= 20; page++) {
      const res = await fetch(`${FAIRE_API}/orders?page=${page}&limit=50`, { headers });
      if (!res.ok) throw new Error(`Faire orders failed (HTTP ${res.status})`);
      const body = (await res.json()) as { orders?: FaireOrder[] };
      const orders = body.orders ?? [];
      for (const o of orders) {
        const t = new Date(o.created_at).getTime();
        if (t < ctx.since.getTime() || t > ctx.until.getTime()) continue;
        const date = new Date(o.created_at).toISOString().slice(0, 10);
        const row = byDay.get(date) ?? { orders: 0, revenue: 0, units: 0 };
        row.orders += 1;
        if (o.total) {
          row.revenue += o.total.amount_cents / 100;
          currency = o.total.currency || currency;
        }
        row.units += (o.items ?? []).reduce((s, i) => s + (i.quantity || 0), 0);
        byDay.set(date, row);
      }
      if (orders.length < 50) break;
    }
    const out: NormalizedMetric[] = [];
    for (const [date, row] of byDay) {
      out.push({ metric: "orders", date, value: row.orders });
      out.push({ metric: "revenue", date, value: row.revenue, currency });
      out.push({ metric: "units", date, value: row.units });
    }
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    // Wholesale: fewer, larger, weekday-skewed orders.
    return [
      ...genSeries(ctx, { metric: "orders", base: 6, growth: 0.005, weekend: 0.4, noise: 0.4 }),
      ...genSeries(ctx, { metric: "revenue", base: 2200, growth: 0.005, weekend: 0.4, noise: 0.4, currency: "USD" }),
      ...genSeries(ctx, { metric: "units", base: 120, growth: 0.005, weekend: 0.4, noise: 0.4 }),
    ];
  },
};

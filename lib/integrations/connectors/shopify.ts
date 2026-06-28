// ---------------------------------------------------------------------------
// Shopify connector (full live, OAuth install flow — same self-serve model as
// the other connectors). The merchant types their shop domain, clicks Connect,
// approves on Shopify's own consent screen, and their offline Admin API token
// comes back and is stored per-integration. No env editing per customer; the
// only one-time setup is the platform's Shopify app (SHOPIFY_API_KEY/SECRET).
//
// Shopify is per-shop: the authorize + token endpoints live on the merchant's
// own *.myshopify.com domain, so the shop domain is threaded through
// connect → authorize → callback (AuthorizeArgs.shopDomain / exchangeCode ctx).
//
// Sync: pulls orders in the window and aggregates them, in code, into daily
// normalized metrics — orders, revenue, units, refunds, refund_amount,
// new_customers vs returning_customers. This is the ground truth the launch
// simulation's predicted orders/AOV/refund-rate/repeat-rate reconcile against.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import { log } from "../../log";
import type {
  AuthorizeArgs,
  Connector,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl } from "./oauth";
import { genSeries } from "../mock";

const API_VERSION = "2024-10";

/** Normalize "my-store", "my-store.myshopify.com", "https://…" → host only. */
export function normalizeShopDomain(input: string): string {
  let d = input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return "";
  if (!d.includes(".")) d = `${d}.myshopify.com`;
  return d.toLowerCase();
}

function shopBase(domain: string): string {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${clean}/admin/api/${API_VERSION}`;
}

type ShopifyOrder = {
  created_at: string;
  current_total_price: string;
  total_discounts: string;
  currency: string;
  line_items: { quantity: number }[];
  refunds: {
    created_at: string;
    refund_line_items: { subtotal: string; quantity: number }[];
    transactions?: { amount: string }[];
  }[];
  customer?: { id: number } | null;
};

function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const SCOPES = ["read_orders", "read_products", "read_customers"];

export const shopifyConnector: Connector = {
  provider: "shopify",
  category: "commerce",
  label: "Shopify",
  authType: "oauth2",
  scopes: SCOPES,
  metrics: [
    "orders",
    "revenue",
    "units",
    "refunds",
    "refund_amount",
    "new_customers",
    "returning_customers",
  ],

  isConfigured() {
    const c = config.integrations.shopify;
    return Boolean(c.apiKey && c.apiSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    const shop = normalizeShopDomain(args.shopDomain ?? "");
    if (!shop) throw new Error("a shop domain is required to connect Shopify");
    // Per-shop authorize endpoint on the merchant's own domain.
    return buildAuthorizeUrl(`https://${shop}/admin/oauth/authorize`, {
      client_id: config.integrations.shopify.apiKey,
      scope: SCOPES.join(","),
      redirect_uri: args.redirectUri,
      state: args.state,
    });
  },

  async exchangeCode(
    code: string,
    _redirectUri: string,
    ctx?: { shopDomain?: string },
  ): Promise<TokenSet> {
    const shop = normalizeShopDomain(ctx?.shopDomain ?? "");
    if (!shop) throw new Error("missing shop domain for Shopify token exchange");
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.integrations.shopify.apiKey,
        client_secret: config.integrations.shopify.apiSecret,
        code,
      }),
    });
    if (!res.ok) {
      throw new Error(`Shopify token exchange failed (HTTP ${res.status})`);
    }
    const body = (await res.json()) as { access_token: string; scope?: string };
    // Shopify offline tokens don't expire and have no refresh token.
    return { accessToken: body.access_token, scope: body.scope ?? null };
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const shopDomain =
      (ctx.metadata.shopDomain as string) || ctx.externalAccountId || "";
    if (!ctx.accessToken || !shopDomain) {
      throw new Error("Shopify integration missing token or shop domain");
    }
    const headers = { "X-Shopify-Access-Token": ctx.accessToken };
    const orders: ShopifyOrder[] = [];
    // Cursor pagination over the created_at window.
    let url =
      `${shopBase(shopDomain)}/orders.json?status=any&limit=250` +
      `&created_at_min=${ctx.since.toISOString()}` +
      `&created_at_max=${ctx.until.toISOString()}`;
    for (let page = 0; page < 40 && url; page++) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Shopify orders fetch failed (HTTP ${res.status})`);
      }
      const body = (await res.json()) as { orders: ShopifyOrder[] };
      orders.push(...body.orders);
      // Link header drives cursor pagination.
      const link = res.headers.get("link") || "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : "";
    }
    return aggregateOrders(orders, ctx);
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    const currency = (ctx.metadata.currency as string) || "USD";
    return [
      ...genSeries(ctx, { metric: "orders", base: 38, growth: 0.006, weekend: 1.25 }),
      ...genSeries(ctx, { metric: "revenue", base: 2600, growth: 0.006, weekend: 1.25, currency }),
      ...genSeries(ctx, { metric: "units", base: 52, growth: 0.006, weekend: 1.25 }),
      ...genSeries(ctx, { metric: "refunds", base: 2, growth: 0.002, noise: 0.5 }),
      ...genSeries(ctx, { metric: "refund_amount", base: 130, noise: 0.5, currency }),
      ...genSeries(ctx, { metric: "new_customers", base: 22, growth: 0.005, weekend: 1.2 }),
      ...genSeries(ctx, { metric: "returning_customers", base: 14, growth: 0.008 }),
    ];
  },
};

/** Pure aggregation: orders[] → daily normalized metrics. Exported for tests. */
export function aggregateOrders(
  orders: ShopifyOrder[],
  ctx: SyncContext,
): NormalizedMetric[] {
  type Day = {
    orders: number;
    revenue: number;
    units: number;
    refunds: number;
    refundAmount: number;
    newCustomers: number;
    returningCustomers: number;
  };
  const byDay = new Map<string, Day>();
  const seenCustomers = new Set<number>();
  let currency = (ctx.metadata.currency as string) || "USD";

  const ensure = (d: string): Day => {
    let row = byDay.get(d);
    if (!row) {
      row = {
        orders: 0,
        revenue: 0,
        units: 0,
        refunds: 0,
        refundAmount: 0,
        newCustomers: 0,
        returningCustomers: 0,
      };
      byDay.set(d, row);
    }
    return row;
  };

  for (const o of orders) {
    const d = dayOf(o.created_at);
    const row = ensure(d);
    currency = o.currency || currency;
    row.orders += 1;
    row.revenue += Number(o.current_total_price || 0);
    row.units += o.line_items.reduce((s, li) => s + (li.quantity || 0), 0);
    // First-vs-repeat from the customer id we've seen in this window.
    const cid = o.customer?.id;
    if (cid != null) {
      if (seenCustomers.has(cid)) row.returningCustomers += 1;
      else {
        row.newCustomers += 1;
        seenCustomers.add(cid);
      }
    }
    for (const r of o.refunds || []) {
      const rd = dayOf(r.created_at);
      const rrow = ensure(rd);
      rrow.refunds += 1;
      const amt =
        r.transactions?.reduce((s, t) => s + Number(t.amount || 0), 0) ??
        r.refund_line_items.reduce((s, li) => s + Number(li.subtotal || 0), 0);
      rrow.refundAmount += amt;
    }
  }

  const out: NormalizedMetric[] = [];
  for (const [date, row] of byDay) {
    out.push({ metric: "orders", date, value: row.orders });
    out.push({ metric: "revenue", date, value: row.revenue, currency });
    out.push({ metric: "units", date, value: row.units });
    if (row.refunds) out.push({ metric: "refunds", date, value: row.refunds });
    if (row.refundAmount)
      out.push({ metric: "refund_amount", date, value: row.refundAmount, currency });
    if (row.newCustomers)
      out.push({ metric: "new_customers", date, value: row.newCustomers });
    if (row.returningCustomers)
      out.push({ metric: "returning_customers", date, value: row.returningCustomers });
  }
  log.debug("shopify aggregate", { days: byDay.size, orders: orders.length });
  return out;
}

void config; // referenced for parity with other connectors; live creds are per-integration

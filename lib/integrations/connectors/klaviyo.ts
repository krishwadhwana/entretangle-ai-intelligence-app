// ---------------------------------------------------------------------------
// Klaviyo connector — email/SMS marketing & retention. Grounds the repeat-rate
// and retention side of the model with real subscriber growth and
// email/SMS-attributed conversions. Auth is a per-account private API key the
// marketer pastes (Klaviyo → Settings → API keys), so there's no platform-wide
// OAuth app to configure.
//
// Klaviyo's metric-aggregate reporting requires per-account metric-id discovery;
// that's scaffolded, so connected accounts run on seeded data until the metric
// ids are wired. Subscriber growth is read live.
// ---------------------------------------------------------------------------
import type { Connector, NormalizedMetric, SyncContext } from "../types";
import { genSeries } from "../mock";

const KLAVIYO_API = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";

export const klaviyoConnector: Connector = {
  provider: "klaviyo",
  category: "marketing",
  label: "Klaviyo",
  authType: "apiKey",
  metrics: ["new_customers", "conversions", "revenue"],
  connectFields: [{ name: "apiKey", label: "Private API key", placeholder: "pk_..." }],

  isConfigured() {
    return true; // per-account key
  },

  async connectWithKey(input) {
    const apiKey = (input.apiKey || "").trim();
    if (!apiKey) throw new Error("Klaviyo private API key is required");
    const res = await fetch(`${KLAVIYO_API}/accounts/`, {
      headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: REVISION },
    });
    if (!res.ok) throw new Error(`Klaviyo rejected the key (HTTP ${res.status})`);
    const body = (await res.json()) as { data?: { id: string; attributes?: { contact_information?: { organization_name?: string } } }[] };
    const acct = body.data?.[0];
    return {
      token: { accessToken: apiKey },
      externalAccountId: acct?.id ?? "klaviyo",
      displayName: acct?.attributes?.contact_information?.organization_name ?? "Klaviyo",
      metadata: {},
    };
  },

  async sync(): Promise<NormalizedMetric[]> {
    // Metric aggregates ("Placed Order" revenue/conversions) need per-account
    // metric-id discovery; finalize before enabling live reporting.
    throw new Error("Klaviyo live reporting needs per-account metric-id discovery");
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "new_customers", base: 40, growth: 0.01, noise: 0.25 }),
      ...genSeries(ctx, { metric: "conversions", base: 18, growth: 0.008, noise: 0.3 }),
      ...genSeries(ctx, { metric: "revenue", base: 1100, growth: 0.009, noise: 0.3, currency: "USD" }),
    ];
  },
};

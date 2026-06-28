// Centralized env-derived run caps (SPEC §0.5, §10; SPEC-V2 §2).
function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  get mockMode() {
    return process.env.MOCK_MODE === "true";
  },
  get maxBlocksPerRun() {
    return intEnv("MAX_BLOCKS_PER_RUN", 28);
  },
  get maxDesksPerRun() {
    return intEnv("MAX_DESKS_PER_RUN", 18);
  },
  get maxLayers() {
    return intEnv("MAX_LAYERS", 4);
  },
  get maxTokensPerRun() {
    return intEnv("MAX_TOKENS_PER_RUN", 600000);
  },
  get blockTimeoutMs() {
    return intEnv("BLOCK_TIMEOUT_MS", 180000);
  },
  /** Per cohort-batch LLM call timeout — generous, because rich personas take
   * a while to generate. The OpenAI SDK aborts the request at this limit (it
   * does NOT just abandon a still-running call), so a genuine hang is
   * cancelled without billing for nothing. */
  get cohortTimeoutMs() {
    return intEnv("COHORT_TIMEOUT_MS", 240000);
  },
  // --- v2: audience simulation ---
  get maxCohorts() {
    return intEnv("MAX_COHORTS", 120);
  },
  /**
   * The whole simulated audience targets ~this many personas, distributed
   * across the planner's cohorts by audience share. Each cohort is then
   * simulated in batches of `personasPerCall` (one mini-model call each).
   */
  get targetAudienceSize() {
    return intEnv("TARGET_AUDIENCE_SIZE", 6000);
  },
  /** Personas per single mini-model call (hard-capped at 60 by the schema).
   * Smaller batches generate faster and far more reliably now that each
   * persona carries rich depth fields. */
  get personasPerCall() {
    return Math.min(60, intEnv("PERSONAS_PER_CALL", 25));
  },
  /** Floor so even small cohorts carry statistical + demographic signal. */
  get minPersonasPerCohort() {
    return intEnv("MIN_PERSONAS_PER_COHORT", 40);
  },
  /** Back-compat default cohort size when no target distribution applies. */
  get personasPerCohort() {
    return intEnv("PERSONAS_PER_COHORT", 40);
  },
  get audienceConcurrency() {
    return intEnv("AUDIENCE_CONCURRENCY", 10);
  },
  get deskConcurrency() {
    return intEnv("DESK_CONCURRENCY", 6);
  },
  // --- v2: model mix + cost cap ---
  /** Frontier model: planner, desks, entangler, synthesis, query. */
  get model() {
    return process.env.MODEL_FRONTIER || process.env.LLM_MODEL || "gpt-5.5";
  },
  /** Mini model: batched cohort/persona simulation. */
  get miniModel() {
    return process.env.MODEL_MINI || "gpt-5-mini";
  },
  get maxCostUsd() {
    return floatEnv("MAX_COST_USD", 5);
  },
  // $ per 1M tokens (env-overridable as published prices move).
  get pricing() {
    return {
      frontierIn: floatEnv("PRICE_FRONTIER_IN", 1.25),
      frontierOut: floatEnv("PRICE_FRONTIER_OUT", 10),
      miniIn: floatEnv("PRICE_MINI_IN", 0.25),
      miniOut: floatEnv("PRICE_MINI_OUT", 2),
      webSearchPerCall: floatEnv("PRICE_WEB_SEARCH", 0.01),
    };
  },
  // --- Business integrations (connected accounts) ---
  // The base URL providers redirect back to after OAuth. Must exactly match the
  // redirect URI registered in each provider's developer app. Defaults to the
  // auth base so dev "just works".
  get integrationsRedirectBase() {
    return (
      process.env.INTEGRATIONS_REDIRECT_BASE ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000"
    );
  },
  // Per-provider OAuth/API credentials. A connector is "configured" (and so
  // pulls LIVE data instead of seeded mock data) only when its creds are set.
  get integrations() {
    return {
      shopify: {
        apiKey: process.env.SHOPIFY_API_KEY || "",
        apiSecret: process.env.SHOPIFY_API_SECRET || "",
      },
      metaAds: {
        appId: process.env.META_APP_ID || process.env.FACEBOOK_CLIENT_ID || "",
        appSecret:
          process.env.META_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET || "",
      },
      google: {
        // Dedicated OAuth client for GA4 / Google Ads integrations, kept
        // separate from the auth (login) client. Falls back to the auth client
        // if the dedicated one isn't set.
        clientId:
          process.env.GOOGLE_INTEGRATIONS_CLIENT_ID ||
          process.env.GOOGLE_CLIENT_ID ||
          "",
        clientSecret:
          process.env.GOOGLE_INTEGRATIONS_CLIENT_SECRET ||
          process.env.GOOGLE_CLIENT_SECRET ||
          "",
        adsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      },
      stripe: {
        clientId: process.env.STRIPE_CLIENT_ID || "",
        secretKey: process.env.STRIPE_SECRET_KEY || "",
      },
      quickbooks: {
        clientId: process.env.QUICKBOOKS_CLIENT_ID || "",
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || "",
      },
      tiktokShop: {
        appKey: process.env.TIKTOK_SHOP_APP_KEY || "",
        appSecret: process.env.TIKTOK_SHOP_APP_SECRET || "",
      },
      tiktokAds: {
        appId: process.env.TIKTOK_ADS_APP_ID || "",
        appSecret: process.env.TIKTOK_ADS_APP_SECRET || "",
      },
      amazon: {
        clientId: process.env.AMAZON_LWA_CLIENT_ID || "",
        clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || "",
      },
      etsy: {
        clientId: process.env.ETSY_CLIENT_ID || "",
        clientSecret: process.env.ETSY_CLIENT_SECRET || "",
      },
      // Faire + Klaviyo authenticate per-account with an API key the customer
      // pastes — no platform-wide OAuth app, so nothing to configure here.
      unified: {
        provider: process.env.UNIFIED_API_PROVIDER || "",
        apiKey: process.env.UNIFIED_API_KEY || "",
      },
    };
  },
};

# Integrations setup (operator guide)

Connecting a customer's real business data (Shopify, Meta Ads, Google, Stripe,
QuickBooks) is **self-serve**: a customer clicks **Connect**, approves on the
provider's own screen, and their access token is stored — encrypted — against
their own project. Customers never touch configuration.

The **only** setup is yours, the platform operator, and it's **once per
provider, ever**: register one app with each provider and drop its credentials
into the environment. This is the same model as "Sign in with Google" — one app
registration, unlimited end users.

Until a provider's credentials are set, its card falls back to clearly-labelled
**demo data** so the dashboard stays usable.

## What goes where

Each provider needs (a) credentials in env and (b) one **redirect URI**
registered in the provider's app, of the form:

```
{INTEGRATIONS_REDIRECT_BASE}/api/integrations/callback/<provider>
```

`INTEGRATIONS_REDIRECT_BASE` defaults to `NEXTAUTH_URL`. Examples:
- Local dev: `http://localhost:3000/api/integrations/callback/shopify`
- Production: `https://app.yourdomain.com/api/integrations/callback/shopify`

Also set once, platform-wide:
- `INTEGRATIONS_ENC_KEY` — token encryption key. Generate: `openssl rand -hex 32`.
  Required in production (unset = tokens stored in plaintext + a warning).

## Per-provider

| Provider | Register the app | Credentials → env | Redirect URI(s) to register |
|---|---|---|---|
| **Shopify** | [partners.shopify.com](https://partners.shopify.com) → Apps → Create app. Scopes: `read_orders`, `read_products`, `read_customers`. | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | `…/callback/shopify` |
| **Meta Ads** | [developers.facebook.com/apps](https://developers.facebook.com/apps) → Create app (Business) → add **Marketing API** + **Facebook Login**. Permissions: `ads_read`, `read_insights`. | `META_APP_ID`, `META_APP_SECRET` | `…/callback/meta_ads` |
| **Google** (GA4 + Ads) | [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → OAuth client ID (Web). Enable APIs: *Google Analytics Data API*, *Analytics Admin API*, *Google Ads API*. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **both** `…/callback/ga4` and `…/callback/google_ads` |
| **Google Ads token** | [ads.google.com/aw/apicenter](https://ads.google.com/aw/apicenter) | `GOOGLE_ADS_DEVELOPER_TOKEN` | — |
| **Stripe** | Enable Connect, then **Settings → Connect → Onboarding options → OAuth** for the `ca_…` client id. Secret key from **Developers → API keys**. | `STRIPE_CLIENT_ID` (the `ca_…` id), `STRIPE_SECRET_KEY` (`sk_…`) | `…/callback/stripe` |
| **QuickBooks** | [developer.intuit.com](https://developer.intuit.com) → create app (accounting scope). | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | `…/callback/quickbooks` |
| **TikTok Shop** | [partner.tiktokshop.com](https://partner.tiktokshop.com) → create app. | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` | `…/callback/tiktok_shop` |
| **TikTok Ads** | [ads.tiktok.com/marketing_api](https://ads.tiktok.com/marketing_api) → TikTok for Business app. | `TIKTOK_ADS_APP_ID`, `TIKTOK_ADS_APP_SECRET` | `…/callback/tiktok_ads` |
| **Amazon** | [developer.amazon.com](https://developer.amazon.com) → Login with Amazon + Selling Partner API app. | `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET` | `…/callback/amazon` |
| **Etsy** | [etsy.com/developers](https://www.etsy.com/developers) → create an Open API v3 app. | `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET` | `…/callback/etsy` |
| **Faire** (wholesale) | No platform app — the brand pastes a Faire API token (Faire → Settings → Integrations). | — (per-account key) | — |
| **Klaviyo** | No platform app — the marketer pastes a private API key (Klaviyo → Settings → API keys). | — (per-account key) | — |

### Notes that save time
- **Google is one OAuth client** for both GA4 and Google Ads — register both
  redirect URIs on it, and enable all three Google APIs listed above.
- **App review:** Meta and Google Ads require provider app review before they can
  read *other people's* accounts in production (your own account works
  immediately in their dev/test mode). Shopify, Stripe and QuickBooks go live as
  soon as the app exists.
- **Sandbox vs production:** QuickBooks and Stripe have separate
  sandbox/test credentials — use those while developing.
- **Other accounting tools** (Xero, Tally, Zoho Books) are the same category as
  QuickBooks and can be added later through the unified aggregator
  (`UNIFIED_API_PROVIDER` / `UNIFIED_API_KEY`).
- **Faire and Klaviyo** authenticate with a pasted per-account API key — no
  platform-wide app, so nothing goes in env for them.
- **Multichannel revenue sums.** Orders/revenue/units from distinct sales
  channels (Shopify, TikTok Shop, Amazon, Etsy, Faire) add together; payment/
  accounting/analytics sources are used only as a fallback to avoid
  double-counting the same money.
- **Live-sync status:** Shopify, Stripe, QuickBooks, GA4, Etsy, TikTok Ads and
  Faire have implemented live sync; Amazon SP-API (SigV4 signing), TikTok Shop
  (request signing) and Klaviyo (metric-id discovery) are OAuth/key-wired and
  run on demo data until those provider-specific steps are finalized.

## How it behaves

- **Credentials set** → Connect runs the real OAuth flow; sync pulls live data.
- **Credentials unset / `MOCK_MODE=true`** → Connect attaches a demo account with
  seeded sample data, badged **Demo** in the UI. Disconnecting removes it cleanly.

See `.env.example` for the full list of keys.

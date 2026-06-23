# Company Intelligence Sources

This folder documents the source policy for the public-company tracker.

## Implemented

### SEC EDGAR APIs
- **Source type:** official API
- **Endpoints used:**
  - `https://www.sec.gov/files/company_tickers_exchange.json`
  - `https://data.sec.gov/submissions/CIK##########.json`
  - `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
- **Used for:** US-listed company identity, exchange listings, recent filings,
  filing document URLs, and structured XBRL financial facts.
- **Command:** `npm run intel:companies -- --tickers AAPL,NVDA --dry-run`
- **Persistence:** run `npm run db:migrate` first, then omit `--dry-run`.
- **Required env for regular use:** `SEC_USER_AGENT="app name contact@email"`

### Crunchbase API / licensed exports
- **Source type:** licensed API or manual upload of a permitted export
- **Endpoints supported:**
  - `https://api.crunchbase.com/v4/data/entities/organizations/{entity_id}`
- **Docs:** `https://data.crunchbase.com/docs/using-the-api` and
  `https://data.crunchbase.com/docs/using-entity-lookup-apis`
- **Used for:** private-company identity, categories, founding date, founders,
  funding/investor cards when returned by the account's Crunchbase plan, and
  founder story snapshots.
- **Commands:**
  - API: `npm run intel:founders -- --companies airbnb,stripe --dry-run`
- **Required env for API use:** `CRUNCHBASE_API_KEY`
- **Policy:** do not scrape Crunchbase HTML pages. Use the authenticated API,
  a plan-permitted export, or founder-provided excerpts that the user is allowed
  to upload.

## Connector Slots

### Nasdaq Data Link / Nasdaq licensed data
- **Source type:** licensed API
- **Intended use:** price snapshots, historical prices, exchange market data and
  enriched listed-company market data.
- **Env:** `NASDAQ_DATA_LINK_API_KEY`
- **Policy:** do not scrape Nasdaq web pages for production data when a licensed
  feed/API is required.

### NSE official/licensed data
- **Source type:** official or licensed API/feed
- **Intended use:** NSE-listed company announcements, corporate filings,
  end-of-day/historical market data and price snapshots.
- **Env:** `NSE_DATA_API_KEY`
- **Policy:** start with public filings/announcements; use official/licensed
  market data products for price feeds.

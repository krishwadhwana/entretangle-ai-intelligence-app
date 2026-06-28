# Venture Platform — Build Handoff

**Status:** in progress · **Last updated:** 2026-06-28 · **Owner:** Karthik

This document is for whoever picks up the venture-building features next. It
covers (1) the original product vision and how it was triaged, (2) what's been
built so far, (3) what's left to finish the shipped features, and (4) a detailed
spec for the **manufacturer sourcing agent** (the directory-scraping/outreach
piece), which is the next big build.

Repo context: Next.js 14 (App Router) · TypeScript · Postgres (Neon) via Prisma ·
NextAuth · Tailwind. A **Project = one venture**. See the Explore notes in
[DATA_PLAN.md](../DATA_PLAN.md) for the data discipline (every number is
`sourced` or flagged `estimate`).

---

## 0. The original vision (triaged)

The original brief was a single large dump describing an end-to-end
venture-building platform. It was ~8 distinct initiatives of very different size
and risk. Triage:

| Initiative | Size | Status |
|---|---|---|
| Per-project **progression scoring** (idea/planning/business-plan/lab-report/money-vs-output, scenarios) | M | ✅ **Built** (this round) |
| **Salesforce** integration (OAuth) | S | ✅ **Built**, "coming soon" (not enabled) |
| **Manufacturer sourcing table** (MOQ, sample price, lead time, payment terms) | M | ✅ **Built** (manual entry) |
| **Manufacturer sourcing agent** (scrape + contact directories) | L | ⏳ **Spec'd below**, not built |
| **Documents marketplace** (NDA-gated, sequential unlock, feedback → personas) | L | ❌ Not started |
| **Gated networking** (no contact exchange, on-portal Zoom/voice, 5-sec audio delay, AI bypass-detection, violation clause) | XL | 🚫 Deferred — legal/infra |
| **Git-for-non-tech-projects** + AI/human permissions | XL | 🚫 Deferred |
| **Entity formation** (LLP/PVT LTD, auto "fair" LLP agreement, **Delaware C-corp share payments through the company account**) | XL | 🚫 Deferred — **regulated money movement + legal docs; needs a lawyer before any code** |

The three 🚫 items are intentionally not started: they need product + legal
decisions first. Do not treat them as ordinary feature work. The documents
marketplace (❌) is buildable in slices on top of the existing Stripe
integration when prioritised.

---

## 1. What was built this round

### 1a. Progression scoring spine ✅

Founder-facing tracker: each project has scored **dimensions**, each with
score/max, status, notes, ETA, money spent, evidence links, and **history over
time**. Dimensions can host nested **scenarios** (e.g. the company-registration
variants). Fixed preset dimensions are seeded on first open; founders add custom
dimensions + scenarios.

- DB: `ProjectDimension`, `ProjectDimensionEvent` — [prisma/schema.prisma](../prisma/schema.prisma)
- Presets / types / rollups: [lib/progression/presets.ts](../lib/progression/presets.ts)
- Store: [lib/progression/store.ts](../lib/progression/store.ts)
- API: [app/api/projects/[id]/dimensions/route.ts](../app/api/projects/[id]/dimensions/route.ts) (GET list+seed, POST create) and `[dimId]/route.ts` (PATCH, DELETE)
- UI: [components/ProgressionPanel.tsx](../components/ProgressionPanel.tsx)
- Standalone page: `/projects/[id]/progression`
- Wired into Owner Dashboard as the **"Progression"** section ([components/OwnerDashboard.tsx](../components/OwnerDashboard.tsx))

Preset dimensions live in `PRESET_DIMENSIONS` (presets.ts): idea, planning,
business_plan, company_registration, lab_report, money_vs_output (a `meter`
kind with labelled bands). Scores aren't capped at 100 — `scoreMax` is
per-dimension (handles the "200/200" combined scenario). History is snapshotted
on every score/status/spend change so the UI draws a sparkline.

### 1b. Salesforce integration ✅ (coming soon)

Full CRM connector following the existing `Connector` contract; registered but
**not** in the `AVAILABLE` set, so the UI shows it as "Coming soon".

- Connector: [lib/integrations/connectors/salesforce.ts](../lib/integrations/connectors/salesforce.ts)
- Config: [lib/config.ts](../lib/config.ts) → `config.integrations.salesforce`
- Provider + `crm` category added to unions: [lib/integrations/types.ts](../lib/integrations/types.ts)
- Registered: [lib/integrations/registry.ts](../lib/integrations/registry.ts)
- `crm` icon (`Users`): [components/IntegrationsSection.tsx](../components/IntegrationsSection.tsx)
- Callback now persists the chosen account's metadata (Salesforce instance URL): [app/api/integrations/callback/[provider]/route.ts](../app/api/integrations/callback/[provider]/route.ts)
- Env documented in [.env.example](../.env.example)

Live sync (once enabled) queries SOQL: closed-won Opportunities → `revenue` +
`conversions`; Leads → `new_customers`. `mockSync` runs until creds land. The
instance host is derived from the OpenID userinfo endpoint (or read from saved
metadata).

### 1c. Manufacturer sourcing table ✅

Per-project supplier table — manual entry now, agent-fed later.

- DB: `Manufacturer` — [prisma/schema.prisma](../prisma/schema.prisma)
- Types (statuses, sources, regions, zod, DTO): [lib/manufacturers/types.ts](../lib/manufacturers/types.ts)
- Store: [lib/manufacturers/store.ts](../lib/manufacturers/store.ts)
- API: [app/api/projects/[id]/manufacturers/route.ts](../app/api/projects/[id]/manufacturers/route.ts) + `[mId]/route.ts`
- UI: [components/ManufacturerTable.tsx](../components/ManufacturerTable.tsx)
- Standalone page: `/projects/[id]/manufacturers`
- Wired into Owner Dashboard as the **"Manufacturers"** section

Captures MOQ (+unit), sample price, unit price, lead time, payment terms,
country/region, products, verified-supplier flag, 0–5 rating, notes, contact
fields, and a sourcing **pipeline status** (lead → contacted → quoted →
sampling → approved/rejected). The `source` enum in types.ts is pre-seeded with
the directories from the brief and is the write target for the sourcing agent.

### 1d. Database

Applied to the Neon DB via **`prisma db push`** (this project tracks schema with
db push, NOT migration history — see §3). Migration SQL files were also written
for the record under `prisma/migrations/2026062800*` and `*01*`.

---

## 2. Conventions to follow (so new work matches)

- **Data access**: no Prisma in route handlers. Put queries in a `lib/<domain>/store.ts`
  (see `lib/progression/store.ts`, `lib/manufacturers/store.ts`).
- **API routes**: `requireProjectForApi(params.id)` for auth/ownership, wrap DB
  calls in `withDbRetry()`, `export const dynamic = "force-dynamic"`, validate
  bodies with zod, return `{ error }` + status on failure.
- **Schema changes**: edit `prisma/schema.prisma`, then **`npx prisma db push`**
  (this repo's `db:migrate` script). `prisma migrate deploy` will NOT work —
  migration history isn't tracked, so deploy tries to re-create `0_init` and
  fails. Keep additive changes additive (new tables/nullable columns).
  **Note**: `.env` needs `DIRECT_URL` set for any migrate tooling; only
  `DATABASE_URL` (the Neon pooled URL) is present today. `db push` works with
  the pooled URL.
- **New integration provider**: implement `Connector` in
  `lib/integrations/connectors/<p>.ts`, register in `registry.ts`, add to
  `AVAILABLE` to enable (else "Coming soon"), add env to `.env.example`.
- **New owner-dashboard section**: add to the `SectionId` union + `SECTIONS`
  array + a body `<div>` in `components/OwnerDashboard.tsx` (data-driven rail).

---

## 3. Finishing the shipped features (concrete TODOs)

### Progression
- [ ] **Surface overall progress on the home dashboard / project cards** — reuse
  `overallProgress()` from presets.ts; show the ring next to each project in
  `app/page.tsx`.
- [ ] **AI auto-scoring**: a "Suggest scores" action that reads the project's
  ventureProfile + simulation runs and proposes dimension scores with rationale
  (write to `notes` + `evidence`). Hook: `lib/llm.ts` + the existing run data.
- [ ] **Reordering**: drag-to-reorder dimensions (the `sortOrder` field + a
  PATCH already exist; just need DnD in the UI).
- [ ] **Preset evolution**: if you add/rename a preset in `PRESET_DIMENSIONS`,
  existing projects won't get it (seed runs once). Add a reconcile step in
  `listDimensions()` that `createMany(skipDuplicates)` the presets every load
  (cheap; the unique constraint makes it idempotent).

### Salesforce
- [ ] **Enable it**: create a Salesforce Connected App, set
  `SALESFORCE_CLIENT_ID/SECRET` (and `SALESFORCE_LOGIN_URL=https://test.salesforce.com`
  for a sandbox), add the callback `/api/integrations/callback/salesforce` to the
  app, then add `"salesforce"` to `AVAILABLE` in `registry.ts`.
- [ ] **Verify the SOQL sync** against a real org (field availability, currency
  handling on Opportunity.Amount — multi-currency orgs expose `CurrencyIsoCode`).
- [ ] **Token refresh**: confirm the worker refreshes Salesforce tokens like it
  does Google's (check `scripts/sync-integrations.ts` / the refresh path).
- [ ] Add MRR/churn if you later sync Salesforce subscription/contract objects.

### Manufacturers
- [ ] **CSV import/export** for bulk manual entry.
- [ ] **Dedupe** by name+country (or website host) before insert — the sourcing
  agent will need this too (see §4).
- [ ] **Cost comparison view**: normalise unit price to a common currency (reuse
  the integrations FX approach if present) and rank by landed cost. This feeds
  the financials engine's COGS input (see DATA_PLAN.md gap #6).
- [ ] **Link a chosen manufacturer back to the project's COGS / lab report**
  dimension so sourcing progress shows in the progression tracker.

---

## 4. The manufacturer sourcing agent (next big build)

The vision: an agent that **finds and contacts** manufacturers for the venture's
product, **before and after** the product lab report, and fills the
`Manufacturer` table.

- **Before the lab report**: cast wide. Learn what manufacturers in the category
  typically do — MOQ, sample prices, turnaround, payment terms — and populate
  the table so the founder sees the supply landscape early.
- **After the lab report**: narrow. Use the report's recipe/spec to fine-tune
  which manufacturers fit, re-rank, and draft tailored outreach.

### 4.1 Sources (from the brief)

Global directories: **Alibaba** (+ Verified Supplier), **AliExpress**,
**Taobao**, **IndiaMART**, **ThomasNet**, **Europages**, **HKTDC Sourcing**,
**Global Sources**, **Made-in-China**, **Kompass**, **TradeKey**, **EC21**, plus
trade-intelligence sources: **ImportYeti**, **Panjiva**, **ImportGenius**,
**Descartes Datamyne**, **Volza**, **Export Genius**, **Trademo**, and
contact-enrichment: **ZoomInfo**, **Apollo.io**, **D&B Hoovers**.

These are already enumerated in `MANUFACTURER_SOURCES` /
[lib/manufacturers/types.ts](../lib/manufacturers/types.ts) — each scraped row
sets `source` to the matching key so provenance is preserved.

### 4.2 ⚠️ Legal / ToS — read before scraping

This is the single biggest constraint and the reason it's a separate, careful
build:

- **Most of these sites prohibit scraping in their ToS** (Alibaba, Alibaba
  Verified, ZoomInfo, Apollo, Panjiva/ImportGenius especially). Do **not** mass-scrape.
- **Prefer official APIs / paid data feeds** where they exist:
  - Alibaba has an official Open Platform API; IndiaMART has a lead/seller API;
    ImportYeti/Panjiva/Volza/ImportGenius/Trademo sell **licensed bills-of-lading
    data** (often the *right* legal path — buy the feed, don't scrape the site).
  - Apollo.io and ZoomInfo have **official APIs** for contact enrichment — use
    those, never scrape their UIs.
- **Respect robots.txt, rate limits, and per-site ToS.** Treat each connector as
  opt-in and individually reviewed. Default the agent OFF until a source's legal
  path is confirmed.
- Keep a per-source `legalMode` flag: `api` | `licensed_feed` | `manual_only`.
  Only `api`/`licensed_feed` sources run automatically.

### 4.3 Suggested architecture

Mirror the existing **integrations connector** pattern and the **durable job
worker** (`RunJob` + `scripts/run-worker.ts`, `npm run worker`).

1. **`SourcingSource` connector interface** (new, e.g. `lib/sourcing/types.ts`):
   ```ts
   interface SourcingSource {
     key: string;                 // "alibaba" | "indiamart" | ...
     legalMode: "api" | "licensed_feed" | "manual_only";
     search(query: SourcingQuery): Promise<RawManufacturer[]>;  // category, region, keywords
     enrichContact?(m: RawManufacturer): Promise<ContactInfo>;  // Apollo/ZoomInfo
   }
   ```
   One file per source under `lib/sourcing/sources/`. Start with the legally
   clean ones: **IndiaMART API**, **Alibaba Open Platform**, a **licensed BoL
   feed** (ImportYeti/Volza), and **Apollo** for enrichment.

2. **Normalisation → `Manufacturer`**: map each `RawManufacturer` to the
   `Manufacturer` shape (reuse `createManufacturer()` in
   `lib/manufacturers/store.ts`). Set `source`, `sourceUrl`, `verified`, and any
   MOQ/price/lead-time the source exposes. **Dedupe** by website host or
   name+country before insert.

3. **Durable jobs**: enqueue a `RunJob` (extend its `kind`) like
   `sourcing.search` / `sourcing.enrich`, processed by the worker so long crawls
   survive serverless timeouts. Stream progress via the existing SSE bus
   (`lib/bus.ts`) so the table live-updates.

4. **The LLM layer** (`lib/llm.ts`): two jobs —
   - **Query expansion**: turn the venture profile (category, product, target
     spec) into good search queries per source. Post-lab-report, fold in the
     recipe/spec to tighten queries.
   - **Ranking + fit**: score each manufacturer against the spec
     (capabilities, MOQ vs the founder's volume, price band, region) and write a
     rationale to `Manufacturer.notes`. Reuse the `sourced`/`estimate` discipline.

5. **Outreach (after dedupe + ranking)**: draft per-manufacturer emails/RFQs
   (product spec, target MOQ, questions on sample price + lead time + payment
   terms). Send via the existing nodemailer setup or a per-manufacturer mailto
   draft; record status transitions on the row (`lead → contacted → quoted`).
   **Keep a human in the loop for first contact** — don't auto-send blind.

6. **The data table** the brief asked for is the existing `Manufacturer` table /
   `ManufacturerTable.tsx`. The agent just writes rows; the founder reviews,
   rates, and advances the pipeline. Sample-price / MOQ / turnaround / payment
   terms columns already exist.

### 4.4 Build order (suggested)

1. `lib/sourcing/types.ts` + worker job kind + one **legally-clean** source
   (IndiaMART API or a licensed BoL feed) end-to-end into the table.
2. LLM query expansion from the venture profile.
3. LLM ranking + rationale into `notes`.
4. Apollo/ZoomInfo contact enrichment (API).
5. Outreach drafts + pipeline status automation (human-approved send).
6. Post-lab-report refinement pass (spec-aware re-query + re-rank).

---

## 5. Deferred initiatives (need decisions first)

- **Documents marketplace** — NDA-gated, sequentially-unlocked packages sold via
  the existing Stripe integration; post-purchase questionnaire feeds
  buyer/investor personas. Buildable in slices; not started.
- **Gated networking**, **git-for-non-tech**, **entity formation + Delaware
  C-corp share payments** — see §0. Do not start without product + legal sign-off.
  The entity-formation/share-payment piece is regulated money movement and needs
  a lawyer in the loop before any code.

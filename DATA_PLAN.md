# Data Plan — grounding the analysis, simulations & personas in real data

**Status:** in progress · **Last updated:** 2026-06-16

## TL;DR

The app's analysis, financials, launch simulation and personas are high quality
*structurally* but run on **LLM-guessed input rates** (CPM, CAC, conversion,
returns, repeat, margins, AOV, seasonality). That's why outputs feel generic.
This plan replaces those guesses with **real, source-cited data** via a
**benchmark/priors layer** that the deterministic engines anchor to.

Core discipline: **only authoritative, citable sources** (government surveys,
audited company filings, methodology-backed industry reports). **No
marketing-agency "benchmark" blogs** — they publish self-serving, unauditable
numbers. Every number is either `sourced` (traced to a saved document + page +
quote) or explicitly flagged `estimate`.

---

## 1. Where data plugs into the app

Both engines already separate **demand SHAPE** (personas) from **SCALE** (market
sizing) and do all arithmetic deterministically. The genericness is in the
*input rates* they consume:

| Engine | File | Inputs that are currently guessed |
|---|---|---|
| Launch simulation | [lib/launchSim.ts](lib/launchSim.ts) | CPM, CVR, abandon, refund/RTO, repeat, shipping, seasonality, channel mix |
| Financials | [lib/financials.ts](lib/financials.ts) + [lib/llm.ts](lib/llm.ts) `callFinancialInputs` | landed COGS, gross margin, CAC by channel, LTV, AOV, TAM/SAM/SOM |
| Personas | [lib/prompts.ts](lib/prompts.ts) `cohortSimSystem` | intent, WTP, objections, price sensitivity, segment weights |

**Architecture:** a single `benchmark/priors` datasource keyed by
`category × geo-tier × channel` returns empirically-anchored ranges, injected
into the engines as ground truth (falling back to model estimates when absent).
This mirrors the existing [lib/datasources/structured.ts](lib/datasources/structured.ts)
pattern (best-effort, never-throws, provenance attached).

---

## 2. Data needs (prioritized)

The original five high-leverage categories, plus gaps identified against what the
engines actually model:

### Demand & acquisition side (original list)
1. **Real campaign funnels with outcomes** — spend → CPM → CTR → landing CVR →
   AOV → return/refund → repeat → CAC, by category & geo.
2. **First-party customer + survey data for personas** — geo/demographic spend
   distributions, basket sizes, price points paid, seasonality, category
   penetration by city tier.
3. **Voice-of-customer text** — reviews, support tickets, sales-call transcripts,
   social listening, churn-reason surveys (objections in real language).
4. **Competitor & pricing intelligence** — price ladders, assortment, market
   share, review-mined complaints.
5. **Channel/CAC economics** by platform × category × geo — real CPMs, CAC,
   organic-vs-paid mix.

### Gaps added (the engines model these but the list omitted them)
6. **Supply & unit-cost data** — COGS, MOQ, supplier quotes, freight, duty, lead
   times. (Financials can't tell margin truth without landed cost.)
7. **Returns/RTO + payment mix (COD vs prepaid)** — in India RTO is 15–40% and
   COD-driven; distinct from funnel CVR and can flip a launch to a loss.
8. **Seasonality / festival demand as a time series** — Diwali/BBD, wedding
   season, EOSS, monsoon — the launch sim runs over time.
9. **Category market size & growth** — for the TAM/SAM/SOM reconciliation.
10. **Creative/content + influencer economics** — hook/format CVR, creator rate
    cards, real engagement, fraud rates.
11. **Retention/repeat curves & price elasticity** — currently single guessed
    numbers; the sim models both as mechanics.
12. **Failed-launch base rates** — survivorship correction; bought funnel data is
    from survivors and will bias priors optimistic.
13. **First-party outcome capture + a backtest set** — the long-term moat and the
    only way to *prove* added data improves accuracy.

---

## 3. Acquisition strategy (by tier of difficulty)

| Tier | What | Examples | Cost |
|---|---|---|---|
| **A — free / authoritative** | Govt surveys, audited filings, free methodology-backed reports | NSSO HCES, company DRHPs/annual reports, Bain "How India Shops Online", RedSeer press | Free |
| **B — licensable** | Syndicated panels & category sizing | CMIE Consumer Pyramids, Euromonitor, Statista, NielsenIQ, Kantar | Subscription |
| **C — partnership** | Proprietary funnel/CAC/RTO outcomes, support tickets, baskets | GoKwik, Shiprocket, Razorpay/Cashfree, Unicommerce; brand data-sharing | Deal |
| **D — first-party (moat)** | Capture actual results from app users post-launch | In-app outcome logging → survivorship-corrected dataset + backtest set | Build |

**Sequencing recommendation:** backtest harness + ~15 real launches → review
scraping (persona realism + competitor prices) → benchmark/priors seeded from
Tier A → one Tier C enabler partnership → first-party outcome capture.

**Reality check from research:** the metrics the engines most need —
**CPM, CAC, conversion rate** — have **no reliable free primary source**. Open-web
results for these are agency SEO blogs (excluded). These cells stay `estimate`
until Tier B (licensed) or Tier D (first-party) data replaces them. The
genuinely reliable free data (NSSO consumption, company-filing margins) maps to
*income-segment calibration* and *gross margins*, not the ad-funnel rates.

---

## 4. Sourcing methodology & rules

1. **Authoritative sources only.** Government statistics, audited regulatory
   filings (DRHP / annual reports), and industry reports with stated
   methodology + named data networks. **No agency/SEO benchmark blogs.**
2. **Every number is `sourced` or `estimate`.** `sourced` = traced to a document
   in [data/benchmarks/sources/](data/benchmarks/sources/) with exact page +
   verbatim quote (recorded in [lib/datasources/verified.ts](lib/datasources/verified.ts)).
   `estimate` = model prior, flagged, **never** attributed to a source.
3. **Save the document.** PDFs are committed to the repo so provenance is
   self-contained and auditable, with a manifest in
   [data/benchmarks/SOURCES.md](data/benchmarks/SOURCES.md).
4. **Estimates are surfaced as estimates** to the engines and the founder — not
   laundered into facts.

---

## 5. What's been built so far

### Code
- **Benchmark/priors module** — [lib/datasources/benchmarks.ts](lib/datasources/benchmarks.ts):
  taxonomy (`CategoryKey × GeoTier × ChannelKey`), per-category economics,
  geo-tier modifiers, channel CPMs, India seasonality curve, mapping helpers,
  and a `formatBenchmarks` prompt renderer.
  ✅ **Provenance refactor done** (data-merge follow-up): every cell now renders
  `[sourced]` or `[estimate]`; placeholder agency citations removed; the beauty
  gross margin is pulled from the verified Honasa figure; `sources` lists verified
  provenance only. Rate cells (CPM/CAC/CVR/AOV/returns/repeat) stay `[estimate]`.
- **Provenance layer** — [lib/datasources/verified.ts](lib/datasources/verified.ts):
  the only place numbers are allowed to claim a source; holds verified figures
  with source id + page + quote.
- **Engine wiring (done, on estimate-grade numbers for now):**
  - Financials: `callFinancialInputs` injects the benchmark block as ground
    truth ([lib/llm.ts](lib/llm.ts)).
  - Launch sim: priors resolved from the run's real localities × category,
    surfaced in `defaults`; form prefills CPM + shipping
    ([app/api/runs/[id]/launch-sim/route.ts](app/api/runs/[id]/launch-sim/route.ts),
    [components/LaunchSimulation.tsx](components/LaunchSimulation.tsx)).
  - Verified: `tsc` clean · launch-sim determinism (11 invariants + rerun
    equality) passes · financials smoke test passes.

### Update — data-merge (folds in the web-branch collectors + calibration)
- **Personas now wired to benchmarks** — `cohortSimSystem` takes a calibration
  block built per-cohort from `resolveBenchmarks(categoryFromProfile × geoTier
  fromLocality)` ([lib/datasources/personaCalibration.ts](lib/datasources/personaCalibration.ts),
  [lib/audience.ts](lib/audience.ts)): anchors persona `wtp` to category order
  value, surfaces the returns rate, and adds category objection/discovery hints
  (flagged ESTIMATE). Fills the personas row of §1.
- **Launch-sim returns now anchored, not just prefilled** — new
  `targetRefundRatePct` input scales per-persona refund propensity so the cohort
  refund rate matches the benchmark `returnRatePct.mid`; the route sets it from
  resolved priors unless the founder overrides ([lib/launchSim.ts](lib/launchSim.ts),
  [lib/schema.ts](lib/schema.ts), launch-sim route). Deterministic (target is in
  the hashed inputs).
- **First automated `sourced` data** — keyless authoritative-API collectors under
  [scripts/scrape/](scripts/scrape/) snapshot into `data/benchmarks/collected/`:
  UN Comtrade per-category India import value (surfaced in `formatBenchmarks` as
  a sourced market-size line) + World Bank population/urban share. Provenance via
  a new `ApiSourceRef` variant in `verified.ts`. Run `npx tsx scripts/scrape/enrich.ts`
  (idempotent — snapshots carry the data's own year). **Does NOT cover CPM/CAC/CVR**
  — those still have no free source (§3 reality check stands).

### Update — provenance tiers
Three honest tiers now render on each benchmark line: **`[sourced]`** (saved
document + page + verbatim quote — beauty margin ← Honasa, income ← NSSO),
**`[reported]`** (a company's own primary disclosure, corroborated but not
transcribed — apparel margin ← Go Fashion, footwear margin ← Metro Brands), and
**`[estimate]`** (model prior, no public source). The `[reported]` figures are
single premium players, so they anchor the *upper* range of their category, not
the whole category (same caveat as the verified beauty figure). Note: the large
DRHP PDFs exceed the fetch limit, so promoting these to full `[sourced]` needs a
human to save the PDF + transcribe the page/quote.

### Saved sources (committed)
- [data/benchmarks/SOURCES.md](data/benchmarks/SOURCES.md) — manifest.
- **NSSO HCES 2022-23 Fact Sheet** (govt) → income/MPCE by sector.
  Verified: rural MPCE ₹3,773 / urban ₹6,459; bottom-5% ₹1,373/₹2,001; top-5%
  ₹10,501/₹20,824 (p.7).
- **Honasa/Mamaearth DRHP** (audited filing) → beauty gross margin **70.57%**
  H1FY23 / 69.96% FY22 / 71.15% FY21 (p.116).

---

## 6. Honest coverage status

| Metric | Status | Reliable free source? |
|---|---|---|
| Gross margin (beauty) | **sourced** — Honasa DRHP | Yes — company filings |
| Gross margin (apparel, footwear, food_beverage, home_decor) | **reported** — Go Fashion / Metro Brands / Britannia+Bikaji / Cello World | Yes — promoted from estimate |
| Gross margin (furniture, electronics, jewellery, services) | estimate | Partial — electronics/jewellery lack a representative listed pure-play with a clean *gross* margin |
| Income / spend by tier | **sourced** — NSSO | Yes — NSSO HCES |
| AOV by category | estimate | Partial — Unicommerce / GoKwik (vendor) |
| RTO / COD share / returns | estimate | Partial — GoKwik / Unicommerce (vendor) |
| Festive seasonality | estimate | Partial — RedSeer festive (vendor) |
| **CPM / CAC / conversion** | estimate | **No** — licensed or first-party only |

---

## 7. Next steps & open decisions

**Immediate (code):**
- [x] Finish the provenance refactor in `benchmarks.ts`: flag every unsourced
      cell `estimate`, pull verified figures from `verified.ts`, remove
      placeholder source attributions, label sourced vs estimate in output.
      *(done — beauty margin ← Honasa; rate cells stay estimate; sources = verified only.)*

**Data acquisition (Tier A, free):**
- [ ] One audited filing per category for gross margins: Nykaa (beauty),
      Vedant Fashions/Go Fashion (apparel), Campus/Metro Brands (footwear),
      FirstCry (kids), etc.
- [ ] Bain "How India Shops Online" + RedSeer festive report for AOV / seasonality
      (verify they're downloadable, not gated).
- [ ] NSSO HCES full report (Report 591) for state/fractile detail beyond the
      factsheet.

**Bigger bets (need a decision):**
- [ ] Tier B licensing — which to buy first (CMIE / Euromonitor / Nielsen)?
      Decide by cells-unlocked vs cost.
- [ ] Tier C enabler partnership for real funnel/CAC/RTO outcomes.
- [~] Backtest harness + first-party outcome capture (Tier D). **Harness done**
      ([lib/backtest.ts](lib/backtest.ts), [scripts/backtest.ts](scripts/backtest.ts),
      `data/backtest/`): replays a recorded outcome through `simulateLaunch`,
      reports predicted-vs-actual error + a benchmark-calibration A/B.
      **Capture path done** ([prisma `LaunchOutcome`](prisma/schema.prisma),
      [app/api/runs/[id]/launch-outcome/route.ts](app/api/runs/[id]/launch-outcome/route.ts)):
      POST snapshots the run's frozen audience + inputs + actual metrics; GET
      replays each capture through the harness. ⚠️ **Needs `npm run db:migrate`**
      (adds the `launch_outcomes` table) before the endpoint works — a new table,
      so it does NOT affect the running app until migrated.
      **Capture UI done** — an "Actual outcome & backtest" panel on the launch-sim
      view ([components/LaunchSimulation.tsx](components/LaunchSimulation.tsx))
      records actuals against the active scenario and shows predicted-vs-actual +
      the refund-calibration A/B (degrades to a migrate-me note until the table
      exists). **Still pending:** accumulating ~15 real launches for a true backtest set.

**Open questions for collaborators:**
- Geo-tier taxonomy: current is `metro / tier1 / tier2 / tier3 / rural /
  international` mapped from city lists in `benchmarks.ts` — align if you use a
  different scheme.
- Category taxonomy: aligned to the industry classifier's `libraryKey`
  (apparel/footwear/beauty/food_beverage/furniture/home_decor/electronics/
  jewellery/services/general) — align before merging.
- Currency: benchmark tables are INR; non-INR markets need an FX step.

---

## 8. Political geography & attention/hype (in progress)

A political-geography axis (state / GoI zone / urban-rural) plus attention/hype
demand signals, layered onto the map + cohorts + analysis. Ordered by what is
authoritative + tractable first (same discipline as §3-4).

- **[x] Administrative geography (Phase 1)** — `lib/datasources/politicalGeography.ts`:
  factual locality → {state, GoI Zonal-Council zone, urban/semi-urban/rural},
  covering the cities the app already classifies. Neutral/authoritative (Census +
  Zonal Councils), pure + deterministic. Wired into `cohortSimSystem` so personas
  are region-aware; `zonesForLocalities` ready for map + aggregation.
- **[~] Aggregation (Phase 2)** — DONE: `AudienceAggregate.byZone` (GoI zone
  breakdown) computed in `aggregateAudience`, rendered as a "Purchase intent by
  region (zone)" chart in `InsightsView`. **Phase 2b DONE:** MapView has a
  colour-mode toggle (segment ↔ region) that tints cohort markers by GoI zone,
  with a legend; `ZONE_COLORS` shared via `segments.ts`.
- **[x] Attention/hype demand signal (Phase 3)** — `attentionSignal()` in
  structured.ts extends the Wikipedia interest proxy with a MOMENTUM read (last 3
  months vs prior 3 → rising/steady/cooling), surfaced in the market-data block as
  an attention/hype line and explicitly labelled a proxy. HONEST LIMIT (as
  expected): Google Trends / social-listening have no clean free API, so true
  ad/social attention stays out of scope and is called out in the line itself.
- **[x] Governance / regulatory regional signals (Phase 4)** — `regionalGovernance.ts`:
  per-state DPIIT BRAP Ease-of-Doing-Business band (Top Achiever/Achiever/Aspirer/
  Emerging), sourced + dated. Injected into the operating-environment research
  desks (regulation/finance/supply/market) only — not consumer-demand desks.
  FACTUAL/NEUTRAL by design; NOT partisan/electoral. GST left as national (no
  fake per-state rate variation).
- **[ ] Voter-style segmentation (Phase 5)** — political-demographic blocs; last,
  as it overlaps the income segments and is the most speculative.

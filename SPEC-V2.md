# EntreTangle Intelligence — Spec v2 ("Thousands of Agents")

Upgrades v1 (SPEC.md) from ~8 model-knowledge blocks to a geography-aware
intelligence platform: web-grounded research desks, a simulated audience of
thousands of personas, social-landscape mapping, and a layered map UI.
v1 invariants still hold (orchestrator-only spawning, typed conclusions,
immutable concluded blocks, event-log-as-truth, hard caps, canvas-is-report).

Decisions locked with the founder:
- **Agent scale**: batched cohorts — one mini-model call simulates 25–50 distinct personas; ~60 cohorts ≈ 2,000–2,400 personas per run.
- **Grounding**: live web search (OpenAI Responses API `web_search`) for research desks; conclusions cite real URLs.
- **Map**: both layers — geographic map (Leaflet) + audience/agent network graph, with top domain panels → desk subpanels → conclusion panel.
- **Budget**: ≤ $5 per run, 5–10 min. Enforced cost cap, not just token cap.

---

## 1. Agent roster

### A. Orchestration agents (frontier model)
| Agent | Role |
|---|---|
| Intake Interviewer | ≤5-question chat → ClientProfile (exists, unchanged) |
| Venture Planner v2 | One call → desk plan (8–14 desks) **and** cohort matrix (localities × segments × roles with weights + lat/lng) |
| Entangler v2 | Relates desk + audience conclusions; spawns synthesis desks |
| Query Agent v2 | Answers over conclusions **and** audience aggregate stats |

### B. Research desks (web-grounded, frontier model)
Planner selects from this catalog and localizes each mission to the venture's
geography (works for any country — nothing is India-hardcoded):

| Domain | Desk | Mission archetype |
|---|---|---|
| market | Market Demand | TAM/SAM, demand trends per target geography |
| competitor | Competitor Stats | Real numbers: pricing, revenue, funding, share — cited |
| competitor | Competitor Stories | How rivals launched/pivoted/failed; narrative case studies |
| channel | Retail Channels | Dept-store/mall fit (Shoppers Stop archetype): listing terms, margins, buyer process |
| channel | Luxury Marketplaces | Farfetch-archetype platforms: commission, curation bar, logistics |
| channel | Institutional Buyers | Hospitals/hotels/offices: procurement cycles, tenders, payment terms |
| channel | D2C & Quickcommerce | Own site, marketplaces, q-commerce economics |
| regulation | Trade & Regulation | Export/import law, HS codes, duties, certifications per corridor |
| pricing | Landed Cost & Pricing | Freight, insurance, duty → landed price abroad; price-position vs locals |
| pricing | Logistics & Distribution | 3PL, warehousing, last-mile per geography |
| social | Social Landscape | Platform-by-platform: where each segment lives, formats, CAC benchmarks |
| social | Creators & Influencers | Who moves this category; rate cards; collab formats |
| market | Brand & Positioning | Whitespace, naming codes, premium cues in category |
| market | Locality desk ×N | One per target city: local taste, rents, festivals, micro-channels |

### C. Audience simulation (mini model, batched — the "thousands")
Cohort = locality × income segment × role. Each cohort is ONE LLM call that
returns 25–50 individual personas.

- **Income segments**: budget / middle / affluent / luxury
- **Roles**: end consumer · retail buying exec · institutional procurement · distributor/importer · designer-influencer (social amplifier)
- **Per persona**: name, age, gender, occupation, income band, locality (+lat/lng jitter), purchase intent 0–1, willingness-to-pay (number + currency), preferred channel, social platforms, top objection, verbatim quote.

### D. Aggregation & synthesis
| Agent | Role |
|---|---|
| Audience Aggregator | Pure code, no LLM: intent by segment/locality, WTP percentiles, channel share, platform-affinity matrix |
| Audience Synthesis desk | Frontier call over the aggregate → typed conclusions, so the audience enters entanglement like any desk |
| Synthesis desks (entangler-spawned) | GTM plan · Channel strategy · Pricing strategy · Social playbook · Risk & compliance |

---

## 2. Model mix & cost control (≤ $5/run)

| Workload | Model (env) | Default |
|---|---|---|
| Planner, desks, entangler, synthesis, query | `MODEL_FRONTIER` | gpt-5.5 |
| Cohort simulation | `MODEL_MINI` | gpt-5-mini |

`lib/usage.ts` gains dollar accounting: per-model token prices + per-web-search
price (env-overridable). New caps (env): `MAX_COST_USD=5`,
`MAX_DESKS_PER_RUN=14`, `MAX_BLOCKS_PER_RUN=20`, `MAX_LAYERS=4`,
`MAX_COHORTS=60`, `PERSONAS_PER_COHORT=40`, `AUDIENCE_CONCURRENCY=8`,
`DESK_CONCURRENCY=6`, `MAX_TOKENS_PER_RUN=600000`.
Cost checked before each spawn wave → graceful `capped` convergence.

Rough budget: 60 cohort calls (mini) ≈ $0.5 · 10–12 web-grounded desks ≈ $2.5–3 ·
planner/entangler/synthesis/query ≈ $1. Headroom ≈ $0.5.

---

## 3. Data model additions (Prisma + Zod)

```
Block   += kind: "research"|"synthesis"|"audience"   domain: string
Run     += costUsd Float @default(0)
Cohort   = { id, runId, label, locality, country, lat, lng,
             segment, role, weightPct, size, state, stats Json?, summary? }
Persona  = { id, cohortId, name, age, gender, occupation, incomeBand,
             lat, lng, intent, wtp, wtpCurrency, channelPref,
             platforms Json, objection, quote }
```

New SSE events (same envelope, replay-safe):
```
cohort_spawned      { cohort }
cohort_simulated    { cohortId, stats, personas }   // full cohort ≤50
audience_aggregated { aggregate }                    // AudienceAggregate
cost_used           { costUsd }
```

`AudienceAggregate` = { totalPersonas, bySegment, byLocality, byRole:
{ n, meanIntent, wtpP25/P50/P75, topChannels, topPlatforms, topObjections },
platformMatrix }.

---

## 4. Orchestrator v2 phases

1. **Plan** — Planner v2 → desks[] + cohortPlan. Clamp to caps. Spawn desk
   blocks (layer 1) + cohorts.
2. **Research + Simulate (parallel)** — desks execute with web search
   (concurrency 6); cohorts simulate in waves (concurrency 8, mini model).
   Cost checked between waves.
3. **Aggregate** — pure code → `audience_aggregated`; then Audience Synthesis
   desk turns the aggregate into typed conclusions (layer 2, kind "audience").
4. **Entangle & synthesize** — Entangler v2 over all conclusions; verified
   edges; up to 4 synthesis desks/round; rounds until layer/block/cost caps.
5. **Converge** — world model = conclusions + edges + audience aggregate +
   cost. Queryable, forkable (cohorts copied as concluded data on fork).

Web search calls: Responses API with `tools:[{type:"web_search"}]`; on any
failure, automatic fallback to plain JSON call (model knowledge + lowered
confidence) so a desk never dies because search did.

---

## 5. UI v2 (`/runs/:id`)

```
┌──────────────────────────────────────────────────────────────┐
│ top bar: brief · phase · personas count · $cost · replay     │
├──────────────────────────────────────────────────────────────┤
│ PANEL STRIP: [Market][Competitors][Channels][Trade&Pricing]  │
│              [Social][Audience][Synthesis][★ Conclusion]     │
│   click → subpanel rail: per-desk "what they discussed"      │
│   (logs), conclusions w/ confidence + clickable sources      │
│   ★ Conclusion = world-model summary + query box (citations  │
│   highlight nodes on the map below)                          │
├──────────────────────────────────────────────────────────────┤
│ THE MAP (layer toggle):                                      │
│  • Geography — Leaflet world map; cohort bubbles at lat/lng, │
│    size = weight, color = income segment; click → drawer:    │
│    cohort stats + persona cards (quotes, intent, WTP)        │
│  • Network — React Flow: cohorts ↔ platforms ↔ channels ↔   │
│    desks ↔ synthesis ↔ world model, laid out by layers       │
└──────────────────────────────────────────────────────────────┘
```

New deps: `leaflet`, `react-leaflet@4`, `@types/leaflet` (map rendered
client-side only, OSM tiles).

---

## 6. Mock mode v2

New fixture: **Jodhpur teak furniture brand → India metros + export to Dubai
& London** (exercises retail channels, luxury marketplaces, institutional
buyers, export law, landed cost — the founder's own examples). Cohorts and
personas are generated deterministically in code (seeded PRNG) — ~2,000
personas, zero tokens. Entire v2 pipeline + UI testable with `MOCK_MODE=true`.

## 7. v2.1 additions (implemented)

**Insights view** — third map toggle (Geography / Network / **Insights**), a
chart dashboard derived purely from the same event-reduced state:
spend-vs-cap gauges ($ and tokens), conclusion-confidence histogram, desk
timeline (who ran when, colored by domain), intent by segment/locality/role,
WTP P25–P75 ranges per segment, channel preference, top objections,
**platform × segment social heatmap**, opportunity bubble map (intent × WTP
per cohort, click → drawer), top entities. Cohort drawer gains an intent
histogram + WTP spread bar. Charts: recharts + custom CSS bars/heatmap;
palette centralized in `components/segments.ts` (also fixes leaflet SSR leak).

**Structured MCQ intake** — the interview now asks 6–8 short multiple-choice
questions, one per turn, with clickable options (Cursor-style): single-select
sends on click, multi-select toggles + ⏎ to continue, free-text input always
available. `IntakeOutputSchema` gains `options[]` + `multiSelect`; options
must be concrete and tailored (capital ranges in the user's currency, real
city names), never generic filler.

## 8. Non-goals v2

Auth/payments/deploy, true per-persona LLM calls, social-listening API
integrations (the social desk is web-search grounded, not API-scraped),
Postgres, mobile.

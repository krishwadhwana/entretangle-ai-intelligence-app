# Benchmark sources — provenance manifest

Every number wired into [lib/datasources/benchmarks.ts](../../lib/datasources/benchmarks.ts)
is one of two kinds:

- **`sourced`** — traced to a document saved in [`sources/`](./sources/), with the
  exact page and a verbatim quote recorded in [`verified.ts`](../../lib/datasources/verified.ts).
- **`estimate`** — a model-estimated prior, flagged `estimate: true`, NOT attributed
  to any source. These are placeholders to be replaced as real data is acquired.

Only free, authoritative documents are used: government surveys and audited
company filings (DRHP / annual reports). Marketing-agency "benchmark" blogs are
deliberately excluded — they publish self-serving, unauditable numbers.

The PDFs are committed to the repo so provenance is self-contained. They are
public regulatory/government documents redistributed for internal reference.

---

## Saved sources

### `nsso-hces-2022-23-factsheet`
- **File:** [`sources/nsso-hces-2022-23-factsheet.pdf`](./sources/nsso-hces-2022-23-factsheet.pdf) (5.9 MB)
- **Title:** Household Consumption Expenditure Survey: 2022-23 — Fact Sheet
- **Publisher:** Ministry of Statistics & Programme Implementation (MoSPI), NSSO, Govt. of India
- **Year:** 2024 (survey period Aug 2022 – Jul 2023)
- **URL:** https://www.mospi.gov.in/sites/default/files/publication_reports/Factsheet_HCES_2022-23.pdf
- **License:** Government of India open publication
- **Used for:** income-segment calibration — urban vs rural household spend and the
  budget→luxury spread (MPCE fractiles).
- **Figures extracted (page 7, Statement 1 & bullets):**
  - Average MPCE 2022-23: **rural ₹3,773**, **urban ₹6,459**.
    > "Average estimated MPCE in 2022-23 has been Rs. 3,773 in rural India and Rs. 6,459 in urban India."
  - Bottom 5% MPCE: **rural ₹1,373**, **urban ₹2,001**.
    > "The bottom 5% of India's rural population, ranked by MPCE, has an average MPCE of Rs. 1,373 while it is Rs. 2,001 for the same category of population in the urban areas."
  - Top 5% MPCE: **rural ₹10,501**, **urban ₹20,824**.
    > "The top 5% of India's rural and urban population, ranked by MPCE, has an average MPCE of Rs. 10,501 and Rs. 20,824, respectively."
  - Food share of MPCE: rural 46% / urban 39% (Statement 1).

### `honasa-mamaearth-drhp-2022`
- **File:** [`sources/honasa-mamaearth-drhp-2022.pdf`](./sources/honasa-mamaearth-drhp-2022.pdf) (8.5 MB)
- **Title:** Honasa Consumer Limited (Mamaearth) — Draft Red Herring Prospectus
- **Publisher:** Honasa Consumer Ltd, filed with SEBI/BSE
- **Year:** Dated December 28, 2022
- **URL:** https://www.bseindia.com/corporates/download/332525/DRHP_20221229142958.pdf
- **License:** Public regulatory filing
- **Used for:** beauty / BPC gross-margin anchor.
- **Figures extracted (KPI table, p.116):**
  - Gross Profit Margin: **70.57%** (6M ended Sep 30, 2022), **69.96%** (FY22),
    **71.15%** (FY21), **66.50%** (FY20).
    > "Gross Profit Margin (2)  %  70.57%  69.96%  71.15%  66.50%"
  - Definition (footnote): "Gross Profit refers to revenue from operations less
    purchase of traded goods less increase in inventories of traded goods."
  - Note: single-company figure (digital-first BPC) — a strong anchor for the
    beauty category's *upper* margin range, not the whole category.

---

## Honest coverage status

| Metric | Status | Reliable free source exists? |
|---|---|---|
| Gross margin (beauty) | **sourced** (Honasa DRHP) | Yes — company filings |
| Gross margin (other categories) | estimate | Yes — needs one filing per category (Nykaa, Vedant Fashions, Campus, Go Fashion, Metro Brands, etc.) |
| Income / spend by tier | **sourced** (NSSO) | Yes — NSSO HCES |
| AOV by category | estimate | Partial — Unicommerce / GoKwik reports (vendor, methodology-stated) |
| RTO / COD share / returns | estimate | Partial — GoKwik / Unicommerce reports (vendor) |
| Festive seasonality | estimate | Partial — RedSeer festive reports (vendor) |
| **CPM / CAC / conversion rate** | estimate | **No** — no reliable free primary source; needs licensed data (CMIE/Euromonitor) or first-party capture |

The CPM/CAC/CVR cells are the launch-sim & financials inputs we most want — and
the ones with no honest free source. They stay flagged estimates until licensed
data or the app's own outcome data replaces them.

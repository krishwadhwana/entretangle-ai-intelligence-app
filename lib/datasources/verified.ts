// ---------------------------------------------------------------------------
// Verified figures — the ONLY numbers in the benchmark layer that are traced to
// a real saved source document. Each entry cites a source id (see
// data/benchmarks/SOURCES.md), the page, and a verbatim quote. Anything not
// here is an estimate (flagged estimate:true in benchmarks.ts), never dressed
// up as sourced.
//
// To add a figure: save the source PDF under data/benchmarks/sources/, add it to
// SOURCES.md, then add an entry here with page + verbatim quote. Do NOT add a
// number you cannot attach to a saved document and a quote.
// ---------------------------------------------------------------------------

export type SourceRef = {
  /** id of a document in data/benchmarks/SOURCES.md */
  sourceId: string;
  publisher: string;
  year: string;
  page: string;
  quote: string;
};

export const SOURCES: Record<string, { title: string; file: string; url: string }> = {
  "nsso-hces-2022-23-factsheet": {
    title: "Household Consumption Expenditure Survey 2022-23 — Fact Sheet",
    file: "data/benchmarks/sources/nsso-hces-2022-23-factsheet.pdf",
    url: "https://www.mospi.gov.in/sites/default/files/publication_reports/Factsheet_HCES_2022-23.pdf",
  },
  "honasa-mamaearth-drhp-2022": {
    title: "Honasa Consumer Ltd (Mamaearth) — Draft Red Herring Prospectus",
    file: "data/benchmarks/sources/honasa-mamaearth-drhp-2022.pdf",
    url: "https://www.bseindia.com/corporates/download/332525/DRHP_20221229142958.pdf",
  },
  // API sources — authoritative, free, methodology-backed primary data fetched
  // by scripts/scrape/ and snapshotted under data/benchmarks/collected/. These
  // count as `sourced` (not `estimate`) via the ApiSourceRef variant below.
  "uncomtrade-preview": {
    title: "UN Comtrade — annual trade by HS code (public preview)",
    file: "data/benchmarks/collected/comtrade-imports.json",
    url: "https://comtradeapi.un.org/public/v1/preview/C/A/HS",
  },
  "worldbank-wdi": {
    title: "World Bank — World Development Indicators",
    file: "data/benchmarks/collected/worldbank-macro.json",
    url: "https://api.worldbank.org/v2",
  },
  // Reported-tier sources: primary company disclosures, figure corroborated but
  // not transcribed to a saved page + quote (file intentionally blank).
  "go-fashion-ar-2023-24": {
    title: "Go Fashion (India) Ltd — Annual Report 2023-24 / investor presentations",
    file: "",
    url: "https://investor.gocolors.com/annual-reports/2023-24/Go_Fashion_Annual_Report_2023-24.pdf",
  },
  "metro-brands-results": {
    title: "Metro Brands Ltd — reported quarterly results / company commentary",
    file: "",
    url: "https://www.business-standard.com/article/news-cm/metro-brands-q3-pat-rises-54-6-yoy-to-rs-100-8-cr-122011700148_1.html",
  },
  "britannia-bikaji-results": {
    title: "Britannia Industries / Bikaji Foods — reported gross margins (FY23–FY24)",
    file: "",
    url: "https://www.business-standard.com/amp/markets/capital-market-news/britannia-inds-q4-pat-drops-4-yoy-to-rs-537-cr-124050400107_1.html",
  },
  "cello-world-fy24": {
    title: "Cello World Ltd — consumer houseware, FY24 results / investor presentation",
    file: "",
    url: "https://corporate.celloworld.com/wp-content/uploads/2025/05/InvestorPresentationCWL.pdf",
  },
};

// Provenance for an API-sourced figure: no page/quote (it's an API, not a PDF);
// instead the endpoint + the exact query + the retrieval date make it checkable.
export type ApiSourceRef = {
  sourceId: string;
  publisher: string;
  retrieved: string; // ISO date the snapshot was taken
  endpoint: string; // base API endpoint
  query: string; // the exact query/parameters used
};

// --- Verified gross margins by category (audited company filings) -----------
export const VERIFIED_GROSS_MARGIN_PCT: Partial<
  Record<string, { low: number; mid: number; high: number; ref: SourceRef }>
> = {
  // Digital-first beauty/BPC. Honasa's FY20→H1FY23 gross margin ran 66.5–71.15%;
  // a single strong player, so it anchors the UPPER part of the beauty range.
  beauty: {
    low: 66,
    mid: 70,
    high: 71,
    ref: {
      sourceId: "honasa-mamaearth-drhp-2022",
      publisher: "Honasa Consumer Ltd (SEBI/BSE filing)",
      year: "2022",
      page: "p.116 (KPI table)",
      quote:
        "Gross Profit Margin (2)  %  70.57%  69.96%  71.15%  66.50% — Gross Profit refers to revenue from operations less purchase of traded goods less increase in inventories of traded goods.",
    },
  },
};

// Provenance for a company-REPORTED figure: a number the company states in its
// own primary investor communication (annual report / investor presentation /
// results), corroborated across sources, but NOT transcribed here to an exact
// saved page + verbatim quote. Strictly weaker than SourceRef (the gold tier),
// strictly stronger than an estimate. Rendered as `[reported]`.
export type ReportedFigureRef = {
  sourceId: string;
  publisher: string;
  period: string; // e.g. "FY24 / Q1 FY26"
  url: string;
  note?: string;
};

// --- Reported gross margins by category (company primary disclosures) -------
// Each is a single listed player, so it anchors the UPPER part of its category
// range (premium retail), not the whole category — same caveat as the verified
// beauty figure. Overrides the estimate range for its category at resolve time.
export const REPORTED_GROSS_MARGIN_PCT: Partial<
  Record<string, { low: number; mid: number; high: number; ref: ReportedFigureRef }>
> = {
  // Go Fashion (Go Colors) — premium women's bottom-wear; reported gross margin
  // ran ~60–64% across FY23–Q1FY26 (63.8% Q4FY23, 63.5% Q4FY24, 63.0% Q1FY26).
  apparel: {
    low: 60,
    mid: 63,
    high: 64,
    ref: {
      sourceId: "go-fashion-ar-2023-24",
      publisher: "Go Fashion (India) Ltd — investor presentations / annual report",
      period: "FY23–Q1FY26",
      url: "https://investor.gocolors.com/annual-reports/2023-24/Go_Fashion_Annual_Report_2023-24.pdf",
      note: "Premium women's bottom-wear; single listed player → anchors the upper range, not all apparel.",
    },
  },
  // Metro Brands — premium multi-brand footwear retail; company-reported gross
  // margin ~55–60% (Q3FY23 59.2%, full-year guidance 55–57%, Q1FY25 ~60%).
  footwear: {
    low: 55,
    mid: 57,
    high: 60,
    ref: {
      sourceId: "metro-brands-results",
      publisher: "Metro Brands Ltd — reported quarterly results / company commentary",
      period: "FY23–FY25",
      url: "https://www.business-standard.com/article/news-cm/metro-brands-q3-pat-rises-54-6-yoy-to-rs-100-8-cr-122011700148_1.html",
      note: "Premium footwear retail; single listed player → anchors the upper range, not all footwear.",
    },
  },
  // Packaged food: FMCG/biscuits (Britannia ~40–44%) run higher, snacks (Bikaji
  // ~30–32%) lower. Notably this CORRECTS the prior estimate (50–60–70%), which
  // was too high for packaged food.
  food_beverage: {
    low: 30,
    mid: 38,
    high: 44,
    ref: {
      sourceId: "britannia-bikaji-results",
      publisher: "Britannia Industries / Bikaji Foods — reported gross margins",
      period: "FY23–FY24",
      url: "https://www.business-standard.com/amp/markets/capital-market-news/britannia-inds-q4-pat-drops-4-yoy-to-rs-537-cr-124050400107_1.html",
      note: "Biscuits/FMCG (Britannia ~40–44%) higher; snacks (Bikaji ~30–32%) lower. Beverages/premium D2C can sit above this band.",
    },
  },
  // Cello World — consumer houseware/consumerware leader; reported FY24 gross
  // margin ~52.6%. Maps to home decor / furnishing / tableware.
  home_decor: {
    low: 50,
    mid: 53,
    high: 55,
    ref: {
      sourceId: "cello-world-fy24",
      publisher: "Cello World Ltd — consumer houseware (FY24 results / investor presentation)",
      period: "FY24",
      url: "https://corporate.celloworld.com/wp-content/uploads/2025/05/InvestorPresentationCWL.pdf",
      note: "Consumer houseware leader; FY24 gross margin ~52.6%.",
    },
  },
};

// --- Verified income / spend levels (NSSO HCES 2022-23) ---------------------
// Monthly Per Capita Consumption Expenditure (MPCE), INR. Used to calibrate the
// budget→luxury spread and a realism ceiling on per-capita spend by sector.
export const VERIFIED_MPCE = {
  ref: {
    sourceId: "nsso-hces-2022-23-factsheet",
    publisher: "MoSPI / NSSO, Govt. of India",
    year: "2024 (survey Aug 2022–Jul 2023)",
    page: "p.7, Statement 1",
    quote:
      "Average estimated MPCE in 2022-23 has been Rs. 3,773 in rural India and Rs. 6,459 in urban India. The bottom 5% ... Rs. 1,373 (rural) / Rs. 2,001 (urban) ... top 5% ... Rs. 10,501 (rural) and Rs. 20,824 (urban).",
  } satisfies SourceRef,
  avgRuralInr: 3773,
  avgUrbanInr: 6459,
  bottom5RuralInr: 1373,
  bottom5UrbanInr: 2001,
  top5RuralInr: 10501,
  top5UrbanInr: 20824,
  foodSharePctRural: 46,
  foodSharePctUrban: 39,
};

/** A one-line provenance string for a verified figure, for prompt rendering. */
export function citeRef(ref: SourceRef | ApiSourceRef | ReportedFigureRef): string {
  if ("page" in ref) return `${ref.publisher}, ${ref.year}, ${ref.page}`;
  if ("retrieved" in ref) return `${ref.publisher}, retrieved ${ref.retrieved}`;
  return `${ref.publisher} (${ref.period}, reported)`;
}

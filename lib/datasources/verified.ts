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
export function citeRef(ref: SourceRef): string {
  return `${ref.publisher}, ${ref.year}, ${ref.page}`;
}

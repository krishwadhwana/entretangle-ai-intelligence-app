import { fetchJson } from "../util";

// ---------------------------------------------------------------------------
// UN Comtrade collector — keyless public preview. India's total annual IMPORT
// value from the World for each mapped category's HS chapter: a real per-category
// demand / import-served-share signal. Output is snapshotted to
// data/benchmarks/collected/comtrade-imports.json and surfaces in the benchmark
// layer as a `sourced` market-size figure. Food spans too many HS chapters to
// map to one, so it's intentionally omitted (no fabricated number).
// ---------------------------------------------------------------------------

const INDIA = 699; // M49 reporter code
const YEARS = ["2023", "2022"]; // latest complete year, then fall back

// CategoryKey -> { HS 2-digit chapter, human label }
export const HS_CHAPTER: Record<string, { chapter: string; desc: string }> = {
  apparel: { chapter: "61", desc: "knitted/crocheted apparel" },
  footwear: { chapter: "64", desc: "footwear" },
  furniture: { chapter: "94", desc: "furniture & bedding" },
  beauty: { chapter: "33", desc: "essential oils, perfumery & cosmetics" },
};

export type ComtradeImports = Record<
  string,
  { usdMn: number; year: string; hsChapter: string; desc: string }
>;

// India's total annual imports from the World for an HS chapter, in USD. Retries
// the SAME year on transient errors (never silently falls to an older year) so
// the committed snapshot stays idempotent across runs.
async function chapterImportUsd(
  chapter: string
): Promise<{ usd: number; year: string } | null> {
  for (const year of YEARS) {
    let emptyButValid = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = (await fetchJson(
          `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${INDIA}&period=${year}&partnerCode=0&cmdCode=${chapter}&flowCode=M`
        )) as { data?: Array<Record<string, unknown>> };
        const rows = data.data ?? [];
        const total = rows.find(
          (rr) =>
            rr.partner2Code === 0 &&
            rr.motCode === 0 &&
            rr.customsCode === "C00" &&
            typeof rr.primaryValue === "number"
        );
        if (total) return { usd: total.primaryValue as number, year };
        emptyButValid = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (!emptyButValid) return null; // never got a valid response — do not guess
  }
  return null;
}

export async function collectComtradeImports(): Promise<ComtradeImports> {
  const out: ComtradeImports = {};
  for (const [category, { chapter, desc }] of Object.entries(HS_CHAPTER)) {
    const r = await chapterImportUsd(chapter);
    if (!r) continue;
    out[category] = {
      usdMn: Math.round((r.usd / 1e6) * 10) / 10,
      year: r.year,
      hsChapter: chapter,
      desc,
    };
  }
  return out;
}

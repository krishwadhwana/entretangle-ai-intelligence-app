import { fetchJson } from "../util";

// ---------------------------------------------------------------------------
// World Bank collector — keyless WDI. India national context for TAM sizing:
// total population and urban share. (GDP/capita is deliberately omitted —
// NSSO HCES MPCE is the better India income anchor and already in verified.ts.)
// Output snapshotted to data/benchmarks/collected/worldbank-macro.json.
// ---------------------------------------------------------------------------

const COUNTRY = "IN";

const INDICATORS = {
  population: "SP.POP.TOTL",
  urbanSharePct: "SP.URB.TOTL.IN.ZS",
} as const;

export type WorldBankMacro = Partial<
  Record<keyof typeof INDICATORS, { value: number; year: string }>
>;

async function indicator(
  code: string
): Promise<{ value: number; year: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = (await fetchJson(
        `https://api.worldbank.org/v2/country/${COUNTRY}/indicator/${code}?format=json&mrnev=1`
      )) as [unknown, Array<{ value: number | null; date: string }>?];
      const row = Array.isArray(data) && data[1]?.[0];
      if (row && row.value != null) return { value: row.value, year: row.date };
      return null; // valid response, no datum
    } catch {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return null;
}

export async function collectWorldBankMacro(): Promise<WorldBankMacro> {
  const out: WorldBankMacro = {};
  for (const [key, code] of Object.entries(INDICATORS) as [
    keyof typeof INDICATORS,
    string,
  ][]) {
    const r = await indicator(code);
    if (!r) continue;
    out[key] = {
      value: key === "urbanSharePct" ? Math.round(r.value * 10) / 10 : Math.round(r.value),
      year: r.year,
    };
  }
  return out;
}

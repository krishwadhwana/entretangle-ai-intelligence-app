import { VERIFIED_MPCE } from "../../../lib/datasources/verified";
import { fetchJson } from "../util";

// ---------------------------------------------------------------------------
// India + US demographic collector.
//
// Baseline is keyless World Bank WDI for a comparable country-level spine:
// population, urban share, broad age structure, and GDP/capita proxy. India gets
// its spend/income anchor from the already verified NSSO HCES source. US gets
// richer household-income / median-age fields from Census ACS when
// CENSUS_API_KEY is configured; without the key we still write a useful,
// provenance-friendly snapshot instead of blocking the run.
// ---------------------------------------------------------------------------

export type DemographicCountryCode = "IN" | "US";

type WdiValue = { value: number; year: string };

export type CountryDemographicSnapshot = {
  country: string;
  iso2: DemographicCountryCode;
  population?: WdiValue;
  urbanSharePct?: WdiValue;
  ageSharesPct?: {
    children0To14?: WdiValue;
    working15To64?: WdiValue;
    senior65Plus?: WdiValue;
  };
  gdpPerCapitaUsd?: WdiValue;
  indiaConsumption?: {
    source: "NSSO HCES 2022-23";
    currency: "INR";
    monthlyPerCapita: {
      avgRural: number;
      avgUrban: number;
      bottom5Rural: number;
      bottom5Urban: number;
      top5Rural: number;
      top5Urban: number;
    };
  };
  usAcs?: {
    year: string;
    population?: number;
    medianAge?: number;
    medianHouseholdIncomeUsd?: number;
  };
};

export type DemographicSnapshots = {
  countries: Record<DemographicCountryCode, CountryDemographicSnapshot>;
  metadata: {
    worldBankLastUpdated?: string;
    censusAcs: {
      status: "collected" | "skipped" | "failed";
      year: string;
      reason?: string;
    };
  };
};

const COUNTRIES: Record<DemographicCountryCode, string> = {
  IN: "India",
  US: "United States",
};

const WDI = {
  population: "SP.POP.TOTL",
  urbanSharePct: "SP.URB.TOTL.IN.ZS",
  children0To14: "SP.POP.0014.TO.ZS",
  working15To64: "SP.POP.1564.TO.ZS",
  senior65Plus: "SP.POP.65UP.TO.ZS",
  gdpPerCapitaUsd: "NY.GDP.PCAP.CD",
} as const;

type WdiResponse = [
  { lastupdated?: string },
  Array<{ value: number | null; date: string }>?,
];

function round(value: number, digits = 1): number {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

async function worldBankIndicator(
  country: DemographicCountryCode,
  indicator: string
): Promise<{ datum: WdiValue | null; lastUpdated?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = (await fetchJson(
        `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&mrnev=1`
      )) as WdiResponse;
      const row = Array.isArray(data) && data[1]?.[0];
      if (!row || row.value == null) {
        return { datum: null, lastUpdated: data[0]?.lastupdated };
      }
      return {
        datum: {
          value:
            indicator === WDI.population
              ? Math.round(row.value)
              : round(row.value, indicator === WDI.gdpPerCapitaUsd ? 0 : 1),
          year: row.date,
        },
        lastUpdated: data[0]?.lastupdated,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { datum: null };
}

async function collectWorldBankCountry(
  iso2: DemographicCountryCode
): Promise<{ profile: CountryDemographicSnapshot; lastUpdated?: string }> {
  const entries: Array<{
    key: string;
    datum: WdiValue | null;
    lastUpdated?: string;
  }> = [];
  // WDI occasionally drops one response when hit in a burst. Keep this small
  // and sequential so committed snapshots are complete and repeatable.
  for (const [key, indicator] of Object.entries(WDI)) {
    entries.push({ key, ...(await worldBankIndicator(iso2, indicator)) });
  }

  const byKey = Object.fromEntries(
    entries.map((e) => [e.key, e.datum])
  ) as Record<keyof typeof WDI, WdiValue | null>;
  const lastUpdated = entries.find((e) => e.lastUpdated)?.lastUpdated;

  return {
    profile: {
      country: COUNTRIES[iso2],
      iso2,
      ...(byKey.population ? { population: byKey.population } : {}),
      ...(byKey.urbanSharePct ? { urbanSharePct: byKey.urbanSharePct } : {}),
      ageSharesPct: {
        ...(byKey.children0To14
          ? { children0To14: byKey.children0To14 }
          : {}),
        ...(byKey.working15To64
          ? { working15To64: byKey.working15To64 }
          : {}),
        ...(byKey.senior65Plus
          ? { senior65Plus: byKey.senior65Plus }
          : {}),
      },
      ...(byKey.gdpPerCapitaUsd
        ? { gdpPerCapitaUsd: byKey.gdpPerCapitaUsd }
        : {}),
    },
    lastUpdated,
  };
}

function parseCensusRow(
  data: unknown
): Record<string, string> | null {
  if (!Array.isArray(data) || data.length < 2) return null;
  const headers = data[0];
  const row = data[1];
  if (!Array.isArray(headers) || !Array.isArray(row)) return null;
  return Object.fromEntries(headers.map((h, i) => [String(h), String(row[i])]));
}

function maybeNumber(value: string | undefined): number | undefined {
  if (value == null || value === "" || value.startsWith("-")) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function collectUsAcs(): Promise<{
  acs?: CountryDemographicSnapshot["usAcs"];
  status: DemographicSnapshots["metadata"]["censusAcs"];
}> {
  const key = process.env.CENSUS_API_KEY?.trim();
  const year = process.env.CENSUS_API_YEAR?.trim() || "2024";
  if (!key) {
    return {
      status: {
        status: "skipped",
        year,
        reason: "CENSUS_API_KEY not set",
      },
    };
  }

  try {
    const params = new URLSearchParams({
      get: "NAME,DP05_0001E,DP05_0018E,DP03_0062E",
      for: "us:*",
      key,
    });
    const row = parseCensusRow(
      await fetchJson(
        `https://api.census.gov/data/${year}/acs/acs5/profile?${params.toString()}`
      )
    );
    if (!row) throw new Error("empty ACS response");
    return {
      acs: {
        year,
        population: maybeNumber(row.DP05_0001E),
        medianAge: maybeNumber(row.DP05_0018E),
        medianHouseholdIncomeUsd: maybeNumber(row.DP03_0062E),
      },
      status: { status: "collected", year },
    };
  } catch (e) {
    return {
      status: {
        status: "failed",
        year,
        reason: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

export async function collectDemographicProfiles(): Promise<DemographicSnapshots> {
  const [india, us, acs] = await Promise.all([
    collectWorldBankCountry("IN"),
    collectWorldBankCountry("US"),
    collectUsAcs(),
  ]);

  const inProfile: CountryDemographicSnapshot = {
    ...india.profile,
    indiaConsumption: {
      source: "NSSO HCES 2022-23",
      currency: "INR",
      monthlyPerCapita: {
        avgRural: VERIFIED_MPCE.avgRuralInr,
        avgUrban: VERIFIED_MPCE.avgUrbanInr,
        bottom5Rural: VERIFIED_MPCE.bottom5RuralInr,
        bottom5Urban: VERIFIED_MPCE.bottom5UrbanInr,
        top5Rural: VERIFIED_MPCE.top5RuralInr,
        top5Urban: VERIFIED_MPCE.top5UrbanInr,
      },
    },
  };
  const usProfile: CountryDemographicSnapshot = {
    ...us.profile,
    ...(acs.acs ? { usAcs: acs.acs } : {}),
  };

  return {
    countries: {
      IN: inProfile,
      US: usProfile,
    },
    metadata: {
      worldBankLastUpdated: india.lastUpdated ?? us.lastUpdated,
      censusAcs: acs.status,
    },
  };
}

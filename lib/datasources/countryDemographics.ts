import demographicSnapshots from "../../data/benchmarks/collected/demographics.json";
import { VERIFIED_MPCE, citeRef } from "./verified";

export type CountryCode = "IN" | "US";

type ValueYear = { value: number; year: string };

type SnapshotCountry = {
  country: string;
  iso2: CountryCode;
  population?: ValueYear;
  urbanSharePct?: ValueYear;
  ageSharesPct?: {
    children0To14?: ValueYear;
    working15To64?: ValueYear;
    senior65Plus?: ValueYear;
  };
  gdpPerCapitaUsd?: ValueYear;
  indiaConsumption?: {
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

type Snapshot = {
  countries: Record<CountryCode, SnapshotCountry>;
  metadata: {
    worldBankLastUpdated?: string;
    censusAcs?: { status: string; year: string; reason?: string };
  };
};

const snapshots = demographicSnapshots as Snapshot;

export type CountryDemographicProfile = {
  code: CountryCode;
  country: string;
  population: ValueYear | null;
  urbanSharePct: ValueYear | null;
  ageSharesPct: {
    children0To14: ValueYear | null;
    working15To64: ValueYear | null;
    senior65Plus: ValueYear | null;
  };
  incomeAnchor:
    | {
        kind: "india_mpce";
        currency: "INR";
        monthlyPerCapita: {
          avgRural: number;
          avgUrban: number;
          bottom5Rural: number;
          bottom5Urban: number;
          top5Rural: number;
          top5Urban: number;
        };
        provenance: "sourced";
      }
    | {
        kind: "us_acs_household_income";
        currency: "USD";
        medianHouseholdIncome: number;
        medianAge?: number;
        year: string;
        provenance: "sourced";
      }
    | {
        kind: "gdp_per_capita_proxy";
        currency: "USD";
        gdpPerCapita: ValueYear;
        provenance: "sourced_proxy";
      }
    | null;
  sourceLabels: string[];
};

const COUNTRY_ALIASES: Record<string, CountryCode> = {
  india: "IN",
  bharat: "IN",
  in: "IN",
  "united states": "US",
  usa: "US",
  us: "US",
  america: "US",
  "united states of america": "US",
};

function val(v: ValueYear | undefined): ValueYear | null {
  return v ?? null;
}

function toProfile(code: CountryCode, s: SnapshotCountry): CountryDemographicProfile {
  const sourceLabels = ["World Bank WDI"];
  let incomeAnchor: CountryDemographicProfile["incomeAnchor"] = null;

  if (code === "IN" && s.indiaConsumption) {
    incomeAnchor = {
      kind: "india_mpce",
      currency: "INR",
      monthlyPerCapita: s.indiaConsumption.monthlyPerCapita,
      provenance: "sourced",
    };
    sourceLabels.push(citeRef(VERIFIED_MPCE.ref));
  } else if (code === "US" && s.usAcs?.medianHouseholdIncomeUsd) {
    incomeAnchor = {
      kind: "us_acs_household_income",
      currency: "USD",
      medianHouseholdIncome: s.usAcs.medianHouseholdIncomeUsd,
      medianAge: s.usAcs.medianAge,
      year: s.usAcs.year,
      provenance: "sourced",
    };
    sourceLabels.push(`US Census ACS ${s.usAcs.year}`);
  } else if (s.gdpPerCapitaUsd) {
    incomeAnchor = {
      kind: "gdp_per_capita_proxy",
      currency: "USD",
      gdpPerCapita: s.gdpPerCapitaUsd,
      provenance: "sourced_proxy",
    };
  }

  return {
    code,
    country: s.country,
    population: val(s.population),
    urbanSharePct: val(s.urbanSharePct),
    ageSharesPct: {
      children0To14: val(s.ageSharesPct?.children0To14),
      working15To64: val(s.ageSharesPct?.working15To64),
      senior65Plus: val(s.ageSharesPct?.senior65Plus),
    },
    incomeAnchor,
    sourceLabels,
  };
}

export function countryCodeFromName(country: string): CountryCode | null {
  return COUNTRY_ALIASES[country.trim().toLowerCase()] ?? null;
}

export function demographicProfileForCountry(
  country: string
): CountryDemographicProfile | null {
  const code = countryCodeFromName(country);
  if (!code) return null;
  return toProfile(code, snapshots.countries[code]);
}

export function demographicProfilesForCountries(
  countries: string[]
): CountryDemographicProfile[] {
  const codes = Array.from(
    new Set(countries.map(countryCodeFromName).filter((c): c is CountryCode => c != null))
  );
  return codes.map((code) => toProfile(code, snapshots.countries[code]));
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(v: ValueYear | null): string {
  return v ? `${v.value}% (${v.year})` : "n/a";
}

function fmtValue(v: ValueYear | null): string {
  return v ? `${fmtNum(v.value)} (${v.year})` : "n/a";
}

function incomeLine(p: CountryDemographicProfile): string {
  const a = p.incomeAnchor;
  if (!a) return "income/spend anchor n/a";
  if (a.kind === "india_mpce") {
    const m = a.monthlyPerCapita;
    return `MPCE/mo INR rural avg ${fmtNum(m.avgRural)}, urban avg ${fmtNum(
      m.avgUrban
    )}; bottom 5% urban ${fmtNum(m.bottom5Urban)}, top 5% urban ${fmtNum(
      m.top5Urban
    )} [sourced]`;
  }
  if (a.kind === "us_acs_household_income") {
    const age = a.medianAge ? `, median age ${a.medianAge}` : "";
    return `median household income $${fmtNum(
      a.medianHouseholdIncome
    )}${age} (${a.year}) [sourced]`;
  }
  return `GDP/capita proxy $${fmtNum(a.gdpPerCapita.value)} (${
    a.gdpPerCapita.year
  }) [sourced_proxy]`;
}

export function formatCountryDemographics(countries: string[]): string | null {
  const profiles = demographicProfilesForCountries(countries);
  if (!profiles.length) return null;
  const lines = profiles.map((p) => {
    const ages = p.ageSharesPct;
    return `  ${p.country}: population ${fmtValue(
      p.population
    )}; urban ${fmtPct(ages ? p.urbanSharePct : null)}; age mix 0-14 ${fmtPct(
      ages.children0To14
    )}, 15-64 ${fmtPct(ages.working15To64)}, 65+ ${fmtPct(
      ages.senior65Plus
    )}; ${incomeLine(p)}`;
  });
  return `Official demographic profiles (India/US country-level spine):\n${lines.join(
    "\n"
  )}`;
}

export function countryDemographicsSources(countries: string[]): string[] {
  return Array.from(
    new Set(demographicProfilesForCountries(countries).flatMap((p) => p.sourceLabels))
  );
}

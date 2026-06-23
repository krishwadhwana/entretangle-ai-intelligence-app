import type { ClientProfile, CohortPlanOutput } from "./schema";

export const SINGLE_DESTINATION_LOCALITY_PREFIX =
  "SINGLE_DESTINATION_LOCALITY_JSON:";

export type SingleDestinationLocality = {
  label: string;
  country?: string;
  lat?: number;
  lng?: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatSingleDestinationContext(
  locality: SingleDestinationLocality
): string {
  const target = [locality.label, locality.country]
    .filter(Boolean)
    .join(", ");
  return [
    `Single destination locality: ${target}. Build the export audience only inside this one city/locality; do not expand it into a country, region, or multi-city market.`,
    `${SINGLE_DESTINATION_LOCALITY_PREFIX}${JSON.stringify(locality)}`,
  ].join("\n");
}

export function parseSingleDestinationLocality(
  additionalContext?: string | null
): SingleDestinationLocality | null {
  if (!additionalContext) return null;
  const line = additionalContext
    .split(/\r?\n/)
    .find((part) => part.startsWith(SINGLE_DESTINATION_LOCALITY_PREFIX));
  if (!line) return null;
  try {
    const raw = JSON.parse(
      line.slice(SINGLE_DESTINATION_LOCALITY_PREFIX.length)
    ) as Record<string, unknown>;
    const label = cleanText(raw.label);
    if (!label) return null;
    return {
      label,
      country: cleanText(raw.country),
      ...(finiteNumber(raw.lat) ? { lat: raw.lat } : {}),
      ...(finiteNumber(raw.lng) ? { lng: raw.lng } : {}),
    };
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function explicitBroadMarket(value: string): boolean {
  const n = normalize(value);
  if (!n) return true;
  if (
    new Set([
      "india",
      "bharat",
      "united states",
      "usa",
      "us",
      "america",
      "united kingdom",
      "uk",
      "great britain",
      "britain",
      "uae",
      "united arab emirates",
      "emirates",
      "canada",
      "australia",
      "germany",
      "france",
      "italy",
      "spain",
      "china",
      "japan",
      "gulf",
      "middle east",
      "europe",
      "asia",
      "southeast asia",
      "south east asia",
      "global",
      "worldwide",
      "international",
    ]).has(n)
  ) {
    return true;
  }
  return /\b(pan india|all india|all of india|entire india|whole india|india wide|nationwide|national|global|worldwide|international|across india)\b/.test(
    n
  );
}

function countryFromQualifier(value: string): string | undefined {
  const n = normalize(value);
  const countries: Record<string, string> = {
    india: "India",
    bharat: "India",
    "united states": "United States",
    usa: "United States",
    us: "United States",
    america: "United States",
    "united kingdom": "United Kingdom",
    uk: "United Kingdom",
    britain: "United Kingdom",
    "great britain": "United Kingdom",
    uae: "United Arab Emirates",
    "united arab emirates": "United Arab Emirates",
    emirates: "United Arab Emirates",
    canada: "Canada",
    australia: "Australia",
    germany: "Germany",
    france: "France",
    italy: "Italy",
    spain: "Spain",
    china: "China",
    japan: "Japan",
  };
  return countries[n];
}

function profileGeographyCandidate(raw: string): {
  label: string;
  country?: string;
} | null {
  const value = raw.trim();
  if (!value || explicitBroadMarket(value)) return null;

  const slashParts = value.split("/").map((part) => part.trim()).filter(Boolean);
  if (slashParts.length > 1) {
    const first = slashParts[0];
    if (!explicitBroadMarket(first)) {
      return {
        label: first,
        country: slashParts.map(countryFromQualifier).find(Boolean),
      };
    }
  }

  const commaParts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    const first = commaParts[0];
    if (!explicitBroadMarket(first)) {
      return {
        label: first,
        country: commaParts.slice(1).map(countryFromQualifier).find(Boolean),
      };
    }
  }

  return { label: value };
}

function matchingPlanLocality(
  plan: CohortPlanOutput,
  label: string
): CohortPlanOutput["localities"][number] | undefined {
  const target = normalize(label);
  if (!target) return undefined;
  return plan.localities.find((locality) => {
    const name = normalize(locality.name);
    return name === target || name.includes(target) || target.includes(name);
  });
}

export function singleProfileLocalityTarget(
  profile: ClientProfile,
  plan: CohortPlanOutput
): SingleDestinationLocality | null {
  const candidates = new Map<string, SingleDestinationLocality>();
  for (const geo of profile.geography ?? []) {
    const candidate = profileGeographyCandidate(geo);
    if (!candidate) continue;
    const match = matchingPlanLocality(plan, candidate.label);
    const label = match?.name ?? candidate.label;
    candidates.set(normalize(label), {
      label,
      country: candidate.country ?? match?.country,
      ...(match ? { lat: match.lat, lng: match.lng } : {}),
    });
  }

  if (candidates.size !== 1) return null;
  return [...candidates.values()][0];
}

export function clampCohortPlanToSingleLocality(
  plan: CohortPlanOutput,
  locality: SingleDestinationLocality
): CohortPlanOutput {
  const fallback = plan.localities[0];
  if (!fallback) return plan;

  const target = {
    name: locality.label,
    country: locality.country ?? fallback.country,
    lat: finiteNumber(locality.lat) ? locality.lat : fallback.lat,
    lng: finiteNumber(locality.lng) ? locality.lng : fallback.lng,
  };

  const merged = new Map<string, CohortPlanOutput["cohorts"][number]>();
  for (const cohort of plan.cohorts) {
    const key = `${cohort.segment}:${cohort.role}`;
    const existing = merged.get(key);
    if (existing) {
      existing.weightPct += cohort.weightPct;
    } else {
      merged.set(key, { ...cohort, locality: target.name });
    }
  }

  const requiredSegments: CohortPlanOutput["cohorts"][number]["segment"][] = [
    "budget",
    "middle",
    "affluent",
    "luxury",
  ];
  for (const segment of requiredSegments) {
    if (merged.size >= 4 && merged.has(`${segment}:consumer`)) continue;
    const key = `${segment}:consumer`;
    if (!merged.has(key)) {
      merged.set(key, {
        locality: target.name,
        segment,
        role: "consumer",
        weightPct: 1,
      });
    }
  }

  const cohorts = Array.from(merged.values()).map((cohort) => ({
    ...cohort,
    locality: target.name,
  }));
  const total = cohorts.reduce((sum, cohort) => sum + Math.max(0, cohort.weightPct), 0);
  const equalWeight = cohorts.length > 0 ? 100 / cohorts.length : 100;
  const normalized = cohorts.map((cohort) => ({
    ...cohort,
    weightPct:
      total > 0
        ? Math.round((Math.max(0, cohort.weightPct) / total) * 10000) / 100
        : Math.round(equalWeight * 100) / 100,
  }));
  if (normalized.length > 0) {
    const sum = normalized.reduce((acc, cohort) => acc + cohort.weightPct, 0);
    normalized[0] = {
      ...normalized[0],
      weightPct: Math.max(0, Math.round((normalized[0].weightPct + (100 - sum)) * 100) / 100),
    };
  }

  return {
    ...plan,
    localities: [target],
    cohorts: normalized,
  };
}

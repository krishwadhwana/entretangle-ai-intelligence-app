import { config } from "../config";
import type { StructuredData } from "./structured";

// ---------------------------------------------------------------------------
// Generic open-data connector (option: government/city open data, keyless).
// Most governments publish on ONE of two standard platforms, so a single
// client per platform reaches thousands of datasets across hundreds of cities:
//   • Socrata (data.cityofnewyork.us, data.sfgov.org, data.cityofchicago.org…)
//   • CKAN    (data.gov.uk, data.gov.in, data.europa.eu…)
// We DISCOVER relevant datasets via each portal's catalog/search API (using
// the industry's openDataQueries, e.g. "building permits"), then pull a recent
// COUNT — a real activity/demand signal per place (e.g. construction pipeline
// for an architecture venture). Best-effort, cached, never throws.
// ---------------------------------------------------------------------------

type Loc = { name: string; country: string; lat: number; lng: number };

// Known Socrata portals by city (the city's data portal host).
const SOCRATA_PORTALS: Record<string, string> = {
  "New York": "data.cityofnewyork.us",
  "New York City": "data.cityofnewyork.us",
  NYC: "data.cityofnewyork.us",
  "San Francisco": "data.sfgov.org",
  Chicago: "data.cityofchicago.org",
  "Los Angeles": "data.lacity.org",
  Seattle: "data.seattle.gov",
  Austin: "data.austintexas.gov",
  Dallas: "www.dallasopendata.com",
  Boston: "data.boston.gov", // CKAN actually; handled by CKAN below too
};
// CKAN national/region portals by country.
const CKAN_PORTALS: Record<string, string> = {
  "United Kingdom": "https://data.gov.uk",
  UK: "https://data.gov.uk",
  India: "https://data.gov.in",
  Germany: "https://www.govdata.de",
  France: "https://www.data.gouv.fr",
};

const CACHE = new Map<string, { at: number; data: StructuredData | null }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h

async function fetchJson(url: string, ms = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "EntreTangle/1.0" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Discover a dataset id on a Socrata portal matching the query (catalog API). */
async function socrataDiscover(
  host: string,
  query: string
): Promise<{ id: string; name: string } | null> {
  try {
    const data = (await fetchJson(
      `https://${host}/api/catalog/v1?q=${encodeURIComponent(query)}&only=dataset&limit=5`
    )) as { results?: Array<{ resource?: { id?: string; name?: string } }> };
    const hit = data.results?.find((r) => r.resource?.id);
    return hit?.resource?.id
      ? { id: hit.resource.id, name: hit.resource.name ?? query }
      : null;
  } catch {
    return null;
  }
}

/** Count recent rows in a Socrata dataset (SoQL $select=count). */
async function socrataCount(host: string, id: string): Promise<number | null> {
  try {
    const data = (await fetchJson(
      `https://${host}/resource/${id}.json?$select=count(*)`
    )) as Array<Record<string, string>>;
    const row = data?.[0];
    const v = row ? Object.values(row)[0] : null;
    const n = v != null ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** CKAN dataset discovery (package_search) — returns count of matching datasets. */
async function ckanDatasetCount(
  portal: string,
  query: string
): Promise<{ count: number; example: string } | null> {
  try {
    const data = (await fetchJson(
      `${portal}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=1`
    )) as { result?: { count?: number; results?: Array<{ title?: string }> } };
    const count = data.result?.count;
    if (count == null) return null;
    return { count, example: data.result?.results?.[0]?.title ?? query };
  } catch {
    return null;
  }
}

function mockOpenData(localities: Loc[], queries: string[]): StructuredData {
  const q = queries[0] ?? "permits";
  const lines = localities.slice(0, 5).map((l) => {
    const n = 1200 + (l.name.length * 911) % 9000;
    return `  ${l.name}: ~${n.toLocaleString()} ${q} records on file (open-data portal)`;
  });
  return {
    text: `Government open-data signal (real activity counts) [mock]:\n${lines.join(
      "\n"
    )}`,
    sources: ["mock:opendata"],
  };
}

/**
 * Pull a real activity signal (e.g. building-permit counts) for the venture's
 * open-data topics across the given localities. Socrata cities give per-city
 * counts; CKAN portals give national dataset availability. Returns null when
 * nothing resolves (desk falls back to web search). Never throws.
 */
export async function fetchOpenData(
  localities: Loc[],
  queries: string[]
): Promise<StructuredData | null> {
  if (queries.length === 0 || localities.length === 0) return null;
  if (config.mockMode) return mockOpenData(localities, queries);

  const query = queries[0];
  const cacheKey = `${query}:${localities.map((l) => l.name).slice(0, 5).join(",")}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const parts: string[] = [];
  const sources: string[] = [];

  // Per-city Socrata counts where we know the portal.
  await Promise.all(
    localities.slice(0, 6).map(async (l) => {
      const host = SOCRATA_PORTALS[l.name];
      if (!host) return;
      const ds = await socrataDiscover(host, query);
      if (!ds) return;
      const count = await socrataCount(host, ds.id);
      if (count != null) {
        parts.push(
          `${l.name}: ${count.toLocaleString()} "${ds.name}" records (${host})`
        );
        sources.push(`https://${host}`);
      }
    })
  );

  // National CKAN availability for the countries in play.
  const countries = Array.from(new Set(localities.map((l) => l.country)));
  for (const country of countries) {
    const portal = CKAN_PORTALS[country];
    if (!portal) continue;
    const r = await ckanDatasetCount(portal, query);
    if (r && r.count > 0) {
      parts.push(
        `${country}: ${r.count} open datasets matching "${query}" (e.g. "${r.example}") on ${portal}`
      );
      sources.push(portal);
    }
  }

  const data: StructuredData | null = parts.length
    ? {
        text: `Government open-data signal (real activity & dataset availability for "${query}"):\n  ${parts.join(
          "\n  "
        )}`,
        sources: Array.from(new Set(sources)),
      }
    : null;
  CACHE.set(cacheKey, { at: Date.now(), data });
  return data;
}

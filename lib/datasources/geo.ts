import { config } from "../config";
import type { StructuredData } from "./structured";

// ---------------------------------------------------------------------------
// Local competitor density (option: OpenStreetMap, keyless). For each locality
// we count the real number of retail outlets selling the venture's category
// (OSM shop= tags) within a radius of the locality centre, via the Overpass
// API. This gives HARD, per-city competition numbers — so each metro is
// genuinely different — without any API key.
//
// Best-effort: capped localities, short timeouts, in-process cache, and a
// never-throws contract (null ⇒ desk falls back to web search / model).
// ---------------------------------------------------------------------------

type Loc = { name: string; country: string; lat: number; lng: number };

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_LOCALITIES = 6;
const BBOX_DELTA = 0.06; // ~6–7 km half-box around the locality centre
const CACHE = new Map<string, { at: number; count: number | null }>();
const TTL_MS = 1000 * 60 * 60 * 12; // 12h

async function overpassCount(
  lat: number,
  lng: number,
  shopTags: string[]
): Promise<number | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}:${shopTags.sort().join(",")}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.count;

  const s = lat - BBOX_DELTA;
  const w = lng - BBOX_DELTA;
  const n = lat + BBOX_DELTA;
  const e = lng + BBOX_DELTA;
  const bbox = `(${s},${w},${n},${e})`;
  // Union of node+way for each shop tag, then a single count.
  const filters = shopTags
    .map((t) => `node["shop"="${t}"]${bbox};way["shop"="${t}"]${bbox};`)
    .join("");
  const query = `[out:json][timeout:20];(${filters});out count;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(endpoint, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "EntreTangle/1.0",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        elements?: Array<{ type?: string; tags?: { total?: string } }>;
      };
      const countEl = data.elements?.find((el) => el.type === "count");
      const total = countEl?.tags?.total;
      const count = total != null ? parseInt(total, 10) : null;
      if (count != null && Number.isFinite(count)) {
        CACHE.set(key, { at: Date.now(), count });
        return count;
      }
    } catch {
      // try next endpoint
    }
  }
  CACHE.set(key, { at: Date.now(), count: null });
  return null;
}

/** Deterministic mock so mock mode shows per-city competition without network. */
function mockCompetition(localities: Loc[], shopTags: string[]): StructuredData {
  const tag = shopTags[0] ?? "shops";
  // Seeded-ish by name length so cities differ but replays are stable.
  const lines = localities.slice(0, MAX_LOCALITIES).map((l) => {
    const base = 40 + (l.name.length * 37) % 220;
    return `  ${l.name}: ~${base} ${tag} outlets within ~6km of centre`;
  });
  return {
    text: `Local competitor density (real outlet counts, OpenStreetMap) [mock]:\n${lines.join(
      "\n"
    )}`,
    sources: ["mock:openstreetmap"],
  };
}

/**
 * Count competing outlets per locality. Returns a summarized StructuredData or
 * null if nothing resolved. Capped to the top localities; runs in parallel.
 */
export async function fetchLocalCompetition(
  localities: Loc[],
  shopTags: string[]
): Promise<StructuredData | null> {
  if (shopTags.length === 0 || localities.length === 0) return null;
  if (config.mockMode) return mockCompetition(localities, shopTags);

  const picked = localities.slice(0, MAX_LOCALITIES);
  const tags = shopTags.slice(0, 4);
  const results = await Promise.all(
    picked.map(async (l) => ({
      l,
      count: await overpassCount(l.lat, l.lng, tags),
    }))
  );
  const found = results.filter((r) => r.count != null);
  if (found.length === 0) return null;

  const lines = found.map(
    (r) => `  ${r.l.name}: ${r.count!.toLocaleString()} ${tags[0]} outlets within ~6km of centre`
  );
  return {
    text: `Local competitor density (real outlet counts, OpenStreetMap — a proxy
for retail saturation per city; higher = more crowded, lower = whitespace):
${lines.join("\n")}`,
    sources: ["https://www.openstreetmap.org (Overpass API)"],
  };
}

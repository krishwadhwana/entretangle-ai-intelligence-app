import { config } from "../config";
import type { StructuredData } from "./structured";

// ---------------------------------------------------------------------------
// Trade & tariffs (option C, industry-aware). Two real, mostly-keyless sources
// keyed off the venture's HS code(s):
//   • UN Comtrade  → real bilateral import/export VALUES by HS code → demand in
//     a market and who already supplies it (sourcing origins / competition).
//   • World Bank WITS → applied tariff (duty %) by HS6 & corridor → landed-cost
//     and regulation inputs.
// Both are best-effort: short timeouts, defensive parsing, in-process cache,
// never throws (null ⇒ desk falls back to web search). Comtrade's keyless
// preview is rate-limited; an optional COMTRADE_API_KEY (free tier) is used
// when present.
// ---------------------------------------------------------------------------

// M49 numeric codes Comtrade expects as reporter/partner.
const M49: Record<string, number> = {
  IN: 699,
  AE: 784,
  GB: 826,
  US: 842,
  SG: 702,
  AU: 36,
  CA: 124,
  DE: 276,
  FR: 250,
  IT: 380,
  ES: 724,
  NL: 528,
  SA: 682,
  QA: 634,
  JP: 392,
  CN: 156,
  BR: 76,
  ZA: 710,
  NG: 566,
  KE: 404,
  ID: 360,
};

const CACHE = new Map<string, { at: number; data: StructuredData | null }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h

async function fetchJson(url: string, ms = 9000, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "EntreTangle/1.0", ...headers },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Comtrade: top import partners (by value) for a reporter + HS code. */
async function comtradeImports(
  iso2: string,
  hs: string
): Promise<{ partner: string; valueUsd: number }[] | null> {
  const reporter = M49[iso2];
  if (!reporter) return null;
  const key = process.env.COMTRADE_API_KEY;
  const base = key
    ? "https://comtradeapi.un.org/data/v1/get/C/A/HS"
    : "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
  const url =
    `${base}?reporterCode=${reporter}&period=2023&cmdCode=${encodeURIComponent(
      hs
    )}&flowCode=M&partnerCode=&partner2Code=0&customsCode=C00&motCode=0` +
    (key ? `&subscription-key=${encodeURIComponent(key)}` : "");
  try {
    const data = (await fetchJson(url)) as {
      data?: Array<{ partnerDesc?: string; primaryValue?: number; partnerCode?: number }>;
    };
    const rows = (data.data ?? [])
      .filter((r) => r.partnerCode !== 0 && (r.primaryValue ?? 0) > 0)
      .map((r) => ({ partner: r.partnerDesc ?? "?", valueUsd: r.primaryValue ?? 0 }))
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 5);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Applied (MFN) import duty % a reporter charges the world for an HS6 product —
 * a landed-cost input for the export-pricing engine. Best-effort: null on any
 * failure (caller supplies its own default). Live + cached (24h).
 */
export async function fetchAppliedTariffPct(
  iso2: string,
  hs6: string
): Promise<number | null> {
  if (config.mockMode) return 12;
  const cacheKey = `tariff:${iso2}:${hs6}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    const t = hit.data?.text.match(/([\d.]+)%/);
    return t ? parseFloat(t[1]) : null;
  }
  const val = await witsTariff(iso2, hs6.slice(0, 6));
  CACHE.set(cacheKey, {
    at: Date.now(),
    data: val != null ? { text: `${val}%`, sources: ["https://wits.worldbank.org"] } : null,
  });
  return val;
}

/** WITS: simple applied (MFN) tariff for reporter from world, HS6. */
async function witsTariff(iso2: string, hs6: string): Promise<number | null> {
  // WITS wants lowercase ISO3-ish reporter; it also accepts ISO2 in some paths.
  const url = `https://wits.worldbank.org/API/V1/SDMX/V21/datasource/TRN/reporter/${iso2.toLowerCase()}/partner/wld/product/${hs6}/year/2021/datatype/aveestimated?format=JSON`;
  try {
    const data = (await fetchJson(url)) as unknown;
    // SDMX-JSON is deeply nested; defensively dig for the first numeric obs.
    const val = digFirstNumber(data);
    return val != null && val >= 0 && val < 1000 ? val : null;
  } catch {
    return null;
  }
}

// Defensive deep search for the first finite number in an SDMX-ish object.
function digFirstNumber(obj: unknown, depth = 0): number | null {
  if (depth > 8 || obj == null) return null;
  if (typeof obj === "number" && Number.isFinite(obj)) return obj;
  if (typeof obj === "string") {
    const n = parseFloat(obj);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = digFirstNumber(v, depth + 1);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const r = digFirstNumber(v, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}

function mockTrade(country: string, hs: string): StructuredData {
  return {
    text: `Trade & tariff data (real, HS ${hs}) [mock]:
  ${country} imports — top origins: China $420M, Vietnam $180M, Bangladesh $90M (2023)
  Applied MFN tariff (${country}, HS ${hs}): ~10–20%`,
    sources: ["mock:uncomtrade", "mock:wits"],
  };
}

/**
 * Real trade flows + tariffs for the venture's HS codes across the relevant
 * countries. `domain` tunes the emphasis (market/competitor ⇒ flows;
 * pricing/regulation ⇒ tariffs; supply ⇒ sourcing origins). Returns null if
 * nothing resolves.
 */
export async function fetchTradeForDomain(
  domain: string,
  countries: { name: string; iso2: string }[],
  hsCodes: string[]
): Promise<StructuredData | null> {
  if (hsCodes.length === 0 || countries.length === 0) return null;
  const hs = hsCodes[0];
  const hs6 = (hsCodes.find((c) => c.length >= 6) ?? hs).slice(0, 6);
  const country = countries[0];

  if (config.mockMode) return mockTrade(country.name, hs);

  const cacheKey = `${domain}:${country.iso2}:${hs}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const parts: string[] = [];
  const sources: string[] = [];

  const wantsFlows = ["market", "competitor", "supply"].includes(domain);
  const wantsTariff = ["pricing", "regulation", "finance"].includes(domain);

  if (wantsFlows) {
    const imports = await comtradeImports(country.iso2, hs);
    if (imports) {
      const top = imports
        .map((r) => `${r.partner} $${Math.round(r.valueUsd / 1e6)}M`)
        .join(", ");
      parts.push(
        `${country.name} imports (HS ${hs}, 2023) — top origins: ${top}. (Real import demand & who already supplies this market.)`
      );
      sources.push("https://comtrade.un.org");
    }
  }
  if (wantsTariff) {
    const tariff = await witsTariff(country.iso2, hs6);
    if (tariff != null) {
      parts.push(
        `Applied tariff into ${country.name} (HS ${hs6}): ~${tariff.toFixed(1)}% — a landed-cost input.`
      );
      sources.push("https://wits.worldbank.org");
    }
  }

  const data: StructuredData | null = parts.length
    ? { text: `Trade & tariff data (real, HS ${hs}):\n  ${parts.join("\n  ")}`, sources }
    : null;
  CACHE.set(cacheKey, { at: Date.now(), data });
  return data;
}

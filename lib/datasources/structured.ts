import { config } from "../config";
import type { Domain } from "../schema";
import { fetchTradeForDomain } from "./trade";
import { fetchLocalCompetition } from "./geo";
import { fetchOpenData } from "./opendata";

// ---------------------------------------------------------------------------
// Structured real-data providers per desk domain (SPEC-V2 §1A option C).
// Each research desk's domain maps to live, structured data sources that are
// fetched and injected into the desk prompt as fact — instead of (or beside)
// the desk's free-text web search:
//   • pricing  → real FX rates (open.er-api.com, keyless)
//   • market   → World Bank macro indicators + Wikipedia interest (keyless)
//   • others   → a pluggable, key-gated hook; null ⇒ desk falls back to web
//                search / model knowledge (never an error).
// Mock mode returns deterministic fixtures (no network).
// ---------------------------------------------------------------------------

export type StructuredData = { text: string; sources: string[] };

export type StructuredCtx = {
  countries: string[];
  currency: string;
  product: string;
  // Industry routing (from the per-run classifier) + localities for geo data.
  hsCodes?: string[];
  osmShopTags?: string[];
  openDataQueries?: string[];
  localities?: { name: string; country: string; lat: number; lng: number }[];
};

// country name (as it appears in localities) -> ISO2 + currency code.
const COUNTRY: Record<string, { iso2: string; currency: string }> = {
  India: { iso2: "IN", currency: "INR" },
  "United Arab Emirates": { iso2: "AE", currency: "AED" },
  UAE: { iso2: "AE", currency: "AED" },
  "United Kingdom": { iso2: "GB", currency: "GBP" },
  UK: { iso2: "GB", currency: "GBP" },
  "United States": { iso2: "US", currency: "USD" },
  USA: { iso2: "US", currency: "USD" },
  US: { iso2: "US", currency: "USD" },
  Singapore: { iso2: "SG", currency: "SGD" },
  Australia: { iso2: "AU", currency: "AUD" },
  Canada: { iso2: "CA", currency: "CAD" },
  Germany: { iso2: "DE", currency: "EUR" },
  France: { iso2: "FR", currency: "EUR" },
  Italy: { iso2: "IT", currency: "EUR" },
  Spain: { iso2: "ES", currency: "EUR" },
  Netherlands: { iso2: "NL", currency: "EUR" },
  "Saudi Arabia": { iso2: "SA", currency: "SAR" },
  Qatar: { iso2: "QA", currency: "QAR" },
  Japan: { iso2: "JP", currency: "JPY" },
  China: { iso2: "CN", currency: "CNY" },
  Brazil: { iso2: "BR", currency: "BRL" },
  "South Africa": { iso2: "ZA", currency: "ZAR" },
  Nigeria: { iso2: "NG", currency: "NGN" },
  Kenya: { iso2: "KE", currency: "KES" },
  Indonesia: { iso2: "ID", currency: "IDR" },
};

async function fetchJson(url: string, ms = 7000): Promise<unknown> {
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

// --- Providers ------------------------------------------------------------

/** Real exchange rates from a base currency to several targets (keyless). */
async function fxRates(
  base: string,
  targets: string[]
): Promise<Record<string, number> | null> {
  try {
    const data = (await fetchJson(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`
    )) as { result?: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) return null;
    const out: Record<string, number> = {};
    for (const t of targets) if (data.rates[t] != null) out[t] = data.rates[t];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Latest value of a World Bank indicator for a country (keyless). */
async function worldBank(
  iso2: string,
  indicator: string
): Promise<{ value: number; date: string } | null> {
  // One retry — the API occasionally returns a transient error.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = (await fetchJson(
        `https://api.worldbank.org/v2/country/${iso2}/indicator/${indicator}?format=json&mrnev=1`
      )) as [unknown, Array<{ value: number | null; date: string }>?];
      const row = Array.isArray(data) && data[1]?.[0];
      if (!row || row.value == null) return null;
      return { value: row.value, date: row.date };
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  return null;
}

// Attention / hype proxy: Wikipedia monthly pageviews for the term, plus a
// MOMENTUM read (last 3 months vs the prior 3) → rising / steady / cooling. This
// is the one clean FREE attention signal — a demand-interest proxy, NOT true ad
// or social attention (Google Trends / social listening have no clean free API
// and need licensed data). Honest by construction; callers flag it as a proxy.
type AttentionSignal = {
  avgMonthly: number;
  momentumPct: number;
  trend: "rising" | "steady" | "cooling";
};

async function attentionSignal(term: string): Promise<AttentionSignal | null> {
  const article = term.trim().split(/\s+/).slice(0, 3).join("_");
  if (!article) return null;
  try {
    const data = (await fetchJson(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(
        article
      )}/monthly/2024010100/2026120100`
    )) as { items?: Array<{ views: number }> };
    const items = data.items ?? [];
    if (items.length < 2) return null;
    const mean = (a: Array<{ views: number }>) =>
      a.length ? a.reduce((s, i) => s + i.views, 0) / a.length : 0;
    const avgMonthly = Math.round(mean(items.slice(-3)));
    const priorAvg = mean(items.slice(-6, -3));
    const momentumPct =
      priorAvg > 0 ? Math.round(((avgMonthly - priorAvg) / priorAvg) * 100) : 0;
    const trend =
      momentumPct >= 15 ? "rising" : momentumPct <= -15 ? "cooling" : "steady";
    return { avgMonthly, momentumPct, trend };
  } catch {
    return null;
  }
}

/**
 * Bounded attention/hype momentum (%) for a product term, for the launch sim's
 * demand tilt. Clamped to ±25 (a proxy, not a hard demand multiplier); 0 when
 * the signal is unavailable. Frozen into a scenario at run time by the caller.
 */
export async function getAttentionMomentumPct(term: string): Promise<number> {
  const sig = await attentionSignal(term);
  if (!sig) return 0;
  return Math.max(-25, Math.min(25, sig.momentumPct));
}

// --- Dispatch -------------------------------------------------------------

const GDP_PC = "NY.GDP.PCAP.CD"; // GDP per capita (current US$)
const URBAN = "SP.URB.TOTL.IN.ZS"; // urban population (% of total)

function knownCountries(countries: string[]) {
  return countries
    .map((c) => ({ name: c, meta: COUNTRY[c] }))
    .filter((c): c is { name: string; meta: { iso2: string; currency: string } } =>
      Boolean(c.meta)
    );
}

async function pricingData(ctx: StructuredCtx): Promise<StructuredData | null> {
  const targets = Array.from(
    new Set(knownCountries(ctx.countries).map((c) => c.meta.currency))
  ).filter((c) => c !== ctx.currency);
  if (targets.length === 0) return null;
  const rates = await fxRates(ctx.currency, targets);
  if (!rates) return null;
  const lines = Object.entries(rates).map(
    ([cur, r]) => `  1 ${ctx.currency} = ${r} ${cur}`
  );
  return {
    text: `Live exchange rates (base ${ctx.currency}) for landed-cost & price positioning:\n${lines.join(
      "\n"
    )}`,
    sources: ["https://open.er-api.com (live FX)"],
  };
}

async function marketData(ctx: StructuredCtx): Promise<StructuredData | null> {
  const cs = knownCountries(ctx.countries);
  if (cs.length === 0 && !ctx.product) return null;
  const parts: string[] = [];
  const sources: string[] = [];
  for (const c of cs) {
    const [gdp, urban] = await Promise.all([
      worldBank(c.meta.iso2, GDP_PC),
      worldBank(c.meta.iso2, URBAN),
    ]);
    if (gdp || urban) {
      parts.push(
        `  ${c.name}: ${
          gdp ? `GDP/capita $${Math.round(gdp.value).toLocaleString()} (${gdp.date})` : "GDP n/a"
        }${urban ? `, urban ${urban.value.toFixed(0)}%` : ""}`
      );
      sources.push("https://data.worldbank.org");
    }
  }
  const attention = await attentionSignal(ctx.product);
  if (attention != null) {
    const momentum =
      attention.momentumPct !== 0
        ? ` (${attention.momentumPct > 0 ? "+" : ""}${attention.momentumPct}% vs prior quarter)`
        : "";
    parts.push(
      `  "${ctx.product}" attention/hype (proxy): ~${attention.avgMonthly.toLocaleString()} Wikipedia views/mo, ${attention.trend}${momentum} — demand-interest proxy only; true ad/social attention (Trends/CPM/virality) needs licensed data`
    );
    sources.push("https://wikimedia.org (pageviews)");
  }
  if (parts.length === 0) return null;
  return {
    text: `Macro & demand indicators (real):\n${parts.join("\n")}`,
    sources: Array.from(new Set(sources)),
  };
}

/** Deterministic mock structured data (no network) for mock mode / tests. */
function mockStructured(domain: Domain, ctx: StructuredCtx): StructuredData | null {
  if (domain === "pricing") {
    return {
      text: `Live exchange rates (base ${ctx.currency}) [mock]:\n  1 ${ctx.currency} = 0.012 USD\n  1 ${ctx.currency} = 0.044 AED`,
      sources: ["mock:fx"],
    };
  }
  if (domain === "market") {
    return {
      text: `Macro & demand indicators (real) [mock]:\n  India: GDP/capita $2,480 (2024), urban 36%\n  "${ctx.product}" Wikipedia interest: ~24,000 views/mo`,
      sources: ["mock:worldbank", "mock:wikipedia"],
    };
  }
  return null;
}

/** Merge several structured sources for one desk into a single block. */
function mergeStructured(parts: StructuredData[]): StructuredData | null {
  const kept = parts.filter(Boolean);
  if (kept.length === 0) return null;
  return {
    text: kept.map((p) => p.text).join("\n\n"),
    sources: Array.from(new Set(kept.flatMap((p) => p.sources))),
  };
}

/**
 * Fetch structured real data relevant to a desk domain, merging every provider
 * that covers it: the generic macro/FX providers PLUS the industry-aware ones
 * (trade & tariffs by HS code, local competitor density by city). Returns null
 * when nothing resolves (the desk then falls back to web search). Never throws.
 */
export async function fetchStructuredForDesk(
  domain: Domain,
  ctx: StructuredCtx
): Promise<StructuredData | null> {
  try {
    const tasks: Promise<StructuredData | null>[] = [];

    // Generic macro/FX providers (mock or real).
    if (config.mockMode) {
      const m = mockStructured(domain, ctx);
      if (m) tasks.push(Promise.resolve(m));
    } else {
      if (domain === "pricing") tasks.push(pricingData(ctx));
      if (domain === "market") tasks.push(marketData(ctx));
    }

    // Industry-aware: trade flows & tariffs by HS code.
    if (
      ctx.hsCodes?.length &&
      ["market", "competitor", "supply", "pricing", "regulation", "finance"].includes(
        domain
      )
    ) {
      const countries = knownCountries(ctx.countries).map((c) => ({
        name: c.name,
        iso2: c.meta.iso2,
      }));
      if (countries.length) {
        tasks.push(fetchTradeForDomain(domain, countries, ctx.hsCodes));
      }
    }

    // Industry-aware: real local competitor density per city (OSM).
    if (
      ctx.osmShopTags?.length &&
      ctx.localities?.length &&
      ["competitor", "channel", "market"].includes(domain)
    ) {
      tasks.push(fetchLocalCompetition(ctx.localities, ctx.osmShopTags));
    }

    // Government open data (permits/construction/licences) — real per-place
    // activity & demand signal for market/competitor/operations desks.
    if (
      ctx.openDataQueries?.length &&
      ctx.localities?.length &&
      ["market", "competitor", "operations"].includes(domain)
    ) {
      tasks.push(fetchOpenData(ctx.localities, ctx.openDataQueries));
    }

    const results = (await Promise.all(tasks)).filter(
      (r): r is StructuredData => r != null
    );
    return mergeStructured(results);
  } catch {
    return null;
  }
}

/** Render structured data as a labeled prompt section. */
export function formatStructured(sd: StructuredData): string {
  return `STRUCTURED DATA (real, fetched live — treat as fact, cite the source
URL in "sources" when used):
${sd.text}
Sources: ${sd.sources.join(", ")}
END STRUCTURED DATA.`;
}

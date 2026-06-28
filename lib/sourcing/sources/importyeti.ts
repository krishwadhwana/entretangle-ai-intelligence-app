// ---------------------------------------------------------------------------
// ImportYeti — a licensed bills-of-lading / trade-data feed. This is a
// legally-clean sourcing path: you LICENSE the customs/shipping data (who ships
// what to whom) rather than scraping a directory's UI. Live mode calls the
// configured feed; before credentials land it returns deterministic fixtures so
// the pipeline is fully exercised end-to-end.
//
// To enable live: set IMPORTYETI_API_URL + IMPORTYETI_API_KEY (per your data
// licence). Confirm the request/response mapping below against the feed's
// contract — the shape here is the integration point, intentionally minimal.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type { RawManufacturer, SourcingQuery, SourcingSource } from "../types";

// ── deterministic fixture generator (no Math.random → stable re-runs) ───────
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGION_COUNTRIES: Record<string, { country: string; cities: string[] }[]> = {
  Asia: [
    { country: "China", cities: ["Shenzhen", "Guangzhou", "Yiwu", "Ningbo", "Dongguan"] },
    { country: "India", cities: ["Mumbai", "Tiruppur", "Surat", "Ahmedabad", "Noida"] },
    { country: "Vietnam", cities: ["Hanoi", "Ho Chi Minh City"] },
    { country: "Bangladesh", cities: ["Dhaka", "Chittagong"] },
  ],
  Europe: [
    { country: "Italy", cities: ["Milan", "Prato"] },
    { country: "Portugal", cities: ["Porto", "Braga"] },
    { country: "Turkey", cities: ["Istanbul", "Izmir"] },
  ],
  "North America": [
    { country: "United States", cities: ["Los Angeles", "New York"] },
    { country: "Mexico", cities: ["Guadalajara", "Tijuana"] },
  ],
};
const ALL_REGIONS = Object.keys(REGION_COUNTRIES);

const PAYMENT_TERMS = [
  "30% deposit, 70% before shipment (T/T)",
  "50% deposit, 50% on B/L copy",
  "L/C at sight",
  "100% before shipment for first order",
  "Net 30 after approved sampling",
];
const SUFFIXES = ["Manufacturing Co., Ltd.", "Industries", "Mfg. Co.", "Exports Pvt. Ltd.", "Trading & Mfg."];

function regionsToUse(query: SourcingQuery): string[] {
  // Map requested regions/countries onto the regions we have fixtures for.
  const matched = new Set<string>();
  for (const r of query.regions) {
    const hit = ALL_REGIONS.find(
      (k) => k.toLowerCase() === r.toLowerCase() || REGION_COUNTRIES[k].some((c) => c.country.toLowerCase() === r.toLowerCase()),
    );
    if (hit) matched.add(hit);
  }
  return matched.size ? [...matched] : ALL_REGIONS;
}

function generate(query: SourcingQuery): RawManufacturer[] {
  const subject = (query.category || query.product || "product").trim();
  const seedKey = `${subject}|${query.regions.join(",")}|${query.keywords.join(",")}`;
  const rng = mulberry32(hashString(seedKey));
  const regions = regionsToUse(query);
  const out: RawManufacturer[] = [];
  const titleSubject = subject.replace(/\b\w/g, (c) => c.toUpperCase());

  for (let i = 0; i < query.limit; i++) {
    const region = regions[Math.floor(rng() * regions.length)];
    const loc = REGION_COUNTRIES[region][Math.floor(rng() * REGION_COUNTRIES[region].length)];
    const city = loc.cities[Math.floor(rng() * loc.cities.length)];
    const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
    const moq = [100, 250, 500, 1000, 2000, 5000][Math.floor(rng() * 6)];
    const samplePrice = Math.round((5 + rng() * 45) * 100) / 100;
    const unitPrice = Math.round((1.2 + rng() * 18) * 100) / 100;
    const leadTimeDays = [15, 21, 30, 45, 60][Math.floor(rng() * 5)];
    const verified = rng() > 0.45;
    const slug = `${city}-${titleSubject}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    out.push({
      name: `${city} ${titleSubject} ${suffix}`,
      products: `${titleSubject}${query.keywords.length ? " — " + query.keywords.slice(0, 3).join(", ") : ""}`,
      country: loc.country,
      region,
      website: `https://${slug}.example.com`,
      sourceUrl: `https://www.importyeti.com/company/${slug}`,
      moq,
      moqUnit: "units",
      samplePrice,
      unitPrice,
      currency: "USD",
      leadTimeDays,
      paymentTerms: PAYMENT_TERMS[Math.floor(rng() * PAYMENT_TERMS.length)],
      verified,
    });
  }
  return out;
}

export const importYetiSource: SourcingSource = {
  key: "importyeti",
  label: "ImportYeti (trade data)",
  legalMode: "licensed_feed",

  isConfigured() {
    const c = config.sourcing.importyeti;
    return Boolean(c.apiKey && c.baseUrl);
  },

  async search(query: SourcingQuery): Promise<RawManufacturer[]> {
    const c = config.sourcing.importyeti;
    if (!c.apiKey || !c.baseUrl) throw new Error("ImportYeti feed not configured");
    // Integration point — confirm against your data licence's contract. The feed
    // returns shippers/suppliers for a product; we keep only supplier-side fields.
    const res = await fetch(c.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        product: query.product,
        category: query.category,
        keywords: query.keywords,
        countries: query.regions,
        limit: query.limit,
      }),
    });
    if (!res.ok) throw new Error(`ImportYeti feed failed (HTTP ${res.status})`);
    const body = (await res.json()) as { suppliers?: RawSupplier[] };
    return (body.suppliers ?? []).slice(0, query.limit).map(mapSupplier);
  },

  mockSearch(query: SourcingQuery): RawManufacturer[] {
    return generate(query);
  },
};

// Shape the licensed feed is expected to return per supplier. Adjust to match
// your contract; only the supplier-identifying + sourcing fields are kept.
type RawSupplier = {
  name?: string;
  company_name?: string;
  products?: string;
  country?: string;
  website?: string;
  profile_url?: string;
  min_order_qty?: number;
  sample_price_usd?: number;
  unit_price_usd?: number;
  lead_time_days?: number;
  payment_terms?: string;
  verified?: boolean;
};
function mapSupplier(s: RawSupplier): RawManufacturer {
  return {
    name: s.name || s.company_name || "Unknown supplier",
    products: s.products ?? null,
    country: s.country ?? null,
    website: s.website ?? null,
    sourceUrl: s.profile_url ?? null,
    moq: s.min_order_qty ?? null,
    samplePrice: s.sample_price_usd ?? null,
    unitPrice: s.unit_price_usd ?? null,
    currency: "USD",
    leadTimeDays: s.lead_time_days ?? null,
    paymentTerms: s.payment_terms ?? null,
    verified: Boolean(s.verified),
  };
}

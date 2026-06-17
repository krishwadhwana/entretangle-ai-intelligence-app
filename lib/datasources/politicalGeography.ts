import { geoTierFromPlace, type GeoTier } from "./benchmarks";

// ---------------------------------------------------------------------------
// Political / administrative geography (India). Maps a locality to its state,
// the Government of India "Zonal Council" zone, and an urban–rural class. This
// is FACTUAL administrative geography (Census of India + GoI Zonal Councils) —
// neutral and authoritative, not partisan/electoral data. It adds a real
// political-geography axis (state/zone/urban-rural) on top of the commercial
// geo-tier axis (metro/tier1/…), so cohorts, the map, and analysis can reason
// regionally. Pure + deterministic (mirrors the structured.ts contract).
//
// Sources: Census of India (settlement classification) and the GoI Zonal
// Councils (States Reorganisation Act / Ministry of Home Affairs) state→zone
// grouping. Coverage tracks the cities the app already recognises; unknown
// Indian places resolve state=null but still get a zone-less urban/rural class.
// ---------------------------------------------------------------------------

export type Zone =
  | "North"
  | "South"
  | "East"
  | "West"
  | "Central"
  | "Northeast";

export type UrbanClass = "urban" | "semi-urban" | "rural";

export type RegionInfo = {
  state: string | null;
  zone: Zone | null;
  urbanClass: UrbanClass;
};

// State → GoI Zonal Council zone (authoritative grouping).
const STATE_ZONE: Record<string, Zone> = {
  // North
  Delhi: "North",
  Haryana: "North",
  Punjab: "North",
  Rajasthan: "North",
  "Himachal Pradesh": "North",
  "Jammu & Kashmir": "North",
  Chandigarh: "North",
  // Central
  "Uttar Pradesh": "Central",
  Uttarakhand: "Central",
  "Madhya Pradesh": "Central",
  Chhattisgarh: "Central",
  // East
  Bihar: "East",
  "West Bengal": "East",
  Odisha: "East",
  Jharkhand: "East",
  // West
  Gujarat: "West",
  Maharashtra: "West",
  Goa: "West",
  // South
  "Andhra Pradesh": "South",
  Karnataka: "South",
  Kerala: "South",
  "Tamil Nadu": "South",
  Telangana: "South",
  Puducherry: "South",
  // Northeast
  Assam: "Northeast",
};

// City (lowercased) → state. Covers the cities the app already classifies in
// benchmarks.ts (metros + tier1 + tier2), incl. common aliases.
const CITY_STATE: Record<string, string> = {
  // metros
  mumbai: "Maharashtra",
  delhi: "Delhi",
  "new delhi": "Delhi",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  hyderabad: "Telangana",
  chennai: "Tamil Nadu",
  kolkata: "West Bengal",
  pune: "Maharashtra",
  ahmedabad: "Gujarat",
  // tier 1
  jaipur: "Rajasthan",
  surat: "Gujarat",
  lucknow: "Uttar Pradesh",
  kanpur: "Uttar Pradesh",
  nagpur: "Maharashtra",
  indore: "Madhya Pradesh",
  thane: "Maharashtra",
  bhopal: "Madhya Pradesh",
  visakhapatnam: "Andhra Pradesh",
  vizag: "Andhra Pradesh",
  patna: "Bihar",
  vadodara: "Gujarat",
  ghaziabad: "Uttar Pradesh",
  ludhiana: "Punjab",
  agra: "Uttar Pradesh",
  nashik: "Maharashtra",
  chandigarh: "Chandigarh",
  coimbatore: "Tamil Nadu",
  kochi: "Kerala",
  cochin: "Kerala",
  gurugram: "Haryana",
  gurgaon: "Haryana",
  noida: "Uttar Pradesh",
  faridabad: "Haryana",
  // tier 2
  guwahati: "Assam",
  mysore: "Karnataka",
  mysuru: "Karnataka",
  madurai: "Tamil Nadu",
  rajkot: "Gujarat",
  jodhpur: "Rajasthan",
  raipur: "Chhattisgarh",
  ranchi: "Jharkhand",
  amritsar: "Punjab",
  varanasi: "Uttar Pradesh",
  allahabad: "Uttar Pradesh",
  prayagraj: "Uttar Pradesh",
  jabalpur: "Madhya Pradesh",
  gwalior: "Madhya Pradesh",
  vijayawada: "Andhra Pradesh",
  trivandrum: "Kerala",
  thiruvananthapuram: "Kerala",
  tiruchirappalli: "Tamil Nadu",
  trichy: "Tamil Nadu",
  salem: "Tamil Nadu",
  warangal: "Telangana",
  dehradun: "Uttarakhand",
  jamshedpur: "Jharkhand",
  bhubaneswar: "Odisha",
  aurangabad: "Maharashtra",
  kota: "Rajasthan",
  udaipur: "Rajasthan",
  siliguri: "West Bengal",
  bareilly: "Uttar Pradesh",
  moradabad: "Uttar Pradesh",
};

// Commercial geo-tier → urban/rural class (Census-style settlement scale).
function urbanClassForTier(tier: GeoTier): UrbanClass {
  if (tier === "metro" || tier === "tier1") return "urban";
  if (tier === "tier2") return "semi-urban";
  return "rural"; // tier3 / rural / international handled by caller
}

/** Resolve a locality to its state, GoI zone, and urban class. Null for non-India. */
export function regionForLocality(
  name: string,
  country?: string
): RegionInfo | null {
  const c = (country ?? "").trim().toLowerCase();
  if (c && !["india", "in", "bharat", ""].includes(c)) return null;
  const n = (name ?? "").trim().toLowerCase();
  const state = CITY_STATE[n] ?? null;
  const zone = state ? (STATE_ZONE[state] ?? null) : null;
  const urbanClass = urbanClassForTier(geoTierFromPlace(name, country));
  return { state, zone, urbanClass };
}

/** The distinct GoI zones present across a set of localities. */
export function zonesForLocalities(
  localities: { name: string; country?: string }[]
): Zone[] {
  const zones = new Set<Zone>();
  for (const l of localities) {
    const r = regionForLocality(l.name, l.country);
    if (r?.zone) zones.add(r.zone);
  }
  return Array.from(zones);
}

/** One-line region context for a prompt (empty when not resolvable). */
export function formatRegion(name: string, country?: string): string {
  const r = regionForLocality(name, country);
  if (!r) return "";
  const parts = [r.state, r.zone ? `${r.zone} India` : null, r.urbanClass].filter(
    Boolean
  );
  return parts.length ? `Administrative region: ${parts.join(" · ")}.` : "";
}

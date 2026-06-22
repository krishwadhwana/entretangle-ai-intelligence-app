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

// India GoI Zonal Councils + US Census Bureau regions share this label set
// (Northeast/South/West overlap by name; "Midwest"/"Central"/"East" are
// market-specific). Which scheme applies is decided by the locality's country.
export type Zone =
  | "North"
  | "South"
  | "East"
  | "West"
  | "Central"
  | "Northeast"
  | "Midwest";

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

// ---------------------------------------------------------------------------
// United States — Census Bureau 4-region scheme (Northeast / Midwest / South /
// West). Authoritative, neutral administrative geography (US Census Bureau
// regions & divisions). State resolved from the locality string ("Austin, TX"
// or "Austin, Texas") or a major-city lookup, then mapped to its region.
// ---------------------------------------------------------------------------
const US_STATE_REGION: Record<string, Zone> = {
  // Northeast
  Connecticut: "Northeast", Maine: "Northeast", Massachusetts: "Northeast",
  "New Hampshire": "Northeast", "Rhode Island": "Northeast", Vermont: "Northeast",
  "New Jersey": "Northeast", "New York": "Northeast", Pennsylvania: "Northeast",
  // Midwest
  Illinois: "Midwest", Indiana: "Midwest", Michigan: "Midwest", Ohio: "Midwest",
  Wisconsin: "Midwest", Iowa: "Midwest", Kansas: "Midwest", Minnesota: "Midwest",
  Missouri: "Midwest", Nebraska: "Midwest", "North Dakota": "Midwest",
  "South Dakota": "Midwest",
  // South
  Delaware: "South", Florida: "South", Georgia: "South", Maryland: "South",
  "North Carolina": "South", "South Carolina": "South", Virginia: "South",
  "West Virginia": "South", "District of Columbia": "South", Alabama: "South",
  Kentucky: "South", Mississippi: "South", Tennessee: "South", Arkansas: "South",
  Louisiana: "South", Oklahoma: "South", Texas: "South",
  // West
  Arizona: "West", Colorado: "West", Idaho: "West", Montana: "West",
  Nevada: "West", "New Mexico": "West", Utah: "West", Wyoming: "West",
  Alaska: "West", California: "West", Hawaii: "West", Oregon: "West",
  Washington: "West",
};

const US_ABBR_STATE: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

// Major US cities/boroughs → state (for bare city names with no state in string).
const US_CITY_STATE: Record<string, string> = {
  "new york": "New York", "new york city": "New York", nyc: "New York",
  brooklyn: "New York", manhattan: "New York", queens: "New York", bronx: "New York",
  "los angeles": "California", la: "California", "san francisco": "California",
  "san diego": "California", "san jose": "California", sacramento: "California",
  fresno: "California", oakland: "California", "long beach": "California",
  chicago: "Illinois", houston: "Texas", "san antonio": "Texas", dallas: "Texas",
  austin: "Texas", "fort worth": "Texas", "el paso": "Texas", phoenix: "Arizona",
  tucson: "Arizona", philadelphia: "Pennsylvania", pittsburgh: "Pennsylvania",
  jacksonville: "Florida", miami: "Florida", orlando: "Florida", tampa: "Florida",
  columbus: "Ohio", cleveland: "Ohio", cincinnati: "Ohio", charlotte: "North Carolina",
  raleigh: "North Carolina", indianapolis: "Indiana", seattle: "Washington",
  denver: "Colorado", washington: "District of Columbia", "washington dc": "District of Columbia",
  boston: "Massachusetts", nashville: "Tennessee", memphis: "Tennessee",
  detroit: "Michigan", portland: "Oregon", "las vegas": "Nevada", louisville: "Kentucky",
  baltimore: "Maryland", milwaukee: "Wisconsin", albuquerque: "New Mexico",
  atlanta: "Georgia", minneapolis: "Minnesota", "kansas city": "Missouri",
  "salt lake city": "Utah", "new orleans": "Louisiana", "oklahoma city": "Oklahoma",
};

const US_COUNTRY = new Set([
  "us", "u.s.", "u.s.a.", "usa", "united states", "united states of america",
  "america",
]);

function usStateFromLocality(name: string): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  // "City, ST" or "City, State" — take the segment after the last comma.
  const parts = raw.split(",").map((s) => s.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    const abbr = seg.toUpperCase().replace(/\./g, "");
    if (US_ABBR_STATE[abbr]) return US_ABBR_STATE[abbr];
    const matchState = Object.keys(US_STATE_REGION).find(
      (st) => st.toLowerCase() === seg.toLowerCase()
    );
    if (matchState) return matchState;
  }
  // Bare city name (any segment) → major-city lookup.
  for (const seg of parts) {
    const city = US_CITY_STATE[seg.toLowerCase()];
    if (city) return city;
  }
  return null;
}

function usRegionForLocality(name: string): RegionInfo {
  const state = usStateFromLocality(name);
  const zone = state ? (US_STATE_REGION[state] ?? null) : null;
  // Most modeled US localities are metros/suburbs; default urban.
  return { state, zone, urbanClass: "urban" };
}

// Commercial geo-tier → urban/rural class (Census-style settlement scale).
function urbanClassForTier(tier: GeoTier): UrbanClass {
  if (tier === "metro" || tier === "tier1") return "urban";
  if (tier === "tier2") return "semi-urban";
  return "rural"; // tier3 / rural / international handled by caller
}

/** Resolve a locality to its state, region/zone, and urban class. Supports India
 *  (GoI zones) and the US (Census regions); null for other countries. */
export function regionForLocality(
  name: string,
  country?: string
): RegionInfo | null {
  const c = (country ?? "").trim().toLowerCase();
  if (US_COUNTRY.has(c)) return usRegionForLocality(name);
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
  const c = (country ?? "").trim().toLowerCase();
  const isUS = US_COUNTRY.has(c);
  const regionLabel = r.zone
    ? isUS
      ? `${r.zone} US (Census region)`
      : `${r.zone} India`
    : null;
  const parts = [r.state, regionLabel, r.urbanClass].filter(Boolean);
  return parts.length ? `Administrative region: ${parts.join(" · ")}.` : "";
}

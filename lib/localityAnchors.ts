import type { Cohort, Role, Segment } from "./schema";

export type LocalityAnchor = {
  name: string;
  cityKey: string;
  country: string;
  lat: number;
  lng: number;
  segments: Segment[];
  spreadKm: number;
};

type BaseLocality = {
  locality: string;
  country: string;
  lat: number;
  lng: number;
};

const LOCALITY_ANCHORS: LocalityAnchor[] = [
  // Delhi NCR
  { name: "Lutyens Delhi, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.6136, lng: 77.2186, segments: ["luxury"], spreadKm: 2.2 },
  { name: "Chanakyapuri, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5941, lng: 77.1889, segments: ["luxury"], spreadKm: 2.5 },
  { name: "Golf Course Road, Gurugram", cityKey: "delhi ncr", country: "India", lat: 28.4511, lng: 77.0996, segments: ["luxury", "affluent"], spreadKm: 3 },
  { name: "Vasant Vihar, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5603, lng: 77.1608, segments: ["affluent"], spreadKm: 2.4 },
  { name: "Greater Kailash, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5486, lng: 77.2430, segments: ["affluent"], spreadKm: 2.6 },
  { name: "Defence Colony, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5735, lng: 77.2309, segments: ["affluent"], spreadKm: 2 },
  { name: "South Extension, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5687, lng: 77.2190, segments: ["affluent"], spreadKm: 2 },
  { name: "Dwarka, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.5921, lng: 77.0460, segments: ["middle"], spreadKm: 4 },
  { name: "Rohini, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.7383, lng: 77.0822, segments: ["middle"], spreadKm: 4 },
  { name: "Mayur Vihar, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.6086, lng: 77.3026, segments: ["middle"], spreadKm: 3 },
  { name: "Noida Sector 62, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.6271, lng: 77.3733, segments: ["middle"], spreadKm: 4 },
  { name: "Indirapuram, Ghaziabad", cityKey: "delhi ncr", country: "India", lat: 28.6416, lng: 77.3706, segments: ["middle"], spreadKm: 3.5 },
  { name: "Uttam Nagar, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.6214, lng: 77.0557, segments: ["budget"], spreadKm: 3 },
  { name: "Sangam Vihar, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.4966, lng: 77.2392, segments: ["budget"], spreadKm: 3 },
  { name: "Seelampur, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.6697, lng: 77.2667, segments: ["budget"], spreadKm: 2.5 },
  { name: "Narela, Delhi NCR", cityKey: "delhi ncr", country: "India", lat: 28.8527, lng: 77.0929, segments: ["budget"], spreadKm: 4 },
  { name: "Loni, Ghaziabad", cityKey: "delhi ncr", country: "India", lat: 28.7515, lng: 77.2880, segments: ["budget"], spreadKm: 4 },

  // Mumbai
  { name: "Malabar Hill, Mumbai", cityKey: "mumbai", country: "India", lat: 18.9548, lng: 72.7985, segments: ["luxury"], spreadKm: 2 },
  { name: "Altamount Road, Mumbai", cityKey: "mumbai", country: "India", lat: 18.9688, lng: 72.8097, segments: ["luxury"], spreadKm: 1.6 },
  { name: "Bandra West, Mumbai", cityKey: "mumbai", country: "India", lat: 19.0596, lng: 72.8295, segments: ["luxury", "affluent"], spreadKm: 2.6 },
  { name: "Worli, Mumbai", cityKey: "mumbai", country: "India", lat: 19.0176, lng: 72.8162, segments: ["luxury", "affluent"], spreadKm: 2.5 },
  { name: "Juhu, Mumbai", cityKey: "mumbai", country: "India", lat: 19.1075, lng: 72.8263, segments: ["affluent"], spreadKm: 2.5 },
  { name: "Powai, Mumbai", cityKey: "mumbai", country: "India", lat: 19.1176, lng: 72.9060, segments: ["affluent", "middle"], spreadKm: 3 },
  { name: "Lower Parel, Mumbai", cityKey: "mumbai", country: "India", lat: 18.9936, lng: 72.8256, segments: ["affluent"], spreadKm: 2 },
  { name: "Andheri West, Mumbai", cityKey: "mumbai", country: "India", lat: 19.1364, lng: 72.8296, segments: ["middle", "affluent"], spreadKm: 3.5 },
  { name: "Borivali, Mumbai", cityKey: "mumbai", country: "India", lat: 19.2307, lng: 72.8567, segments: ["middle"], spreadKm: 4 },
  { name: "Thane West, Mumbai Region", cityKey: "mumbai", country: "India", lat: 19.2183, lng: 72.9781, segments: ["middle"], spreadKm: 4 },
  { name: "Kurla, Mumbai", cityKey: "mumbai", country: "India", lat: 19.0726, lng: 72.8845, segments: ["budget"], spreadKm: 3 },
  { name: "Mira Road, Mumbai Region", cityKey: "mumbai", country: "India", lat: 19.2813, lng: 72.8687, segments: ["budget", "middle"], spreadKm: 4 },
  { name: "Kalyan, Mumbai Region", cityKey: "mumbai", country: "India", lat: 19.2403, lng: 73.1305, segments: ["budget"], spreadKm: 5 },

  // Bangalore
  { name: "Sadashivanagar, Bangalore", cityKey: "bangalore", country: "India", lat: 13.0068, lng: 77.5800, segments: ["luxury"], spreadKm: 2 },
  { name: "Lavelle Road, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9717, lng: 77.5998, segments: ["luxury", "affluent"], spreadKm: 1.8 },
  { name: "Indiranagar, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9719, lng: 77.6412, segments: ["affluent"], spreadKm: 2.5 },
  { name: "Koramangala, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9352, lng: 77.6245, segments: ["affluent", "middle"], spreadKm: 3 },
  { name: "Whitefield, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9698, lng: 77.7500, segments: ["middle", "affluent"], spreadKm: 5 },
  { name: "Yelahanka, Bangalore", cityKey: "bangalore", country: "India", lat: 13.1007, lng: 77.5963, segments: ["middle"], spreadKm: 4 },
  { name: "Marathahalli, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9592, lng: 77.6974, segments: ["middle"], spreadKm: 4 },
  { name: "Peenya, Bangalore", cityKey: "bangalore", country: "India", lat: 13.0285, lng: 77.5197, segments: ["budget"], spreadKm: 4 },
  { name: "Bommanahalli, Bangalore", cityKey: "bangalore", country: "India", lat: 12.9081, lng: 77.6236, segments: ["budget"], spreadKm: 3.5 },

  // Hyderabad
  { name: "Jubilee Hills, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.4326, lng: 78.4071, segments: ["luxury", "affluent"], spreadKm: 3 },
  { name: "Banjara Hills, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.4156, lng: 78.4347, segments: ["luxury", "affluent"], spreadKm: 2.5 },
  { name: "Gachibowli, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.4401, lng: 78.3489, segments: ["affluent", "middle"], spreadKm: 4 },
  { name: "Kukatpally, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.4933, lng: 78.3996, segments: ["middle"], spreadKm: 4 },
  { name: "Dilsukhnagar, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.3687, lng: 78.5247, segments: ["middle", "budget"], spreadKm: 3 },
  { name: "Uppal, Hyderabad", cityKey: "hyderabad", country: "India", lat: 17.4058, lng: 78.5591, segments: ["budget"], spreadKm: 4 },

  // Chennai
  { name: "Boat Club, Chennai", cityKey: "chennai", country: "India", lat: 13.0251, lng: 80.2548, segments: ["luxury"], spreadKm: 1.6 },
  { name: "Poes Garden, Chennai", cityKey: "chennai", country: "India", lat: 13.0464, lng: 80.2565, segments: ["luxury"], spreadKm: 1.5 },
  { name: "Adyar, Chennai", cityKey: "chennai", country: "India", lat: 13.0012, lng: 80.2565, segments: ["affluent"], spreadKm: 2.8 },
  { name: "Anna Nagar, Chennai", cityKey: "chennai", country: "India", lat: 13.0850, lng: 80.2101, segments: ["affluent", "middle"], spreadKm: 3.2 },
  { name: "Velachery, Chennai", cityKey: "chennai", country: "India", lat: 12.9755, lng: 80.2207, segments: ["middle"], spreadKm: 3.5 },
  { name: "Tambaram, Chennai", cityKey: "chennai", country: "India", lat: 12.9249, lng: 80.1000, segments: ["middle", "budget"], spreadKm: 5 },
  { name: "North Chennai, Chennai", cityKey: "chennai", country: "India", lat: 13.1297, lng: 80.2885, segments: ["budget"], spreadKm: 4 },

  // Pune
  { name: "Koregaon Park, Pune", cityKey: "pune", country: "India", lat: 18.5362, lng: 73.8940, segments: ["luxury", "affluent"], spreadKm: 2.3 },
  { name: "Kalyani Nagar, Pune", cityKey: "pune", country: "India", lat: 18.5481, lng: 73.9033, segments: ["affluent"], spreadKm: 2.4 },
  { name: "Baner, Pune", cityKey: "pune", country: "India", lat: 18.5590, lng: 73.7868, segments: ["affluent", "middle"], spreadKm: 3.5 },
  { name: "Kothrud, Pune", cityKey: "pune", country: "India", lat: 18.5074, lng: 73.8077, segments: ["middle"], spreadKm: 3 },
  { name: "Hadapsar, Pune", cityKey: "pune", country: "India", lat: 18.5089, lng: 73.9259, segments: ["middle", "budget"], spreadKm: 4 },
  { name: "Pimpri-Chinchwad, Pune Region", cityKey: "pune", country: "India", lat: 18.6298, lng: 73.7997, segments: ["budget", "middle"], spreadKm: 5 },

  // Kolkata
  { name: "Ballygunge, Kolkata", cityKey: "kolkata", country: "India", lat: 22.5270, lng: 88.3657, segments: ["luxury", "affluent"], spreadKm: 2.5 },
  { name: "Alipore, Kolkata", cityKey: "kolkata", country: "India", lat: 22.5252, lng: 88.3300, segments: ["luxury"], spreadKm: 2 },
  { name: "Salt Lake, Kolkata", cityKey: "kolkata", country: "India", lat: 22.5867, lng: 88.4171, segments: ["affluent", "middle"], spreadKm: 4 },
  { name: "New Town, Kolkata", cityKey: "kolkata", country: "India", lat: 22.5810, lng: 88.4695, segments: ["middle", "affluent"], spreadKm: 5 },
  { name: "Behala, Kolkata", cityKey: "kolkata", country: "India", lat: 22.4986, lng: 88.3108, segments: ["middle"], spreadKm: 4 },
  { name: "Dum Dum, Kolkata", cityKey: "kolkata", country: "India", lat: 22.6420, lng: 88.4313, segments: ["budget", "middle"], spreadKm: 4 },
  { name: "Howrah, Kolkata Region", cityKey: "kolkata", country: "India", lat: 22.5958, lng: 88.2636, segments: ["budget"], spreadKm: 5 },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cityKeyFor(locality: string, country: string): string | null {
  if (normalize(country) !== "india") return null;
  const n = normalize(locality);
  if (/\b(delhi|new delhi|ncr|gurugram|gurgaon|noida|ghaziabad|faridabad)\b/.test(n)) {
    return "delhi ncr";
  }
  if (/\b(mumbai|bombay|thane|navi mumbai)\b/.test(n)) return "mumbai";
  if (/\b(bangalore|bengaluru)\b/.test(n)) return "bangalore";
  if (/\b(hyderabad|secunderabad)\b/.test(n)) return "hyderabad";
  if (/\b(chennai|madras)\b/.test(n)) return "chennai";
  if (/\b(pune|pimpri|chinchwad)\b/.test(n)) return "pune";
  if (/\b(kolkata|calcutta|howrah)\b/.test(n)) return "kolkata";
  return null;
}

function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(items: T[], seed: string): T {
  return items[hashSeed(seed) % items.length];
}

export function localityAnchorForCohort(
  base: BaseLocality,
  segment: Segment,
  role: Role,
  seed: string
): LocalityAnchor | null {
  const cityKey = cityKeyFor(base.locality, base.country);
  if (!cityKey) return null;
  const cityAnchors = LOCALITY_ANCHORS.filter((a) => a.cityKey === cityKey);
  const segmentAnchors = cityAnchors.filter((a) => a.segments.includes(segment));
  const pool = segmentAnchors.length > 0 ? segmentAnchors : cityAnchors;
  if (pool.length === 0) return null;
  return pick(pool, `${base.locality}:${segment}:${role}:${seed}`);
}

export function placedLocalityForCohort(
  base: BaseLocality,
  segment: Segment,
  role: Role,
  seed: string
): BaseLocality & { spreadKm?: number; parentLocality?: string } {
  const anchor = localityAnchorForCohort(base, segment, role, seed);
  if (!anchor) return base;
  return {
    locality: anchor.name,
    country: anchor.country,
    lat: anchor.lat,
    lng: anchor.lng,
    spreadKm: anchor.spreadKm,
    parentLocality: base.locality,
  };
}

export function personaJitterDegreesForLocality(
  locality: string,
  country: string
): number {
  const exact = LOCALITY_ANCHORS.find(
    (a) => normalize(a.name) === normalize(locality) && normalize(a.country) === normalize(country)
  );
  if (exact) return Math.max(0.006, Math.min(0.035, exact.spreadKm / 111));
  if (locality.includes(",")) return 0.025;
  return 0.08;
}

export type LocalitySearchResult = {
  label: string;
  country: string;
  lat: number;
  lng: number;
  segments: Segment[];
};

export function searchKnownLocalities(
  query: string,
  limit = 8
): LocalitySearchResult[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  return LOCALITY_ANCHORS.filter((anchor) => {
    const n = normalize(`${anchor.name} ${anchor.cityKey} ${anchor.country}`);
    return n.includes(q);
  })
    .slice(0, limit)
    .map((anchor) => ({
      label: anchor.name,
      country: anchor.country,
      lat: anchor.lat,
      lng: anchor.lng,
      segments: anchor.segments,
    }));
}

export function cohortAreaRadiusMeters(cohort: Pick<Cohort, "locality" | "country" | "weightPct">): number {
  const exact = LOCALITY_ANCHORS.find(
    (a) => normalize(a.name) === normalize(cohort.locality) && normalize(a.country) === normalize(cohort.country)
  );
  const baseKm = exact ? exact.spreadKm : cohort.locality.includes(",") ? 2.5 : 8;
  const weightedKm = baseKm * (0.8 + Math.min(2, Math.max(0, cohort.weightPct)) * 0.08);
  return Math.round(Math.max(900, Math.min(12000, weightedKm * 1000)));
}

export { LOCALITY_ANCHORS };

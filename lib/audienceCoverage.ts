import type { ClientProfile, PlannerV2Output, Role, Segment } from "./schema";

type Locality = PlannerV2Output["cohortPlan"]["localities"][number];
type CohortPlan = PlannerV2Output["cohortPlan"];

type IndiaMarket = Locality & {
  region: string;
  tier: "metro" | "tier2" | "tier3" | "small_cluster";
  spreadKm: number;
  cultureContext: string;
};

export const INDIA_RELEVANT_MARKETS: IndiaMarket[] = [
  {
    name: "Delhi NCR",
    country: "India",
    lat: 28.6139,
    lng: 77.209,
    region: "North",
    tier: "metro",
    spreadKm: 45,
    cultureContext:
      "large NCR market with strong status signalling, family input, premium malls, dense online commerce and sharp price comparison across Delhi, Gurugram, Noida and Ghaziabad.",
  },
  {
    name: "Mumbai",
    country: "India",
    lat: 19.076,
    lng: 72.8777,
    region: "West",
    tier: "metro",
    spreadKm: 28,
    cultureContext:
      "high-paced coastal metro where convenience, brand visibility, practical value and social proof matter; buyers range from compact-apartment professionals to affluent South Mumbai/Bandra households.",
  },
  {
    name: "Bengaluru",
    country: "India",
    lat: 12.9716,
    lng: 77.5946,
    region: "South",
    tier: "metro",
    spreadKm: 30,
    cultureContext:
      "tech-led, cosmopolitan market with high digital discovery, convenience orientation, startup-professional lifestyles and a mix of local Kannada families and migrants.",
  },
  {
    name: "Hyderabad",
    country: "India",
    lat: 17.385,
    lng: 78.4867,
    region: "South",
    tier: "metro",
    spreadKm: 34,
    cultureContext:
      "aspirational but value-conscious metro where family occasions, new wealth, IT corridors, malls and trust in known sellers strongly shape purchases.",
  },
  {
    name: "Chennai",
    country: "India",
    lat: 13.0827,
    lng: 80.2707,
    region: "South",
    tier: "metro",
    spreadKm: 30,
    cultureContext:
      "rooted, quality-conscious market with family approval, durability, modest premium cues and strong local-language/offline trust alongside urban digital buyers.",
  },
  {
    name: "Kolkata",
    country: "India",
    lat: 22.5726,
    lng: 88.3639,
    region: "East",
    tier: "metro",
    spreadKm: 32,
    cultureContext:
      "culture-forward and value-aware metro where heritage, aesthetics, festivals, word of mouth and trust matter more than loud luxury signalling.",
  },
  {
    name: "Pune",
    country: "India",
    lat: 18.5204,
    lng: 73.8567,
    region: "West",
    tier: "metro",
    spreadKm: 28,
    cultureContext:
      "educated, young-professional and family market with practical premium buying, strong two-wheeler/suburb lifestyles and good digital adoption.",
  },
  {
    name: "Ahmedabad",
    country: "India",
    lat: 23.0225,
    lng: 72.5714,
    region: "West",
    tier: "metro",
    spreadKm: 28,
    cultureContext:
      "entrepreneurial, family-business market where value, community recommendation, visible quality and conservative-smart spending matter.",
  },
  {
    name: "Surat",
    country: "India",
    lat: 21.1702,
    lng: 72.8311,
    region: "West",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "trading and textile-led city with sharp value instincts, fast adoption when peer circles approve, and strong family/community influence.",
  },
  {
    name: "Jaipur",
    country: "India",
    lat: 26.9124,
    lng: 75.7873,
    region: "North",
    tier: "tier2",
    spreadKm: 25,
    cultureContext:
      "heritage and tourism-influenced market with craft pride, wedding/occasion buying, family influence and visible but tasteful status cues.",
  },
  {
    name: "Lucknow",
    country: "India",
    lat: 26.8467,
    lng: 80.9462,
    region: "North",
    tier: "tier2",
    spreadKm: 27,
    cultureContext:
      "north Indian administrative and cultural city where family reputation, refined presentation, trust and moderate conservatism shape purchases.",
  },
  {
    name: "Kanpur",
    country: "India",
    lat: 26.4499,
    lng: 80.3319,
    region: "North",
    tier: "tier2",
    spreadKm: 23,
    cultureContext:
      "industrial/trading city with practical value-seeking, durable-product expectations, family buying input and lower tolerance for unproven premiums.",
  },
  {
    name: "Nagpur",
    country: "India",
    lat: 21.1458,
    lng: 79.0882,
    region: "Central",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "central Indian logistics and government-service market where reliability, price fairness, offline trust and family recommendations matter.",
  },
  {
    name: "Indore",
    country: "India",
    lat: 22.7196,
    lng: 75.8577,
    region: "Central",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "commercial, food-and-family oriented city with rising aspirations, clean-modern retail expectations and strong value judgement.",
  },
  {
    name: "Bhopal",
    country: "India",
    lat: 23.2599,
    lng: 77.4126,
    region: "Central",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "administrative and education-led market with measured spending, family approval, trust in established sellers and moderate adoption pace.",
  },
  {
    name: "Patna",
    country: "India",
    lat: 25.5941,
    lng: 85.1376,
    region: "East",
    tier: "tier2",
    spreadKm: 25,
    cultureContext:
      "family- and education-driven market with strong value scrutiny, conservative social norms, local trust networks and festival-led spikes.",
  },
  {
    name: "Vadodara",
    country: "India",
    lat: 22.3072,
    lng: 73.1812,
    region: "West",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "Gujarati family/professional market with practical premium buying, community recommendations, education focus and value-for-money expectations.",
  },
  {
    name: "Ludhiana",
    country: "India",
    lat: 30.901,
    lng: 75.8573,
    region: "North",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "industrial Punjabi market with entrepreneurial households, visible status cues, durable-quality expectations and family/business-network influence.",
  },
  {
    name: "Agra",
    country: "India",
    lat: 27.1767,
    lng: 78.0081,
    region: "North",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "heritage and tourism city in western UP; family reputation, local trust, value, traditional norms and relatively conservative social signalling influence buying.",
  },
  {
    name: "Nashik",
    country: "India",
    lat: 19.9975,
    lng: 73.7898,
    region: "West",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "growing Maharashtra city with family-oriented spending, industrial/agri wealth pockets, practical quality expectations and festival-led demand.",
  },
  {
    name: "Ranchi",
    country: "India",
    lat: 23.3441,
    lng: 85.3096,
    region: "East",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "state-capital market with government-service households, student youth, emerging mall culture, price sensitivity and local trust channels.",
  },
  {
    name: "Guwahati",
    country: "India",
    lat: 26.1445,
    lng: 91.7362,
    region: "Northeast",
    tier: "tier2",
    spreadKm: 25,
    cultureContext:
      "gateway to the Northeast with youth fashion, regional identity, community recommendation, logistics sensitivity and strong social-media discovery among younger buyers.",
  },
  {
    name: "Bhubaneswar",
    country: "India",
    lat: 20.2961,
    lng: 85.8245,
    region: "East",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "planned administrative/education city with rising middle-class aspirations, family buying input, value awareness and moderate premium adoption.",
  },
  {
    name: "Chandigarh",
    country: "India",
    lat: 30.7333,
    lng: 76.7794,
    region: "North",
    tier: "tier2",
    spreadKm: 25,
    cultureContext:
      "affluent planned-city market serving Punjab/Haryana/Himachal, with polished status cues, car-led retail trips and high quality expectations.",
  },
  {
    name: "Kochi",
    country: "India",
    lat: 9.9312,
    lng: 76.2673,
    region: "South",
    tier: "tier2",
    spreadKm: 23,
    cultureContext:
      "coastal Kerala market with Gulf exposure, educated households, tasteful premium buying, high trust expectations and strong family influence.",
  },
  {
    name: "Coimbatore",
    country: "India",
    lat: 11.0168,
    lng: 76.9558,
    region: "South",
    tier: "tier2",
    spreadKm: 23,
    cultureContext:
      "industrial/entrepreneurial Tamil city with practical quality expectations, textile familiarity, family-owned businesses and measured spending.",
  },
  {
    name: "Visakhapatnam",
    country: "India",
    lat: 17.6868,
    lng: 83.2185,
    region: "South",
    tier: "tier2",
    spreadKm: 24,
    cultureContext:
      "coastal Andhra market with government/port/IT mix, family occasions, mall adoption, value sensitivity and regional pride.",
  },
  {
    name: "Vijayawada",
    country: "India",
    lat: 16.5062,
    lng: 80.648,
    region: "South",
    tier: "tier2",
    spreadKm: 23,
    cultureContext:
      "commercial Andhra city where family networks, visible prosperity, value comparison and occasion-led buying are important.",
  },
  {
    name: "Madurai",
    country: "India",
    lat: 9.9252,
    lng: 78.1198,
    region: "South",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "temple/trading city with traditional family norms, festival and wedding buying, strong local retail trust and price discipline.",
  },
  {
    name: "Mysuru",
    country: "India",
    lat: 12.2958,
    lng: 76.6394,
    region: "South",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "heritage and education city with calmer pace than Bengaluru, family-oriented decisions, quality appreciation and moderate premium adoption.",
  },
  {
    name: "Thiruvananthapuram",
    country: "India",
    lat: 8.5241,
    lng: 76.9366,
    region: "South",
    tier: "tier2",
    spreadKm: 22,
    cultureContext:
      "Kerala administrative/education market with high literacy, practical value, family discussion, Gulf influence and trust-sensitive buying.",
  },
  {
    name: "Raipur",
    country: "India",
    lat: 21.2514,
    lng: 81.6296,
    region: "Central",
    tier: "tier2",
    spreadKm: 23,
    cultureContext:
      "central Indian trading and government-service market with emerging malls, local trust networks, family buying and high price scrutiny.",
  },
  {
    name: "Jodhpur",
    country: "India",
    lat: 26.2389,
    lng: 73.0243,
    region: "North",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "heritage Rajasthan city with craft pride, conservative family influence, wedding/occasion demand and strong sensitivity to authenticity.",
  },
  {
    name: "Amritsar",
    country: "India",
    lat: 31.634,
    lng: 74.8723,
    region: "North",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "Punjabi religious/tourism city with family hospitality, visible quality, celebration buying and trust built through community recommendation.",
  },
  {
    name: "Varanasi",
    country: "India",
    lat: 25.3176,
    lng: 82.9739,
    region: "North",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "deep heritage city with traditional norms, religious tourism, family and elder influence, craft familiarity and conservative trust thresholds.",
  },
  {
    name: "Meerut",
    country: "India",
    lat: 28.9845,
    lng: 77.7064,
    region: "North",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "western UP manufacturing/trading city with practical spending, family influence, local market bargaining and cautious premium adoption.",
  },
  {
    name: "Dehradun",
    country: "India",
    lat: 30.3165,
    lng: 78.0322,
    region: "North",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "education/retirement/tourism market with relaxed lifestyle, family trust, understated status and outdoor/convenience considerations.",
  },
  {
    name: "Jamshedpur",
    country: "India",
    lat: 22.8046,
    lng: 86.2029,
    region: "East",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "industrial company-town market with stable salaried households, reliability expectations, practical buying and local word-of-mouth influence.",
  },
  {
    name: "Rajkot",
    country: "India",
    lat: 22.3039,
    lng: 70.8022,
    region: "West",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "Gujarati business-family market with strong value instincts, community reputation, practical quality checks and conservative-modern tastes.",
  },
  {
    name: "Gwalior",
    country: "India",
    lat: 26.2183,
    lng: 78.1828,
    region: "Central",
    tier: "tier3",
    spreadKm: 20,
    cultureContext:
      "heritage/education/defence-influenced market with family decisions, cautious premium buying, visible durability and local retail trust.",
  },
  {
    name: "Hubballi-Dharwad",
    country: "India",
    lat: 15.3647,
    lng: 75.124,
    region: "South",
    tier: "tier3",
    spreadKm: 21,
    cultureContext:
      "north Karnataka twin-city market with education/trade mix, practical middle-class buying, family input and high value scrutiny.",
  },
  {
    name: "Tiruppur",
    country: "India",
    lat: 11.1085,
    lng: 77.3411,
    region: "South",
    tier: "tier3",
    spreadKm: 20,
    cultureContext:
      "textile manufacturing city with high product-quality awareness, business-family networks, practical pricing and supplier trust concerns.",
  },
  {
    name: "Siliguri",
    country: "India",
    lat: 26.7271,
    lng: 88.3953,
    region: "East",
    tier: "tier3",
    spreadKm: 20,
    cultureContext:
      "gateway market for North Bengal/Sikkim/Northeast with trading networks, logistics sensitivity, mixed cultures and value-led purchases.",
  },
];

export const PAN_INDIA_MIN_RELEVANT_SPOTS = Math.max(
  25,
  Math.ceil(INDIA_RELEVANT_MARKETS.length / 2)
);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function profileGeographyText(profile: ClientProfile): string {
  return [
    ...(profile.geography ?? []),
    profile.targetAudience ?? "",
    profile.goal ?? "",
  ].join(" ");
}

export function isPanIndiaProfile(profile: ClientProfile): boolean {
  const text = profileGeographyText(profile).toLowerCase();
  return /\b(pan[\s-]?india|pan india|all india|india wide|indiawide|nationwide|national|across india|whole india)\b/.test(
    text
  );
}

function marketForName(name: string): IndiaMarket | undefined {
  const n = norm(name);
  return INDIA_RELEVANT_MARKETS.find((m) => {
    const mn = norm(m.name);
    return n === mn || n.includes(mn) || mn.includes(n);
  });
}

function dominantRole(cohorts: CohortPlan["cohorts"]): Role {
  const counts = new Map<Role, number>();
  for (const c of cohorts) counts.set(c.role, (counts.get(c.role) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "consumer"
  );
}

function segmentPairForMarket(market: IndiaMarket): Segment[] {
  switch (market.tier) {
    case "metro":
      return ["affluent", "middle"];
    case "tier2":
      return ["middle", "affluent"];
    case "tier3":
      return ["middle", "budget"];
    case "small_cluster":
      return ["budget", "middle"];
  }
}

function normalizeWeights(cohorts: CohortPlan["cohorts"]): CohortPlan["cohorts"] {
  const total = cohorts.reduce((sum, c) => sum + Math.max(0, c.weightPct), 0);
  if (total <= 0) {
    const even = Math.round((100 / Math.max(1, cohorts.length)) * 100) / 100;
    return cohorts.map((c) => ({ ...c, weightPct: even }));
  }
  return cohorts.map((c) => ({
    ...c,
    weightPct: Math.round((Math.max(0, c.weightPct) / total) * 10000) / 100,
  }));
}

function capCohortsWithCoverage(
  cohorts: CohortPlan["cohorts"],
  selectedLocalities: string[],
  maxCohorts: number
): CohortPlan["cohorts"] {
  if (cohorts.length <= maxCohorts) return normalizeWeights(cohorts);

  const required = new Set(selectedLocalities.map(norm));
  const picked: CohortPlan["cohorts"] = [];
  const pickedKeys = new Set<string>();

  for (const locality of selectedLocalities) {
    const matches = cohorts
      .filter((c) => norm(c.locality) === norm(locality))
      .sort((a, b) => b.weightPct - a.weightPct);
    for (const c of matches.slice(0, 2)) {
      const key = `${norm(c.locality)}|${c.segment}|${c.role}`;
      if (!pickedKeys.has(key) && picked.length < maxCohorts) {
        picked.push(c);
        pickedKeys.add(key);
      }
    }
  }

  for (const c of cohorts.sort((a, b) => {
    const ar = required.has(norm(a.locality)) ? 1 : 0;
    const br = required.has(norm(b.locality)) ? 1 : 0;
    return br - ar || b.weightPct - a.weightPct;
  })) {
    if (picked.length >= maxCohorts) break;
    const key = `${norm(c.locality)}|${c.segment}|${c.role}`;
    if (!pickedKeys.has(key)) {
      picked.push(c);
      pickedKeys.add(key);
    }
  }

  return normalizeWeights(picked);
}

export function expandPanIndiaCohortPlan(
  plan: CohortPlan,
  profile: ClientProfile,
  maxCohorts: number
): CohortPlan {
  if (!isPanIndiaProfile(profile)) return plan;

  const localities = [...plan.localities];
  const existingNames = new Set(localities.map((l) => norm(l.name)));
  let relevantCount = localities.filter((l) => marketForName(l.name)).length;

  for (const market of INDIA_RELEVANT_MARKETS) {
    if (relevantCount >= PAN_INDIA_MIN_RELEVANT_SPOTS) break;
    if (existingNames.has(norm(market.name))) continue;
    localities.push({
      name: market.name,
      country: market.country,
      lat: market.lat,
      lng: market.lng,
    });
    existingNames.add(norm(market.name));
    relevantCount += 1;
  }

  const selectedRelevant = localities
    .filter((l) => marketForName(l.name))
    .slice(0, Math.max(PAN_INDIA_MIN_RELEVANT_SPOTS, relevantCount))
    .map((l) => l.name);
  const role = dominantRole(plan.cohorts);
  const cohorts = [...plan.cohorts];

  for (const locality of selectedRelevant) {
    const market = marketForName(locality);
    if (!market) continue;
    const existing = cohorts.filter((c) => norm(c.locality) === norm(locality));
    const segments = segmentPairForMarket(market);
    for (let i = existing.length; i < 2; i++) {
      cohorts.push({
        locality,
        segment: segments[i % segments.length],
        role,
        weightPct:
          market.tier === "metro"
            ? 2.8
            : market.tier === "tier2"
              ? 1.8
              : 1.1,
      });
    }
  }

  return {
    ...plan,
    localities,
    cohorts: capCohortsWithCoverage(cohorts, selectedRelevant, maxCohorts),
  };
}

export function cultureContextForLocality(
  locality: string,
  country: string
): string {
  if (country.toLowerCase() !== "india") {
    return `Use the lived culture, class norms, languages, trust networks and buying habits of ${locality}, ${country}; avoid treating it as interchangeable with other cities.`;
  }
  const market = marketForName(locality);
  if (market) {
    return `${market.region} India, ${market.tier.replace("_", " ")} market: ${market.cultureContext}`;
  }
  return `Indian locality-specific context for ${locality}: reflect its region, language mix, migration history, family norms, local retail trust, price sensitivity, status cues and urban/semi-urban pace.`;
}

export function spreadKmForLocality(locality: string, country: string): number {
  if (country.toLowerCase() !== "india") return 18;
  return marketForName(locality)?.spreadKm ?? 22;
}

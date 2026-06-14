import type { ClientProfile, PlannerV2Output, Role, Segment } from "./schema";

type Locality = PlannerV2Output["cohortPlan"]["localities"][number];
type CohortPlan = PlannerV2Output["cohortPlan"];

type IndiaMarket = Locality & {
  region: string;
  tier: "metro" | "tier2" | "tier3" | "small_cluster";
  marketClass?: "A" | "B" | "C" | "D" | "E";
  spreadKm: number;
  cultureContext: string;
};

function coverageMarket(
  name: string,
  lat: number,
  lng: number,
  region: string,
  marketClass: "C" | "D" | "E",
  cultureContext: string
): IndiaMarket {
  return {
    name,
    country: "India",
    lat,
    lng,
    region,
    tier: marketClass === "C" ? "tier3" : "small_cluster",
    marketClass,
    spreadKm: marketClass === "C" ? 18 : marketClass === "D" ? 15 : 12,
    cultureContext,
  };
}

const INDIA_CORE_MARKETS: IndiaMarket[] = [
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

const INDIA_LONG_TAIL_MARKETS: IndiaMarket[] = [
  coverageMarket(
    "Prayagraj",
    25.4358,
    81.8463,
    "North",
    "C",
    "UP education, pilgrimage and administrative market where family elders, exam-focused youth, religious calendars and value scrutiny shape buying."
  ),
  coverageMarket(
    "Aligarh",
    27.8974,
    78.088,
    "North",
    "C",
    "western UP manufacturing and university city with conservative family norms, practical quality checks and strong local-market bargaining."
  ),
  coverageMarket(
    "Moradabad",
    28.8386,
    78.7733,
    "North",
    "C",
    "brassware/export cluster with trading families, craft familiarity, price discipline and community-trust driven purchase decisions."
  ),
  coverageMarket(
    "Bareilly",
    28.367,
    79.4304,
    "North",
    "C",
    "Rohilkhand service/trading market with family-led spending, local retail trust, conservative-modern tastes and high value comparison."
  ),
  coverageMarket(
    "Gorakhpur",
    26.7606,
    83.3732,
    "North",
    "C",
    "eastern UP hub with family reputation, religious/institutional influence, migration-linked incomes and cautious premium adoption."
  ),
  coverageMarket(
    "Ayodhya",
    26.7922,
    82.1998,
    "North",
    "D",
    "pilgrimage-led town where religious tourism, family norms, local trust and traditional signalling strongly influence demand."
  ),
  coverageMarket(
    "Mathura",
    27.4924,
    77.6737,
    "North",
    "D",
    "pilgrimage and small-business market with family tourism, devotional occasions, conservative norms and value-led buying."
  ),
  coverageMarket(
    "Saharanpur",
    29.9671,
    77.551,
    "North",
    "C",
    "woodcraft and trading city with artisan awareness, local networks, family buying input and practical durability expectations."
  ),
  coverageMarket(
    "Rohtak",
    28.8955,
    76.6066,
    "North",
    "D",
    "Haryana education/agri-service market with family status cues, vehicle-led retail, practical value checks and conservative social norms."
  ),
  coverageMarket(
    "Hisar",
    29.1492,
    75.7217,
    "North",
    "D",
    "Haryana agri-trading and education city where household consensus, durability and visible value matter more than novelty."
  ),
  coverageMarket(
    "Panipat",
    29.3909,
    76.9635,
    "North",
    "D",
    "textile and trading cluster with product-quality awareness, business-family networks and sharp price/value judgement."
  ),
  coverageMarket(
    "Karnal",
    29.6857,
    76.9905,
    "North",
    "D",
    "Haryana agrarian-service market with family input, local trust, practical premium adoption and conservative social signalling."
  ),
  coverageMarket(
    "Ajmer",
    26.4499,
    74.6399,
    "North",
    "C",
    "Rajasthan pilgrimage/education city with heritage pride, family decisions, tourism exposure and measured spending."
  ),
  coverageMarket(
    "Kota",
    25.2138,
    75.8648,
    "North",
    "C",
    "coaching and industrial city with student/youth inflows, middle-class aspiration, hostel life and family-funded purchases."
  ),
  coverageMarket(
    "Udaipur",
    24.5854,
    73.7125,
    "North",
    "C",
    "tourism and heritage market with wedding demand, craft/aesthetic sensitivity, affluent pockets and local trust networks."
  ),
  coverageMarket(
    "Bikaner",
    28.0229,
    73.3119,
    "North",
    "D",
    "desert trading city with traditional family norms, festival buying, local-market trust and conservative spending habits."
  ),
  coverageMarket(
    "Alwar",
    27.553,
    76.6346,
    "North",
    "D",
    "NCR-adjacent Rajasthan market with industrial/agri incomes, family approval and practical value expectations."
  ),
  coverageMarket(
    "Bhilwara",
    25.3463,
    74.6364,
    "North",
    "D",
    "textile-industrial city with fabric/product awareness, business families, durability focus and strong price discipline."
  ),
  coverageMarket(
    "Jamnagar",
    22.4707,
    70.0577,
    "West",
    "C",
    "industrial/coastal Gujarat market with business-family networks, community recommendation, practical premium buying and value scrutiny."
  ),
  coverageMarket(
    "Bhavnagar",
    21.7645,
    72.1519,
    "West",
    "C",
    "Saurashtra trading/industrial city with conservative-modern tastes, family decision-making and strong value instincts."
  ),
  coverageMarket(
    "Junagadh",
    21.5222,
    70.4579,
    "West",
    "D",
    "Saurashtra heritage/agri market with community trust, family buying, festival demand and measured premium adoption."
  ),
  coverageMarket(
    "Vapi",
    20.3893,
    72.9106,
    "West",
    "D",
    "industrial corridor town with salaried/SME households, migrant mix, practical spending and retailer trust."
  ),
  coverageMarket(
    "Kolhapur",
    16.705,
    74.2433,
    "West",
    "C",
    "western Maharashtra market with agri/SME wealth, family occasions, local pride and value-conscious premium buying."
  ),
  coverageMarket(
    "Solapur",
    17.6599,
    75.9064,
    "West",
    "C",
    "textile/agri-trading city with practical middle-class buying, family input and high sensitivity to durability and price."
  ),
  coverageMarket(
    "Chhatrapati Sambhajinagar",
    19.8762,
    75.3433,
    "West",
    "C",
    "industrial and tourism city with manufacturing households, aspirational retail, family decisions and practical value filters."
  ),
  coverageMarket(
    "Jalgaon",
    21.0077,
    75.5626,
    "West",
    "D",
    "agri-trading Maharashtra market where local trust, family budgeting and functional value dominate buying decisions."
  ),
  coverageMarket(
    "Nanded",
    19.1383,
    77.321,
    "West",
    "D",
    "Marathwada religious/education market with family-led spending, local networks and cautious adoption of unfamiliar brands."
  ),
  coverageMarket(
    "Akola",
    20.7002,
    77.0082,
    "West",
    "D",
    "Vidarbha agri-service city with price-sensitive middle households, practical quality expectations and offline trust channels."
  ),
  coverageMarket(
    "Ujjain",
    23.1765,
    75.7885,
    "Central",
    "C",
    "pilgrimage and education market with festival demand, family norms, local trust and conservative premium signalling."
  ),
  coverageMarket(
    "Jabalpur",
    23.1815,
    79.9864,
    "Central",
    "C",
    "central Indian defence/education/service market with stable salaried households, family approval and value-led choices."
  ),
  coverageMarket(
    "Rewa",
    24.5362,
    81.3037,
    "Central",
    "D",
    "Vindhya administrative/education market with cautious spending, family recommendation and high trust requirements."
  ),
  coverageMarket(
    "Satna",
    24.6005,
    80.8322,
    "Central",
    "D",
    "cement/trading city with practical working households, local dealer trust and strong price comparison."
  ),
  coverageMarket(
    "Bilaspur",
    22.0797,
    82.1409,
    "Central",
    "C",
    "Chhattisgarh service/railway market with family buying, emerging retail, practical value and offline trust."
  ),
  coverageMarket(
    "Durg-Bhilai",
    21.1938,
    81.3509,
    "Central",
    "C",
    "steel-town cluster with stable industrial households, durability expectations, local word-of-mouth and practical spending."
  ),
  coverageMarket(
    "Rourkela",
    22.2604,
    84.8536,
    "East",
    "C",
    "steel/industrial city with salaried company-town households, reliability focus and cautious premium adoption."
  ),
  coverageMarket(
    "Cuttack",
    20.4625,
    85.8828,
    "East",
    "C",
    "old commercial Odisha city with family businesses, local retail trust, festival demand and value-led choices."
  ),
  coverageMarket(
    "Sambalpur",
    21.4669,
    83.9812,
    "East",
    "D",
    "western Odisha trading/education market with regional pride, family networks and strong price sensitivity."
  ),
  coverageMarket(
    "Berhampur",
    19.3149,
    84.7941,
    "East",
    "D",
    "southern Odisha trading city with local-language trust, family decisions, practical value and festival-linked demand."
  ),
  coverageMarket(
    "Dhanbad",
    23.7957,
    86.4304,
    "East",
    "C",
    "coal/industrial market with salaried and trading households, durability expectations and practical price-value filters."
  ),
  coverageMarket(
    "Bokaro",
    23.6693,
    86.1511,
    "East",
    "D",
    "steel-town market with stable public-sector households, family buying input, reliability expectations and local trust."
  ),
  coverageMarket(
    "Muzaffarpur",
    26.1197,
    85.391,
    "East",
    "C",
    "north Bihar commercial market with family networks, migration-linked incomes, strong value scrutiny and offline discovery."
  ),
  coverageMarket(
    "Gaya",
    24.7914,
    85.0002,
    "East",
    "C",
    "pilgrimage/education market with traditional norms, family decisions, tourism seasonality and cautious premium adoption."
  ),
  coverageMarket(
    "Darbhanga",
    26.1542,
    85.8918,
    "East",
    "D",
    "Mithila cultural/education market with family reputation, local trust, wedding occasions and value-conscious spending."
  ),
  coverageMarket(
    "Asansol",
    23.6739,
    86.9524,
    "East",
    "C",
    "industrial Bengal market with salaried/trading households, practical value filters and local word-of-mouth."
  ),
  coverageMarket(
    "Durgapur",
    23.5204,
    87.3119,
    "East",
    "C",
    "planned industrial/education city with stable households, emerging mall habits and practical premium evaluation."
  ),
  coverageMarket(
    "Malda",
    25.0108,
    88.1411,
    "East",
    "D",
    "north Bengal trading/agri market with price sensitivity, family decisions, local retail trust and festival demand."
  ),
  coverageMarket(
    "Agartala",
    23.8315,
    91.2868,
    "Northeast",
    "D",
    "Tripura capital market with government-service households, Bengali/Northeast cultural mix, family input and logistics-aware buying."
  ),
  coverageMarket(
    "Shillong",
    25.5788,
    91.8933,
    "Northeast",
    "D",
    "hill-city market with youth style, community networks, tourism exposure, regional identity and selective premium adoption."
  ),
  coverageMarket(
    "Imphal",
    24.817,
    93.9368,
    "Northeast",
    "D",
    "Manipur capital with strong local identity, sports/youth culture, community trust and logistics-sensitive buying."
  ),
  coverageMarket(
    "Aizawl",
    23.7271,
    92.7176,
    "Northeast",
    "E",
    "Mizoram hill capital with tight community networks, church/family norms, understated status cues and high trust requirements."
  ),
  coverageMarket(
    "Salem",
    11.6643,
    78.146,
    "South",
    "C",
    "Tamil industrial/trading city with practical quality expectations, family approval and measured premium spending."
  ),
  coverageMarket(
    "Erode",
    11.341,
    77.7172,
    "South",
    "D",
    "textile and agri-trading market with fabric/product awareness, family businesses and sharp value judgement."
  ),
  coverageMarket(
    "Tiruchirappalli",
    10.7905,
    78.7047,
    "South",
    "C",
    "education/industrial Tamil city with salaried households, family-led decisions, durability expectations and practical premium adoption."
  ),
  coverageMarket(
    "Tirunelveli",
    8.7139,
    77.7567,
    "South",
    "D",
    "southern Tamil market with family norms, local retail trust, conservative-modern tastes and high price discipline."
  ),
  coverageMarket(
    "Vellore",
    12.9165,
    79.1325,
    "South",
    "D",
    "education/medical city with student and service households, family budgeting, trust in known sellers and practical value checks."
  ),
  coverageMarket(
    "Mangaluru",
    12.9141,
    74.856,
    "South",
    "C",
    "coastal Karnataka market with Gulf/education exposure, tasteful premium buying, family influence and high service expectations."
  ),
  coverageMarket(
    "Belagavi",
    15.8497,
    74.4977,
    "South",
    "C",
    "Karnataka-Maharashtra border market with trading families, practical quality filters, local trust and mixed-language culture."
  ),
];

export const INDIA_RELEVANT_MARKETS: IndiaMarket[] = [
  ...INDIA_CORE_MARKETS,
  ...INDIA_LONG_TAIL_MARKETS,
];

export const PAN_INDIA_MIN_RELEVANT_SPOTS = Math.max(
  50,
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
  if (
    (profile.geography ?? []).some((g) => {
      const n = norm(g);
      return (
        n === "india" ||
        n === "bharat" ||
        n === "all india" ||
        n === "all of india" ||
        n === "entire india" ||
        n === "whole india"
      );
    })
  ) {
    return true;
  }
  const text = profileGeographyText(profile).toLowerCase();
  return /\b(pan[\s-]?india|pan india|all india|all of india|entire india|india wide|indiawide|nationwide|national|across india|whole india)\b/.test(
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

function classOfMarket(market: IndiaMarket): "A" | "B" | "C" | "D" | "E" {
  if (market.marketClass) return market.marketClass;
  if (market.tier === "metro") return "A";
  if (market.tier === "tier2") return "B";
  if (market.tier === "tier3") return "C";
  return "D";
}

function panIndiaExpansionOrder(): IndiaMarket[] {
  // For "All India", the fallback must not collapse back to A/B markets.
  // Prioritize C/D/E locations; the LLM plan usually already contributes
  // metros and large tier-B cities before this deterministic expansion runs.
  const longTail = ["E", "D", "C"].flatMap((klass) =>
    INDIA_RELEVANT_MARKETS.filter((m) => classOfMarket(m) === klass)
  );
  const largeMarkets = INDIA_RELEVANT_MARKETS.filter((m) =>
    ["A", "B"].includes(classOfMarket(m))
  );
  const seeded = [...longTail, ...largeMarkets];
  const seen = new Set(seeded.map((m) => norm(m.name)));
  return [
    ...seeded,
    ...INDIA_RELEVANT_MARKETS.filter((m) => !seen.has(norm(m.name))),
  ];
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

  const existingByName = new Map(plan.localities.map((l) => [norm(l.name), l]));
  const plannerIndiaRelevant = plan.localities
    .filter((l) => l.country.toLowerCase() === "india" && marketForName(l.name))
    .map((l) => l.name)
    .slice(0, 10);
  const selectedRelevant = Array.from(
    new Set([
      ...plannerIndiaRelevant.map(norm),
      ...panIndiaExpansionOrder().map((m) => norm(m.name)),
    ])
  )
    .slice(0, PAN_INDIA_MIN_RELEVANT_SPOTS)
    .map((n) => marketForName(n)?.name ?? existingByName.get(n)?.name)
    .filter((name): name is string => !!name);

  const selectedNorms = new Set(selectedRelevant.map(norm));
  const selectedLocalities = selectedRelevant
    .map((name) => {
      const existing = existingByName.get(norm(name));
      if (existing) return existing;
      const market = marketForName(name);
      return market
        ? {
            name: market.name,
            country: market.country,
            lat: market.lat,
            lng: market.lng,
          }
        : null;
    })
    .filter((l): l is Locality => !!l);
  const extraLocalities = plan.localities
    .filter((l) => !selectedNorms.has(norm(l.name)))
    .slice(0, Math.max(0, 60 - selectedLocalities.length));
  const localities = [...selectedLocalities, ...extraLocalities];
  const allowedLocalities = new Set(localities.map((l) => norm(l.name)));
  const role = dominantRole(plan.cohorts);
  const cohorts = plan.cohorts.filter((c) =>
    allowedLocalities.has(norm(c.locality))
  );

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

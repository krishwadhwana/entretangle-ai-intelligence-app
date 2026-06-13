import type {
  AudienceAggregate,
  AudienceChatMode,
  AudienceChatOutput,
  BrandKit,
  Cohort,
  CohortSimOutput,
  EntanglerOutput,
  ExecutorOutput,
  InspirationKit,
  PlannerV2Output,
  Persona,
  QueryOutput,
  Conclusion,
} from "../schema";

// ---------------------------------------------------------------------------
// Mock fixtures v2 (SPEC-V2 §6): a Jodhpur teak-furniture brand selling into
// Indian metros and exporting to Dubai & London. Exercises every v2 path —
// web-grounded desks, export law, landed cost, retail/luxury/institutional
// channels, social mapping, and ~2,000 deterministic personas — zero tokens.
// All objects pass the exact same Zod schemas as real LLM output.
// ---------------------------------------------------------------------------

export const mockPlannerV2Output: PlannerV2Output = {
  desks: [
    {
      name: "Market Demand",
      domain: "market",
      mission:
        "Size demand for premium solid-teak furniture in Mumbai, Delhi NCR and Bangalore, and for Indian-craft furniture among Dubai and London buyers. Which price bands clear and which city leads?",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Competitor Stats",
      domain: "competitor",
      mission:
        "Real numbers on competitors: pricing per dining table, revenue, store count and funding for premium Indian furniture brands and the importers serving Dubai/London.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Competitor Stories",
      domain: "competitor",
      mission:
        "How comparable craft-furniture brands launched, pivoted or failed — narrative case studies with what actually made the difference.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Retail Channels",
      domain: "channel",
      mission:
        "Department-store and large-format retail fit in India (Shoppers Stop archetype, Home Centre, large MBOs): listing terms, margins, category-buyer process, sampling expectations.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Luxury Marketplaces",
      domain: "channel",
      mission:
        "Farfetch-archetype curated marketplaces and design platforms for furniture (1stDibs, Pamono, regional luxury e-tail): commission, curation bar, who handles cross-border logistics.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Institutional Buyers",
      domain: "channel",
      mission:
        "Hospitals, hotels and serviced offices as bulk buyers in India and the Gulf: procurement cycles, tender thresholds, spec sheets, payment terms.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Trade & Regulation",
      domain: "regulation",
      mission:
        "Export/import law for wooden furniture India→UAE and India→UK: HS 9403 duties, VRIKSH/legality certification, fumigation, UKCA/REACH, and what blocks first-time exporters.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Landed Cost & Pricing",
      domain: "pricing",
      mission:
        "Freight + insurance + duty movement for a 40ft container Mumbai→Jebel Ali and Mumbai→Felixstowe; landed cost per dining table; viable price position vs local players in Dubai and London.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Social Landscape",
      domain: "social",
      mission:
        "Platform-by-platform map for furniture discovery per segment in India, UAE, UK: Instagram/Pinterest/YouTube formats, interior-designer communities, CAC benchmarks.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Brand & Positioning",
      domain: "market",
      mission:
        "Whitespace for a heritage-Jodhpur teak story between mass online furniture and bespoke ateliers; naming codes and premium cues in the category.",
      useWebSearch: false,
      params: {},
    },
    {
      name: "Product & Materials",
      domain: "product",
      mission:
        "Teak grades and certified-legal sourcing, joinery and finish quality bar for premium positioning, SKU/range architecture for a launch collection.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Manufacturing & Sourcing",
      domain: "supply",
      mission:
        "Where to make it (Jodhpur/Saharanpur clusters vs own unit), supplier discovery, MOQ per workshop tier, sampling + production lead times, timber and hardware sourcing, capacity for export volumes.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Fulfilment & Returns",
      domain: "operations",
      mission:
        "Inventory model for bulky furniture, 3PL/warehousing and crated last-mile, damage/returns (RTO) rates in India vs export, packaging and post-sale support.",
      useWebSearch: true,
      params: {},
    },
    {
      name: "Unit Economics",
      domain: "finance",
      mission:
        "Per-table COGS build-up, gross margin at each price tier, working-capital cycle between paying workshops and getting paid, break-even volume, and whether ₹40L capital funds the MOQ.",
      useWebSearch: false,
      params: {},
    },
  ],
  cohortPlan: {
    currency: "INR",
    localities: [
      { name: "Mumbai", country: "India", lat: 19.076, lng: 72.8777 },
      { name: "Delhi NCR", country: "India", lat: 28.6139, lng: 77.209 },
      { name: "Bangalore", country: "India", lat: 12.9716, lng: 77.5946 },
      // tier-2 / tier-3 — the non-metro India most programs ignore
      { name: "Jaipur", country: "India", lat: 26.9124, lng: 75.7873 },
      { name: "Indore", country: "India", lat: 22.7196, lng: 75.8577 },
      { name: "Surat", country: "India", lat: 21.1702, lng: 72.8311 },
      { name: "Dubai", country: "UAE", lat: 25.2048, lng: 55.2708 },
      { name: "London", country: "UK", lat: 51.5074, lng: -0.1278 },
    ],
    cohorts: [
      // consumers: every city x segment that makes sense
      { locality: "Mumbai", segment: "middle", role: "consumer", weightPct: 9 },
      { locality: "Mumbai", segment: "affluent", role: "consumer", weightPct: 8 },
      { locality: "Mumbai", segment: "luxury", role: "consumer", weightPct: 3 },
      { locality: "Mumbai", segment: "budget", role: "consumer", weightPct: 4 },
      { locality: "Delhi NCR", segment: "middle", role: "consumer", weightPct: 8 },
      { locality: "Delhi NCR", segment: "affluent", role: "consumer", weightPct: 7 },
      { locality: "Delhi NCR", segment: "luxury", role: "consumer", weightPct: 3 },
      { locality: "Bangalore", segment: "middle", role: "consumer", weightPct: 7 },
      { locality: "Bangalore", segment: "affluent", role: "consumer", weightPct: 6 },
      // tier-2 / tier-3 consumers — budget/middle-skewed, lower premium intent
      { locality: "Jaipur", segment: "middle", role: "consumer", weightPct: 5 },
      { locality: "Jaipur", segment: "budget", role: "consumer", weightPct: 4 },
      { locality: "Jaipur", segment: "affluent", role: "consumer", weightPct: 2 },
      { locality: "Indore", segment: "budget", role: "consumer", weightPct: 4 },
      { locality: "Indore", segment: "middle", role: "consumer", weightPct: 3 },
      { locality: "Surat", segment: "middle", role: "consumer", weightPct: 4 },
      { locality: "Surat", segment: "budget", role: "consumer", weightPct: 3 },
      { locality: "Dubai", segment: "affluent", role: "consumer", weightPct: 6 },
      { locality: "Dubai", segment: "luxury", role: "consumer", weightPct: 4 },
      { locality: "London", segment: "affluent", role: "consumer", weightPct: 5 },
      { locality: "London", segment: "luxury", role: "consumer", weightPct: 3 },
      // retail buying execs
      { locality: "Mumbai", segment: "affluent", role: "retail_exec", weightPct: 3 },
      { locality: "Delhi NCR", segment: "affluent", role: "retail_exec", weightPct: 3 },
      { locality: "Dubai", segment: "luxury", role: "retail_exec", weightPct: 2 },
      { locality: "London", segment: "luxury", role: "retail_exec", weightPct: 2 },
      // institutional procurement
      { locality: "Mumbai", segment: "middle", role: "institutional", weightPct: 2 },
      { locality: "Bangalore", segment: "middle", role: "institutional", weightPct: 2 },
      { locality: "Dubai", segment: "affluent", role: "institutional", weightPct: 2 },
      // distributors / importers
      { locality: "Dubai", segment: "middle", role: "distributor", weightPct: 2 },
      { locality: "London", segment: "middle", role: "distributor", weightPct: 2 },
      { locality: "Mumbai", segment: "middle", role: "distributor", weightPct: 1 },
      // influencers / designers
      { locality: "Mumbai", segment: "affluent", role: "influencer", weightPct: 2 },
      { locality: "Delhi NCR", segment: "affluent", role: "influencer", weightPct: 1 },
      { locality: "Dubai", segment: "luxury", role: "influencer", weightPct: 1 },
      { locality: "London", segment: "luxury", role: "influencer", weightPct: 1 },
      { locality: "Bangalore", segment: "affluent", role: "influencer", weightPct: 1 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Desk outputs — entities overlap deliberately so entanglement fires.
// ---------------------------------------------------------------------------

const deskOutputs: Record<string, ExecutorOutput> = {
  "Market Demand": {
    logs: [
      "searching: india premium furniture market size 2025",
      "found: organized furniture shifting online + premium",
      "searching: dubai london demand for indian craft furniture",
      "cross-checking metro-level demand signals",
      "sizing addressable buyers per city",
    ],
    conclusions: [
      {
        claim: "India premium furniture demand concentrated in 3 metros",
        value:
          "Mumbai, Delhi NCR, Bangalore account for an estimated 55–65% of premium (>₹60k ticket) furniture purchases; Mumbai leads on willingness to pay.",
        confidence: 0.7,
        entities: ["mumbai", "delhi ncr", "bangalore", "premium", "teak"],
        sources: ["https://example-mock.search/india-furniture-market"],
      },
      {
        claim: "Gulf + UK diaspora is a real export beachhead",
        value:
          "Dubai and London households with Indian heritage over-index 2–3x on Indian-craft furniture purchases; entry via curated marketplaces beats own-store.",
        confidence: 0.6,
        entities: ["dubai", "london", "export", "diaspora", "marketplace"],
        sources: ["https://example-mock.search/gulf-uk-craft-demand"],
      },
    ],
  },
  "Product & Materials": {
    logs: [
      "searching: grade a teak vs plantation teak furniture",
      "checking legal-sourcing + certification cues buyers trust",
      "benchmarking joinery/finish bar at premium price points",
      "sketching a tight launch range vs sprawling catalog",
    ],
    conclusions: [
      {
        claim: "Certified-legal Grade-A teak is the load-bearing premium cue",
        value:
          "Buyers above ₹90k expect FSC/legal-sourcing papers and visible mortise-and-tenon joinery; without proof of provenance the 'real teak' claim is discounted.",
        confidence: 0.7,
        entities: ["teak", "premium", "certification", "quality", "provenance"],
        sources: ["https://example-mock.search/teak-grades-provenance"],
      },
      {
        claim: "Launch with a tight 12–15 SKU range, not a broad catalog",
        value:
          "A focused range (dining table + 2 bench/chair options + 1 sideboard in 3 finishes) covers most demand while keeping MOQ and working capital sane; expand after sell-through data.",
        confidence: 0.6,
        entities: ["sku", "range", "moq", "launch", "teak"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Manufacturing & Sourcing": {
    logs: [
      "searching: jodhpur saharanpur furniture manufacturing clusters",
      "comparing job-work workshops vs own production unit",
      "found: MOQ varies sharply by workshop tier",
      "checking sampling + production lead times for teak",
      "mapping timber + hardware supplier base",
    ],
    conclusions: [
      {
        claim: "Job-work workshops in Jodhpur quote MOQ 20–50 units/design",
        value:
          "Established Jodhpur/Saharanpur export workshops take 20–50 units per design at job-work rates; below ~20 units you pay 25–40% per-unit premiums or must run your own unit. Sampling 3–5 weeks, production 6–10 weeks for solid teak.",
        confidence: 0.62,
        entities: ["jodhpur", "moq", "manufacturing", "lead time", "teak"],
        sources: ["https://example-mock.search/jodhpur-furniture-moq"],
      },
      {
        claim: "Own unit only pays off above ~150 units/month sustained",
        value:
          "Renting a small unit + 6–8 karigars carries ~₹3–4L/month fixed; it beats job-work economics only past ~150 units/month — so start asset-light on job-work, revisit after demand proves out.",
        confidence: 0.55,
        entities: ["manufacturing", "capacity", "unit economics", "jodhpur"],
        sources: ["https://example-mock.search/furniture-unit-vs-jobwork"],
      },
    ],
  },
  "Fulfilment & Returns": {
    logs: [
      "searching: bulky furniture 3PL crated last-mile india",
      "checking RTO/damage rates for online furniture",
      "comparing india vs dubai/london reverse logistics",
    ],
    conclusions: [
      {
        claim: "Damage/returns, not demand, is the margin killer for furniture D2C",
        value:
          "Crated solid-wood furniture sees 8–14% damage-or-return on uninsured last-mile in India; specialised furniture 3PL + white-glove delivery cuts this to 3–5% but adds ₹1,200–2,500/order.",
        confidence: 0.6,
        entities: ["returns", "rto", "logistics", "last-mile", "d2c"],
        sources: ["https://example-mock.search/furniture-rto-damage"],
      },
      {
        claim: "Export fulfilment needs crating + insured freight, not parcel",
        value:
          "Dubai/London orders must ship as insured palletised/crated freight; treat fulfilment as project-logistics per order, not parcel shipping, and price it into landed cost.",
        confidence: 0.55,
        entities: ["export", "dubai", "london", "freight", "logistics"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Unit Economics": {
    logs: [
      "building per-table COGS: timber + hardware + labour + finish",
      "modelling gross margin at ₹90k / ₹1.2L / ₹1.8L tiers",
      "estimating working-capital cycle vs ₹40L capital",
      "solving break-even volume",
    ],
    conclusions: [
      {
        claim: "Per-table COGS ~₹38–46k; healthy margin only above ₹1.1L retail",
        value:
          "Solid-teak dining table COGS lands ~₹38–46k (timber ~55%, labour ~25%, hardware/finish ~20%). At ₹90k retail the gross margin is thin after returns/freight; ₹1.1L–₹1.4L is the sustainable launch band.",
        confidence: 0.6,
        entities: ["unit economics", "cogs", "pricing", "teak", "margin"],
        sources: ["llm:knowledge"],
      },
      {
        claim: "₹40L funds ~1 MOQ cycle; working capital is the real constraint",
        value:
          "Cash is tied 3–4 months between paying the workshop and getting paid. A 40-unit MOQ at ~₹42k = ~₹17L locked per design; ₹40L funds roughly one launch range plus thin runway — sequence drops, don't launch everything at once.",
        confidence: 0.58,
        entities: ["working capital", "moq", "funding", "unit economics"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Competitor Stats": {
    logs: [
      "searching: pepperfry urban ladder pricing dining table",
      "pulling premium brand price ladders",
      "searching: funding rounds indian furniture brands",
      "tabulating price per dining table by brand",
    ],
    conclusions: [
      {
        claim: "Premium teak dining tables retail ₹85k–₹2.4L in India",
        value:
          "Mass-online (Pepperfry/Urban Ladder) tops out ~₹85k; craft-premium brands (Fabindia, boutique ateliers) run ₹1.2L–₹2.4L — a gap at ₹90k–₹1.2L.",
        confidence: 0.65,
        entities: ["pricing", "teak", "premium", "dining table", "pepperfry"],
        sources: ["https://example-mock.search/dining-table-prices"],
      },
      {
        claim: "Dubai imported-furniture retail markup is 2.2–2.8x landed",
        value:
          "Local premium retailers in Dubai mark imported solid-wood furniture 2.2–2.8x over landed cost — room for a direct brand to undercut at 1.8x.",
        confidence: 0.55,
        entities: ["dubai", "pricing", "landed cost", "import", "markup"],
        sources: ["https://example-mock.search/dubai-furniture-markup"],
      },
    ],
  },
  "Competitor Stories": {
    logs: [
      "searching: indian furniture brand export case study",
      "reading: how a jaipur brand cracked 1stdibs",
      "reading: failed D2C furniture launches 2023-25",
      "extracting the repeatable moves",
    ],
    conclusions: [
      {
        claim: "Winners led with story + designer seeding, not ads",
        value:
          "Case pattern: brands that seeded 20–30 interior designers with sample pieces and a heritage story hit profitable repeat orders in &lt;12 months; ad-led launches burned out.",
        confidence: 0.6,
        entities: ["influencer", "interior designers", "story", "launch"],
        sources: ["https://example-mock.search/craft-brand-case-studies"],
      },
      {
        claim: "Failure mode #1: underestimating export paperwork",
        value:
          "Two of three failed exporters cite certification + fumigation delays (not demand) as the killer — 4–6 month stalls eroded cash.",
        confidence: 0.6,
        entities: ["export", "certification", "fumigation", "regulation"],
        sources: ["https://example-mock.search/export-failure-stories"],
      },
    ],
  },
  "Retail Channels": {
    logs: [
      "searching: shoppers stop home centre furniture vendor terms",
      "mapping category-buyer process at indian dept stores",
      "checking listing fees + margin expectations",
    ],
    conclusions: [
      {
        claim: "Dept-store route costs 35–45% margin + slow onboarding",
        value:
          "Shoppers Stop/Home Centre archetype: 35–45% retail margin, 60–90 day payment, 3–6 month onboarding via category buyer; good for credibility, bad for cash early.",
        confidence: 0.6,
        entities: ["shoppers stop", "department store", "margin", "retail"],
        sources: ["https://example-mock.search/dept-store-vendor-terms"],
      },
      {
        claim: "Shop-in-shop beats full listing for year one",
        value:
          "A 200 sq ft shop-in-shop in 2 flagship stores outperforms a 20-store listing on contribution margin for a new premium brand.",
        confidence: 0.55,
        entities: ["shop-in-shop", "retail", "premium", "mumbai"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Luxury Marketplaces": {
    logs: [
      "searching: 1stdibs pamono seller commission furniture",
      "checking farfetch-style curation for home category",
      "who handles cross-border shipping per platform",
    ],
    conclusions: [
      {
        claim: "Curated marketplaces take 15–50% but solve trust + logistics",
        value:
          "1stDibs/Pamono archetype: 15–50% commission, strict curation, they front cross-border logistics and white-glove delivery — fastest credible route to London/Dubai buyers.",
        confidence: 0.65,
        entities: ["marketplace", "1stdibs", "commission", "london", "dubai"],
        sources: ["https://example-mock.search/luxury-marketplace-terms"],
      },
    ],
  },
  "Institutional Buyers": {
    logs: [
      "searching: hotel furniture procurement india gulf tender",
      "mapping hospital + serviced office buying cycles",
      "extracting spec + payment terms",
    ],
    conclusions: [
      {
        claim: "Hotels buy in 18–30 month cycles via fit-out contractors",
        value:
          "Hospitality FF&E flows through fit-out contractors, not direct: get specified by 5–10 contractors/designers; payment 90–120 days; volumes 200–600 pieces per property.",
        confidence: 0.6,
        entities: ["hotels", "institutional", "tender", "fit-out", "dubai"],
        sources: ["https://example-mock.search/hospitality-ffe-procurement"],
      },
      {
        claim: "Hospitals need certifications, not aesthetics",
        value:
          "Hospital furniture tenders hinge on fire-retardancy + infection-control certs; teak craft is a poor fit — deprioritize hospitals, keep hotels/offices.",
        confidence: 0.7,
        entities: ["hospitals", "certification", "tender", "institutional"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Trade & Regulation": {
    logs: [
      "searching: HS 9403 duty india to uae furniture",
      "searching: uk import duty wooden furniture UKCA",
      "checking VRIKSH timber legality certification",
      "fumigation + phytosanitary requirements",
    ],
    conclusions: [
      {
        claim: "India→UAE wooden furniture duty 5%, India→UK 0–2% post-FTA",
        value:
          "HS 9403: UAE applies 5% CIF duty; UK 0–2% with proper origin docs. Both need fumigation cert + timber-legality (VRIKSH) paperwork per shipment.",
        confidence: 0.6,
        entities: ["hs 9403", "duty", "export", "dubai", "london", "regulation"],
        sources: ["https://example-mock.search/hs9403-duties"],
      },
      {
        claim: "Teak export needs legality proof — plantation-sourced only",
        value:
          "Indian teak export is fine if plantation-sourced with VRIKSH/legality chain; reclaimed/forest teak triggers seizure risk. Lock supply contracts first.",
        confidence: 0.7,
        entities: ["teak", "vriksh", "certification", "export", "regulation"],
        sources: ["https://example-mock.search/teak-export-rules"],
      },
    ],
  },
  "Landed Cost & Pricing": {
    logs: [
      "searching: 40ft container freight mumbai jebel ali rate",
      "searching: mumbai felixstowe container rate 2026",
      "computing landed cost per dining table",
      "positioning vs dubai + london local prices",
    ],
    conclusions: [
      {
        claim: "Landed Dubai cost ≈ 1.18x ex-works; London ≈ 1.32x",
        value:
          "40ft container (≈60 dining tables): Mumbai→Jebel Ali freight+ins+5% duty ≈ +18%; Mumbai→Felixstowe +duty ≈ +32%. A ₹1L ex-works table lands at ₹1.18L / ₹1.32L.",
        confidence: 0.55,
        entities: ["landed cost", "freight", "dubai", "london", "pricing"],
        sources: ["https://example-mock.search/container-rates"],
      },
      {
        claim: "Price at 1.8x landed in Dubai undercuts local premium 25%+",
        value:
          "Selling at 1.8x landed (≈₹2.1L retail) in Dubai still sits 25–35% below comparable local premium retail — defensible margin with room for marketplace commission.",
        confidence: 0.5,
        entities: ["pricing", "dubai", "margin", "landed cost", "premium"],
        sources: ["llm:knowledge"],
      },
    ],
  },
  "Social Landscape": {
    logs: [
      "searching: furniture discovery instagram pinterest stats india",
      "mapping platform x segment for uae uk buyers",
      "pulling CAC benchmarks home category",
      "finding interior-designer communities per city",
    ],
    conclusions: [
      {
        claim: "Instagram + Pinterest drive 60%+ of premium furniture discovery",
        value:
          "Affluent/luxury furniture buyers discover via Instagram reels (process videos) and Pinterest boards; YouTube long-form converts the ₹1L+ ticket. CAC benchmark ₹800–2500 per qualified lead.",
        confidence: 0.6,
        entities: ["instagram", "pinterest", "youtube", "cac", "social"],
        sources: ["https://example-mock.search/furniture-social-stats"],
      },
      {
        claim: "Designer-led content outperforms brand ads 3–5x",
        value:
          "Posts by interior designers featuring a piece outperform brand-run ads 3–5x on saves and DMs — matches the audience's influencer cohorts' behavior.",
        confidence: 0.6,
        entities: ["interior designers", "influencer", "instagram", "social"],
        sources: ["https://example-mock.search/designer-content-performance"],
      },
    ],
  },
  "Brand & Positioning": {
    logs: [
      "mapping whitespace between mass online and bespoke ateliers",
      "testing heritage-jodhpur narrative codes",
      "naming + premium cue audit",
    ],
    conclusions: [
      {
        claim: "Whitespace: 'heritage craft, contemporary form' at ₹90k–1.2L",
        value:
          "The unowned position: Jodhpur heritage story + contemporary silhouettes at the ₹90k–₹1.2L gap, with plantation-teak legality as a trust cue for export buyers.",
        confidence: 0.65,
        entities: ["premium", "teak", "story", "positioning", "jodhpur"],
        sources: ["llm:knowledge"],
      },
    ],
  },
};

const fallbackDesk: ExecutorOutput = {
  logs: ["scoping mission", "gathering signals", "drafting conclusions"],
  conclusions: [
    {
      claim: "Directional finding (mock fallback)",
      value: "Mock mode fallback output for an unrecognized desk name.",
      confidence: 0.4,
      entities: ["mock"],
      sources: ["llm:knowledge"],
    },
  ],
};

export function mockDeskOutput(name: string): ExecutorOutput {
  return deskOutputs[name] ?? fallbackDesk;
}

// ---------------------------------------------------------------------------
// Deterministic persona generator — thousands of personas, zero tokens.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NAMES: Record<string, { first: string[]; last: string[] }> = {
  India: {
    first: ["Aarav", "Priya", "Rohan", "Ananya", "Kabir", "Meera", "Vikram", "Isha", "Arjun", "Naina", "Dev", "Sana"],
    last: ["Sharma", "Mehta", "Iyer", "Reddy", "Khan", "Patel", "Nair", "Gupta", "Desai", "Singh"],
  },
  UAE: {
    first: ["Omar", "Layla", "Hassan", "Fatima", "Yusuf", "Noora", "Rashid", "Amira", "Zayed", "Hind", "Ravi", "Deepa"],
    last: ["Al Maktoum", "Haddad", "Al Falasi", "Khoury", "Bin Saeed", "Nasser", "Menon", "Kapoor"],
  },
  UK: {
    first: ["Oliver", "Amelia", "James", "Sophia", "Harry", "Freya", "Arjun", "Priya", "Theo", "Zara", "Leo", "Maya"],
    last: ["Smith", "Patel", "Jones", "Williams", "Shah", "Brown", "Taylor", "Khan", "Davies", "Mehta"],
  },
};

const OCCUPATIONS: Record<string, Record<string, string[]>> = {
  consumer: {
    budget: ["school teacher", "delivery supervisor", "retail assistant", "clerk"],
    middle: ["software engineer", "bank officer", "marketing manager", "pharmacist"],
    affluent: ["surgeon", "startup founder", "corporate lawyer", "investment manager"],
    luxury: ["family-office principal", "art collector", "property developer", "CXO"],
  },
  retail_exec: {
    affluent: ["category buyer, dept store", "merchandising head", "home-category buyer"],
    luxury: ["luxury retail buyer", "concept-store curator", "design-store owner"],
  },
  institutional: {
    middle: ["hospital procurement officer", "facilities manager", "admin head"],
    affluent: ["hotel FF&E manager", "fit-out project director", "club secretary"],
  },
  distributor: {
    middle: ["furniture importer", "wholesale trader", "retail distributor"],
  },
  influencer: {
    affluent: ["interior designer", "home-decor content creator", "architect"],
    luxury: ["celebrity interior designer", "design magazine editor", "stylist"],
  },
};

// Intent and willingness-to-pay distributions per segment x role.
const SEGMENT_WTP: Record<string, [number, number]> = {
  budget: [8000, 22000],
  middle: [22000, 65000],
  affluent: [65000, 160000],
  luxury: [150000, 500000],
};
const ROLE_INTENT: Record<string, [number, number]> = {
  consumer: [0.02, 0.45],
  retail_exec: [0.1, 0.6],
  institutional: [0.05, 0.5],
  distributor: [0.1, 0.65],
  influencer: [0.15, 0.7],
};
// Intent must depend on income tier AND locality, not just role — otherwise
// "intent by segment" and "by locality" come out identical (the same flat
// average). For a premium product, intent rises with income tier and with how
// fashion-forward / high-adoption the place is.
const SEGMENT_INTENT_MULT: Record<string, number> = {
  budget: 0.55,
  middle: 0.85,
  affluent: 1.25,
  luxury: 1.5,
};
// Locality adoption skew: metros and global cities higher, tier-2/3 and towns
// lower for a premium category. Unknown places fall back to a tier-2/3 level.
const LOCALITY_INTENT_MULT: Record<string, number> = {
  Mumbai: 1.2,
  "Delhi NCR": 1.12,
  Delhi: 1.12,
  Bangalore: 1.06,
  Bengaluru: 1.06,
  Chennai: 0.98,
  Kolkata: 0.92,
  Hyderabad: 1.0,
  Pune: 1.02,
  Ahmedabad: 0.9,
  Jaipur: 0.8,
  Surat: 0.78,
  Indore: 0.72,
  Lucknow: 0.7,
  Coimbatore: 0.74,
  Dubai: 1.25,
  London: 1.08,
};
const LOCALITY_WTP_MULT: Record<string, number> = {
  Mumbai: 1.12,
  "Delhi NCR": 1.08,
  Delhi: 1.08,
  Bangalore: 1.05,
  Bengaluru: 1.05,
  Chennai: 1.0,
  Kolkata: 0.95,
  Hyderabad: 1.0,
  Pune: 1.0,
  Ahmedabad: 0.92,
  Jaipur: 0.85,
  Surat: 0.85,
  Indore: 0.8,
  Lucknow: 0.8,
  Coimbatore: 0.82,
};
const ROLE_CHANNELS: Record<string, string[]> = {
  consumer: ["d2c website", "department store", "marketplace", "instagram shop", "showroom"],
  retail_exec: ["trade fair", "direct vendor pitch", "showroom"],
  institutional: ["tender", "fit-out contractor", "direct vendor pitch"],
  distributor: ["wholesale market", "trade fair", "direct vendor pitch"],
  influencer: ["showroom", "d2c website", "instagram shop"],
};
const SEGMENT_PLATFORMS: Record<string, string[][]> = {
  budget: [["whatsapp"], ["facebook", "whatsapp"], ["youtube"], []],
  middle: [["instagram", "whatsapp"], ["youtube", "facebook"], ["instagram"], ["whatsapp"]],
  affluent: [["instagram", "pinterest"], ["instagram", "youtube"], ["pinterest", "linkedin"], ["instagram"]],
  luxury: [["instagram", "pinterest"], ["instagram", "linkedin"], ["pinterest"], ["instagram", "x"]],
};
const OBJECTIONS: Record<string, string[]> = {
  consumer: [
    "too expensive for an unknown brand",
    "worried about delivery damage",
    "can't see and touch it before buying",
    "teak maintenance sounds like work",
    "no EMI option means no deal",
  ],
  retail_exec: [
    "unproven sell-through, I need rotation data",
    "margins too thin after your price",
    "supply reliability for reorders",
  ],
  institutional: [
    "no certifications, no tender",
    "lead times don't fit project schedule",
    "need 90-day payment terms",
  ],
  distributor: [
    "exclusivity terms unclear",
    "minimum order too high for a trial",
    "after-sales support is on whom?",
  ],
  influencer: [
    "story is nice but photos are weak",
    "nothing distinctive vs other craft brands",
    "no trade discount for designers",
  ],
};
const QUOTES: Record<string, string[]> = {
  consumer: [
    "If it really lasts decades like my grandmother's teak, I'm interested.",
    "Beautiful, but I'd need to sit at it before paying this much.",
    "The Jodhpur story got me — now match Pepperfry's delivery promise.",
    "I'd pay more for real teak if the legality papers are shown.",
  ],
  retail_exec: [
    "Bring me a shop-in-shop proposal with sell-through projections.",
    "The category needs a heritage story; the buying committee will listen.",
  ],
  institutional: [
    "Spec sheet, fire cert, and 200 units by March — can you?",
    "Get specified by our fit-out contractor first.",
  ],
  distributor: [
    "Give me Dubai exclusivity and I'll commit a container a quarter.",
    "Your landed price works only if duty paperwork is airtight.",
  ],
  influencer: [
    "Send me one piece to style; if my audience saves it, we talk.",
    "Contemporary lines with that joinery? My clients will eat this up.",
  ],
};

export function mockCohortSim(
  cohort: Pick<Cohort, "label" | "locality" | "country" | "segment" | "role">,
  currency: string,
  n: number,
  batchIndex = 0
): CohortSimOutput {
  // Seed by label + batch so each batch yields a distinct (non-duplicate) draw.
  const rng = mulberry32(hash(`${cohort.label}#${batchIndex}`));
  const names = NAMES[cohort.country] ?? NAMES.India;
  const occs =
    OCCUPATIONS[cohort.role]?.[cohort.segment] ??
    OCCUPATIONS[cohort.role]?.middle ??
    OCCUPATIONS.consumer[cohort.segment] ??
    OCCUPATIONS.consumer.middle;
  const [wtpLo, wtpHi] = SEGMENT_WTP[cohort.segment];
  const [intLo, intHi] = ROLE_INTENT[cohort.role];
  const channels = ROLE_CHANNELS[cohort.role];
  const platformSets = SEGMENT_PLATFORMS[cohort.segment];
  const objections = OBJECTIONS[cohort.role];
  const quotes = QUOTES[cohort.role];
  // export-market multiplier: Dubai/London quote higher in INR terms
  const fx = cohort.country === "India" ? 1 : cohort.country === "UAE" ? 1.6 : 1.9;
  // buyers (exec/distributor) quote per-unit buying price ≈ 55% of retail WTP
  const buyFactor = ["retail_exec", "distributor", "institutional"].includes(
    cohort.role
  )
    ? 0.55
    : 1;

  // Depth-field pools (seeded draws so each batch/persona varies). Lifestyle
  // and social behaviour are keyed by segment so they stay coherent with
  // income — a luxury buyer never gets a "hostel mess" routine.
  const LIFESTYLES_BY_SEGMENT: Record<string, string[]> = {
    budget: [
      "11–7 shift plus a long local-train commute, rarely eats out, unwinds on YouTube",
      "runs a roadside shop dawn to dusk, WhatsApp all day, temple on Sundays",
      "gig/delivery work, irregular hours, every rupee budgeted for the family",
      "hostel/PG life, cooks to save money, very online but spends little",
    ],
    middle: [
      "9–7 desk job, weekend mall trips with the family, scrolls reels at night",
      "WFH most days, gym mornings, the occasional brunch, watches the budget",
      "field sales, always travelling, decisions made over phone calls",
      "dual-income couple, plans big buys around festival sales and EMIs",
    ],
    affluent: [
      "senior professional, long hours, dines out often, hosts a few times a year",
      "runs own practice/business, weekend golf, travels for leisure quarterly",
      "design-conscious homeowner, follows interiors accounts, renovates room by room",
      "frequent flyer, entertains at home, happy to pay for quality and time saved",
    ],
    luxury: [
      "globe-trotting schedule, hosts curated dinners, surrounds self with design",
      "art-and-travel lifestyle, has a decorator on call, buys for legacy not price",
      "high-society circuit, galas and openings, statement pieces are the point",
      "owns multiple homes, sources bespoke, taste and provenance over cost",
    ],
  };
  const LIFESTYLES =
    LIFESTYLES_BY_SEGMENT[cohort.segment] ?? LIFESTYLES_BY_SEGMENT.middle;
  const LIFE_STAGES =
    cohort.segment === "luxury" || cohort.segment === "affluent"
      ? [
          "established family, owns the home",
          "empty-nester homeowner",
          "married, second home in progress",
          "single high-earner, large apartment",
        ]
      : [
          "single, lives with parents",
          "newly married, renting",
          "young family with toddlers",
          "joint family, shared home",
          "empty-nester on a fixed income",
        ];
  const VALUE_POOL = [
    "quality",
    "value-for-money",
    "status",
    "durability",
    "local craft",
    "sustainability",
    "convenience",
    "brand trust",
  ];
  const HABITS = [
    "researches online, buys in store after touching the product",
    "impulse buyer on social offers",
    "compares 3–4 options, waits for sales",
    "loyal to one or two trusted brands",
    "asks family/friends before any big purchase",
  ];
  const segPS: Record<string, number> = {
    budget: 0.85,
    middle: 0.6,
    affluent: 0.35,
    luxury: 0.15,
  };

  // Personality SYNCED TO LOCALITY: each place has its own temperament, status
  // cues and way of talking/deciding. Combined with global temperament/social
  // draws below, this gives every persona a distinct, locally-rooted character.
  const PERSONALITY_BY_LOCALITY: Record<
    string,
    { traits: string[]; flavors: string[] }
  > = {
    Mumbai: {
      traits: ["fast-paced", "street-smart", "value-savvy", "resilient", "ambitious"],
      flavors: [
        "talks fast, bargains harder, time is money",
        "always hustling between work and the local train",
        "spends carefully but can't resist a good deal",
        "proudly Mumbaikar — practical and unfussy",
      ],
    },
    "Delhi NCR": {
      traits: ["status-conscious", "assertive", "brand-aware", "well-networked", "image-driven"],
      flavors: [
        "wants the look and the label to match",
        "negotiates with confidence and connections",
        "big on first impressions and showing up well",
        "brand and prestige carry real weight here",
      ],
    },
    Bangalore: {
      traits: ["tech-savvy", "understated", "research-driven", "cosmopolitan", "practical"],
      flavors: [
        "googles and reads reviews before buying anything",
        "laid-back but quietly does the homework",
        "prefers function and value over flash",
        "mixes global and local taste comfortably",
      ],
    },
    Dubai: {
      traits: ["cosmopolitan", "aspirational", "brand-led", "convenience-first", "polished"],
      flavors: [
        "expects polish, speed and a premium feel",
        "moves between cultures, leans upscale",
        "values convenience over haggling",
        "finish and brand matter more than price",
      ],
    },
    London: {
      traits: ["discerning", "understated", "sustainability-minded", "design-literate", "sceptical"],
      flavors: [
        "quietly judges quality and provenance",
        "values craft and ethics over logos",
        "reserved — won't be oversold",
        "won over by an authentic story, not hype",
      ],
    },
  };
  const PERSONALITY_BY_COUNTRY: Record<
    string,
    { traits: string[]; flavors: string[] }
  > = {
    India: {
      traits: ["family-first", "value-savvy", "relationship-driven", "aspirational"],
      flavors: [
        "consults family before any big purchase",
        "loyalty is earned through trust and value",
        "aspirational but careful with money",
      ],
    },
    UAE: PERSONALITY_BY_LOCALITY.Dubai,
    UK: PERSONALITY_BY_LOCALITY.London,
  };
  const localPersona =
    PERSONALITY_BY_LOCALITY[cohort.locality] ??
    PERSONALITY_BY_COUNTRY[cohort.country] ?? {
      traits: ["pragmatic", "curious", "budget-aware", "independent"],
      flavors: ["weighs the options carefully", "makes up their own mind"],
    };
  const TEMPERAMENTS = [
    { adj: "Warm and gregarious", tag: "outgoing" },
    { adj: "Reserved and private", tag: "introverted" },
    { adj: "Sceptical, hard to convince", tag: "sceptical" },
    { adj: "Eager early-adopter", tag: "early-adopter" },
    { adj: "Cautious and risk-averse", tag: "cautious" },
    { adj: "Confident and opinionated", tag: "assertive" },
    { adj: "Easy-going and adaptable", tag: "easygoing" },
    { adj: "Detail-obsessed", tag: "meticulous" },
  ];
  const SOCIAL_STYLES = [
    { phrase: "loves hosting and being seen", tag: "social" },
    { phrase: "keeps a tight close circle", tag: "private" },
    { phrase: "leads opinions among friends", tag: "trendsetter" },
    { phrase: "follows trusted recommendations", tag: "follower" },
    { phrase: "prefers solitude and routine", tag: "homebody" },
  ];

  const personas = Array.from({ length: n }, (_, i) => {
    const first = names.first[Math.floor(rng() * names.first.length)];
    const last = names.last[Math.floor(rng() * names.last.length)];
    // Base draw from the role band, then skewed by income tier AND locality so
    // intent genuinely differs across segments and cities (not a flat mean).
    const baseIntent = intLo + Math.pow(rng(), 1.6) * (intHi - intLo);
    const fit =
      (SEGMENT_INTENT_MULT[cohort.segment] ?? 1) *
      (LOCALITY_INTENT_MULT[cohort.locality] ?? 0.7);
    const intent =
      Math.round(Math.min(0.97, Math.max(0, baseIntent * fit)) * 100) / 100;
    const locWtpMult =
      LOCALITY_WTP_MULT[cohort.locality] ??
      (cohort.country === "India" ? 0.82 : 1);
    const wtp = Math.round(
      ((wtpLo + rng() * (wtpHi - wtpLo)) * fx * buyFactor * locWtpMult) / 500
    ) * 500;
    const occupation = occs[Math.floor(rng() * occs.length)];
    const lifeStage = LIFE_STAGES[Math.floor(rng() * LIFE_STAGES.length)];
    const age = 18 + Math.floor(rng() * 54);
    const priceSensitivity =
      Math.round(
        Math.min(1, Math.max(0, (segPS[cohort.segment] ?? 0.5) + (rng() - 0.5) * 0.3)) * 100
      ) / 100;
    const values = Array.from(
      new Set(
        Array.from({ length: 1 + Math.floor(rng() * 3) }, () =>
          VALUE_POOL[Math.floor(rng() * VALUE_POOL.length)]
        )
      )
    );
    const lifestyle = LIFESTYLES[Math.floor(rng() * LIFESTYLES.length)];

    // Coherent life -> tier -> intent chain (the "Ramesh" logic): how income,
    // routine and social life justify the price tier they'll actually pay.
    const tierWord =
      cohort.segment === "budget"
        ? "entry-level"
        : cohort.segment === "middle"
          ? "mid-range"
          : cohort.segment === "affluent"
            ? "premium"
            : "top-end";
    const tierRationale =
      cohort.segment === "budget"
        ? "every rupee is accounted for, so anything beyond functional feels like a stretch"
        : cohort.segment === "middle"
          ? "they'll stretch for something that lasts, but only when the value is obvious"
          : cohort.segment === "affluent"
            ? "they pay readily for quality and a story, and dislike wasting time hunting deals"
            : "price is almost beside the point — provenance, taste and exclusivity decide it";
    const intentClause =
      intent >= 0.5
        ? "already fairly convinced and close to buying"
        : intent >= 0.25
          ? "warm but waiting for proof before committing"
          : "low intent for now — it isn't a priority in their life";
    const firstName = first;
    const reasoning = `${firstName}, ${age}, ${occupation} — ${lifestyle}. Given that life and a ${values[0] ?? "value-for-money"} mindset, ${tierRationale}, which points them at the ${tierWord} tier (WTP ≈ ${currency} ${wtp.toLocaleString()}). ${intentClause.charAt(0).toUpperCase()}${intentClause.slice(1)}.`;

    // Distinct personality, synced to the persona's locality.
    const temperament = TEMPERAMENTS[Math.floor(rng() * TEMPERAMENTS.length)];
    const social = SOCIAL_STYLES[Math.floor(rng() * SOCIAL_STYLES.length)];
    const localFlavor =
      localPersona.flavors[Math.floor(rng() * localPersona.flavors.length)];
    const localTrait =
      localPersona.traits[Math.floor(rng() * localPersona.traits.length)];
    const personality = `${temperament.adj}, ${social.phrase}; a ${cohort.locality} character — ${localFlavor}.`;
    const personalityTraits = Array.from(
      new Set([temperament.tag, social.tag, localTrait])
    );

    return {
      name: `${first} ${last}`,
      age,
      gender: rng() < 0.48 ? "female" : rng() < 0.97 ? "male" : "nonbinary",
      occupation,
      incomeBand:
        cohort.segment === "budget"
          ? "₹25k–60k/mo"
          : cohort.segment === "middle"
            ? "₹60k–2L/mo"
            : cohort.segment === "affluent"
              ? "₹2L–8L/mo"
              : "₹8L+/mo",
      intent,
      wtp,
      channelPref: channels[Math.floor(rng() * channels.length)],
      platforms: platformSets[Math.floor(rng() * platformSets.length)],
      objection: objections[Math.floor(rng() * objections.length)],
      quote: quotes[Math.floor(rng() * quotes.length)],
      lifestyle,
      lifeStage,
      values,
      shoppingHabits: HABITS[Math.floor(rng() * HABITS.length)],
      priceSensitivity,
      reasoning,
      personality,
      personalityTraits,
    };
  });

  const meanIntent =
    personas.reduce((s, p) => s + p.intent, 0) / personas.length;
  return {
    summary: `${cohort.label}: mean intent ${meanIntent.toFixed(2)}, WTP clusters ${currency} ${Math.round(wtpLo * fx * buyFactor / 1000)}k–${Math.round(wtpHi * fx * buyFactor / 1000)}k. ${
      meanIntent > 0.3 ? "Warm cohort — convertible with proof of quality." : "Cool cohort — needs trust-building before conversion."
    }`,
    personas,
  };
}

// ---------------------------------------------------------------------------
// Entangler mock: derive edges mechanically from ACTUAL shared entities, so
// the orchestrator's verification always passes; synthesis desks by round.
// ---------------------------------------------------------------------------

export function mockEntanglerV2(
  blocks: { id: string; name: string; domain?: string; conclusions: Conclusion[] }[],
  round: number
): EntanglerOutput {
  if (round === 1) {
    const edges: EntanglerOutput["edges"] = [];
    for (let i = 0; i < blocks.length && edges.length < 6; i++) {
      for (let j = i + 1; j < blocks.length && edges.length < 6; j++) {
        const a = new Set(blocks[i].conclusions.flatMap((c) => c.entities));
        const shared = blocks[j].conclusions
          .flatMap((c) => c.entities)
          .find((e) => a.has(e));
        if (shared) {
          edges.push({
            fromBlockId: blocks[i].id,
            toBlockId: blocks[j].id,
            trigger: "shared_entity",
            reason: `both concluded on "${shared}"`,
          });
        }
      }
    }
    const byDomain = (d: string[]) =>
      blocks.filter((b) => d.includes(b.domain ?? "")).map((b) => b.id);
    const synthesisBlocks: EntanglerOutput["synthesisBlocks"] = [];
    const gtmInputs = byDomain(["market", "channel", "audience"]).slice(0, 5);
    if (gtmInputs.length >= 2) {
      synthesisBlocks.push({
        name: "Go-To-Market Plan",
        mission:
          "Reconcile market demand, channel economics and the simulated audience's channel preferences into a sequenced 18-month go-to-market: which city, which channel first, when to export.",
        inputBlockIds: gtmInputs,
        domain: "synthesis",
      });
    }
    const priceInputs = byDomain(["pricing", "competitor", "audience", "regulation"]).slice(0, 5);
    if (priceInputs.length >= 2) {
      synthesisBlocks.push({
        name: "Pricing Strategy",
        mission:
          "Set price architecture from landed-cost math, competitor price ladders and the audience's willingness-to-pay percentiles, per market (India, Dubai, London).",
        inputBlockIds: priceInputs,
        domain: "synthesis",
      });
    }
    const socialInputs = byDomain(["social", "audience"]).slice(0, 4);
    if (socialInputs.length >= 2) {
      synthesisBlocks.push({
        name: "Social Playbook",
        mission:
          "Combine the social landscape with the audience's platform-by-segment matrix into a platform/content/creator plan with budget split.",
        inputBlockIds: socialInputs,
        domain: "synthesis",
      });
    }
    return { edges, synthesisBlocks };
  }
  if (round === 2) {
    const synthIds = blocks
      .filter((b) => (b.domain ?? "") === "synthesis")
      .map((b) => b.id);
    if (synthIds.length >= 2) {
      return {
        edges: [],
        synthesisBlocks: [
          {
            name: "Launch Roadmap",
            mission:
              "Merge the GTM plan, pricing strategy and social playbook into one sequenced launch roadmap with capital allocation and the three riskiest assumptions to test first.",
            inputBlockIds: synthIds.slice(0, 4),
            domain: "synthesis",
          },
        ],
      };
    }
  }
  return { edges: [], synthesisBlocks: [] };
}

// Synthesis desk outputs (keyed names used by mockEntanglerV2)
deskOutputs["Go-To-Market Plan"] = {
  logs: [
    "weighing mumbai vs delhi as launch city",
    "ranking channels by audience preference x margin",
    "sequencing india launch -> dubai export",
  ],
  conclusions: [
    {
      claim: "Launch Mumbai D2C + 2 shop-in-shops; export Dubai in month 9",
      value:
        "Audience channel data + dept-store economics favor: Mumbai D2C site + Instagram shop month 1, two shop-in-shops month 4, Dubai via curated marketplace month 9, London month 15.",
      confidence: 0.6,
      entities: ["mumbai", "dubai", "d2c website", "shop-in-shop", "marketplace"],
      sources: ["simulation:audience", "llm:knowledge"],
    },
  ],
};
deskOutputs["Pricing Strategy"] = {
  logs: [
    "anchoring on audience wtp p50 by segment",
    "stacking landed cost + duty per market",
    "checking competitor ladder fit",
  ],
  conclusions: [
    {
      claim: "Hero dining table at ₹98k India / ₹2.1L-equivalent Dubai",
      value:
        "Affluent-consumer WTP P50 supports ₹95k–1.1L in India (the competitor gap); Dubai at 1.8x landed clears margin incl. marketplace commission; London needs the 0-duty FTA paperwork to work.",
      confidence: 0.55,
      entities: ["pricing", "landed cost", "dubai", "london", "premium"],
      sources: ["simulation:audience", "https://example-mock.search/container-rates"],
    },
  ],
};
deskOutputs["Social Playbook"] = {
  logs: [
    "crossing platform matrix with segment value",
    "allocating budget across instagram/pinterest/youtube",
    "designing designer-seeding program",
  ],
  conclusions: [
    {
      claim: "60/25/15 budget: Instagram reels / Pinterest / YouTube long-form",
      value:
        "Affluent+luxury cohorts cluster on Instagram & Pinterest; seed 25 interior designers (the influencer cohorts' #1 ask: trade discount + one styled piece) before any paid spend.",
      confidence: 0.6,
      entities: ["instagram", "pinterest", "youtube", "interior designers", "social"],
      sources: ["simulation:audience"],
    },
  ],
};
deskOutputs["Launch Roadmap"] = {
  logs: [
    "merging gtm, pricing and social into one sequence",
    "allocating capital by phase",
    "flagging riskiest assumptions",
  ],
  conclusions: [
    {
      claim: "18-month roadmap, ₹20L split 40/30/30; test 3 assumptions first",
      value:
        "Phase capital 40% product+certs, 30% Mumbai launch, 30% export. Riskiest assumptions: (1) WTP at ₹98k holds offline, (2) VRIKSH cert in <90 days, (3) designer seeding converts at modeled rate.",
      confidence: 0.55,
      entities: ["roadmap", "capital", "certification", "mumbai", "export"],
      sources: ["simulation:audience", "llm:knowledge"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Audience synthesis mock: real numbers from the actual aggregate.
// ---------------------------------------------------------------------------

export function mockAudienceSynth(agg: AudienceAggregate): ExecutorOutput {
  const segs = Object.entries(agg.bySegment).sort(
    (a, b) => b[1].meanIntent - a[1].meanIntent
  );
  const topSeg = segs[0];
  const topChannel = agg.channelShare[0];
  const topPlatform = agg.platformShare[0];
  const topObjection = agg.topObjections[0];
  return {
    logs: [
      `aggregating ${agg.totalPersonas} personas / ${agg.totalCohorts} cohorts`,
      "ranking segments by mean intent",
      "computing wtp percentiles per segment",
      "building platform x segment matrix",
    ],
    conclusions: [
      {
        claim: `"${topSeg?.[0]}" converts best: mean intent ${topSeg?.[1].meanIntent}`,
        value: `Across ${agg.totalPersonas} simulated personas, ${topSeg?.[0]} leads with mean intent ${topSeg?.[1].meanIntent} and WTP P50 ₹${topSeg?.[1].wtpP50.toLocaleString()}. Segment ranking: ${segs.map(([k, v]) => `${k} ${v.meanIntent}`).join(", ")}.`,
        confidence: 0.7,
        entities: [topSeg?.[0] ?? "affluent", "premium", "wtp"],
        sources: ["simulation:audience"],
      },
      {
        claim: `Top channel: ${topChannel?.name} (${topChannel?.share}% preference)`,
        value: `Channel preference across all roles: ${agg.channelShare.slice(0, 4).map((c) => `${c.name} ${c.share}%`).join(", ")}.`,
        confidence: 0.65,
        entities: [topChannel?.name ?? "d2c website", "marketplace", "retail"],
        sources: ["simulation:audience"],
      },
      {
        claim: `${topPlatform?.name} is the discovery platform (${topPlatform?.share}%)`,
        value: `Platform share: ${agg.platformShare.slice(0, 4).map((p) => `${p.name} ${p.share}%`).join(", ")}. Affluent/luxury skew hardest to instagram+pinterest.`,
        confidence: 0.65,
        entities: [topPlatform?.name ?? "instagram", "social", "discovery"],
        sources: ["simulation:audience"],
      },
      {
        claim: `#1 objection: "${topObjection?.text ?? "price"}"`,
        value: `Objection frequency: ${agg.topObjections.slice(0, 3).map((o) => `"${o.text}" (${o.count})`).join("; ")}. Defuse in PDP + first campaign.`,
        confidence: 0.7,
        entities: ["objection", "trust", "pricing"],
        sources: ["simulation:audience"],
      },
    ],
  };
}

export const mockQueryOutput: QueryOutput = {
  answer:
    "Mock answer: launch Mumbai-first via D2C + shop-in-shop, price the hero table at ₹98k (audience WTP P50 supports it), and export to Dubai through a curated marketplace in month 9 once VRIKSH certification clears.",
  citedConclusionIds: [],
};

export function mockAudienceChatOutput(
  mode: AudienceChatMode,
  personas: Persona[],
  question: string
): AudienceChatOutput {
  const selected = personas.slice(0, mode === "group" ? 5 : 1);
  const hasUsp = /\b(usp|guarantee|free|certified|quality|delivery|warranty|discount|exclusive)\b/i.test(
    question
  );
  return {
    messages: selected.map((p) => {
      const lift = hasUsp ? 0.16 : 0.06;
      const intentAfter = Math.min(1, p.intent + lift);
      return {
        role: "customer",
        speaker: p.name,
        personaId: p.id,
        content:
          mode === "group"
            ? `On "${question}", I would listen, but my hesitation is still ${p.objection.toLowerCase()}. Show me proof that fits how I buy through ${p.channelPref}.`
            : `I hear the pitch. For me, the key issue is ${p.objection.toLowerCase()}; if your USP proves that directly, I could move from curious to seriously considering it.`,
        intentAfter,
        objection: p.objection,
      };
    }),
    summary:
      mode === "group"
        ? "Mock group read: the room wants concrete proof before the USP changes behaviour."
        : "Mock customer read: the USP helps only if it addresses this persona's main objection.",
    nextMove: "Lead with one proof point, one price/offer detail, and one trust signal.",
  };
}

// Owner Dashboard › Brand & Social Action Plan fixture (Jodhpur teak brand).
// Mirrors the real callBrandKit output so the whole feature works offline.
export const mockBrandKit: BrandKit = {
  comparableAccounts: [
    {
      id: "gulmohar-lane",
      name: "Gulmohar Lane",
      platform: "Instagram",
      handle: "@gulmoharlane",
      url: "https://www.instagram.com/gulmoharlane/",
      followers: "180k",
      grounded: true,
      whyRelevant:
        "Premium Indian furniture brand selling a heritage-meets-modern story to the same affluent metro buyer.",
      whatToEmulate:
        "Styled room sets shot in real homes; carousel 'how to style' posts that turn a single piece into a mood.",
      source: "https://www.instagram.com/gulmoharlane/",
    },
    {
      id: "the-wooden-street",
      name: "WoodenStreet",
      platform: "Instagram",
      handle: "@woodenstreet",
      url: "https://www.instagram.com/woodenstreet/",
      followers: "420k",
      grounded: true,
      whyRelevant:
        "Mass-premium solid-wood competitor — shows the price/volume floor you must differentiate above.",
      whatToEmulate:
        "High-cadence reels on craftsmanship + festival-sale urgency; UGC reposts of delivered pieces.",
      source: "https://www.instagram.com/woodenstreet/",
    },
    {
      id: "house-of-things",
      name: "House of Things",
      platform: "Instagram",
      handle: "@houseofthings",
      url: "https://www.instagram.com/houseofthings/",
      followers: "95k",
      grounded: true,
      whyRelevant:
        "Curated luxury-decor marketplace — the aspirational tier your export (Dubai/London) buyer follows.",
      whatToEmulate:
        "Designer-collab drops and editorial captions that frame price as provenance, not cost.",
      source: "https://www.instagram.com/houseofthings/",
    },
    {
      id: "jaipur-rugs",
      name: "Jaipur Rugs",
      platform: "Instagram",
      handle: "@jaipurrugs",
      url: "https://www.instagram.com/jaipurrugs/",
      followers: "210k",
      grounded: true,
      whyRelevant:
        "Indian craft heritage scaled to a global premium audience — the export narrative you want to own.",
      whatToEmulate:
        "Artisan-led storytelling: name the maker, show the hands, sell the lineage.",
      source: "https://www.instagram.com/jaipurrugs/",
    },
    {
      id: "interior-design-creators-in",
      name: "Indian interior-design creators",
      platform: "YouTube",
      handle: "@interior-creators",
      url: null,
      followers: null,
      grounded: false,
      whyRelevant:
        "Mid-tier home-tour creators drive consideration for big-ticket furniture among metro homeowners.",
      whatToEmulate:
        "Long-form room makeovers featuring a hero piece; gift a table for an honest 'living with it' review.",
      source: null,
    },
    {
      id: "dubai-home-decor-pages",
      name: "Dubai home-decor pages",
      platform: "Instagram",
      handle: "@dubai-decor",
      url: null,
      followers: null,
      grounded: false,
      whyRelevant:
        "Local taste-makers in your export corridor; partnering early seeds the Dubai launch.",
      whatToEmulate:
        "Region-specific styling (majlis seating, warm woods) and AED pricing transparency.",
      source: null,
    },
  ],
  brandIdentity: {
    voice:
      "Warm, confident, maker-proud. Speaks about wood, hands and time — never 'cheap' or 'discount'.",
    positioning:
      "Heritage Jodhpur teak, built for the modern metro home — the considered piece between mass online furniture and bespoke ateliers.",
    visualCodes: [
      "Warm desert-and-teak palette: sand, ochre, deep brown",
      "Natural light, real homes, lived-in styling (no sterile studio)",
      "A serif wordmark paired with clean sans body type",
      "Always show grain texture and joinery close-ups",
    ],
    namingCues: [
      "Name collections after Rajasthani places/motifs (Mehrangarh, Marwar)",
      "Talk in 'pieces' and 'makers', not 'SKUs' and 'units'",
    ],
    doList: [
      "Credit the artisan and the wood source in product stories",
      "Show scale and styling so buyers picture it at home",
      "Lead with provenance before price",
    ],
    dontList: [
      "Don't run permanent discounts — it breaks the premium cue",
      "Don't use stocky studio renders instead of real photography",
      "Don't chase trends that clash with the heritage story",
    ],
  },
  socialGuidelines: {
    contentPillars: [
      "Craft & makers (behind the workshop)",
      "Styled in real homes (room sets)",
      "Heritage & material story (teak, Jodhpur)",
      "Buyer education (care, longevity, value)",
    ],
    platformPlan: [
      {
        platform: "Instagram",
        segment: "affluent metro homeowners",
        cadence: "4–5 posts/week, 3 reels",
        formats: ["Styled carousels", "Maker reels", "Home-tour collabs"],
        notes:
          "Primary channel. Benchmark CAC ₹400–800 per add-to-cart at this price tier; reels drive cheapest reach.",
      },
      {
        platform: "Pinterest",
        segment: "planners in research mode",
        cadence: "10–15 pins/week",
        formats: ["Room boards", "Shoppable pins"],
        notes: "Long-tail discovery; pin every styled shot to themed boards.",
      },
      {
        platform: "YouTube",
        segment: "high-intent big-ticket buyers",
        cadence: "1–2/month via creators",
        formats: ["Home makeovers", "Craft documentaries"],
        notes: "Gifting + paid integrations with home-tour creators.",
      },
    ],
  },
  checklist: [
    {
      id: "set-up-instagram-business",
      category: "Setup",
      title: "Set up an Instagram Business profile",
      detail: "Add shop catalog, link-in-bio, and a clear bio with the positioning line.",
      priority: "now",
    },
    {
      id: "create-pinterest-business",
      category: "Setup",
      title: "Create a Pinterest Business account",
      detail: "Claim the domain and enable rich/shoppable pins.",
      priority: "soon",
    },
    {
      id: "lock-visual-palette",
      category: "Brand",
      title: "Lock the visual palette & wordmark",
      detail: "Sand/ochre/teak palette + serif wordmark; save as a 1-page brand sheet.",
      priority: "now",
    },
    {
      id: "write-brand-voice-guide",
      category: "Brand",
      title: "Write a one-page voice guide",
      detail: "Do/don't list so every caption sounds maker-proud, never discount-y.",
      priority: "soon",
    },
    {
      id: "shoot-styled-room-sets",
      category: "Content",
      title: "Shoot 3 styled room sets in a real home",
      detail: "Hero table + supporting pieces, natural light, grain close-ups.",
      priority: "now",
    },
    {
      id: "build-content-calendar",
      category: "Content",
      title: "Build a 4-week content calendar",
      detail: "Rotate the 4 pillars; 3 reels/week from the room-set shoot.",
      priority: "soon",
    },
    {
      id: "film-maker-reel",
      category: "Content",
      title: "Film one workshop/maker reel",
      detail: "Show the hands and joinery — your strongest differentiator vs mass brands.",
      priority: "soon",
    },
    {
      id: "set-up-pinterest-boards",
      category: "Growth",
      title: "Create themed Pinterest boards",
      detail: "Pin every styled shot; one board per collection/room type.",
      priority: "later",
    },
    {
      id: "run-reels-reach-test",
      category: "Growth",
      title: "Run a ₹5k reels reach test",
      detail: "Promote your 2 best reels to Mumbai/Delhi affluent homeowners; watch CAC.",
      priority: "soon",
    },
    {
      id: "shortlist-home-tour-creators",
      category: "Outreach",
      title: "Shortlist 5 home-tour creators",
      detail: "Mid-tier Indian interior YouTubers; draft a gifting + review offer.",
      priority: "soon",
    },
    {
      id: "seed-dubai-decor-pages",
      category: "Outreach",
      title: "Reach out to 3 Dubai decor pages",
      detail: "Seed the export corridor before the month-9 Dubai launch.",
      priority: "later",
    },
  ],
};

// Owner Dashboard › Inspiration fixture (Jodhpur teak brand). Mock mode skips
// link verification, so these render directly. YouTube ids are well-known
// stable videos purely so the embeds display offline.
export const mockInspiration: InspirationKit = {
  videoExamples: [
    {
      id: "craft-storytelling-furniture",
      title: "How a heritage furniture brand tells its craft story",
      channel: "Brand Films",
      youtubeId: "aqz-KE-bpKQ",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      whyRelevant:
        "Shows the maker-led narrative arc that sells premium provenance over price.",
      takeaway:
        "Open on the hands and the wood grain in the first 2 seconds — lead with craft, not the product shot.",
    },
    {
      id: "founder-story-format",
      title: "Founder story: building a premium home brand",
      channel: "Startup Stories",
      youtubeId: "ScMzIvxBSi4",
      url: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
      whyRelevant:
        "A founder-led trust format that works for big-ticket, considered purchases.",
      takeaway:
        "Keep it under 90s, one clear 'why we exist' line, end on the hero piece in a real home.",
    },
    {
      id: "room-makeover-reel",
      title: "Room makeover featuring one statement piece",
      channel: "Interior Tours",
      youtubeId: "9bZkp7q19f0",
      url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      whyRelevant:
        "Demonstrates the styled-in-a-real-home format that drives furniture consideration.",
      takeaway:
        "Anchor the whole video on a single hero table; show before/after with the piece as the turn.",
    },
  ],
  placementExamples: [
    {
      id: "hero-shot",
      pattern: "Hero shot",
      account: "House of Things",
      accountUrl: "https://www.instagram.com/houseofthings/",
      platform: "Instagram",
      recipe:
        "Single piece, clean backdrop, natural light from one side, grain texture sharp. No clutter.",
      whyItWorks:
        "Frames the product as an object of desire and justifies the price.",
    },
    {
      id: "in-context-lifestyle",
      pattern: "In-context lifestyle",
      account: "Gulmohar Lane",
      accountUrl: "https://www.instagram.com/gulmoharlane/",
      platform: "Instagram",
      recipe:
        "Style the piece in a lived-in room with plants, books, soft textiles; shoot at eye level.",
      whyItWorks:
        "Lets the buyer picture it in their own home, which closes considered purchases.",
    },
    {
      id: "maker-flat-lay",
      pattern: "Process / maker flat-lay",
      account: "Jaipur Rugs",
      accountUrl: "https://www.instagram.com/jaipurrugs/",
      platform: "Instagram",
      recipe:
        "Top-down of tools, raw teak, and the half-finished joint; warm tones, hands in frame.",
      whyItWorks:
        "Proves the craft and the lineage — the core premium differentiator.",
    },
  ],
  successStories: [
    {
      id: "pepperfry-content-commerce",
      brand: "Pepperfry",
      platform: "Instagram / YouTube",
      summary:
        "Indian furniture marketplace that leaned on styled room content and studios to drive online furniture confidence.",
      theMove:
        "Pair shoppable styled-room content online with offline 'Studio' touchpoints to de-risk big-ticket buys.",
      result: "Became one of India's largest online furniture brands.",
      sourceUrl: "https://en.wikipedia.org/wiki/Pepperfry",
    },
    {
      id: "jaipur-rugs-artisan-story",
      brand: "Jaipur Rugs",
      platform: "Instagram",
      summary:
        "Built a global premium audience by foregrounding individual artisans and craft heritage.",
      theMove:
        "Name and feature the maker in every story; sell provenance, not discounts.",
      result: "Global premium positioning and a recognizable craft-led brand.",
      sourceUrl: "https://en.wikipedia.org/wiki/Jaipur_Rugs",
    },
  ],
};

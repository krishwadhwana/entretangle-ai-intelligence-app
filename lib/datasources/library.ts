import type { StructuredData } from "./structured";

// ---------------------------------------------------------------------------
// Curated industry dataset library (option B, built-in). A small registry of
// real, defensible per-industry reference figures + named sources, injected as
// ground truth for every desk based on the venture's classified `libraryKey`.
// This is the offline, always-available real-data channel: no network, no key.
//
// Figures are deliberately given as ranges/approximations with the SOURCE named
// so a desk treats them as a grounded prior and can refine with live search.
// Keep entries factual and source-attributed; update as data ages.
// ---------------------------------------------------------------------------

type LibraryEntry = { text: string; sources: string[] };

const LIBRARY: Record<string, LibraryEntry> = {
  apparel: {
    text: `Apparel & fashion reference priors:
- India is among the world's largest textile/apparel producers; key apparel
  manufacturing clusters: Tiruppur (knits), Ludhiana (woollens/knits), Delhi-
  NCR & Noida (woven/fashion), Bengaluru (woven exports), Surat (synthetics &
  fabric). Tiruppur alone drives the bulk of India's knitwear exports.
- Typical small-brand manufacturing MOQs: 50–300 pcs/style at job-work units,
  often 100+ for cut-make-trim with fabric sourced separately; sampling 2–4
  weeks, bulk production 4–8 weeks.
- D2C apparel in India sees high RETURNS/RTO: commonly 20–40% for online
  fashion (size/fit driven), materially higher than most categories.
- GST on apparel: 5% under ₹1,000 MRP, 12% above (India) — verify current.
- Online fashion in India is dominated by Myntra, Ajio, Flipkart, Amazon;
  Nykaa Fashion at the premium end.`,
    sources: [
      "Tiruppur Exporters' Association",
      "Apparel Export Promotion Council (AEPC)",
      "Ministry of Textiles, India",
    ],
  },
  footwear: {
    text: `Footwear reference priors:
- India footwear manufacturing hubs: Agra (leather), Kanpur (leather), Chennai/
  Ambur (leather exports), Bahadurgarh & Delhi-NCR (non-leather/sports).
- MOQs at established units commonly 500–1,200 pairs/style; sampling 3–6 weeks.
- Sizing/fit drives returns similar to apparel; bracketing inventory across the
  size curve ties working capital.`,
    sources: ["Council for Leather Exports (CLE), India"],
  },
  furniture: {
    text: `Furniture reference priors:
- Indian craft-furniture clusters: Jodhpur & Saharanpur (wood), Jaipur, Channapatna.
  Jodhpur is a major handmade/“sheesham/mango/recycled-wood” export hub.
- Solid-wood job-work MOQs commonly 20–50 units/design; own-unit economics only
  beat job-work past sustained ~150 units/month. Sampling 3–5 weeks, production
  6–10 weeks for solid wood.
- Bulky-goods D2C: damage/return on uninsured last-mile commonly 8–14%; furniture
  3PL + white-glove cuts it to 3–5% at higher cost.
- India online furniture led by Pepperfry, Urban Ladder (Reliance), Wakefit,
  IKEA; premium/craft via Jaypore, Fabindia, boutiques.`,
    sources: [
      "Export Promotion Council for Handicrafts (EPCH)",
      "Jodhpur Handicraft industry bodies",
    ],
  },
  food_beverage: {
    text: `Food & beverage reference priors:
- India regulator is FSSAI; licence required (registration/state/central by
  turnover & scale), plus labelling norms (veg/non-veg mark, nutrition).
- Packaged-food MOQs depend on co-packers; private-label runs often start a few
  thousand units. Cold-chain & shelf-life drive operations and wastage.
- Quick-commerce (Blinkit, Zepto, Swiggy Instamart) reshapes urban FMCG demand;
  listing terms and fill-rate penalties matter.`,
    sources: ["FSSAI (fssai.gov.in)", "APEDA for agri exports"],
  },
  beauty: {
    text: `Beauty & personal care reference priors:
- India cosmetics regulated by CDSCO (import registration for cosmetics) plus
  BIS/labelling; "ayurvedic" claims fall under AYUSH rules.
- Contract manufacturers (e.g. in Baddi HP, Daman, Gujarat) run private label;
  MOQs often 1,000–5,000 units/SKU. Nykaa dominates beauty e-commerce.`,
    sources: ["CDSCO (cdsco.gov.in)", "Nykaa market reports"],
  },
  electronics: {
    text: `Consumer electronics reference priors:
- Import-heavy components; BIS compulsory registration (CRS) for many devices.
  GST commonly 18%. Assembly/PLI incentives in India for some categories.
- MOQs from OEM/ODM (often China/Vietnam) typically high (1k+); long lead times
  and FX/duty exposure dominate landed cost.`,
    sources: ["BIS CRS (bis.gov.in)", "MeitY"],
  },
  jewellery: {
    text: `Jewellery reference priors:
- India hubs: Mumbai (SEEPZ), Surat (diamond cutting), Jaipur (gemstones/
  kundan), Rajkot. Hallmarking (BIS) mandatory for gold.
- High working capital (metal value); consignment & memo common in trade.`,
    sources: ["GJEPC (Gem & Jewellery Export Promotion Council)", "BIS hallmarking"],
  },
  home_decor: {
    text: `Home decor & handicrafts reference priors:
- Clusters: Moradabad (metal), Jaipur (blue pottery/textiles), Jodhpur (wood),
  Firozabad (glass), Bhadohi (rugs). Strong export base via EPCH.
- Small-batch friendly (artisan job-work); quality consistency and packaging
  for fragile goods are the key risks.`,
    sources: ["EPCH", "Ministry of Textiles (Handicrafts)"],
  },
  services: {
    text: `Services reference priors:
- No HS/trade or manufacturing; economics are CAC/LTV, utilisation, and local
  density of demand. Regulation is sector-specific (e.g. licences, GST on
  services commonly 18% in India).`,
    sources: ["Sector-specific Indian regulators"],
  },
  general: {
    text: `General reference priors:
- For physical goods, expect manufacturing MOQs, sampling + production lead
  times, working-capital tied in inventory, and returns to dominate operations.
- Verify category-specific regulation (GST/duty, labelling, certifications).`,
    sources: [],
  },
};

/** Curated industry reference data for a libraryKey, or null. */
export function getIndustryLibrary(libraryKey: string): StructuredData | null {
  const entry = LIBRARY[libraryKey] ?? LIBRARY.general;
  if (!entry) return null;
  return { text: entry.text, sources: entry.sources };
}

/** Render the curated industry library as a labelled ground-truth section. */
export function formatLibrary(sd: StructuredData): string {
  return `INDUSTRY REFERENCE DATA (curated real priors — treat as grounded
context; refine with live search where a desk needs current specifics):
${sd.text}
Sources: ${sd.sources.length ? sd.sources.join(", ") : "industry bodies"}
END INDUSTRY REFERENCE DATA.`;
}

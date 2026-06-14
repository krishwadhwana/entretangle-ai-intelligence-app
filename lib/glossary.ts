// A small glossary of the business / retail / finance jargon the research desks
// and synthesis tend to emit (e.g. "use size curves to cap dead stock"). The
// UI underlines any of these terms wherever report prose is rendered and shows
// the plain-English definition on hover — see components/GlossaryText.tsx.
//
// `term` plus `aliases` are all the surface forms we match (case-insensitive,
// on word boundaries). The matched text is rendered verbatim, so we don't need
// to worry about casing/pluralisation in the display. Entries with an `href`
// also become a clickable "learn more" link.

export type GlossaryEntry = {
  /** Primary surface form to match. */
  term: string;
  /** Plain-English, founder-facing definition. */
  definition: string;
  /** Optional external explainer — makes the term a hyperlink, not just a tooltip. */
  href?: string;
  /** Other forms to match (plurals, acronyms, spellings). */
  aliases?: string[];
};

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "size curve",
    aliases: ["size curves", "size run", "size runs"],
    definition:
      "The mix of sizes you stock for a style — how many XS/S/M/L/XL etc. — set to match real demand so you don't over-buy sizes that won't sell.",
    href: "https://www.google.com/search?q=size+curve+retail+inventory+planning",
  },
  {
    term: "dead stock",
    aliases: ["deadstock"],
    definition:
      "Inventory that isn't selling and probably won't, tying up cash and shelf space until it's marked down or written off.",
  },
  {
    term: "MOQ",
    aliases: ["minimum order quantity", "minimum order quantities"],
    definition:
      "Minimum order quantity — the smallest amount a supplier will produce or sell in a single order.",
  },
  {
    term: "RTO",
    aliases: ["return to origin", "return-to-origin"],
    definition:
      "Return to origin — an order that ships but is refused or undelivered and travels back to you, so you eat the round-trip shipping with no sale.",
  },
  {
    term: "landed cost",
    definition:
      "The all-in cost of a product once it reaches you — factory price plus shipping, duties, taxes and handling.",
  },
  {
    term: "unit economics",
    definition:
      "The revenue and costs of a single unit or customer, used to check whether each sale actually makes money.",
  },
  {
    term: "contribution margin",
    definition:
      "What's left from a sale after variable costs — the amount available to cover fixed costs and profit.",
    href: "https://www.investopedia.com/terms/c/contributionmargin.asp",
  },
  {
    term: "gross margin",
    aliases: ["gross margins"],
    definition:
      "The share of revenue left after the direct cost of making the goods (COGS).",
    href: "https://www.investopedia.com/terms/g/grossmargin.asp",
  },
  {
    term: "working capital",
    definition:
      "The cash tied up in day-to-day operations — roughly inventory plus money owed to you, minus money you owe suppliers.",
    href: "https://www.investopedia.com/terms/w/workingcapital.asp",
  },
  {
    term: "runway",
    definition:
      "How many months you can keep operating before cash runs out at the current burn rate.",
  },
  {
    term: "WTP",
    aliases: ["willingness to pay", "willingness-to-pay"],
    definition:
      "Willingness to pay — the most a customer would pay for your product before walking away.",
  },
  {
    term: "D2C",
    aliases: ["DTC", "direct-to-consumer", "direct to consumer"],
    definition:
      "Direct-to-consumer — selling straight to shoppers (your own site or store) instead of through retailers or marketplaces.",
  },
  {
    term: "CAC",
    aliases: ["customer acquisition cost"],
    definition:
      "Customer acquisition cost — the average marketing and sales spend it takes to win one new customer.",
    href: "https://www.investopedia.com/terms/c/customer-acquisition-cost.asp",
  },
  {
    term: "LTV",
    aliases: ["lifetime value", "customer lifetime value", "CLV"],
    definition:
      "Lifetime value — the total profit you expect from a customer over the whole relationship.",
  },
  {
    term: "AOV",
    aliases: ["average order value"],
    definition:
      "Average order value — the average amount a customer spends per order.",
  },
  {
    term: "SKU",
    aliases: ["SKUs"],
    definition:
      "Stock-keeping unit — one specific variant (a size/colour combination) that you track and stock individually.",
    href: "https://www.investopedia.com/terms/s/stock-keeping-unit-sku.asp",
  },
  {
    term: "sell-through",
    aliases: ["sell through", "sell-through rate"],
    definition:
      "The percentage of received stock that sells in a period — high sell-through means demand is keeping up with how much you bought.",
  },
  {
    term: "GMV",
    aliases: ["gross merchandise value"],
    definition:
      "Gross merchandise value — the total value of goods sold through your platform before fees and costs.",
    href: "https://www.investopedia.com/terms/g/gross-merchandise-value.asp",
  },
  {
    term: "inventory turnover",
    aliases: ["inventory turns", "stock turn", "stock turns", "inventory turn"],
    definition:
      "How many times you sell and replace your stock in a period — higher means less cash sitting in unsold inventory.",
    href: "https://www.investopedia.com/terms/i/inventoryturnover.asp",
  },
  {
    term: "lead time",
    aliases: ["lead times"],
    definition:
      "The time between placing a production or restock order and having the goods ready to sell.",
  },
  {
    term: "markdown",
    aliases: ["markdowns"],
    definition:
      "A cut from the original price, usually to clear slow-moving or dead stock.",
  },
  {
    term: "price band",
    aliases: ["price bands"],
    definition:
      "The price range your product sits in relative to the market — e.g. budget, mid, premium or luxury.",
  },
];

// Index every surface form → its entry, for O(1) lookup of a matched token.
const ENTRY_BY_FORM = new Map<string, GlossaryEntry>();
for (const entry of GLOSSARY) {
  for (const form of [entry.term, ...(entry.aliases ?? [])]) {
    ENTRY_BY_FORM.set(form.toLowerCase(), entry);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest forms first so "landed cost" wins over a bare "cost", "size curves"
// over "size", etc.
const ALL_FORMS = [...ENTRY_BY_FORM.keys()].sort((a, b) => b.length - a.length);
const MATCH_RE = new RegExp(
  `\\b(${ALL_FORMS.map(escapeRegExp).join("|")})\\b`,
  "gi"
);

export type GlossaryToken = { text: string; entry?: GlossaryEntry };

/**
 * Split prose into a flat list of tokens, flagging the ones that are known
 * glossary terms. Non-matching runs come back as plain `{ text }`.
 */
export function tokenizeGlossary(text: string): GlossaryToken[] {
  const out: GlossaryToken[] = [];
  let last = 0;
  MATCH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATCH_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], entry: ENTRY_BY_FORM.get(m[0].toLowerCase()) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

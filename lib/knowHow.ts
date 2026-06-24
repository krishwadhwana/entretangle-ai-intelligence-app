import type { Domain } from "@/lib/schema";

export type KnowHowModuleKey =
  | "strategy"
  | "financials"
  | "launch"
  | "audience"
  | "market"
  | "supply-ops"
  | "channel"
  | "product-regulation";

export type KnowHowTool =
  | "financials"
  | "launch"
  | "audience"
  | "playbook"
  | "qa";

export type KnowHowTask = {
  id: string;
  title: string;
  detail: string;
};

export type KnowHowModule = {
  key: KnowHowModuleKey;
  title: string;
  blurb: string;
  decision: string;
  needToKnow: string[];
  tasks: KnowHowTask[];
  tool: KnowHowTool;
  askSubject: string;
  domains: Domain[];
};

export const ALL_KNOW_HOW_DOMAINS: Domain[] = [
  "market",
  "competitor",
  "product",
  "supply",
  "operations",
  "channel",
  "regulation",
  "pricing",
  "finance",
  "social",
  "audience",
  "synthesis",
];

export const KNOW_HOW_MODULES: KnowHowModule[] = [
  {
    key: "strategy",
    title: "Strategy control room",
    blurb:
      "Turn the run into the operating thesis: what to do first, what must be proven, and what could break the business.",
    decision:
      "Which path should the founder act on next, and what evidence would change that path?",
    needToKnow: [
      "The strongest buying trigger and the biggest adoption blocker.",
      "The first market, segment, and channel to test before scaling.",
      "The riskiest assumption that needs a real-world proof point.",
    ],
    tasks: [
      {
        id: "write-one-page-operating-thesis",
        title: "Write the one-page operating thesis",
        detail:
          "Summarise target buyer, offer, channel, price logic, and the next proof needed.",
      },
      {
        id: "pick-first-validation-metric",
        title: "Pick the first validation metric",
        detail:
          "Choose one metric that decides whether the next two weeks worked: leads, orders, CAC, margin, or repeat intent.",
      },
      {
        id: "list-top-three-kill-risks",
        title: "List the top three kill risks",
        detail:
          "Write the three assumptions that could make the venture fail even if the product looks promising.",
      },
    ],
    tool: "playbook",
    askSubject: "this venture's overall strategy and world model",
    domains: ALL_KNOW_HOW_DOMAINS,
  },
  {
    key: "financials",
    title: "Unit economics & financials",
    blurb:
      "Work through price, landed cost, margin, CAC/LTV, break-even, runway, and cash pressure.",
    decision:
      "Can this business make money at the intended price and scale, and which number needs fixing first?",
    needToKnow: [
      "Gross margin by realistic price tier.",
      "Break-even units per month and runway at current fixed costs.",
      "CAC and refund sensitivity before ad spend is increased.",
    ],
    tasks: [
      {
        id: "build-financial-model",
        title: "Build the financial model",
        detail:
          "Generate the run-specific model, then check base price, margin, break-even, and runway.",
      },
      {
        id: "test-price-floor",
        title: "Test the price floor",
        detail:
          "Lower price until margin becomes unacceptable; note the minimum viable price.",
      },
      {
        id: "record-cash-risk",
        title: "Record the cash risk",
        detail:
          "Write the biggest working-capital or inventory cash constraint in the notes.",
      },
    ],
    tool: "financials",
    askSubject: "this business's financial model",
    domains: ["finance", "pricing"],
  },
  {
    key: "launch",
    title: "Launch trajectory",
    blurb:
      "Convert the research into a first-month launch plan: spend, orders, inventory, fulfilment, and cash movement.",
    decision:
      "What launch shape is realistic without running out of cash, stock, or trust?",
    needToKnow: [
      "First campaign budget and the expected order range.",
      "Inventory or fulfilment bottleneck before demand is created.",
      "The trigger that tells you to scale, pause, or change the offer.",
    ],
    tasks: [
      {
        id: "open-launch-simulator",
        title: "Open the launch simulator",
        detail:
          "Run one conservative and one aggressive launch scenario against this run.",
      },
      {
        id: "define-scale-stop-rules",
        title: "Define scale and stop rules",
        detail:
          "Write the CAC, conversion, or refund threshold that decides whether spend increases.",
      },
      {
        id: "check-operational-readiness",
        title: "Check operational readiness",
        detail:
          "Confirm stock, packaging, fulfilment, returns, and customer support before pushing traffic.",
      },
    ],
    tool: "launch",
    askSubject: "this launch simulation",
    domains: ["channel", "finance", "operations"],
  },
  {
    key: "audience",
    title: "Audience & demand",
    blurb:
      "Translate simulated buyers into who to sell to, what they care about, and what they will not tolerate.",
    decision:
      "Which audience segment is worth targeting first, and what exact promise will move them?",
    needToKnow: [
      "Highest-intent segment and locality or platform signal.",
      "Willingness-to-pay tension and the top objection.",
      "Language, proof, and offer details that reduce hesitation.",
    ],
    tasks: [
      {
        id: "choose-first-segment",
        title: "Choose the first segment",
        detail:
          "Pick the audience group with the best mix of intent, reach, and ability to pay.",
      },
      {
        id: "write-objection-replies",
        title: "Write objection replies",
        detail:
          "Turn the top three buyer objections into founder-ready response lines.",
      },
      {
        id: "save-audience-proof",
        title: "Save audience proof",
        detail:
          "Copy the strongest buyer quote or finding into notes for ads, website, or pitch use.",
      },
    ],
    tool: "audience",
    askSubject: "this venture's audience and demand",
    domains: ["audience", "market", "social"],
  },
  {
    key: "market",
    title: "Market & competition",
    blurb:
      "Understand the market shape, competitors, price anchors, whitespace, and where differentiation must be sharper.",
    decision:
      "Where is the opening in the market, and who must the founder benchmark against?",
    needToKnow: [
      "Named competitors and the price or positioning they occupy.",
      "The market segment that is reachable now, not just theoretically large.",
      "The gap this venture can credibly own.",
    ],
    tasks: [
      {
        id: "name-five-competitors",
        title: "Name five competitors",
        detail:
          "List direct, aspirational, and substitute competitors with one reason each.",
      },
      {
        id: "write-positioning-gap",
        title: "Write the positioning gap",
        detail:
          "State the specific market gap in one sentence using buyer language.",
      },
      {
        id: "collect-price-anchors",
        title: "Collect price anchors",
        detail:
          "Record low, middle, and premium competitor prices for the same buyer use case.",
      },
    ],
    tool: "playbook",
    askSubject: "this venture's market and competitive landscape",
    domains: ["market", "competitor", "pricing"],
  },
  {
    key: "supply-ops",
    title: "Supply & operations",
    blurb:
      "Work through sourcing, MOQ, sampling, packaging, fulfilment, returns, quality control, and operating constraints.",
    decision:
      "Can the business reliably deliver the promised product at the needed cost and quality?",
    needToKnow: [
      "Supplier, MOQ, sampling, and lead-time constraints.",
      "Fulfilment, returns, quality, and support risks.",
      "Which operating step must be solved before paid growth.",
    ],
    tasks: [
      {
        id: "map-supply-path",
        title: "Map the supply path",
        detail:
          "Write each step from sourcing to delivery, including who owns it and where delay can happen.",
      },
      {
        id: "confirm-moq-and-lead-time",
        title: "Confirm MOQ and lead time",
        detail:
          "Record the minimum order, sampling time, production time, and cash locked in stock.",
      },
      {
        id: "define-quality-check",
        title: "Define the quality check",
        detail:
          "Write the inspection or acceptance standard before products ship.",
      },
    ],
    tool: "qa",
    askSubject: "this venture's supply chain and operations",
    domains: ["supply", "operations"],
  },
  {
    key: "channel",
    title: "Channels & growth",
    blurb:
      "Decide how customers will discover, trust, and buy: social, ads, retail, partnerships, referrals, or marketplaces.",
    decision:
      "Which channel should be tested first, and what proof must that channel carry?",
    needToKnow: [
      "Where the audience already pays attention.",
      "Which channel has the lowest trust barrier for this product.",
      "Creative, creator, or retail proof needed before conversion.",
    ],
    tasks: [
      {
        id: "pick-one-primary-channel",
        title: "Pick one primary channel",
        detail:
          "Choose the first acquisition channel and write why it is better than the alternatives.",
      },
      {
        id: "draft-three-test-creatives",
        title: "Draft three test creatives",
        detail:
          "Write three ad, post, or outreach concepts tied to buyer objections.",
      },
      {
        id: "define-channel-budget",
        title: "Define the channel budget",
        detail:
          "Set the small test budget and the result needed before increasing spend.",
      },
    ],
    tool: "qa",
    askSubject: "this venture's acquisition channels and growth",
    domains: ["channel", "social", "audience"],
  },
  {
    key: "product-regulation",
    title: "Product & compliance",
    blurb:
      "Clarify the product standard, claim boundaries, packaging, certifications, duties, labels, and compliance gates.",
    decision:
      "What product or compliance requirement could block trust, sale, export, or scale?",
    needToKnow: [
      "Product attributes buyers treat as non-negotiable.",
      "Claims, labels, duties, certifications, or rules that apply.",
      "Packaging and proof needed for trust or retail readiness.",
    ],
    tasks: [
      {
        id: "write-product-standard",
        title: "Write the product standard",
        detail:
          "Define must-have specs, unacceptable defects, and proof points buyers need to see.",
      },
      {
        id: "list-compliance-gates",
        title: "List compliance gates",
        detail:
          "Record labels, certifications, duties, or claims that need verification.",
      },
      {
        id: "prepare-proof-assets",
        title: "Prepare proof assets",
        detail:
          "List photos, test results, certifications, or guarantees needed to reduce buyer risk.",
      },
    ],
    tool: "playbook",
    askSubject: "this venture's product and regulatory requirements",
    domains: ["product", "regulation", "supply"],
  },
];

const MODULE_BY_KEY = new Map<string, KnowHowModule>(
  KNOW_HOW_MODULES.map((m) => [m.key, m]),
);

export function moduleByKey(key: string): KnowHowModule | undefined {
  return MODULE_BY_KEY.get(key);
}

export function defaultKnowHowModule(): KnowHowModule {
  return MODULE_BY_KEY.get("strategy")!;
}

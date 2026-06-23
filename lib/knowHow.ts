import type { Domain } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Know-How hub: the network graph becomes a navigable index of "every aspect
// of the business". Clicking a node opens an interactive module — a calculator
// you can edit and recompute, plus a grounded Q&A you can follow up on, plus
// saved what-if scenarios you can come back to and compare.
//
// This file is the catalog. It owns (a) the list of modules and (b) the rule
// that resolves a clicked graph node to the module that should open. Adding a
// new business aspect is a single entry here — the drawer renders it by its
// `calculator` kind.
// ---------------------------------------------------------------------------

// Which interactive surface backs a module. "financials" is the fully
// interactive calculator (edit inputs → deterministic recompute → save
// scenario). The others are grounded-Q&A modules today: you can ask, follow
// up, and have the model propose justified changes — the dedicated calculators
// land incrementally and slot in by switching this kind.
export type KnowHowCalculator =
  | "financials" // unit economics, pricing, break-even, runway, TAM/SAM/SOM
  | "launchSim" // launch trajectory: orders, cash, inventory over time
  | "audience" // demand: who buys, willingness-to-pay, reachable prospects
  | "qa"; // grounded question-and-answer over the converged world model

export type KnowHowModule = {
  key: string;
  title: string;
  blurb: string;
  calculator: KnowHowCalculator;
  // Subject phrasing used by the grounded-Q&A prompt ("ask about <subject>").
  askSubject: string;
  // World-model domains this module reasons over. Drives the Q&A domain filter
  // and how a node's domain maps onto a module.
  domains: Domain[];
};

// The catalog, in a sensible reading order. `key` is stable — it's what the
// drawer, scenarios and analytics reference.
export const KNOW_HOW_MODULES: KnowHowModule[] = [
  {
    key: "financials",
    title: "Unit economics & financials",
    blurb:
      "Price tiers, landed cost, margins, CAC/LTV, break-even, runway and TAM/SAM/SOM — edit any assumption and recompute against your simulated buyers.",
    calculator: "financials",
    askSubject: "this business's financial model",
    domains: ["finance", "pricing"],
  },
  {
    key: "launch",
    title: "Launch trajectory",
    blurb:
      "Simulate the first months: ad spend, orders, cash and inventory over time. Try a scenario, see where it breaks, and come back to compare.",
    calculator: "launchSim",
    askSubject: "this launch simulation",
    domains: ["channel", "finance", "operations"],
  },
  {
    key: "audience",
    title: "Audience & demand",
    blurb:
      "Who actually buys, what they'll pay, and how many you can reach — drawn from the simulated audience behind the graph.",
    calculator: "audience",
    askSubject: "this venture's audience and demand",
    domains: ["audience", "market"],
  },
  {
    key: "market",
    title: "Market & competition",
    blurb:
      "Market size, segments, and the competitive set the research desks converged on. Ask how a move changes the picture.",
    calculator: "qa",
    askSubject: "this venture's market and competitive landscape",
    domains: ["market", "competitor"],
  },
  {
    key: "supply-ops",
    title: "Supply & operations",
    blurb:
      "Sourcing, MOQ, fulfilment and the operating constraints that shape what's actually buildable at what cost.",
    calculator: "qa",
    askSubject: "this venture's supply chain and operations",
    domains: ["supply", "operations"],
  },
  {
    key: "channel",
    title: "Channels & growth",
    blurb:
      "Where customers come from, what acquisition costs, and how the social/organic mix compounds. Test a channel-mix shift.",
    calculator: "qa",
    askSubject: "this venture's acquisition channels and growth",
    domains: ["channel", "social"],
  },
  {
    key: "product-regulation",
    title: "Product & compliance",
    blurb:
      "Product positioning, must-have features, and the regulatory or compliance gates that apply to this category and geography.",
    calculator: "qa",
    askSubject: "this venture's product and regulatory requirements",
    domains: ["product", "regulation"],
  },
  {
    key: "strategy",
    title: "Whole-business strategy",
    blurb:
      "The converged world model across every desk. Ask anything end-to-end; answers cite the conclusions they rely on.",
    calculator: "qa",
    askSubject: "this venture's overall strategy and world model",
    domains: ["synthesis"],
  },
];

const MODULE_BY_KEY = new Map(KNOW_HOW_MODULES.map((m) => [m.key, m]));

// Each world-model domain points at the module that should own it when a desk
// node of that domain is clicked.
const MODULE_BY_DOMAIN: Record<Domain, string> = {
  finance: "financials",
  pricing: "financials",
  market: "market",
  competitor: "market",
  audience: "audience",
  supply: "supply-ops",
  operations: "supply-ops",
  channel: "channel",
  social: "channel",
  product: "product-regulation",
  regulation: "product-regulation",
  synthesis: "strategy",
};

export function moduleByKey(key: string): KnowHowModule | undefined {
  return MODULE_BY_KEY.get(key);
}

// A graph node, reduced to what the resolver needs. NetworkView nodes are
// either research desks (with a `domain`), audience locality/platform nodes
// (id-prefixed), or the world-model terminal.
export type KnowHowNodeRef = {
  id: string;
  /** Research desks carry their world-model domain. */
  domain?: Domain | null;
  /** True for the world-model terminal node. */
  isWorldModel?: boolean;
};

// Resolve a clicked node to the module that should open. Audience locality /
// platform nodes open the audience module; the world model opens strategy;
// research desks open whichever module owns their domain. Falls back to
// strategy so every node is always actionable.
export function moduleForNode(node: KnowHowNodeRef): KnowHowModule {
  if (node.isWorldModel) return MODULE_BY_KEY.get("strategy")!;
  if (node.id.startsWith("loc:") || node.id.startsWith("plat:")) {
    return MODULE_BY_KEY.get("audience")!;
  }
  if (node.domain) {
    const key = MODULE_BY_DOMAIN[node.domain];
    const mod = key ? MODULE_BY_KEY.get(key) : undefined;
    if (mod) return mod;
  }
  return MODULE_BY_KEY.get("strategy")!;
}

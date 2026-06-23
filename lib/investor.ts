import { prisma } from "./db";
import {
  AudienceAggregateSchema,
  ClientProfileSchema,
  FinalReportSchema,
  FinancialsSectionSchema,
  InvestorKitSchema,
  RoadmapItemSchema,
  WebsiteAnalysisSchema,
  type Block,
  type ClientProfile,
  type EvidenceItem,
  type FinancialModel,
  type FinalReport,
  type FounderStorySection,
  type InvestorKit,
  type InvestorKitEdits,
  type InvestorStage,
  type ReadinessGate,
  type RoadmapItem,
} from "./schema";
import {
  getInvestorOS,
  getOwnerDashboard,
  saveInvestorKit,
  saveInvestorKitEdits,
  saveInvestorRoadmap,
} from "./store";
import { blockToWire } from "./wire";

export type InvestorReadiness = {
  score: number;
  status: "draft" | "investor_ready";
  investorReady: boolean;
  gates: ReadinessGate[];
  blockers: string[];
  evidenceCount: number;
  latestRunId: string | null;
  generatedAt: string;
};

export type InvestorSnapshot = {
  project: { id: string; name: string };
  profile: ClientProfile | null;
  evidence: EvidenceItem[];
  readiness: InvestorReadiness;
  roadmap: RoadmapItem[];
  latestKit: InvestorKit | null;
  kitEdits: InvestorKitEdits;
};

type GateConfig = {
  id: string;
  name: string;
  stage: InvestorStage;
  tags: string[];
  critical: boolean;
  requiredEvidence: string[];
};

const GATES: GateConfig[] = [
  {
    id: "market",
    name: "Market and competitor clarity",
    stage: "validate",
    tags: ["market", "competitor"],
    critical: true,
    requiredEvidence: ["Market size or demand proof", "Competitor/pricing evidence"],
  },
  {
    id: "customer_proof",
    name: "Customer proof",
    stage: "validate",
    tags: ["customer_proof", "audience"],
    critical: true,
    requiredEvidence: ["Audience signal", "Customer objection or validation evidence"],
  },
  {
    id: "product",
    name: "Product definition",
    stage: "build",
    tags: ["product", "brand"],
    critical: false,
    requiredEvidence: ["Product scope", "Differentiation or positioning"],
  },
  {
    id: "gtm",
    name: "GTM and channel plan",
    stage: "launch",
    tags: ["gtm", "channel", "social"],
    critical: true,
    requiredEvidence: ["Channel plan", "Launch or acquisition assumptions"],
  },
  {
    id: "financials",
    name: "Financial model",
    stage: "fundraise",
    tags: ["financials", "pricing"],
    critical: true,
    requiredEvidence: ["Unit economics", "Market sizing", "Runway/use-of-funds view"],
  },
  {
    id: "operations",
    name: "Operations and supply",
    stage: "build",
    tags: ["operations", "supply", "regulation"],
    critical: false,
    requiredEvidence: ["Supply, compliance or delivery plan"],
  },
  {
    id: "traction",
    name: "Traction and outcomes",
    stage: "prove",
    tags: ["traction", "outcome"],
    critical: false,
    requiredEvidence: ["Real or simulated launch outcome", "Proof metric"],
  },
  {
    id: "team",
    name: "Founder and team story",
    stage: "define",
    tags: ["team", "founder"],
    critical: false,
    requiredEvidence: ["Founder background", "Credibility proof"],
  },
  {
    id: "risks",
    name: "Risks and mitigations",
    stage: "fundraise",
    tags: ["risks", "regulation"],
    critical: true,
    requiredEvidence: ["Known risks", "Mitigation or validation plan"],
  },
  {
    id: "data_room",
    name: "Data room completeness",
    stage: "fundraise",
    tags: ["data_room", "document", "report"],
    critical: true,
    requiredEvidence: ["Uploaded proof/documents", "Investor report/kit assets"],
  },
];

const ROADMAP_TEMPLATES: Record<string, Omit<RoadmapItem, "id" | "status" | "createdAt" | "updatedAt" | "evidenceIds">[]> = {
  market: [
    {
      stage: "validate",
      type: "experiment",
      title: "Validate market size and competitor wedge",
      detail: "Collect 5-8 cited market or competitor sources and convert them into one positioning memo.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["market"],
      requiredProof: ["Cited market source", "Competitor price/positioning snapshot"],
    },
  ],
  customer_proof: [
    {
      stage: "validate",
      type: "experiment",
      title: "Run customer validation sprint",
      detail: "Interview or survey 15-25 target buyers and attach verbatims, objections and intent signals.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["customer_proof"],
      requiredProof: ["Interview notes or survey export", "Top objections", "Intent/WTP signal"],
    },
  ],
  product: [
    {
      stage: "build",
      type: "document",
      title: "Lock the product thesis",
      detail: "Write the hero SKU/service, audience, differentiation, price band and proof needed to ship v1.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["product"],
      requiredProof: ["Product spec", "Differentiation evidence"],
    },
  ],
  gtm: [
    {
      stage: "launch",
      type: "experiment",
      title: "Design the first GTM experiment",
      detail: "Pick one primary channel, define spend/time budget, success metric and kill criteria.",
      ownerRole: "Growth",
      dueDate: null,
      linkedGateIds: ["gtm"],
      requiredProof: ["Channel plan", "Launch simulation or campaign result"],
    },
  ],
  financials: [
    {
      stage: "fundraise",
      type: "metric",
      title: "Firm up unit economics",
      detail: "Replace estimated price, margin, CAC and fixed-cost assumptions with founder-entered or uploaded data.",
      ownerRole: "Finance",
      dueDate: null,
      linkedGateIds: ["financials"],
      requiredProof: ["Financial model", "Assumption sources", "Use-of-funds plan"],
    },
  ],
  operations: [
    {
      stage: "build",
      type: "task",
      title: "Validate supply and delivery path",
      detail: "Document supplier, fulfilment, compliance, lead-time and quality-control assumptions.",
      ownerRole: "Ops",
      dueDate: null,
      linkedGateIds: ["operations"],
      requiredProof: ["Supplier quote or ops memo", "Compliance notes"],
    },
  ],
  traction: [
    {
      stage: "prove",
      type: "metric",
      title: "Capture one real-world outcome",
      detail: "Log a pilot, launch, sales, waitlist, LOI or campaign outcome against the simulated plan.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["traction"],
      requiredProof: ["Launch outcome", "Sales/LOI/waitlist proof"],
    },
  ],
  team: [
    {
      stage: "define",
      type: "document",
      title: "Document founder-market fit",
      detail: "Capture founder background, domain insight, unfair advantage and key hiring gaps.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["team"],
      requiredProof: ["Founder story", "Credibility proof"],
    },
  ],
  risks: [
    {
      stage: "fundraise",
      type: "task",
      title: "Turn top risks into validation tasks",
      detail: "For each investor-obvious risk, define the evidence that would reduce it before fundraising.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["risks"],
      requiredProof: ["Risk register", "Mitigation plan"],
    },
  ],
  data_room: [
    {
      stage: "fundraise",
      type: "document",
      title: "Assemble the data room spine",
      detail: "Upload the documents that support claims: company basics, financials, customer proof, product, contracts and sources.",
      ownerRole: "Founder",
      dueDate: null,
      linkedGateIds: ["data_room"],
      requiredProof: ["Uploaded documents", "Evidence-linked fundraise kit"],
    },
  ],
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function nowIso(): string {
  return new Date().toISOString();
}

function firstText(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function sourceFromCitation(citation: string | null): EvidenceItem["sourceType"] {
  if (!citation) return "conclusion";
  if (/^https?:\/\//i.test(citation)) return "website";
  return "conclusion";
}

function domainTags(domain: string): string[] {
  const d = domain.toLowerCase();
  const tags = [d];
  if (d === "audience") tags.push("customer_proof");
  if (d === "channel" || d === "social") tags.push("gtm");
  if (d === "finance" || d === "pricing") tags.push("financials");
  if (d === "supply" || d === "operations" || d === "regulation")
    tags.push("operations");
  if (d === "market" || d === "competitor") tags.push("market");
  if (d === "product") tags.push("product");
  if (d === "synthesis") tags.push("report");
  return Array.from(new Set(tags));
}

function documentTags(name: string): string[] {
  const n = name.toLowerCase();
  const tags = ["document", "data_room"];
  if (/sales|revenue|order|customer|waitlist|loi|traction/.test(n))
    tags.push("traction", "customer_proof");
  if (/finance|p&l|pl|margin|cost|cac|bank|account/.test(n))
    tags.push("financials");
  if (/supplier|factory|contract|compliance|license|ops/.test(n))
    tags.push("operations");
  if (/deck|memo|market|competitor|research/.test(n))
    tags.push("market");
  if (/founder|team|bio/.test(n)) tags.push("team", "founder");
  return Array.from(new Set(tags));
}

function evidenceFromConclusion(runId: string, block: Block, c: Block["conclusions"][number]): EvidenceItem {
  const citation = c.sources.find((s) => /^https?:\/\//i.test(s)) ?? c.sources[0] ?? null;
  return {
    id: `conclusion-${c.id}`,
    sourceType: sourceFromCitation(citation),
    title: c.claim,
    summary: c.value,
    confidence: c.confidence,
    citation,
    investorRelevance: `${block.name} finding for investor diligence.`,
    linkedRunId: runId,
    linkedConclusionIds: [c.id],
    linkedDocumentId: null,
    metricKey: null,
    tags: [...domainTags(block.domain), ...c.entities.map((e) => e.toLowerCase())],
    createdAt: "",
  };
}

function formatMoney(value: number | undefined, currency: string): string {
  if (!Number.isFinite(value)) return "not available";
  const n = Number(value);
  const compact = new Intl.NumberFormat("en", {
    notation: Math.abs(n) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
  return `${currency} ${compact}`;
}

function financialBullets(model: FinancialModel | null): string[] {
  if (!model) {
    return [
      "Financial model has not been generated yet.",
      "Investor materials should treat economics as estimated until the founder builds the model.",
    ];
  }
  const base = model.priceTiers[0] ?? null;
  return [
    `Data maturity: ${Math.round(model.dataMaturityPct)}% of assumptions are founder/data-backed.`,
    base
      ? `Base price tier: ${formatMoney(base.price.value, model.currency)} with ${Math.round(base.grossMarginPct.value)}% gross margin.`
      : "No base price tier is available.",
    `Blended CAC: ${formatMoney(model.unitEconomics.blendedCac.value, model.currency)}; LTV:CAC ${model.unitEconomics.ltvCacRatio ? model.unitEconomics.ltvCacRatio.value.toFixed(1) : "not available"}.`,
    `Runway: ${model.runwayFit.runwayMonths ? `${model.runwayFit.runwayMonths.value.toFixed(1)} months` : "not available"}; ${model.runwayFit.verdict || "funding fit needs review"}.`,
  ];
}

function founderStoryBullets(story: FounderStorySection): string[] {
  const signals = story.signals;
  return [
    signals.founderBackground
      ? `Background: ${signals.founderBackground}`
      : "",
    signals.originStory ? `Origin: ${signals.originStory}` : "",
    signals.founderMotivation
      ? `Motivation: ${signals.founderMotivation}`
      : "",
    signals.whyNow ? `Why now: ${signals.whyNow}` : "",
    signals.customerInsight
      ? `Customer insight: ${signals.customerInsight}`
      : "",
    signals.categoryConviction
      ? `Category conviction: ${signals.categoryConviction}`
      : "",
    signals.credibilityProof.length
      ? `Credibility proof: ${signals.credibilityProof.join("; ")}`
      : "",
    signals.unfairAdvantages.length
      ? `Unfair advantages: ${signals.unfairAdvantages.join("; ")}`
      : "",
    signals.constraints.length
      ? `Constraints: ${signals.constraints.join("; ")}`
      : "",
    signals.openQuestions.length
      ? `Open questions: ${signals.openQuestions.join("; ")}`
      : "",
  ].filter(Boolean);
}

export function buildReadinessGates(evidence: EvidenceItem[]): ReadinessGate[] {
  return GATES.map((gate) => {
    const matches = evidence.filter((e) =>
      gate.tags.some((tag) => e.tags.includes(tag))
    );
    const top = [...matches].sort((a, b) => b.confidence - a.confidence).slice(0, 4);
    const countScore = Math.min(50, matches.length * 16);
    const confidenceScore = top.length
      ? Math.round((top.reduce((s, e) => s + e.confidence, 0) / top.length) * 25)
      : 0;
    const hardProof = matches.some((e) =>
      ["document", "financial", "outcome", "website", "market_data"].includes(
        e.sourceType
      )
    )
      ? 15
      : 0;
    const actualProof = matches.some((e) => e.sourceType === "outcome") ? 10 : 0;
    const score = Math.min(100, countScore + confidenceScore + hardProof + actualProof);
    const status = score >= 75 ? "ready" : score >= 40 ? "partial" : "blocked";
    const blockers =
      status === "ready"
        ? []
        : gate.requiredEvidence.filter((_, i) => i >= Math.max(0, matches.length - 1));
    return {
      id: gate.id,
      name: gate.name,
      stage: gate.stage,
      score,
      status,
      critical: gate.critical,
      summary:
        status === "ready"
          ? "Evidence is strong enough for investor-facing materials."
          : status === "partial"
            ? "Some evidence exists, but investor diligence would still press on this."
            : "This gate lacks enough evidence for an investor-ready claim.",
      blockers,
      requiredEvidence: gate.requiredEvidence,
      evidenceIds: top.map((e) => e.id),
    } satisfies ReadinessGate;
  });
}

export function summarizeReadiness(
  gates: ReadinessGate[],
  evidenceCount: number,
  latestRunId: string | null
): InvestorReadiness {
  const score = Math.round(
    gates.reduce((s, g) => s + g.score * (g.critical ? 1.25 : 1), 0) /
      gates.reduce((s, g) => s + (g.critical ? 1.25 : 1), 0)
  );
  const criticalBlockers = gates.filter(
    (g) => g.critical && g.status !== "ready"
  );
  const investorReady = score >= 80 && criticalBlockers.length === 0;
  return {
    score,
    status: investorReady ? "investor_ready" : "draft",
    investorReady,
    gates,
    blockers: criticalBlockers.map(
      (g) => `${g.name}: ${g.blockers[0] ?? "needs stronger evidence"}`
    ),
    evidenceCount,
    latestRunId,
    generatedAt: nowIso(),
  };
}

export function buildRoadmapFromReadiness(
  gates: ReadinessGate[],
  existing: RoadmapItem[] = [],
  report: FinalReport | null = null
): RoadmapItem[] {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const createdAt = nowIso();
  const generated: RoadmapItem[] = [];

  for (const gate of gates) {
    if (gate.status === "ready") continue;
    for (const template of ROADMAP_TEMPLATES[gate.id] ?? []) {
      const id = `gate-${gate.id}-${slug(template.title)}`;
      const prior = existingById.get(id);
      generated.push(
        RoadmapItemSchema.parse({
          ...template,
          id,
          status: prior?.status ?? "todo",
          evidenceIds: prior?.evidenceIds ?? gate.evidenceIds,
          createdAt: prior?.createdAt || createdAt,
          updatedAt: prior?.updatedAt || createdAt,
        })
      );
    }
  }

  for (const action of report?.nextActions ?? []) {
    const id = `report-action-${slug(action)}`;
    const prior = existingById.get(id);
    generated.push(
      RoadmapItemSchema.parse({
        id,
        stage: "launch",
        type: "task",
        title: action.length > 90 ? `${action.slice(0, 87)}...` : action,
        detail: "Generated from the final business report next actions.",
        status: prior?.status ?? "todo",
        ownerRole: "Founder",
        dueDate: null,
        linkedGateIds: ["gtm", "risks"],
        requiredProof: ["Completed action evidence"],
        evidenceIds: prior?.evidenceIds ?? [],
        createdAt: prior?.createdAt || createdAt,
        updatedAt: prior?.updatedAt || createdAt,
      })
    );
  }

  for (const item of existing) {
    if (!generated.some((g) => g.id === item.id)) generated.push(item);
  }

  return generated.slice(0, 40);
}

function topEvidenceIds(evidence: EvidenceItem[], tags: string[], limit = 4): string[] {
  return evidence
    .filter((e) => tags.some((tag) => e.tags.includes(tag)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
    .map((e) => e.id);
}

function latestReportFromEvents(events: { payload: string }[]): FinalReport | null {
  for (const event of events) {
    const parsed = safeJson<{ report?: unknown }>(event.payload, {});
    const report = FinalReportSchema.safeParse(parsed.report);
    if (report.success) return report.data;
  }
  return null;
}

function generateInvestorKit(args: {
  projectName: string;
  profile: ClientProfile | null;
  evidence: EvidenceItem[];
  readiness: InvestorReadiness;
  report: FinalReport | null;
  financialModel: FinancialModel | null;
}): InvestorKit {
  const profile = args.profile;
  const venture = profile?.product || args.projectName;
  const category = profile?.category || "venture";
  const target = profile?.targetAudience || profile?.goal || "target customers";
  const marketEvidence = topEvidenceIds(args.evidence, ["market", "competitor"]);
  const customerEvidence = topEvidenceIds(args.evidence, ["customer_proof", "audience"]);
  const gtmEvidence = topEvidenceIds(args.evidence, ["gtm", "channel", "social"]);
  const financialEvidence = topEvidenceIds(args.evidence, ["financials", "pricing"]);
  const riskEvidence = topEvidenceIds(args.evidence, ["risks", "regulation"]);
  const tractionEvidence = topEvidenceIds(args.evidence, ["traction", "outcome"]);
  const dataRoomEvidence = topEvidenceIds(args.evidence, ["data_room", "document"]);
  const finBullets = financialBullets(args.financialModel);
  const caveats = args.readiness.blockers.length
    ? args.readiness.blockers
    : ["Investor-ready gates passed; still verify all figures before sharing externally."];

  return InvestorKitSchema.parse({
    id: `kit-${Date.now()}`,
    sourceRunId: args.readiness.latestRunId,
    readinessScore: args.readiness.score,
    readinessStatus: args.readiness.investorReady ? "investor_ready" : "draft",
    readinessSnapshot: args.readiness.gates,
    artifacts: {
      pitchDeck: {
        title: `${venture} investor deck`,
        slides: [
          {
            title: "Company",
            bullets: [
              `${venture} is a ${category} venture for ${target}.`,
              firstText(profile?.goal, "The venture needs a sharper investor narrative before fundraising."),
            ],
            evidenceIds: topEvidenceIds(args.evidence, ["founder", "product", "team"]),
            provenance: "founder_entered",
          },
          {
            title: "Problem",
            bullets: [
              args.report?.executiveSummary ?? "The market problem is derived from the current research run.",
              "Investor claim should be supported by cited market and customer evidence.",
            ],
            evidenceIds: [...marketEvidence, ...customerEvidence].slice(0, 5),
            provenance: marketEvidence.length ? "sourced" : "estimated",
          },
          {
            title: "Solution",
            bullets: [
              firstText(profile?.product, "Product needs to be specified."),
              firstText(profile?.productDetails?.differentiation, "Differentiation needs stronger proof."),
            ],
            evidenceIds: topEvidenceIds(args.evidence, ["product", "brand"]),
            provenance: "founder_entered",
          },
          {
            title: "Market",
            bullets: [
              args.report?.sections.find((s) => /market|demand|compet/i.test(s.title))?.summary ??
                "Market evidence exists in the research conclusions.",
              `Readiness gate: ${args.readiness.gates.find((g) => g.id === "market")?.score ?? 0}/100.`,
            ],
            evidenceIds: marketEvidence,
            provenance: marketEvidence.length ? "sourced" : "estimated",
          },
          {
            title: "Customer proof",
            bullets: [
              `Customer proof readiness: ${args.readiness.gates.find((g) => g.id === "customer_proof")?.score ?? 0}/100.`,
              customerEvidence.length
                ? "Audience and customer evidence is linked in the evidence ledger."
                : "Customer proof is still a fundraising blocker.",
            ],
            evidenceIds: customerEvidence,
            provenance: tractionEvidence.length ? "actual" : "simulated",
          },
          {
            title: "Go to market",
            bullets: [
              args.report?.sections.find((s) => /channel|gtm|social|launch/i.test(s.title))?.summary ??
                "GTM plan should be backed by channel and launch evidence.",
              "Primary channel assumptions should be validated before investor outreach.",
            ],
            evidenceIds: gtmEvidence,
            provenance: gtmEvidence.length ? "simulated" : "estimated",
          },
          {
            title: "Business model",
            bullets: finBullets.slice(0, 3),
            evidenceIds: financialEvidence,
            provenance: args.financialModel?.dataMaturityPct && args.financialModel.dataMaturityPct > 50
              ? "founder_entered"
              : "estimated",
          },
          {
            title: "Traction",
            bullets: tractionEvidence.length
              ? ["Real or captured outcomes are available in the evidence ledger.", `Traction evidence count: ${tractionEvidence.length}.`]
              : ["No hard traction has been captured yet.", "Use launch outcomes, LOIs, waitlists or sales exports to upgrade this slide."],
            evidenceIds: tractionEvidence,
            provenance: tractionEvidence.length ? "actual" : "estimated",
          },
          {
            title: "Risks",
            bullets: args.readiness.gates
              .filter((g) => g.status !== "ready")
              .slice(0, 3)
              .map((g) => `${g.name}: ${g.blockers[0] ?? "needs proof"}`),
            evidenceIds: riskEvidence,
            provenance: riskEvidence.length ? "sourced" : "estimated",
          },
          {
            title: "Ask and use of funds",
            bullets: [
              firstText(profile?.funding?.capitalAvailable, "Funding ask needs to be set."),
              "Use funds across product, validation, GTM, team and operating runway milestones.",
              `Investor readiness: ${args.readiness.score}/100 (${args.readiness.status.replace("_", " ")}).`,
            ],
            evidenceIds: financialEvidence,
            provenance: "founder_entered",
          },
        ],
      },
      investorMemo: {
        title: `${venture} investor memo`,
        sections: [
          {
            title: "Thesis",
            body: args.report?.verdict ?? `${venture} can be evaluated as an investor draft once readiness blockers are resolved.`,
            evidenceIds: topEvidenceIds(args.evidence, ["report", "market", "customer_proof"]),
          },
          {
            title: "Market and wedge",
            body: marketEvidence.length
              ? "The market and competitor claims are backed by linked research evidence."
              : "Market evidence is currently insufficient for a confident investor memo.",
            evidenceIds: marketEvidence,
          },
          {
            title: "Customer and GTM",
            body: "Customer proof, channel assumptions and launch simulations should drive the first execution milestones.",
            evidenceIds: [...customerEvidence, ...gtmEvidence].slice(0, 8),
          },
          {
            title: "Economics",
            body: finBullets.join(" "),
            evidenceIds: financialEvidence,
          },
          {
            title: "Risks",
            body: caveats.join(" "),
            evidenceIds: riskEvidence,
          },
        ],
      },
      financialModelSummary: {
        status: args.financialModel
          ? `${Math.round(args.financialModel.dataMaturityPct)}% data maturity`
          : "Financial model missing",
        bullets: finBullets,
        evidenceIds: financialEvidence,
      },
      dataRoomIndex: [
        "Company overview and founder story",
        "Pitch deck and investor memo",
        "Financial model and assumptions",
        "Market research and competitor sources",
        "Customer proof: personas, interviews, surveys, outcomes",
        "Product, supplier, compliance and operations documents",
        "Launch simulations, actual outcomes and backtests",
        "Risk register and mitigation plan",
        dataRoomEvidence.length
          ? `${dataRoomEvidence.length} evidence-linked project document(s)`
          : "Upload supporting files before external diligence",
      ],
      investorQA: [
        {
          question: "What evidence proves customers want this?",
          answer: customerEvidence.length
            ? "Use the linked customer-proof evidence and audience signals."
            : "This is a blocker: run customer validation and capture outcomes.",
          evidenceIds: customerEvidence,
        },
        {
          question: "Why now and why this market?",
          answer: marketEvidence.length
            ? "Market evidence is linked; cite the strongest sources in the memo."
            : "Market timing needs stronger cited evidence.",
          evidenceIds: marketEvidence,
        },
        {
          question: "How will you acquire customers?",
          answer: gtmEvidence.length
            ? "Use the GTM evidence and launch simulation assumptions."
            : "The channel plan needs a concrete experiment and proof.",
          evidenceIds: gtmEvidence,
        },
        {
          question: "What are the unit economics?",
          answer: finBullets.join(" "),
          evidenceIds: financialEvidence,
        },
        {
          question: "What could make the plan wrong?",
          answer: caveats.join(" "),
          evidenceIds: riskEvidence,
        },
      ],
      useOfFundsPlan: [
        "Product and supply validation tied to the Build gate.",
        "Customer validation and first GTM experiment tied to the Validate/Launch gates.",
        "Working capital and runway tied to the Financial Model gate.",
        "Data-room completion and investor materials tied to the Fundraise gate.",
        "Post-launch measurement tied to the Prove and Grow gates.",
      ],
    },
    caveats,
    createdAt: nowIso(),
  });
}

export async function buildInvestorSnapshot(projectId: string): Promise<InvestorSnapshot> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ventureProfile: true,
      websiteAnalysis: true,
      marketData: true,
      documents: {
        select: {
          id: true,
          name: true,
          charCount: true,
          chunkCount: true,
          createdAt: true,
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          blocks: { include: { conclusions: true } },
          events: {
            where: {
              type: { in: ["final_report", "audience_aggregated"] },
            },
            orderBy: { seq: "desc" },
          },
          launchSims: {
            select: { id: true, name: true, result: true, createdAt: true },
          },
          launchOutcomes: {
            select: {
              id: true,
              label: true,
              source: true,
              horizonLabel: true,
              actual: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  if (!project) throw new Error("project not found");

  const owner = await getOwnerDashboard(projectId);
  const investorOS = await getInvestorOS(projectId);
  const profile =
    ClientProfileSchema.safeParse(project.ventureProfile).success
      ? ClientProfileSchema.parse(project.ventureProfile)
      : null;
  const website = project.websiteAnalysis
    ? WebsiteAnalysisSchema.safeParse(project.websiteAnalysis)
    : null;
  const evidence: EvidenceItem[] = [];

  if (profile) {
    evidence.push({
      id: "profile-venture",
      sourceType: "founder",
      title: "Venture profile captured",
      summary: `${profile.product}. ${profile.goal}`,
      confidence: profile.product && profile.goal ? 0.75 : 0.45,
      citation: null,
      investorRelevance: "Defines the company, product, audience and fundraising context.",
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "profile",
      tags: ["founder", "team", "product", "define"],
      createdAt: "",
    });
  }

  if (website?.success) {
    evidence.push({
      id: "website-analysis",
      sourceType: "website",
      title: "Website and consumer-opinion analysis",
      summary: website.data.summary || website.data.consumerOpinion,
      confidence: website.data.sources.length ? 0.75 : 0.5,
      citation: website.data.sources[0] ?? website.data.url ?? null,
      investorRelevance: "Shows what the app could infer from the founder's live market presence.",
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "website",
      tags: ["market", "customer_proof", "product", "website"],
      createdAt: website.data.analyzedAt || "",
    });
  }

  const marketData =
    project.marketData && typeof project.marketData === "object"
      ? (project.marketData as Record<string, { sources?: string[]; notes?: string }>)
      : {};
  for (const [key, datum] of Object.entries(marketData)) {
    evidence.push({
      id: `market-data-${slug(key)}`,
      sourceType: "market_data",
      title: `Market benchmark: ${key}`,
      summary: datum.notes || "Web-sourced market benchmark override.",
      confidence: datum.sources?.length ? 0.75 : 0.5,
      citation: datum.sources?.[0] ?? null,
      investorRelevance: "Strengthens benchmark assumptions for market and financial diligence.",
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: key,
      tags: ["market", "financials", "data_room"],
      createdAt: "",
    });
  }

  for (const doc of project.documents) {
    evidence.push({
      id: `document-${doc.id}`,
      sourceType: "document",
      title: doc.name,
      summary: `${doc.chunkCount} indexed chunk(s), ${doc.charCount.toLocaleString()} characters.`,
      confidence: 0.82,
      citation: null,
      investorRelevance: "Founder-uploaded data-room evidence.",
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: doc.id,
      metricKey: "document",
      tags: documentTags(doc.name),
      createdAt: doc.createdAt.toISOString(),
    });
  }

  let latestReport: FinalReport | null = null;
  let latestRunId: string | null = null;

  for (const run of project.runs) {
    if (!latestRunId && ["complete", "capped"].includes(run.status)) {
      latestRunId = run.id;
    }
    for (const block of run.blocks) {
      const wireBlock = blockToWire(block, block.conclusions);
      for (const conclusion of wireBlock.conclusions) {
        evidence.push(evidenceFromConclusion(run.id, wireBlock, conclusion));
      }
    }
    const reportEvents = run.events.filter((e) => e.type === "final_report");
    const report = latestReportFromEvents(reportEvents);
    if (report && !latestReport) latestReport = report;
    if (report) {
      evidence.push({
        id: `report-${run.id}`,
        sourceType: "report",
        title: report.title,
        summary: report.verdict,
        confidence: 0.72,
        citation: null,
        investorRelevance: "Final business report distilled from the world model.",
        linkedRunId: run.id,
        linkedConclusionIds: report.sections.flatMap((s) => s.citedConclusionIds),
        linkedDocumentId: null,
        metricKey: "final_report",
        tags: ["report", "risks", "gtm", "data_room"],
        createdAt: "",
      });
    }
    const aggEvent = run.events.find((e) => e.type === "audience_aggregated");
    const aggregate = aggEvent
      ? AudienceAggregateSchema.safeParse(safeJson<{ aggregate?: unknown }>(aggEvent.payload, {}).aggregate)
      : null;
    if (aggregate?.success) {
      evidence.push({
        id: `audience-${run.id}`,
        sourceType: "simulation",
        title: `${aggregate.data.totalPersonas.toLocaleString()} simulated customer/persona signals`,
        summary: `Top channel ${aggregate.data.channelShare[0]?.name ?? "n/a"}; top objection ${aggregate.data.topObjections[0]?.text ?? "n/a"}.`,
        confidence: 0.65,
        citation: null,
        investorRelevance: "Simulated customer proof; useful, but not a substitute for actual traction.",
        linkedRunId: run.id,
        linkedConclusionIds: [],
        linkedDocumentId: null,
        metricKey: "audience",
        tags: ["customer_proof", "audience", "market"],
        createdAt: "",
      });
    }
    for (const sim of run.launchSims) {
      const result = sim.result as { diagnostics?: { headline?: string }; summary?: { totalOrders?: number; netProfit?: number } };
      evidence.push({
        id: `launch-sim-${sim.id}`,
        sourceType: "simulation",
        title: `Launch simulation: ${sim.name}`,
        summary:
          result.diagnostics?.headline ??
          `Orders ${result.summary?.totalOrders ?? "n/a"}, net profit ${result.summary?.netProfit ?? "n/a"}.`,
        confidence: 0.62,
        citation: null,
        investorRelevance: "Models GTM and working-capital assumptions before actual launch data exists.",
        linkedRunId: run.id,
        linkedConclusionIds: [],
        linkedDocumentId: null,
        metricKey: "launch_sim",
        tags: ["gtm", "financials", "traction", "launch"],
        createdAt: sim.createdAt.toISOString(),
      });
    }
    for (const outcome of run.launchOutcomes) {
      const actual = outcome.actual as Record<string, unknown>;
      evidence.push({
        id: `outcome-${outcome.id}`,
        sourceType: "outcome",
        title: `Actual outcome: ${outcome.label}`,
        summary: Object.entries(actual)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .slice(0, 5)
          .join("; "),
        confidence: 0.92,
        citation: outcome.source,
        investorRelevance: "Actual traction/outcome data; strongest evidence tier.",
        linkedRunId: run.id,
        linkedConclusionIds: [],
        linkedDocumentId: null,
        metricKey: outcome.horizonLabel ?? "actual_outcome",
        tags: ["traction", "outcome", "customer_proof", "financials"],
        createdAt: outcome.createdAt.toISOString(),
      });
    }
  }

  const finSections = owner
    ? [
        ...Object.values(owner.financialsByRun ?? {}),
        owner.financials,
      ].filter(Boolean)
    : [];
  const seenFinancialRuns = new Set<string>();
  for (const section of finSections) {
    const parsed = FinancialsSectionSchema.safeParse(section);
    if (!parsed.success || !parsed.data.model) continue;
    const runId = parsed.data.sourceRunId ?? parsed.data.model.sourceRunId ?? "latest";
    if (seenFinancialRuns.has(runId)) continue;
    seenFinancialRuns.add(runId);
    evidence.push({
      id: `financial-model-${runId}`,
      sourceType: "financial",
      title: "Financial model",
      summary: financialBullets(parsed.data.model).join(" "),
      confidence: 0.55 + Math.min(0.35, parsed.data.model.dataMaturityPct / 300),
      citation: null,
      investorRelevance: "Investor-facing unit economics, market sizing and runway model.",
      linkedRunId: parsed.data.sourceRunId,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "financial_model",
      tags: ["financials", "pricing", "data_room"],
      createdAt: parsed.data.generatedAt ?? "",
    });
  }

  if (owner?.brandSocial.kit) {
    evidence.push({
      id: `brand-kit-${owner.brandSocial.sourceRunId ?? "latest"}`,
      sourceType: "report",
      title: "Brand and social action plan",
      summary: `${owner.brandSocial.kit.checklist.length} execution checklist items and ${owner.brandSocial.kit.comparableAccounts.length} comparable accounts.`,
      confidence: 0.62,
      citation: null,
      investorRelevance: "Supports GTM and brand-positioning diligence.",
      linkedRunId: owner.brandSocial.sourceRunId,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "brand_social",
      tags: ["gtm", "social", "brand", "product"],
      createdAt: owner.brandSocial.generatedAt ?? "",
    });
  }

  if (owner?.founderStory && (owner.founderStory.confidence > 0 || owner.founderStory.evidence.length)) {
    const storySummary = founderStoryBullets(owner.founderStory).join(" ");
    evidence.push({
      id: "founder-story",
      sourceType: "founder",
      title: "Founder story",
      summary:
        storySummary ||
        owner.founderStory.evidence.map((e) => e.summary || e.excerpt).filter(Boolean).join(" "),
      confidence: Math.max(
        owner.founderStory.confidence,
        owner.founderStory.evidence.length ? 0.58 : 0.35
      ),
      citation:
        owner.founderStory.sources[0] ??
        owner.founderStory.evidence.find((e) => e.url)?.url ??
        null,
      investorRelevance:
        "Supports founder-market fit, team narrative, credibility proof and diligence follow-up questions.",
      linkedRunId: null,
      linkedConclusionIds: [],
      linkedDocumentId: null,
      metricKey: "founder_story",
      tags: [
        "team",
        "founder",
        "define",
        "product",
        owner.founderStory.signals.customerInsight ? "customer_proof" : "",
        owner.founderStory.signals.categoryConviction ? "market" : "",
      ].filter(Boolean),
      createdAt: owner.founderStory.generatedAt ?? "",
    });
  }

  evidence.push(
    ...investorOS.manualEvidence.map((e) => ({
      ...e,
      sourceType: "manual" as const,
      tags: Array.from(new Set([...e.tags, "manual"])),
    }))
  );

  const gates = buildReadinessGates(evidence);
  const readiness = summarizeReadiness(gates, evidence.length, latestRunId);
  const roadmap = buildRoadmapFromReadiness(gates, investorOS.roadmap, latestReport);
  // The stored kit is the un-edited base; overlay founder edits before exposing.
  const latestKit = investorOS.kits[0]
    ? applyKitEdits(investorOS.kits[0], investorOS.edits)
    : null;

  return {
    project: { id: project.id, name: project.name },
    profile,
    evidence,
    readiness,
    roadmap,
    latestKit,
    kitEdits: investorOS.edits,
  };
}

export async function syncInvestorRoadmap(projectId: string): Promise<RoadmapItem[]> {
  const snapshot = await buildInvestorSnapshot(projectId);
  await saveInvestorRoadmap(projectId, snapshot.roadmap);
  return snapshot.roadmap;
}

/**
 * Overlay founder edits onto a freshly-generated ("base") kit. Non-destructive:
 * the stored kit stays the regenerable base and these overrides are re-applied
 * on every read, so clearing an edit cleanly reverts to generated content and
 * regenerating from new evidence keeps the founder's wording. `editedSections`
 * records which sections were overridden so the UI can flag them.
 */
export function applyKitEdits(
  kit: InvestorKit,
  edits: InvestorKitEdits
): InvestorKit {
  const editedSections = new Set<string>();

  const slides = kit.artifacts.pitchDeck.slides.map((slide) => {
    const override = edits.deckSlides[slide.title];
    if (override && override.length) {
      editedSections.add(`slide:${slide.title}`);
      return { ...slide, bullets: override };
    }
    return slide;
  });

  const sections = kit.artifacts.investorMemo.sections.map((section) => {
    const override = edits.memoSections[section.title];
    if (typeof override === "string" && override.trim()) {
      editedSections.add(`memo:${section.title}`);
      return { ...section, body: override };
    }
    return section;
  });

  const investorQA = kit.artifacts.investorQA.map((qa) => {
    const override = edits.qaAnswers[qa.question];
    if (typeof override === "string" && override.trim()) {
      editedSections.add(`qa:${qa.question}`);
      return { ...qa, answer: override };
    }
    return qa;
  });

  let useOfFundsPlan = kit.artifacts.useOfFundsPlan;
  if (edits.useOfFundsPlan && edits.useOfFundsPlan.length) {
    useOfFundsPlan = edits.useOfFundsPlan;
    editedSections.add("useOfFunds");
  }

  let financialModelSummary = kit.artifacts.financialModelSummary;
  if (edits.financialBullets && edits.financialBullets.length) {
    financialModelSummary = {
      ...financialModelSummary,
      bullets: edits.financialBullets,
    };
    editedSections.add("financials");
  }

  return InvestorKitSchema.parse({
    ...kit,
    artifacts: {
      ...kit.artifacts,
      pitchDeck: { ...kit.artifacts.pitchDeck, slides },
      investorMemo: { ...kit.artifacts.investorMemo, sections },
      financialModelSummary,
      investorQA,
      useOfFundsPlan,
    },
    editedSections: [...editedSections],
  });
}

export async function createInvestorKit(projectId: string): Promise<InvestorKit> {
  const snapshot = await buildInvestorSnapshot(projectId);
  const owner = await getOwnerDashboard(projectId);
  const latestFinancial =
    snapshot.readiness.latestRunId && owner
      ? owner.financialsByRun[snapshot.readiness.latestRunId]?.model ?? owner.financials.model
      : owner?.financials.model ?? null;
  const latestRun = snapshot.readiness.latestRunId
    ? await prisma.run.findUnique({
        where: { id: snapshot.readiness.latestRunId },
        select: {
          events: {
            where: { type: "final_report" },
            orderBy: { seq: "desc" },
            take: 1,
          },
        },
      })
    : null;
  const report = latestRun ? latestReportFromEvents(latestRun.events) : null;
  const base = generateInvestorKit({
    projectName: snapshot.project.name,
    profile: snapshot.profile,
    evidence: snapshot.evidence,
    readiness: snapshot.readiness,
    report,
    financialModel: latestFinancial,
  });
  // Store the un-edited base so future regenerations stay deterministic, then
  // overlay any saved founder edits for the returned (and snapshot-visible) kit.
  await saveInvestorKit(projectId, base);
  const edits = (await getInvestorOS(projectId)).edits;
  return applyKitEdits(base, edits);
}

/**
 * Persist founder edits and return the latest kit with them applied. Generates
 * a base kit first if none exists yet so the founder's edits are never dropped.
 */
export async function updateInvestorKit(
  projectId: string,
  edits: InvestorKitEdits
): Promise<InvestorKit> {
  const os = await saveInvestorKitEdits(projectId, edits);
  const base = os.kits[0];
  if (!base) return createInvestorKit(projectId);
  return applyKitEdits(base, os.edits);
}

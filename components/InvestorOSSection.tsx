"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileDown,
  FileText,
  FolderKanban,
  FolderOpen,
  Gauge,
  Globe2,
  Landmark,
  Layers3,
  LineChart,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  EvidenceItem,
  InvestorKit,
  InvestorKitEdits,
  InvestorStage,
  ReadinessGate,
  RoadmapItem,
} from "@/lib/schema";
import { downloadDossier, slug, type Dossier } from "./pdf";
import { providerErrorMessage } from "@/lib/providerErrors";

type Readiness = {
  score: number;
  status: "draft" | "investor_ready";
  investorReady: boolean;
  gates: ReadinessGate[];
  blockers: string[];
  evidenceCount: number;
  latestRunId: string | null;
  generatedAt: string;
};

const STAGES: { id: InvestorStage; label: string }[] = [
  { id: "define", label: "Define" },
  { id: "validate", label: "Validate" },
  { id: "build", label: "Build" },
  { id: "launch", label: "Launch" },
  { id: "prove", label: "Prove" },
  { id: "fundraise", label: "Fundraise" },
  { id: "grow", label: "Grow" },
];

type FundingMarket = "local" | "international";
type FundraiseWorkspaceTab = "rounds" | "ask" | "deck" | "projections";
type GrowWorkspaceTab = "markets" | "loops" | "capital" | "proof";
type KitArtifactKind = "deck" | "memo" | "dataRoom" | "qa" | "projections";

const STAGE_DETAILS: Record<
  InvestorStage,
  { label: string; outcome: string; focus: string }
> = {
  define: {
    label: "Define",
    outcome: "A sharp venture thesis, founder story and first investor claim.",
    focus: "Product, audience, category, founder-market fit and proof gaps.",
  },
  validate: {
    label: "Validate",
    outcome: "Customer and market proof that narrows what should be built.",
    focus: "Audience evidence, competitor context, willingness to pay and objections.",
  },
  build: {
    label: "Build",
    outcome: "A product, operating model and brand system that can survive launch.",
    focus: "Product scope, supply path, compliance, differentiation and delivery risk.",
  },
  launch: {
    label: "Launch",
    outcome: "A measurable first GTM experiment with a clear spend ceiling.",
    focus: "Channel plan, campaign assumptions, launch simulation and kill criteria.",
  },
  prove: {
    label: "Prove",
    outcome: "Real or simulated traction that an investor can diligence.",
    focus: "Sales, waitlist, LOIs, pilots, outcomes and proof against the forecast.",
  },
  fundraise: {
    label: "Fundraise",
    outcome: "An ask, round path, deck, memo, projection pack and data room.",
    focus: "Local/international round strategy, use of funds, investor story and caveats.",
  },
  grow: {
    label: "Grow",
    outcome: "A repeatable growth engine with expansion capital tied to proof.",
    focus: "Local density, international wedges, growth loops and scaling constraints.",
  },
};

const FUNDRAISE_TABS: {
  id: FundraiseWorkspaceTab;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "rounds", label: "Rounds", icon: Landmark },
  { id: "ask", label: "Ask", icon: WalletCards },
  { id: "deck", label: "Deck", icon: FileText },
  { id: "projections", label: "Projections", icon: LineChart },
];

const GROW_TABS: {
  id: GrowWorkspaceTab;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "markets", label: "Markets", icon: Globe2 },
  { id: "loops", label: "Loops", icon: Rocket },
  { id: "capital", label: "Capital", icon: WalletCards },
  { id: "proof", label: "Proof", icon: BarChart3 },
];

const FUNDING_MARKET_PLAYBOOKS: Record<
  FundingMarket,
  {
    label: string;
    headline: string;
    fit: string;
    roundTypes: string[];
    diligence: string[];
    nextMoves: string[];
  }
> = {
  local: {
    label: "Local",
    headline: "Local rounds",
    fit: "Best when the first wedge, customers, supply path and sales motion are concentrated in the home market.",
    roundTypes: [
      "Founder capital or validation budget",
      "Angel/pre-seed cheque",
      "Local accelerator or micro-VC",
      "Revenue-based, distributor or working-capital partner",
    ],
    diligence: [
      "Local customer proof and CAC assumptions",
      "Margin, fulfilment and payment-cycle evidence",
      "Founder-market fit and operating discipline",
    ],
    nextMoves: [
      "Pick the smallest cheque that clears the next evidence gate.",
      "Anchor the ask to 6-9 months of runway unless traction is already strong.",
      "Keep the story close to one city, segment or channel before broadening.",
    ],
  },
  international: {
    label: "International",
    headline: "International rounds",
    fit: "Best when cross-border demand, diaspora pull, export economics or strategic distribution already show up in the evidence.",
    roundTypes: [
      "Cross-border angel syndicate",
      "Seed fund with geography thesis",
      "Strategic distributor/importer advance",
      "Export, grant or venture-debt layer after repeatable demand",
    ],
    diligence: [
      "Country-level demand and pricing proof",
      "Duties, logistics, compliance and local competition",
      "Clear reason the company can win outside the home market",
    ],
    nextMoves: [
      "Run one target-country proof sprint before pitching a global story.",
      "Model landed cost, refund/returns and fulfilment lead time separately.",
      "Use international capital for proven expansion, not unresolved local validation.",
    ],
  },
};

type StageWindowGuidance = {
  headline: string;
  spendRule: string;
  cards: { title: string; items: string[] }[];
};

const STAGE_WINDOW_GUIDANCE: Record<InvestorStage, StageWindowGuidance> = {
  define: {
    headline: "Turn founder intent into one investable thesis before money is committed.",
    spendRule:
      "Spend only on clarification: founder story, category definition, customer segment and proof map.",
    cards: [
      {
        title: "Thesis stress test",
        items: [
          "One customer, one urgent job and one reason this team should win.",
          "A wedge small enough to test, but large enough to compound if true.",
          "A clear claim that later evidence can confirm or kill.",
        ],
      },
      {
        title: "Founder-market fit",
        items: [
          "Document lived access, domain insight, supply advantage or distribution edge.",
          "Name the missing capability that must be hired, partnered or de-risked.",
          "Tie founder credibility to the first market, not the eventual vision.",
        ],
      },
      {
        title: "Definition artifacts",
        items: [
          "Venture one-liner",
          "Customer and use-case map",
          "Founder story proof",
          "Evidence backlog",
        ],
      },
    ],
  },
  validate: {
    headline: "Prove a specific buyer cares before building a broader operation.",
    spendRule:
      "Use a capped validation budget; avoid inventory, hiring or ad scale until objections and willingness to pay are understood.",
    cards: [
      {
        title: "Local validation window",
        items: [
          "Pick 2-3 localities where access, supply and cultural context are strongest.",
          "Run interviews, smoke tests, preorder pages or LOI outreach against one segment.",
          "Compare willingness to pay against the current price and margin assumptions.",
        ],
      },
      {
        title: "International validation window",
        items: [
          "Test only one target country or diaspora wedge at a time.",
          "Separate demand from landed-cost, compliance and fulfilment friction.",
          "Require stronger proof before using international demand in the raise story.",
        ],
      },
      {
        title: "Pass/fail signals",
        items: [
          "Buyers repeat the problem in their own words.",
          "The top objection has a fixable cause.",
          "At least one channel produces qualified leads below the planned CAC ceiling.",
        ],
      },
    ],
  },
  build: {
    headline: "Convert validation into a v1 that can be sold, fulfilled and defended.",
    spendRule:
      "Spend on the smallest product, supply and operating system that can produce real outcomes.",
    cards: [
      {
        title: "Scope lock",
        items: [
          "Cut non-essential SKUs, claims and features until the first proof loop works.",
          "Translate customer objections into product requirements and claims guardrails.",
          "Define what must be true before expanding the product surface.",
        ],
      },
      {
        title: "Operating proof",
        items: [
          "Attach supplier, compliance, fulfilment and quality-control evidence.",
          "Model lead times, refund exposure and inventory cash lockup.",
          "Document the manual process before automating it.",
        ],
      },
      {
        title: "Investor artifacts",
        items: [
          "Product spec",
          "Ops risk register",
          "Supplier/compliance notes",
          "Brand and differentiation proof",
        ],
      },
    ],
  },
  launch: {
    headline: "Buy one channel truth, then decide whether to scale, pause or reposition.",
    spendRule:
      "Set the spend ceiling before launch; scale only after CAC, conversion and refund assumptions hold together.",
    cards: [
      {
        title: "Experiment design",
        items: [
          "Choose one primary channel and one backup channel.",
          "Define audience, offer, creative angle, budget, dates and kill criteria.",
          "Connect launch results back to the financial model, not just traffic.",
        ],
      },
      {
        title: "Projection hook",
        items: [
          "Use the launch simulation as the expected-case forecast.",
          "Log actual revenue, units, CAC, refunds and inventory impact after launch.",
          "Treat deviations as model updates before fundraising.",
        ],
      },
      {
        title: "Scale rules",
        items: [
          "Scale when paid demand, margin and fulfilment all stay inside tolerance.",
          "Pause when CAC or refunds break the contribution margin.",
          "Reposition when intent is high but conversion or price acceptance is weak.",
        ],
      },
    ],
  },
  prove: {
    headline: "Turn tests into diligence-grade traction, not just optimistic screenshots.",
    spendRule:
      "Spend to make proof harder and cleaner: paid demand, signed interest, repeat usage or revenue quality.",
    cards: [
      {
        title: "Proof hierarchy",
        items: [
          "Revenue, repeat purchase or paid pilot beats surveys.",
          "Signed LOIs or waitlists beat generic intent.",
          "Actual campaign outcomes beat simulated audience forecasts.",
        ],
      },
      {
        title: "Forecast comparison",
        items: [
          "Compare actual units, CAC, conversion and refund behavior against the projection.",
          "Record what improved, what broke and what the next model should assume.",
          "Make the investor story smaller if proof is narrow but strong.",
        ],
      },
      {
        title: "Proof artifacts",
        items: [
          "Outcome log",
          "Sales/waitlist/LOI evidence",
          "Backtest vs projection",
          "Customer quotes with context",
        ],
      },
    ],
  },
  fundraise: {
    headline: "Convert proof into an ask, a round path and diligence-ready materials.",
    spendRule:
      "Raise for the next milestone; do not ask for expansion money until validation, launch and proof risks are priced in.",
    cards: [],
  },
  grow: {
    headline: "Use expansion capital only after the growth loop has proof and a constraint.",
    spendRule:
      "Fund the bottleneck that is now limiting repeatable demand: market density, supply, channel capacity or team.",
    cards: [],
  },
};

const STATUS_TONE: Record<ReadinessGate["status"], string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
};

const SOURCE_TONE: Record<string, string> = {
  outcome: "bg-emerald-50 text-emerald-700",
  document: "bg-sky-50 text-sky-700",
  financial: "bg-indigo-50 text-indigo-700",
  simulation: "bg-amber-50 text-amber-700",
  website: "bg-violet-50 text-violet-700",
  market_data: "bg-cyan-50 text-cyan-700",
  founder: "bg-neutral-100 text-neutral-700",
  report: "bg-neutral-100 text-neutral-700",
  manual: "bg-neutral-100 text-neutral-700",
  conclusion: "bg-neutral-100 text-neutral-700",
};

type DataRoomRequirement = {
  label: string;
  tags?: string[];
  sourceTypes?: EvidenceItem["sourceType"][];
};

type DataRoomFolder = {
  id: string;
  label: string;
  description: string;
  tags: string[];
  requirements: DataRoomRequirement[];
};

const DATA_ROOM_FOLDERS: DataRoomFolder[] = [
  {
    id: "company",
    label: "Company",
    description: "Founder story, venture definition and company basics.",
    tags: ["founder", "team", "product", "define"],
    requirements: [
      { label: "Venture profile", tags: ["founder", "product"] },
      { label: "Founder-market fit", tags: ["team", "founder"] },
      { label: "Company proof document", sourceTypes: ["document"], tags: ["team", "founder"] },
    ],
  },
  {
    id: "market",
    label: "Market",
    description: "Demand, category context, competitors and pricing.",
    tags: ["market", "competitor", "market_data"],
    requirements: [
      { label: "Market demand evidence", tags: ["market"] },
      { label: "Competitor evidence", tags: ["competitor"] },
      { label: "Cited benchmark/source", sourceTypes: ["website", "market_data", "document"] },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    description: "Audience signal, interviews, objections and willingness to pay.",
    tags: ["customer_proof", "audience"],
    requirements: [
      { label: "Audience/persona signal", tags: ["audience", "customer_proof"] },
      { label: "Customer verbatims or objections", tags: ["customer_proof"] },
      { label: "Real validation proof", sourceTypes: ["document", "outcome", "manual"], tags: ["traction", "customer_proof"] },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    description: "Unit economics, market sizing, runway and assumptions.",
    tags: ["financials", "pricing"],
    requirements: [
      { label: "Financial model", sourceTypes: ["financial"] },
      { label: "Pricing or margin evidence", tags: ["pricing", "financials"] },
      { label: "Founder/data-backed assumption", sourceTypes: ["document", "manual", "market_data", "outcome"] },
    ],
  },
  {
    id: "product",
    label: "Product",
    description: "Product scope, differentiation and brand proof.",
    tags: ["product", "brand"],
    requirements: [
      { label: "Product definition", tags: ["product"] },
      { label: "Differentiation or brand proof", tags: ["brand", "product"] },
      { label: "Product/spec document", sourceTypes: ["document", "manual"] },
    ],
  },
  {
    id: "gtm",
    label: "GTM",
    description: "Channels, launch simulations, growth and social plan.",
    tags: ["gtm", "channel", "social", "launch"],
    requirements: [
      { label: "Channel plan", tags: ["channel", "gtm"] },
      { label: "Launch experiment or simulation", tags: ["launch", "gtm"], sourceTypes: ["simulation", "outcome", "manual"] },
      { label: "Social/growth proof", tags: ["social", "gtm"] },
    ],
  },
  {
    id: "legal_ops",
    label: "Legal/Ops",
    description: "Supply, fulfilment, compliance, contracts and operating risks.",
    tags: ["operations", "supply", "regulation"],
    requirements: [
      { label: "Operations or supply plan", tags: ["operations", "supply"] },
      { label: "Compliance/regulatory evidence", tags: ["regulation"] },
      { label: "Supplier/contract/procedure document", sourceTypes: ["document", "manual"] },
    ],
  },
  {
    id: "traction",
    label: "Traction",
    description: "Actual outcomes, pilots, sales, waitlist, LOIs or campaign proof.",
    tags: ["traction", "outcome"],
    requirements: [
      { label: "Actual outcome or pilot result", sourceTypes: ["outcome", "manual"], tags: ["traction"] },
      { label: "Sales/waitlist/LOI proof", sourceTypes: ["document", "manual"], tags: ["traction"] },
      { label: "Backtest or launch comparison", tags: ["traction", "launch"], sourceTypes: ["simulation", "outcome"] },
    ],
  },
];

function pct(n: number) {
  return `${Math.round(n)}%`;
}

function itemMatchesTags(item: EvidenceItem, tags: string[]): boolean {
  return tags.some((tag) => item.tags.includes(tag));
}

function itemMatchesRequirement(
  item: EvidenceItem,
  requirement: DataRoomRequirement
): boolean {
  const tagMatch = requirement.tags?.length
    ? itemMatchesTags(item, requirement.tags)
    : true;
  const sourceMatch = requirement.sourceTypes?.length
    ? requirement.sourceTypes.includes(item.sourceType)
    : true;
  return tagMatch && sourceMatch;
}

function folderEvidence(folder: DataRoomFolder, evidence: EvidenceItem[]) {
  return evidence.filter(
    (item) =>
      itemMatchesTags(item, folder.tags) ||
      folder.requirements.some((req) => itemMatchesRequirement(item, req))
  );
}

function readinessLabel(r: Readiness | null) {
  if (!r) return "Loading";
  return r.investorReady ? "Investor Ready" : "Draft";
}

function buildKitDossier(kit: InvestorKit): Dossier {
  const sections = [
    {
      heading: "Readiness",
      body: `Score: ${kit.readinessScore}/100. Status: ${kit.readinessStatus.replace("_", " ")}.`,
      bullets: kit.caveats,
    },
    {
      heading: "Pitch deck",
      table: {
        columns: ["Slide", "Provenance", "Key points"],
        rows: kit.artifacts.pitchDeck.slides.map((s) => [
          s.title,
          s.provenance,
          s.bullets.join(" "),
        ]),
      },
    },
    ...kit.artifacts.investorMemo.sections.map((s) => ({
      heading: `Memo: ${s.title}`,
      body: s.body,
    })),
    {
      heading: "Financial model summary",
      body: kit.artifacts.financialModelSummary.status,
      bullets: kit.artifacts.financialModelSummary.bullets,
    },
    {
      heading: "Data room index",
      bullets: kit.artifacts.dataRoomIndex,
    },
    {
      heading: "Investor Q&A",
      table: {
        columns: ["Question", "Answer"],
        rows: kit.artifacts.investorQA.map((q) => [q.question, q.answer]),
      },
    },
    {
      heading: "Use of funds",
      bullets: kit.artifacts.useOfFundsPlan,
    },
  ];
  return {
    title: kit.artifacts.pitchDeck.title,
    subtitle: "Investor fundraise kit",
    meta: [`Readiness ${kit.readinessScore}/100`, new Date(kit.createdAt).toLocaleDateString()],
    sections,
  };
}

function buildDeckDossier(kit: InvestorKit): Dossier {
  return {
    title: kit.artifacts.pitchDeck.title,
    subtitle: "Pitch deck",
    meta: [
      `${kit.artifacts.pitchDeck.slides.length} slides`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: kit.artifacts.pitchDeck.slides.map((slide, i) => ({
      heading: `${i + 1}. ${slide.title}`,
      bullets: slide.bullets,
      body: `Provenance: ${slide.provenance.replace("_", " ")}${
        slide.evidenceIds.length
          ? `\nEvidence IDs: ${slide.evidenceIds.join(", ")}`
          : ""
      }`,
      pageBreak: i > 0 && i % 3 === 0,
    })),
  };
}

function buildMemoDossier(kit: InvestorKit): Dossier {
  return {
    title: kit.artifacts.investorMemo.title,
    subtitle: "Investor memo",
    meta: [
      `${kit.artifacts.investorMemo.sections.length} sections`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      ...kit.artifacts.investorMemo.sections.map((section) => ({
        heading: section.title,
        body: section.body,
        bullets: section.evidenceIds.length
          ? [`Evidence IDs: ${section.evidenceIds.join(", ")}`]
          : undefined,
      })),
      {
        heading: "Financial model summary",
        body: kit.artifacts.financialModelSummary.status,
        bullets: kit.artifacts.financialModelSummary.bullets,
        pageBreak: true,
      },
      {
        heading: "Caveats",
        bullets: kit.caveats,
      },
    ],
  };
}

function buildDataRoomDossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} data room`,
    subtitle: "Data room index and readiness gaps",
    meta: [
      `Readiness ${kit.readinessScore}/100`,
      kit.readinessStatus.replace("_", " "),
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      {
        heading: "Data room index",
        bullets: kit.artifacts.dataRoomIndex,
      },
      {
        heading: "Readiness gates",
        table: {
          columns: ["Gate", "Status", "Score"],
          rows: kit.readinessSnapshot.map((gate) => [
            gate.name,
            gate.status,
            `${gate.score}/100`,
          ]),
        },
      },
      {
        heading: "Diligence caveats",
        bullets: kit.caveats,
      },
    ],
  };
}

function buildQADossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} investor Q&A`,
    subtitle: "Objection handling pack",
    meta: [
      `${kit.artifacts.investorQA.length} questions`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: kit.artifacts.investorQA.map((qa, i) => ({
      heading: `${i + 1}. ${qa.question}`,
      body: qa.answer,
      bullets: qa.evidenceIds.length
        ? [`Evidence IDs: ${qa.evidenceIds.join(", ")}`]
        : undefined,
    })),
  };
}

function buildProjectionDossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} projections`,
    subtitle: "Financial summary and use-of-funds pack",
    meta: [
      kit.artifacts.financialModelSummary.status,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      {
        heading: "Capital posture",
        bullets: kit.artifacts.financialModelSummary.bullets,
      },
      {
        heading: "Use of funds",
        bullets: kit.artifacts.useOfFundsPlan,
      },
      {
        heading: "Readiness caveats",
        bullets: kit.caveats,
      },
    ],
  };
}

function GateCard({ gate }: { gate: ReadinessGate }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-neutral-900">
            {gate.name}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            {gate.summary}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[gate.status]}`}
        >
          {pct(gate.score)}
        </span>
      </div>
      {gate.blockers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {gate.blockers.slice(0, 2).map((b) => (
            <li key={b} className="flex gap-1.5 text-[10px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <div className="grid gap-2 border-b border-neutral-100 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[9rem_1fr_5rem]">
      <div>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
            SOURCE_TONE[item.sourceType] ?? SOURCE_TONE.manual
          }`}
        >
          {item.sourceType.replace("_", " ")}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-neutral-900">{item.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
          {item.summary || item.investorRelevance}
        </p>
        {item.citation && /^https?:\/\//.test(item.citation) && (
          <a
            href={item.citation}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block max-w-full truncate text-[10px] text-indigo-600 underline"
          >
            {item.citation}
          </a>
        )}
      </div>
      <div className="text-right text-[11px] font-medium text-neutral-500">
        {pct(item.confidence * 100)}
      </div>
    </div>
  );
}

function averageGateScore(gates: ReadinessGate[]): number | null {
  if (!gates.length) return null;
  return Math.round(
    gates.reduce((sum, gate) => sum + gate.score, 0) / gates.length
  );
}

function stageStatusLabel(gates: ReadinessGate[]): string {
  if (!gates.length) return "Open";
  if (gates.every((gate) => gate.status === "ready")) return "Ready";
  if (gates.some((gate) => gate.status === "blocked")) return "Blocked";
  return "In progress";
}

function capitalGuidance(readiness: Readiness | null) {
  const score = readiness?.score ?? 0;
  if (score < 50) {
    return {
      posture: "Proof budget",
      runway: "4-8 weeks",
      ask: "Small internal, angel or grant-sized cheque",
      spend:
        "Spend on the next blocker only; defer brand scale, hiring and inventory depth.",
    };
  }
  if (score < 75) {
    return {
      posture: "Milestone round",
      runway: "6-9 months",
      ask: "Pre-seed or bridge-sized round tied to clear gate completion",
      spend:
        "Fund customer proof, launch experiments, data-room completion and unit-economics cleanup.",
    };
  }
  if (readiness?.investorReady) {
    return {
      posture: "Investor round",
      runway: "12-18 months",
      ask: "Seed or growth round sized to the next revenue and expansion milestone",
      spend:
        "Fund the proven constraint: acquisition, supply, market expansion or key hires.",
    };
  }
  return {
    posture: "Selective raise",
    runway: "9-12 months",
    ask: "Seed-style ask with explicit caveats for remaining critical gates",
    spend:
      "Keep the ask milestone-based and show exactly how each caveat gets retired.",
  };
}

function matchingEvidence(
  evidence: EvidenceItem[],
  tags: string[],
  limit = 6
): EvidenceItem[] {
  return evidence
    .filter((item) => tags.some((tag) => item.tags.includes(tag)))
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function SmallStat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "emerald" | "amber" | "sky";
}) {
  const tones = {
    neutral: "bg-neutral-50 text-neutral-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
  };
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-[11px] leading-relaxed text-neutral-600">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StageWorkspace({
  activeStage,
  gates,
  tasks,
  allRoadmap,
  evidence,
  readiness,
  kit,
  dataRoomCompletion,
  fundingMarket,
  onFundingMarketChange,
  fundraiseTab,
  onFundraiseTabChange,
  growTab,
  onGrowTabChange,
  kitBusy,
  editing,
  onGenerateKit,
  onDownloadKit,
  onDownloadArtifact,
  onEditKit,
  onCueStageEvidence,
}: {
  activeStage: InvestorStage;
  gates: ReadinessGate[];
  tasks: RoadmapItem[];
  allRoadmap: RoadmapItem[];
  evidence: EvidenceItem[];
  readiness: Readiness | null;
  kit: InvestorKit | null;
  dataRoomCompletion: number;
  fundingMarket: FundingMarket;
  onFundingMarketChange: (market: FundingMarket) => void;
  fundraiseTab: FundraiseWorkspaceTab;
  onFundraiseTabChange: (tab: FundraiseWorkspaceTab) => void;
  growTab: GrowWorkspaceTab;
  onGrowTabChange: (tab: GrowWorkspaceTab) => void;
  kitBusy: boolean;
  editing: boolean;
  onGenerateKit: () => void;
  onDownloadKit: () => void;
  onDownloadArtifact: (kind: KitArtifactKind) => void;
  onEditKit: () => void;
  onCueStageEvidence: (stage: InvestorStage) => void;
}) {
  const details = STAGE_DETAILS[activeStage];
  const avgScore = averageGateScore(gates);
  const status = stageStatusLabel(gates);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-neutral-900">
              {details.label} window
            </h3>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            {details.outcome}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
            {details.focus}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onCueStageEvidence(activeStage)}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-700"
          >
            <Plus className="h-3 w-3" />
            Cue evidence
          </button>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Stage score
            </p>
            <p className="text-sm font-semibold text-neutral-900">
              {avgScore == null ? "No gate" : `${avgScore}/100`}
            </p>
          </div>
        </div>
      </div>

      {activeStage === "fundraise" ? (
        <FundraiseStageWindow
          gates={gates}
          evidence={evidence}
          readiness={readiness}
          kit={kit}
          dataRoomCompletion={dataRoomCompletion}
          fundingMarket={fundingMarket}
          onFundingMarketChange={onFundingMarketChange}
          activeTab={fundraiseTab}
          onTabChange={onFundraiseTabChange}
          kitBusy={kitBusy}
          editing={editing}
          onGenerateKit={onGenerateKit}
          onDownloadKit={onDownloadKit}
          onDownloadArtifact={onDownloadArtifact}
          onEditKit={onEditKit}
        />
      ) : activeStage === "grow" ? (
        <GrowStageWindow
          evidence={evidence}
          readiness={readiness}
          kit={kit}
          activeTab={growTab}
          onTabChange={onGrowTabChange}
          allRoadmap={allRoadmap}
        />
      ) : (
        <GeneralStageWindow
          stage={activeStage}
          gates={gates}
          tasks={tasks}
          evidence={evidence}
        />
      )}
    </section>
  );
}

function GeneralStageWindow({
  stage,
  gates,
  tasks,
  evidence,
}: {
  stage: InvestorStage;
  gates: ReadinessGate[];
  tasks: RoadmapItem[];
  evidence: EvidenceItem[];
}) {
  const guidance = STAGE_WINDOW_GUIDANCE[stage];
  const blockers = gates.flatMap((gate) => gate.blockers).slice(0, 4);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const stageEvidence = matchingEvidence(
    evidence,
    [stage, ...gates.map((gate) => gate.id)],
    5
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SmallStat
          icon={Gauge}
          label="Gate posture"
          value={stageStatusLabel(gates)}
          tone={gates.some((g) => g.status === "blocked") ? "amber" : "emerald"}
        />
        <SmallStat
          icon={ClipboardList}
          label="Open tasks"
          value={`${openTasks.length}/${tasks.length || 0}`}
          tone="sky"
        />
        <SmallStat
          icon={Target}
          label="Proof items"
          value={`${stageEvidence.length}`}
        />
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
        <p className="text-xs font-semibold text-neutral-900">
          {guidance.headline}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
          {guidance.spendRule}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {guidance.cards.map((card) => (
          <div key={card.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="mb-2 text-xs font-semibold text-neutral-900">
              {card.title}
            </p>
            <BulletList items={card.items} />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Live blockers
          </p>
          {blockers.length ? (
            <ul className="mt-2 space-y-1.5">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-emerald-700">
              No blockers attached to this stage right now.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Best current proof
          </p>
          {stageEvidence.length ? (
            <ul className="mt-2 space-y-2">
              {stageEvidence.map((item) => (
                <li key={item.id} className="text-[11px]">
                  <p className="line-clamp-1 font-medium text-neutral-800">
                    {item.title}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-neutral-400">
                    {item.sourceType.replace("_", " ")} · {pct(item.confidence * 100)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-neutral-400">
              No tagged proof has landed in this stage yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FundraiseStageWindow({
  gates,
  evidence,
  readiness,
  kit,
  dataRoomCompletion,
  fundingMarket,
  onFundingMarketChange,
  activeTab,
  onTabChange,
  kitBusy,
  editing,
  onGenerateKit,
  onDownloadKit,
  onDownloadArtifact,
  onEditKit,
}: {
  gates: ReadinessGate[];
  evidence: EvidenceItem[];
  readiness: Readiness | null;
  kit: InvestorKit | null;
  dataRoomCompletion: number;
  fundingMarket: FundingMarket;
  onFundingMarketChange: (market: FundingMarket) => void;
  activeTab: FundraiseWorkspaceTab;
  onTabChange: (tab: FundraiseWorkspaceTab) => void;
  kitBusy: boolean;
  editing: boolean;
  onGenerateKit: () => void;
  onDownloadKit: () => void;
  onDownloadArtifact: (kind: KitArtifactKind) => void;
  onEditKit: () => void;
}) {
  const guidance = capitalGuidance(readiness);
  const activeMarket = FUNDING_MARKET_PLAYBOOKS[fundingMarket];
  const criticalGaps = gates
    .filter((gate) => gate.status !== "ready")
    .flatMap((gate) => gate.blockers.length ? gate.blockers : [`${gate.name} needs proof`])
    .slice(0, 4);
  const financialEvidence = matchingEvidence(evidence, [
    "financials",
    "pricing",
    "data_room",
  ]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {FUNDRAISE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                active
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-neutral-500 hover:bg-white hover:text-neutral-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "rounds" && (
        <div className="grid gap-4 xl:grid-cols-[16rem_1fr]">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Market route
            </p>
            <div className="mt-2 grid gap-2">
              {(["local", "international"] as const).map((market) => {
                const active = market === fundingMarket;
                return (
                  <button
                    key={market}
                    type="button"
                    onClick={() => onFundingMarketChange(market)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                      active
                        ? "border-indigo-300 bg-white text-indigo-700"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                    }`}
                  >
                    {FUNDING_MARKET_PLAYBOOKS[market].label}
                    <span className="mt-0.5 block text-[10px] font-normal text-neutral-400">
                      {market === "local" ? "Home-market first" : "Cross-border path"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  {activeMarket.headline}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  {activeMarket.fit}
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                {guidance.posture}
              </span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Round types
                </p>
                <BulletList items={activeMarket.roundTypes} />
              </div>
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Diligence focus
                </p>
                <BulletList items={activeMarket.diligence} />
              </div>
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Next moves
                </p>
                <BulletList items={activeMarket.nextMoves} />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "ask" && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <SmallStat icon={WalletCards} label="Posture" value={guidance.posture} tone="emerald" />
            <SmallStat icon={Gauge} label="Runway target" value={guidance.runway} tone="sky" />
            <SmallStat icon={Landmark} label="Round shape" value={guidance.ask} tone="neutral" />
            <SmallStat icon={Target} label="Spend rule" value="Milestone only" tone="amber" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-semibold text-neutral-900">
                Capital advice
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
                {guidance.spend}
              </p>
              <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Use of funds
                </p>
                <BulletList
                  items={
                    kit?.artifacts.useOfFundsPlan.length
                      ? kit.artifacts.useOfFundsPlan.slice(0, 6)
                      : [
                          "Complete critical readiness blockers first.",
                          "Fund the first measurable GTM experiment.",
                          "Keep working capital separate from learning budget.",
                          "Reserve runway for one iteration after the first result.",
                        ]
                  }
                />
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Ask blockers
              </p>
              {criticalGaps.length ? (
                <ul className="mt-2 space-y-1.5">
                  {criticalGaps.map((gap) => (
                    <li key={gap} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] text-emerald-700">
                  Critical fundraise gates are clear enough for external review.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "deck" && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          {kit ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  {kit.artifacts.pitchDeck.title}
                </p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {kit.artifacts.pitchDeck.slides.length} slides · {kit.artifacts.investorMemo.sections.length} memo sections · readiness {kit.readinessScore}/100
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {kit.artifacts.pitchDeck.slides.slice(0, 8).map((slide) => (
                    <div key={slide.title} className="rounded-lg border border-neutral-200 bg-white p-2">
                      <p className="text-[11px] font-semibold text-neutral-900">
                        {slide.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-neutral-500">
                        {slide.bullets[0] ?? "Slide ready for review."}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onDownloadArtifact("deck")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Deck PDF
                </button>
                <button
                  type="button"
                  onClick={() => onDownloadArtifact("memo")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-300"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Memo PDF
                </button>
                <button
                  type="button"
                  onClick={() => onDownloadArtifact("qa")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-300"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Q&amp;A PDF
                </button>
                <button
                  type="button"
                  onClick={onEditKit}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-300"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {editing ? "Close editor" : "Edit kit"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  No deck generated yet
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  Generate the kit after reviewing the ask tab so the deck, memo and Q&amp;A inherit the current readiness caveats.
                </p>
              </div>
              <button
                type="button"
                onClick={onGenerateKit}
                disabled={kitBusy}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {kitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate kit
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "projections" && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold text-neutral-900">
              Projection pack
            </p>
            {kit ? (
              <>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {kit.artifacts.financialModelSummary.status}
                </p>
                <div className="mt-3">
                  <BulletList items={kit.artifacts.financialModelSummary.bullets.slice(0, 6)} />
                </div>
              </>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                Generate the kit to bind the projection pack to the latest financial model and use-of-funds plan.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <SmallStat icon={FolderOpen} label="Data room" value={`${dataRoomCompletion}%`} tone="emerald" />
            <SmallStat icon={Target} label="Financial proof" value={`${financialEvidence.length} items`} tone="sky" />
            {kit ? (
              <>
                <button
                  type="button"
                  onClick={() => onDownloadArtifact("projections")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Projection PDF
                </button>
                <button
                  type="button"
                  onClick={onDownloadKit}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-300"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Full kit PDF
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onGenerateKit}
                disabled={kitBusy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {kitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate kit
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GrowStageWindow({
  evidence,
  readiness,
  kit,
  activeTab,
  onTabChange,
  allRoadmap,
}: {
  evidence: EvidenceItem[];
  readiness: Readiness | null;
  kit: InvestorKit | null;
  activeTab: GrowWorkspaceTab;
  onTabChange: (tab: GrowWorkspaceTab) => void;
  allRoadmap: RoadmapItem[];
}) {
  const guidance = capitalGuidance(readiness);
  const growthEvidence = matchingEvidence(evidence, [
    "traction",
    "outcome",
    "gtm",
    "channel",
    "social",
    "launch",
  ]);
  const growthTasks = allRoadmap
    .filter(
      (task) =>
        (["launch", "prove", "grow"] as InvestorStage[]).includes(task.stage) ||
        /growth/i.test(task.ownerRole)
    )
    .slice(0, 5);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {GROW_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                active
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-neutral-500 hover:bg-white hover:text-neutral-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "markets" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-emerald-700" />
              <p className="text-xs font-semibold text-neutral-900">
                Local density
              </p>
            </div>
            <BulletList
              items={[
                "Double down where CAC, fulfilment and customer proof are already strongest.",
                "Add sales capacity only after the first channel has repeatable economics.",
                "Use local expansion to raise confidence before opening new operating complexity.",
              ]}
            />
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-sky-700" />
              <p className="text-xs font-semibold text-neutral-900">
                International wedge
              </p>
            </div>
            <BulletList
              items={[
                "Enter one country, segment or diaspora channel before broad international spend.",
                "Model landed cost, compliance, fulfilment time and refunds separately from demand.",
                "Treat cross-border revenue as expansion proof only after delivery quality holds.",
              ]}
            />
          </div>
        </div>
      )}

      {activeTab === "loops" && (
        <div className="grid gap-3 lg:grid-cols-3">
          {[
            {
              title: "Acquisition loop",
              items: [
                "One channel with repeatable creative and offer learning.",
                "CAC tracked against contribution margin, not traffic.",
                "Budget increases only when conversion stays inside tolerance.",
              ],
            },
            {
              title: "Retention loop",
              items: [
                "Repeat purchase, referral or usage signal captured in evidence.",
                "Customer objection fixes feed back into product and messaging.",
                "Refund and support burden stays below the planned threshold.",
              ],
            },
            {
              title: "Operating loop",
              items: [
                "Supply and fulfilment capacity scale without damaging margin.",
                "Manual process has owners, cadence and exception handling.",
                "Hiring follows proven bottlenecks instead of generic headcount.",
              ],
            },
          ].map((card) => (
            <div key={card.title} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="mb-2 text-xs font-semibold text-neutral-900">
                {card.title}
              </p>
              <BulletList items={card.items} />
            </div>
          ))}
        </div>
      )}

      {activeTab === "capital" && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold text-neutral-900">
              Growth capital rule
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
              {guidance.spend}
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {[
                "More demand when CAC and margin already work",
                "More supply when orders are constrained by capacity",
                "More team when execution bottlenecks are proven and recurring",
              ].map((item) => (
                <div key={item} className="rounded-lg border border-neutral-200 bg-white p-2 text-[11px] leading-relaxed text-neutral-600">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <SmallStat icon={WalletCards} label="Capital posture" value={guidance.posture} tone="emerald" />
            <SmallStat icon={Gauge} label="Runway target" value={guidance.runway} tone="sky" />
            <SmallStat
              icon={LineChart}
              label="Projection pack"
              value={kit ? kit.artifacts.financialModelSummary.status : "Not generated"}
              tone="neutral"
            />
          </div>
        </div>
      )}

      {activeTab === "proof" && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold text-neutral-900">
              Growth proof feed
            </p>
            {growthEvidence.length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {growthEvidence.map((item) => (
                  <div key={item.id} className="rounded-lg border border-neutral-200 bg-white p-2">
                    <p className="line-clamp-1 text-[11px] font-semibold text-neutral-900">
                      {item.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-neutral-500">
                      {item.summary || item.investorRelevance}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-neutral-400">
                Growth evidence appears here after launch, traction and channel proof is attached.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Adjacent tasks
            </p>
            {growthTasks.length ? (
              <ul className="mt-2 space-y-2">
                {growthTasks.map((task) => (
                  <li key={task.id} className="text-[11px]">
                    <p className="font-medium text-neutral-800">{task.title}</p>
                    <p className="mt-0.5 text-[10px] text-neutral-400">
                      {task.stage} · {task.status}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-neutral-400">
                No growth-adjacent tasks yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_EDITS: InvestorKitEdits = {
  deckSlides: {},
  memoSections: {},
  qaAnswers: {},
  useOfFundsPlan: null,
  financialBullets: null,
  updatedAt: null,
};

function joinLines(arr: string[]): string {
  return arr.join("\n");
}

function splitLines(s: string): string[] {
  return s
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
}

function FieldLabel({
  text,
  edited,
  onRevert,
}: {
  text: string;
  edited: boolean;
  onRevert?: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-neutral-700">{text}</span>
      {edited && (
        <button
          type="button"
          onClick={onRevert}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium text-indigo-600 hover:bg-indigo-50"
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Revert to generated
        </button>
      )}
    </div>
  );
}

// Edits the founder makes here are stored as overrides keyed by slide/section
// title (and by question for Q&A). Only fields the founder actually changes
// become overrides, so untouched sections keep regenerating from fresh
// evidence and "Revert to generated" cleanly drops the override.
function KitEditor({
  kit,
  initialEdits,
  saving,
  onSave,
  onCancel,
}: {
  kit: InvestorKit;
  initialEdits: InvestorKitEdits;
  saving: boolean;
  onSave: (edits: InvestorKitEdits) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<InvestorKitEdits>(() =>
    structuredClone(initialEdits)
  );

  const taClass =
    "w-full resize-y rounded-lg border border-neutral-300 px-2 py-1.5 text-[11px] leading-relaxed outline-none focus:border-indigo-500";

  function setSlide(title: string, text: string) {
    setDraft((d) => ({
      ...d,
      deckSlides: { ...d.deckSlides, [title]: splitLines(text) },
    }));
  }
  function revertSlide(title: string) {
    setDraft((d) => {
      const next = { ...d.deckSlides };
      delete next[title];
      return { ...d, deckSlides: next };
    });
  }
  function setMemo(title: string, text: string) {
    setDraft((d) => ({
      ...d,
      memoSections: { ...d.memoSections, [title]: text },
    }));
  }
  function revertMemo(title: string) {
    setDraft((d) => {
      const next = { ...d.memoSections };
      delete next[title];
      return { ...d, memoSections: next };
    });
  }
  function setQa(question: string, text: string) {
    setDraft((d) => ({
      ...d,
      qaAnswers: { ...d.qaAnswers, [question]: text },
    }));
  }
  function revertQa(question: string) {
    setDraft((d) => {
      const next = { ...d.qaAnswers };
      delete next[question];
      return { ...d, qaAnswers: next };
    });
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Edit fundraise kit
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Save edits
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Refine any section. Only sections you change are stored as overrides, so
        regenerating the kit keeps your wording and untouched sections stay
        sourced from the latest evidence. One bullet or line per row.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Pitch deck slides
          </p>
          {kit.artifacts.pitchDeck.slides.map((slide) => {
            const edited = draft.deckSlides[slide.title] !== undefined;
            const value = edited
              ? joinLines(draft.deckSlides[slide.title])
              : joinLines(slide.bullets);
            return (
              <div key={slide.title}>
                <FieldLabel
                  text={slide.title}
                  edited={edited}
                  onRevert={() => revertSlide(slide.title)}
                />
                <textarea
                  rows={Math.max(2, value.split("\n").length)}
                  value={value}
                  onChange={(e) => setSlide(slide.title, e.target.value)}
                  className={taClass}
                />
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Investor memo
          </p>
          {kit.artifacts.investorMemo.sections.map((section) => {
            const edited = draft.memoSections[section.title] !== undefined;
            const value = edited
              ? draft.memoSections[section.title]
              : section.body;
            return (
              <div key={section.title}>
                <FieldLabel
                  text={section.title}
                  edited={edited}
                  onRevert={() => revertMemo(section.title)}
                />
                <textarea
                  rows={3}
                  value={value}
                  onChange={(e) => setMemo(section.title, e.target.value)}
                  className={taClass}
                />
              </div>
            );
          })}

          <div>
            <FieldLabel
              text="Financial model bullets"
              edited={draft.financialBullets !== null}
              onRevert={() =>
                setDraft((d) => ({ ...d, financialBullets: null }))
              }
            />
            <textarea
              rows={4}
              value={joinLines(
                draft.financialBullets ?? kit.artifacts.financialModelSummary.bullets
              )}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  financialBullets: splitLines(e.target.value),
                }))
              }
              className={taClass}
            />
          </div>

          <div>
            <FieldLabel
              text="Use of funds"
              edited={draft.useOfFundsPlan !== null}
              onRevert={() =>
                setDraft((d) => ({ ...d, useOfFundsPlan: null }))
              }
            />
            <textarea
              rows={5}
              value={joinLines(
                draft.useOfFundsPlan ?? kit.artifacts.useOfFundsPlan
              )}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  useOfFundsPlan: splitLines(e.target.value),
                }))
              }
              className={taClass}
            />
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Investor Q&amp;A
        </p>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {kit.artifacts.investorQA.map((qa) => {
            const edited = draft.qaAnswers[qa.question] !== undefined;
            const value = edited ? draft.qaAnswers[qa.question] : qa.answer;
            return (
              <div key={qa.question}>
                <FieldLabel
                  text={qa.question}
                  edited={edited}
                  onRevert={() => revertQa(qa.question)}
                />
                <textarea
                  rows={3}
                  value={value}
                  onChange={(e) => setQa(qa.question, e.target.value)}
                  className={taClass}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function InvestorOSSection({
  projectId,
  refreshKey = 0,
}: {
  projectId: string | null;
  refreshKey?: number;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [kit, setKit] = useState<InvestorKit | null>(null);
  const [kitEdits, setKitEdits] = useState<InvestorKitEdits>(EMPTY_EDITS);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kitBusy, setKitBusy] = useState(false);
  const [kitSaving, setKitSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eSummary, setESummary] = useState("");
  const [eTags, setETags] = useState("traction, customer_proof");
  const [proofTaskId, setProofTaskId] = useState<string | null>(null);
  const [proofTitle, setProofTitle] = useState("");
  const [proofSummary, setProofSummary] = useState("");
  const [proofCitation, setProofCitation] = useState("");
  const [activeFolderId, setActiveFolderId] = useState(DATA_ROOM_FOLDERS[0].id);
  const [activeStageId, setActiveStageId] =
    useState<InvestorStage>("validate");
  const [fundingMarket, setFundingMarket] =
    useState<FundingMarket>("local");
  const [fundraiseTab, setFundraiseTab] =
    useState<FundraiseWorkspaceTab>("rounds");
  const [growTab, setGrowTab] = useState<GrowWorkspaceTab>("markets");

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const [readinessRes, evidenceRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/readiness`),
        fetch(`/api/projects/${projectId}/evidence`),
      ]);
      if (!readinessRes.ok) throw new Error(`readiness failed (${readinessRes.status})`);
      if (!evidenceRes.ok) throw new Error(`evidence failed (${evidenceRes.status})`);
      const readinessJson = await readinessRes.json();
      const evidenceJson = await evidenceRes.json();
      setReadiness(readinessJson.readiness);
      setRoadmap(readinessJson.roadmap ?? []);
      setKit(readinessJson.latestKit ?? null);
      setKitEdits(readinessJson.kitEdits ?? EMPTY_EDITS);
      setEvidence(evidenceJson.evidence ?? []);
    } catch (e) {
      setError(providerErrorMessage(e, "Investor OS failed to load."));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const gatesByStage = useMemo(() => {
    const map = new Map<InvestorStage, ReadinessGate[]>();
    for (const gate of readiness?.gates ?? []) {
      map.set(gate.stage, [...(map.get(gate.stage) ?? []), gate]);
    }
    return map;
  }, [readiness]);

  const dataRoom = useMemo(
    () =>
      DATA_ROOM_FOLDERS.map((folder) => {
        const items = folderEvidence(folder, evidence);
        const missing = folder.requirements
          .filter(
            (req) => !evidence.some((item) => itemMatchesRequirement(item, req))
          )
          .map((req) => req.label);
        return {
          ...folder,
          evidence: items,
          missing,
          complete: folder.requirements.length - missing.length,
        };
      }),
    [evidence]
  );

  const activeFolder =
    dataRoom.find((folder) => folder.id === activeFolderId) ?? dataRoom[0];

  const dataRoomCompletion = useMemo(() => {
    const total = dataRoom.reduce((sum, folder) => sum + folder.requirements.length, 0);
    const done = dataRoom.reduce((sum, folder) => sum + folder.complete, 0);
    return total ? Math.round((100 * done) / total) : 0;
  }, [dataRoom]);

  const activeStage =
    STAGES.find((stage) => stage.id === activeStageId)?.id ?? "validate";
  const activeStageGates = gatesByStage.get(activeStage) ?? [];
  const activeStageTasks = roadmap.filter((item) => item.stage === activeStage);

  async function refreshReadiness() {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/readiness`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      const json = await res.json();
      setReadiness(json.readiness);
      setRoadmap(json.roadmap ?? []);
      setKit(json.latestKit ?? null);
      setKitEdits(json.kitEdits ?? EMPTY_EDITS);
      const ev = await fetch(`/api/projects/${projectId}/evidence`);
      if (ev.ok) setEvidence((await ev.json()).evidence ?? []);
    } catch (e) {
      setError(providerErrorMessage(e, "Refresh failed."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(item: RoadmapItem) {
    if (!projectId) return;
    const status =
      item.status === "todo" ? "doing" : item.status === "doing" ? "done" : "todo";
    const prior = roadmap;
    setRoadmap((items) =>
      items.map((i) => (i.id === item.id ? { ...i, status } : i))
    );
    try {
      const res = await fetch(`/api/projects/${projectId}/roadmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { id: item.id, status } }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setRoadmap((await res.json()).roadmap ?? []);
    } catch {
      setRoadmap(prior);
    }
  }

  function proofTagsFor(item: RoadmapItem): string[] {
    const tags = new Set<string>([
      "manual",
      item.stage,
      item.type,
      ...item.linkedGateIds,
    ]);
    if (item.stage === "prove") tags.add("traction");
    if (item.stage === "fundraise") tags.add("data_room");
    if (item.type === "document") tags.add("document");
    if (item.type === "metric") tags.add("financials");
    return [...tags];
  }

  function openProof(item: RoadmapItem) {
    setProofTaskId(item.id);
    setProofTitle(item.title);
    setProofSummary(
      item.requiredProof.length
        ? `Proof attached for: ${item.requiredProof.join(", ")}`
        : item.detail
    );
    setProofCitation("");
  }

  function cueFolderEvidence(folder: DataRoomFolder) {
    setETitle(`${folder.label} proof`);
    setESummary("");
    setETags(Array.from(new Set([...folder.tags, "data_room"])).join(", "));
  }

  function cueStageEvidence(stage: InvestorStage) {
    const stageGates = gatesByStage.get(stage) ?? [];
    setETitle(`${STAGE_DETAILS[stage].label} proof`);
    setESummary("");
    setETags(
      Array.from(
        new Set(["manual", stage, ...stageGates.map((gate) => gate.id)])
      ).join(", ")
    );
  }

  async function attachTaskProof(e: React.FormEvent, item: RoadmapItem) {
    e.preventDefault();
    if (!projectId || !proofTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const evidenceRes = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proofTitle.trim(),
          summary: proofSummary.trim() || item.detail,
          citation: proofCitation.trim() || null,
          investorRelevance: `Proof that roadmap task "${item.title}" was completed.`,
          tags: proofTagsFor(item),
        }),
      });
      if (!evidenceRes.ok) {
        throw new Error(`evidence save failed (${evidenceRes.status})`);
      }
      const evidenceJson = await evidenceRes.json();
      const evidenceId = evidenceJson.evidence?.id;
      if (!evidenceId) throw new Error("evidence save returned no id");

      const roadmapRes = await fetch(`/api/projects/${projectId}/roadmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            id: item.id,
            status: "done",
            evidenceIds: Array.from(new Set([...item.evidenceIds, evidenceId])),
          },
        }),
      });
      if (!roadmapRes.ok) {
        throw new Error(`roadmap save failed (${roadmapRes.status})`);
      }
      setRoadmap((await roadmapRes.json()).roadmap ?? []);
      setProofTaskId(null);
      setProofTitle("");
      setProofSummary("");
      setProofCitation("");
      await load();
    } catch (e) {
      setError(providerErrorMessage(e, "Could not attach proof."));
    } finally {
      setBusy(false);
    }
  }

  async function addEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !eTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: eTitle.trim(),
          summary: eSummary.trim(),
          tags: eTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const json = await res.json();
      setEvidence(json.allEvidence ?? evidence);
      setReadiness(json.readiness ?? readiness);
      setETitle("");
      setESummary("");
      await refreshReadiness();
    } catch (e) {
      setError(providerErrorMessage(e, "Could not add evidence."));
    } finally {
      setBusy(false);
    }
  }

  async function generateKit() {
    if (!projectId || kitBusy) return;
    setKitBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/investor-kit`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`kit failed (${res.status})`);
      setKit((await res.json()).kit);
      await load();
    } catch (e) {
      setError(providerErrorMessage(e, "Fundraise kit generation failed."));
    } finally {
      setKitBusy(false);
    }
  }

  async function saveKitEdits(edits: InvestorKitEdits) {
    if (!projectId) return;
    setKitSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/investor-kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edits),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const json = await res.json();
      setKit(json.kit);
      setKitEdits(edits);
      setEditing(false);
    } catch (e) {
      setError(providerErrorMessage(e, "Could not save kit edits."));
    } finally {
      setKitSaving(false);
    }
  }

  function downloadKit() {
    if (!kit) return;
    const dossier = buildKitDossier(kit);
    downloadDossier(dossier, `${slug(dossier.title)}-fundraise-kit`);
  }

  function downloadKitArtifact(kind: KitArtifactKind) {
    if (!kit) return;
    const builders: Record<KitArtifactKind, (kit: InvestorKit) => Dossier> = {
      deck: buildDeckDossier,
      memo: buildMemoDossier,
      dataRoom: buildDataRoomDossier,
      qa: buildQADossier,
      projections: buildProjectionDossier,
    };
    const suffix: Record<KitArtifactKind, string> = {
      deck: "pitch-deck",
      memo: "investor-memo",
      dataRoom: "data-room",
      qa: "investor-qa",
      projections: "projections",
    };
    const dossier = builders[kind](kit);
    downloadDossier(dossier, `${slug(dossier.title)}-${suffix[kind]}`);
  }

  if (!projectId) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        Save this venture as a project to use the 0 to 100 Investor OS.
      </div>
    );
  }

  return (
    <div className="px-6 pb-12 pt-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
                0 to 100 Investor OS
              </h2>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Evidence-gated journey, execution roadmap and fundraise kit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refreshReadiness()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-score
            </button>
            <button
              onClick={() => void generateKit()}
              disabled={kitBusy}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {kitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate kit
            </button>
            {kit && (
              <button
                onClick={downloadKit}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-indigo-500"
              >
                <FileDown className="h-3.5 w-3.5" />
                PDF
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Readiness
              </p>
              <p className="mt-1 text-3xl font-semibold text-neutral-900">
                {readiness ? readiness.score : "--"}
                <span className="text-sm text-neutral-400">/100</span>
              </p>
            </div>
            <div className="min-w-48 flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full ${readiness?.investorReady ? "bg-emerald-500" : "bg-indigo-600"}`}
                  style={{ width: `${readiness?.score ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {readinessLabel(readiness)} · {readiness?.evidenceCount ?? 0} evidence items
                {readiness?.latestRunId ? " · linked to latest completed run" : ""}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              {readiness?.investorReady ? (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Investor-ready gates passed
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Draft exports allowed, badge blocked
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div role="tablist" className="grid gap-2 md:grid-cols-7">
            {STAGES.map((stage, i) => {
              const gates = gatesByStage.get(stage.id) ?? [];
              const ready = gates.length > 0 && gates.every((g) => g.status === "ready");
              const partial = gates.some((g) => g.status === "partial");
              const active = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveStageId(stage.id)}
                  className={`rounded-lg border p-2 text-left transition ${
                    active
                      ? "border-indigo-300 bg-white shadow-sm"
                      : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                        active
                          ? "bg-indigo-600 text-white"
                          : ready
                          ? "bg-emerald-600 text-white"
                          : partial
                            ? "bg-amber-500 text-white"
                            : "bg-neutral-200 text-neutral-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[11px] font-semibold text-neutral-800">
                      {stage.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    {gates.length ? `${gates.length} gate${gates.length === 1 ? "" : "s"}` : "No gate"}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <StageWorkspace
          activeStage={activeStage}
          gates={activeStageGates}
          tasks={activeStageTasks}
          allRoadmap={roadmap}
          evidence={evidence}
          readiness={readiness}
          kit={kit}
          dataRoomCompletion={dataRoomCompletion}
          fundingMarket={fundingMarket}
          onFundingMarketChange={setFundingMarket}
          fundraiseTab={fundraiseTab}
          onFundraiseTabChange={setFundraiseTab}
          growTab={growTab}
          onGrowTabChange={setGrowTab}
          kitBusy={kitBusy}
          editing={editing}
          onGenerateKit={() => void generateKit()}
          onDownloadKit={downloadKit}
          onDownloadArtifact={downloadKitArtifact}
          onEditKit={() => setEditing((v) => !v)}
          onCueStageEvidence={cueStageEvidence}
        />

        <div className="grid gap-4 xl:grid-cols-[1fr_25rem]">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Readiness gates
              </h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(readiness?.gates ?? []).map((gate) => (
                <GateCard key={gate.id} gate={gate} />
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Execution roadmap
              </h3>
            </div>
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {roadmap.length ? (
                roadmap.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleTask(item)}
                        title="Cycle task status"
                        className="mt-0.5 rounded p-0.5 hover:bg-white"
                      >
                        {item.status === "done" ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : item.status === "doing" ? (
                          <Loader2 className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-neutral-400" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-900">
                          {item.title}
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                          {item.detail}
                        </p>
                        <p className="mt-2 text-[10px] text-neutral-400">
                          {item.stage} · {item.type} · {item.ownerRole}
                          {item.evidenceIds.length > 0 &&
                            ` · ${item.evidenceIds.length} proof${item.evidenceIds.length === 1 ? "" : "s"}`}
                        </p>
                        {item.requiredProof.length > 0 && (
                          <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">
                            Proof needed: {item.requiredProof.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => openProof(item)}
                        className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-700"
                      >
                        <Paperclip className="h-3 w-3" />
                        Attach proof
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleTask(item)}
                        className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-500 hover:border-neutral-400"
                      >
                        {item.status === "done" ? "Reopen" : "Mark progress"}
                      </button>
                    </div>
                    {proofTaskId === item.id && (
                      <form
                        onSubmit={(e) => void attachTaskProof(e, item)}
                        className="mt-3 rounded-lg border border-indigo-100 bg-white p-2"
                      >
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
                          Attach proof
                        </p>
                        <input
                          value={proofTitle}
                          onChange={(e) => setProofTitle(e.target.value)}
                          placeholder="Proof title"
                          className="mb-2 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-[11px] outline-none focus:border-indigo-500"
                        />
                        <textarea
                          value={proofSummary}
                          onChange={(e) => setProofSummary(e.target.value)}
                          placeholder="What changed? Add the metric, finding, link, or file note."
                          rows={3}
                          className="mb-2 w-full resize-none rounded-lg border border-neutral-300 px-2 py-1.5 text-[11px] outline-none focus:border-indigo-500"
                        />
                        <input
                          value={proofCitation}
                          onChange={(e) => setProofCitation(e.target.value)}
                          placeholder="Optional URL or source note"
                          className="mb-2 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-[11px] outline-none focus:border-indigo-500"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={busy || !proofTitle.trim()}
                            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50"
                          >
                            Save proof + mark done
                          </button>
                          <button
                            type="button"
                            onClick={() => setProofTaskId(null)}
                            className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[10px] font-medium text-neutral-500"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
                  Roadmap tasks appear after the first readiness score.
                </p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-neutral-500" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Data room
                </h3>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                Evidence grouped into the folders an investor will expect.
              </p>
            </div>
            <div className="min-w-44">
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${dataRoomCompletion}%` }}
                />
              </div>
              <p className="mt-1 text-right text-[10px] font-medium text-neutral-500">
                {dataRoomCompletion}% complete
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[23rem_1fr]">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {dataRoom.map((folder) => {
                const active = folder.id === activeFolder.id;
                const complete = folder.missing.length === 0;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setActiveFolderId(folder.id)}
                    className={`rounded-lg border p-3 text-left transition ${
                      active
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-900">
                          {folder.label}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-neutral-500">
                          {folder.description}
                        </p>
                      </div>
                      {complete ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                          {folder.missing.length} missing
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[10px] text-neutral-400">
                      {folder.evidence.length} evidence item{folder.evidence.length === 1 ? "" : "s"} · {folder.complete}/{folder.requirements.length} checks
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {activeFolder.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                    {activeFolder.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cueFolderEvidence(activeFolder)}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[10px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-700"
                >
                  <Plus className="h-3 w-3" />
                  Add folder evidence
                </button>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Missing
                  </p>
                  {activeFolder.missing.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {activeFolder.missing.map((item) => (
                        <li
                          key={item}
                          className="flex gap-1.5 text-[11px] leading-relaxed text-amber-800"
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Folder has the expected proof types.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Strongest evidence
                  </p>
                  {activeFolder.evidence.length ? (
                    <ul className="mt-2 space-y-2">
                      {activeFolder.evidence
                        .slice()
                        .sort((a, b) => b.confidence - a.confidence)
                        .slice(0, 5)
                        .map((item) => (
                          <li key={item.id} className="text-[11px]">
                            <p className="line-clamp-1 font-medium text-neutral-800">
                              {item.title}
                            </p>
                            <p className="mt-0.5 text-[10px] text-neutral-400">
                              {item.sourceType.replace("_", " ")} · {pct(item.confidence * 100)}
                            </p>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-neutral-400">
                      No evidence in this folder yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_25rem]">
          <section className="rounded-xl border border-neutral-200 bg-white">
            <div className="border-b border-neutral-100 px-3 py-2">
              <h3 className="text-sm font-semibold text-neutral-900">
                Evidence ledger
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Claims, docs, financials, simulations and outcomes that support investor materials.
              </p>
            </div>
            <div className="max-h-[32rem] overflow-y-auto">
              {evidence.length ? (
                evidence.slice(0, 80).map((item) => (
                  <EvidenceRow key={item.id} item={item} />
                ))
              ) : (
                <p className="p-4 text-xs text-neutral-400">
                  Evidence appears as runs, reports, docs and outcomes are created.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <form
              onSubmit={(e) => void addEvidence(e)}
              className="rounded-xl border border-neutral-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Plus className="h-4 w-4 text-neutral-500" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Add manual evidence
                </h3>
              </div>
              <input
                value={eTitle}
                onChange={(e) => setETitle(e.target.value)}
                placeholder="Evidence title"
                className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
              <textarea
                value={eSummary}
                onChange={(e) => setESummary(e.target.value)}
                placeholder="Summary or metric"
                rows={3}
                className="mb-2 w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
              <input
                value={eTags}
                onChange={(e) => setETags(e.target.value)}
                placeholder="tags, comma separated"
                className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={busy || !eTitle.trim()}
                className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add evidence
              </button>
            </form>

            <section className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-900">
                  Fundraise room
                </h3>
                {kit && (
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    <Pencil className="h-3 w-3" />
                    {editing ? "Close editor" : "Edit kit"}
                  </button>
                )}
              </div>
              {kit ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs font-medium text-neutral-800">
                    {kit.artifacts.pitchDeck.title}
                  </p>
                  <p className="text-[11px] leading-relaxed text-neutral-500">
                    {kit.artifacts.pitchDeck.slides.length} slides · {kit.artifacts.investorMemo.sections.length} memo sections · readiness {kit.readinessScore}/100
                  </p>
                  {kit.editedSections.length > 0 && (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                      <Pencil className="h-3 w-3" />
                      {kit.editedSections.length} section
                      {kit.editedSections.length === 1 ? "" : "s"} edited · preserved on regeneration
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => downloadKitArtifact("deck")}
                      className="flex items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[10px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <FileDown className="h-3 w-3" />
                      Deck PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadKitArtifact("memo")}
                      className="flex items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[10px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <FileDown className="h-3 w-3" />
                      Memo PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadKitArtifact("dataRoom")}
                      className="flex items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[10px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <FileDown className="h-3 w-3" />
                      Data room
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadKitArtifact("qa")}
                      className="flex items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[10px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      <FileDown className="h-3 w-3" />
                      Q&amp;A PDF
                    </button>
                  </div>
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      Caveats
                    </p>
                    <ul className="mt-1 space-y-1">
                      {kit.caveats.slice(0, 4).map((c) => (
                        <li key={c} className="text-[11px] text-neutral-600">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                  Generate a full draft: deck, memo, financial summary, data room index, investor Q&A and use-of-funds plan.
                </p>
              )}
            </section>
          </section>
        </div>

        {kit && editing && (
          <KitEditor
            kit={kit}
            initialEdits={kitEdits}
            saving={kitSaving}
            onSave={(edits) => void saveKitEdits(edits)}
            onCancel={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  );
}

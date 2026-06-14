import { z } from "zod";

// ---------------------------------------------------------------------------
// Core domain types (SPEC §2). All LLM output is parsed through these schemas.
// ---------------------------------------------------------------------------

export const ConclusionSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  claim: z.string().max(120),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  // THIS FIELD DRIVES ENTANGLEMENT — required, min 1
  entities: z.array(z.string()).min(1),
  sources: z.array(z.string()),
});
export type Conclusion = z.infer<typeof ConclusionSchema>;

export const BlockStateSchema = z.enum([
  "spawning",
  "working",
  "concluded",
  "failed",
]);
export type BlockState = z.infer<typeof BlockStateSchema>;

export const BlockParamsSchema = z.record(z.union([z.number(), z.string()]));
export type BlockParams = z.infer<typeof BlockParamsSchema>;

// v2: every block has a kind and a domain — drives panels + network layout.
export const BlockKindSchema = z.enum(["research", "synthesis", "audience"]);
export type BlockKind = z.infer<typeof BlockKindSchema>;

export const DomainSchema = z.enum([
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
]);
export type Domain = z.infer<typeof DomainSchema>;

export const BlockSchema = z.object({
  id: z.string(),
  runId: z.string(),
  name: z.string(),
  mission: z.string(),
  layer: z.number().int().min(1),
  kind: BlockKindSchema.default("research"),
  domain: DomainSchema.default("market"),
  state: BlockStateSchema,
  inputBlockIds: z.array(z.string()),
  params: BlockParamsSchema,
  logs: z.array(z.string()),
  conclusions: z.array(ConclusionSchema),
});
export type Block = z.infer<typeof BlockSchema>;

export const EdgeKindSchema = z.enum(["entangle", "feeds"]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  runId: z.string(),
  fromBlockId: z.string(),
  toBlockId: z.string(),
  kind: EdgeKindSchema,
  reason: z.string(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const RunStatusSchema = z.enum([
  "interviewing",
  "planning",
  "running",
  "cancelling",
  "complete",
  "failed",
  "capped",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// Funding: how much capital is actually available and how long it must last.
// capitalAvailable keeps the user's own words/currency (e.g. "₹40 lakh").
export const FundingSchema = z.object({
  capitalAvailable: z.string().nullable().default(null),
  runwayMonths: z.number().nullable().default(null),
});
export type Funding = z.infer<typeof FundingSchema>;

export const ClientProfileSchema = z.object({
  ambitions: z.string(),
  product: z.string(),
  capitalInr: z.number().nullable(),
  experience: z.string(),
  scale: z.string(),
  restrictions: z.array(z.string()),
  goal: z.string(),
  // Venture-profile fields (optional so profiles saved before these existed
  // still parse).
  category: z.string().optional(),
  priceBand: z.string().optional(),
  geography: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  funding: FundingSchema.nullable().optional(),
  // Numeric financial targets captured at intake — feed the Financials module
  // as founder-entered ground truth. All optional/nullable so profiles saved
  // before these existed still parse. Currency follows the venture (capitalInr
  // is the legacy INR field; these are in the venture's working currency).
  targetMarginPct: z.number().min(0).max(100).nullable().optional(),
  priceMin: z.number().min(0).nullable().optional(),
  priceMax: z.number().min(0).nullable().optional(),
  acceptableCac: z.number().min(0).nullable().optional(),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const RunSchema = z.object({
  id: z.string(),
  brief: z.string(),
  clientProfile: ClientProfileSchema,
  status: RunStatusSchema,
  parentRunId: z.string().nullable(),
  forkPointBlockId: z.string().nullable(),
  tokensUsed: z.number(),
  costUsd: z.number().default(0),
  createdAt: z.coerce.date(),
});
export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------
// v2 audience simulation types
// ---------------------------------------------------------------------------

export const SegmentSchema = z.enum(["budget", "middle", "affluent", "luxury"]);
export type Segment = z.infer<typeof SegmentSchema>;

export const RoleSchema = z.enum([
  "consumer",
  "retail_exec",
  "institutional",
  "distributor",
  "influencer",
]);
export type Role = z.infer<typeof RoleSchema>;

export const PersonaSchema = z.object({
  id: z.string(),
  cohortId: z.string(),
  name: z.string(),
  age: z.number().int().min(16).max(90),
  gender: z.string(),
  occupation: z.string(),
  incomeBand: z.string(),
  lat: z.number(),
  lng: z.number(),
  intent: z.number().min(0).max(1),
  wtp: z.number().min(0),
  wtpCurrency: z.string(),
  channelPref: z.string(),
  platforms: z.array(z.string()),
  objection: z.string(),
  quote: z.string(),
  // Depth fields — the lived context that explains intent & WTP. Defaulted so
  // personas/events saved before these existed still parse.
  lifestyle: z.string().default(""),
  lifeStage: z.string().default(""),
  values: z.array(z.string()).default([]),
  shoppingHabits: z.string().default(""),
  priceSensitivity: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().default(""),
  // Distinct personality, flavoured by the persona's locality/culture.
  personality: z.string().default(""),
  personalityTraits: z.array(z.string()).default([]),
  // Win-back: original pre-chat intent (null until a chat moves the vote) and
  // the ISO timestamp of that change. Defaulted so older personas still parse.
  intentOriginal: z.number().min(0).max(1).nullable().default(null),
  voteChangedAt: z.string().nullable().default(null),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const CohortStatsSchema = z.object({
  n: z.number().int(),
  meanIntent: z.number(),
  wtpP25: z.number(),
  wtpP50: z.number(),
  wtpP75: z.number(),
  wtpCurrency: z.string(),
  topChannels: z.array(z.object({ name: z.string(), share: z.number() })),
  topPlatforms: z.array(z.object({ name: z.string(), share: z.number() })),
  topObjections: z.array(z.string()),
});
export type CohortStats = z.infer<typeof CohortStatsSchema>;

export const CohortStateSchema = z.enum([
  "pending",
  "simulating",
  "done",
  "failed",
]);
export type CohortState = z.infer<typeof CohortStateSchema>;

export const CohortSchema = z.object({
  id: z.string(),
  runId: z.string(),
  label: z.string(),
  locality: z.string(),
  country: z.string(),
  lat: z.number(),
  lng: z.number(),
  segment: SegmentSchema,
  role: RoleSchema,
  weightPct: z.number().min(0).max(100),
  size: z.number().int().min(1),
  state: CohortStateSchema,
  stats: CohortStatsSchema.nullable(),
  summary: z.string().nullable(),
});
export type Cohort = z.infer<typeof CohortSchema>;

const groupStat = z.object({
  n: z.number().int(),
  meanIntent: z.number(),
  wtpP50: z.number(),
});

export const AudienceAggregateSchema = z.object({
  totalPersonas: z.number().int(),
  totalCohorts: z.number().int(),
  bySegment: z.record(groupStat),
  byLocality: z.record(groupStat),
  byRole: z.record(groupStat),
  channelShare: z.array(z.object({ name: z.string(), share: z.number() })),
  platformShare: z.array(z.object({ name: z.string(), share: z.number() })),
  // platform -> segment -> share: the social-media affinity matrix
  platformMatrix: z.record(z.record(z.number())),
  topObjections: z.array(z.object({ text: z.string(), count: z.number() })),
});
export type AudienceAggregate = z.infer<typeof AudienceAggregateSchema>;

export const FinalReportSectionSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(2).max(8),
  citedConclusionIds: z.array(z.string()).default([]),
});
export type FinalReportSection = z.infer<typeof FinalReportSectionSchema>;

export const FinalReportSchema = z.object({
  title: z.string().min(1).max(120),
  executiveSummary: z.string().min(1),
  verdict: z.string().min(1),
  sections: z.array(FinalReportSectionSchema).min(6).max(12),
  nextActions: z.array(z.string().min(1)).min(3).max(10),
  risks: z.array(z.string().min(1)).min(2).max(8),
});
export type FinalReport = z.infer<typeof FinalReportSchema>;

// ---------------------------------------------------------------------------
// SSE event protocol (SPEC §2). Discriminated union on `type`.
// `seq` is a monotonic integer per run — the client uses it for replay/dedupe.
// ---------------------------------------------------------------------------

const eventBase = {
  runId: z.string(),
  seq: z.number().int(),
  ts: z.number(),
};

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("run_status"),
    status: RunStatusSchema,
    phaseLabel: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("block_spawned"),
    block: BlockSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("block_working"),
    blockId: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("block_log"),
    blockId: z.string(),
    line: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("block_concluded"),
    blockId: z.string(),
    conclusions: z.array(ConclusionSchema),
  }),
  z.object({
    ...eventBase,
    type: z.literal("block_failed"),
    blockId: z.string(),
    error: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("edge_added"),
    edge: EdgeSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("world_model_ready"),
    conclusionCount: z.number(),
    blockCount: z.number(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("final_report"),
    report: FinalReportSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("run_error"),
    message: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("tokens_used"),
    tokensUsed: z.number(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("cost_used"),
    costUsd: z.number(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("cohort_spawned"),
    cohort: CohortSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("cohort_simulated"),
    cohortId: z.string(),
    stats: CohortStatsSchema,
    summary: z.string(),
    personas: z.array(PersonaSchema),
  }),
  z.object({
    ...eventBase,
    type: z.literal("cohort_failed"),
    cohortId: z.string(),
    error: z.string(),
  }),
  // A single persona changed their vote via a 1:1 win-back chat. Folded into
  // the cohort's persona list so sentiment/charts re-derive (canvas = f(log)).
  z.object({
    ...eventBase,
    type: z.literal("persona_updated"),
    cohortId: z.string(),
    personaId: z.string(),
    intent: z.number().min(0).max(1),
    intentOriginal: z.number().min(0).max(1).nullable(),
    objection: z.string(),
    voteChangedAt: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("audience_aggregated"),
    aggregate: AudienceAggregateSchema,
  }),
  // A world-model query asked after the run converged + its answer, persisted
  // so the Conclusion panel's Q&A survives reload (canvas = f(event log)).
  z.object({
    ...eventBase,
    type: z.literal("conclusion_query"),
    question: z.string(),
    answer: z.string(),
    citedConclusionIds: z.array(z.string()).default([]),
    domains: z.array(z.string()).default([]),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];

// ---------------------------------------------------------------------------
// LLM call output shapes (SPEC §5). Parsed with one retry on failure.
// ---------------------------------------------------------------------------

export const PlannerOutputSchema = z.object({
  teams: z
    .array(
      z.object({
        name: z.string(),
        mission: z.string(),
        params: BlockParamsSchema.default({}),
      })
    )
    .min(2)
    .max(4),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// v2 planner: research desks + the audience cohort matrix, localized to the
// venture's geography (works for any country).
export const PlannerV2OutputSchema = z.object({
  desks: z
    .array(
      z.object({
        name: z.string(),
        domain: DomainSchema,
        mission: z.string(),
        useWebSearch: z.boolean().default(true),
        params: BlockParamsSchema.default({}),
      })
    )
    .min(4)
    .max(20),
  cohortPlan: z.object({
    currency: z.string(), // ISO code personas quote WTP in, e.g. "INR"
    localities: z
      .array(
        z.object({
          name: z.string(),
          country: z.string(),
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
        })
      )
      .min(1)
      .max(60),
    cohorts: z
      .array(
        z.object({
          locality: z.string(), // must match a localities[].name
          segment: SegmentSchema,
          role: RoleSchema,
          weightPct: z.number().min(0).max(100),
        })
      )
      .min(4)
      .max(160),
  }),
});
export type PlannerV2Output = z.infer<typeof PlannerV2OutputSchema>;

// One cohort-simulation call returns the requested number of individual personas
// (usually 25–50, but custom audience sizes can require tiny final batches).
// Length caps TRUNCATE instead of reject — a model that writes a slightly
// long summary/field must never fail (and waste tokens on) the whole cohort.
const cappedStr = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));
const cappedArr = (max: number) =>
  z.array(z.string()).transform((a) => a.slice(0, max));

export const CohortSimOutputSchema = z.object({
  summary: cappedStr(800).default(""),
  personas: z
    .array(
      z.object({
        name: z.string(),
        age: z.number().int().min(16).max(90),
        gender: z.string(),
        occupation: z.string(),
        incomeBand: z.string(),
        intent: z.number().min(0).max(1),
        wtp: z.number().min(0),
        channelPref: z.string(),
        platforms: cappedArr(8).default([]),
        objection: z.string(),
        quote: z.string(),
        // Depth fields. Defaulted + truncated so neither an omitted field nor
        // an over-long one ever fails the cohort.
        lifestyle: cappedStr(800).default(""),
        lifeStage: cappedStr(400).default(""),
        values: cappedArr(12).default([]),
        shoppingHabits: cappedStr(600).default(""),
        priceSensitivity: z.number().min(0).max(1).default(0.5),
        reasoning: cappedStr(1000).default(""),
        personality: cappedStr(700).default(""),
        personalityTraits: cappedArr(12).default([]),
      })
    )
    .min(1)
    .max(60),
});
export type CohortSimOutput = z.infer<typeof CohortSimOutputSchema>;

export const ExecutorOutputSchema = z.object({
  logs: z.array(z.string()).min(1).max(12),
  conclusions: z
    .array(
      z.object({
        claim: z.string().max(120),
        value: z.string(),
        confidence: z.number().min(0).max(1),
        entities: z.array(z.string()).min(1),
        sources: z.array(z.string()).min(1),
      })
    )
    .min(1)
    .max(5),
});
export type ExecutorOutput = z.infer<typeof ExecutorOutputSchema>;

export const EntanglerOutputSchema = z.object({
  edges: z
    .array(
      z.object({
        fromBlockId: z.string(),
        toBlockId: z.string(),
        trigger: z.enum(["shared_entity", "contradiction", "dependency"]),
        reason: z.string().max(140),
      })
    )
    .default([]),
  synthesisBlocks: z
    .array(
      z.object({
        name: z.string(),
        mission: z.string(),
        inputBlockIds: z.array(z.string()).min(1),
        domain: DomainSchema.default("synthesis"),
      })
    )
    .max(4)
    .default([]),
});
export type EntanglerOutput = z.infer<typeof EntanglerOutputSchema>;

export const QueryOutputSchema = z.object({
  answer: z.string(),
  citedConclusionIds: z.array(z.string()).default([]),
});
export type QueryOutput = z.infer<typeof QueryOutputSchema>;

export const AudienceChatModeSchema = z.enum(["customer", "group"]);
export type AudienceChatMode = z.infer<typeof AudienceChatModeSchema>;

export const AudienceChatHistoryItemSchema = z.object({
  role: z.enum(["founder", "customer", "moderator"]),
  speaker: z.string().min(1).max(80),
  content: z.string().min(1).max(2000),
});
export type AudienceChatHistoryItem = z.infer<
  typeof AudienceChatHistoryItemSchema
>;

export const AudienceChatOutputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["customer", "moderator"]).default("customer"),
        speaker: z.string().min(1).max(80),
        personaId: z.string().nullable().default(null),
        content: z.string().min(1).max(900),
        intentAfter: z.number().min(0).max(1).nullable().default(null),
        objection: z.string().max(180).nullable().default(null),
      })
    )
    .min(1)
    .max(8),
  summary: z.string().max(800).default(""),
  nextMove: z.string().max(280).default(""),
});
export type AudienceChatOutput = z.infer<typeof AudienceChatOutputSchema>;

// ---------------------------------------------------------------------------
// Owner Dashboard › Brand & Social Action Plan (one frontier call over the
// converged world model). The founder studies comparable accounts, reads
// brand + social guidelines, and ticks off the action checklist as they do it.
// `id` fields are STABLE kebab slugs (model derives them from the title) so
// regeneration can reconcile saved checkbox state by id.
// ---------------------------------------------------------------------------

export const ComparableAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(), // "Instagram" | "TikTok" | "YouTube" | "Pinterest" | …
  handle: z.string(), // "@name"
  url: z.string().nullable().default(null), // profile link when web-verified
  followers: z.string().nullable().default(null), // approximate, e.g. "120k"
  // true = found/verified via web search (cited url); false = from model
  // knowledge (treat as approximate). Drives the "verified vs from-knowledge"
  // badge and the ~60/40 grounding mix.
  grounded: z.boolean().default(false),
  whyRelevant: z.string(),
  whatToEmulate: z.string(),
  source: z.string().nullable().default(null), // citation URL if grounded
});
export type ComparableAccount = z.infer<typeof ComparableAccountSchema>;

export const BrandIdentitySchema = z.object({
  voice: z.string(),
  positioning: z.string(),
  visualCodes: z.array(z.string()).default([]),
  namingCues: z.array(z.string()).default([]),
  doList: z.array(z.string()).default([]),
  dontList: z.array(z.string()).default([]),
});
export type BrandIdentity = z.infer<typeof BrandIdentitySchema>;

export const SocialGuidelinesSchema = z.object({
  contentPillars: z.array(z.string()).default([]),
  platformPlan: z
    .array(
      z.object({
        platform: z.string(),
        segment: z.string().nullable().default(null),
        cadence: z.string(),
        formats: z.array(z.string()).default([]),
        notes: z.string().default(""),
      })
    )
    .default([]),
});
export type SocialGuidelines = z.infer<typeof SocialGuidelinesSchema>;

export const ChecklistItemSchema = z.object({
  id: z.string(),
  category: z.string(), // "Setup" | "Brand" | "Content" | "Growth" | "Outreach"
  title: z.string(),
  detail: z.string().default(""),
  priority: z.enum(["now", "soon", "later"]).default("soon"),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const FinSourceSchema = z.enum([
  "ai_estimated", // first-pass estimate from desks / web research
  "founder_entered", // the founder typed a real number
  "derived_from_data", // pulled from an uploaded Document (quote, Shopify CSV)
  "computed", // computeFinancials() derived it from other figures
]);
export type FinSource = z.infer<typeof FinSourceSchema>;

// A single provenanced number. `unit` is free text ("INR", "INR/unit",
// "units/mo", "months", "%", "x"). `basis` is a one-line note on derivation;
// `sourceConclusionIds` link back to the desk conclusions it came from.
export const FinNumSchema = z.object({
  // JSONB can't store Infinity/NaN — JSON.stringify turns them into null. Coerce
  // any non-finite/missing value back to a finite 0 on read so a single stray
  // value can never fail the parse and silently wipe the saved dashboard.
  value: z.preprocess(
    (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0),
    z.number()
  ),
  unit: z.string().default(""),
  source: FinSourceSchema.default("ai_estimated"),
  confidence: z.number().min(0).max(1).default(0.5),
  basis: z.string().default(""),
  sourceConclusionIds: z.array(z.string()).default([]),
});
export type FinNum = z.infer<typeof FinNumSchema>;

// One line of the per-unit landed-cost build-up (BOM, labour, freight, duty…).
export const FinCostLineSchema = z.object({
  label: z.string(),
  amount: FinNumSchema, // per-unit cost in the model currency
  note: z.string().default(""),
});
export type FinCostLine = z.infer<typeof FinCostLineSchema>;

// A price point the founder might sell at. The *input* fields are price +
// (optionally) an overriding landed cost; everything else is computed.
export const FinPriceTierSchema = z.object({
  label: z.string(), // "Entry" | "Core" | "Premium" | a segment name
  segment: SegmentSchema.nullable().default(null), // ties tier ↔ audience segment
  price: FinNumSchema, // retail price per unit
  landedCogs: FinNumSchema, // per-unit cost at this tier (defaults to costStructure sum)
  contributionPerUnit: FinNumSchema, // computed = price − landedCogs
  grossMarginPct: FinNumSchema, // computed = contribution / price × 100
  // Demand from the simulated audience at this price:
  estUnitsPerMonth: FinNumSchema, // computed = reachable prospects × conversion at price
  estRevenuePerMonth: FinNumSchema, // computed = units × price
  estGrossProfitPerMonth: FinNumSchema, // computed = units × contribution
});
export type FinPriceTier = z.infer<typeof FinPriceTierSchema>;

export const FinUnitEconomicsSchema = z.object({
  cacByChannel: z
    .array(z.object({ channel: z.string(), cac: FinNumSchema }))
    .default([]),
  blendedCac: FinNumSchema, // computed (channel-share weighted) or estimated
  ltv: FinNumSchema, // lifetime gross-profit value of a customer
  // null when not computable (no CAC / no contribution).
  ltvCacRatio: FinNumSchema.nullable().default(null), // computed = ltv / blendedCac
  paybackMonths: FinNumSchema.nullable().default(null), // computed = cac / contribution
});
export type FinUnitEconomics = z.infer<typeof FinUnitEconomicsSchema>;

export const FinMarketSizingSchema = z.object({
  // Top-down (from market/research desks):
  tam: FinNumSchema, // total addressable market (annual revenue)
  sam: FinNumSchema, // serviceable available market
  som: FinNumSchema, // realistic obtainable share (annual revenue)
  // How many prospects the venture can actually put the product in front of
  // per month — the scale knob the persona conversion curve multiplies against.
  reachableProspectsPerMonth: FinNumSchema,
  // Bottom-up (computed from persona wtp×intent × reach):
  bottomUpAnnualRevenue: FinNumSchema, // computed
  // The reconciliation: bottom-up vs SOM, and what the gap means.
  reconciliationNote: z.string().default(""),
});
export type FinMarketSizing = z.infer<typeof FinMarketSizingSchema>;

export const FinBreakEvenSchema = z.object({
  fixedCostsPerMonth: FinNumSchema, // rent, salaries, software, marketing base
  contributionPerUnit: FinNumSchema, // at the base/recommended tier
  // null when contribution ≤ 0 (the venture never breaks even at this price).
  breakEvenUnitsPerMonth: FinNumSchema.nullable().default(null), // = fixed / contribution
  breakEvenRevenuePerMonth: FinNumSchema.nullable().default(null), // computed
  // months until cumulative gross profit covers fixed + initial outlay, given
  // the base-tier demand; null if it never breaks even at modelled demand.
  monthsToBreakEven: FinNumSchema.nullable().default(null),
});
export type FinBreakEven = z.infer<typeof FinBreakEvenSchema>;

export const FinRunwayFitSchema = z.object({
  capitalAvailable: FinNumSchema, // from ClientProfile.funding / capitalInr
  monthlyBurn: FinNumSchema, // fixed costs (+ pre-revenue losses)
  moqCashRequired: FinNumSchema, // cash tied up to fund one MOQ inventory cycle
  // null when burn ≤ 0 (runway unbounded).
  runwayMonths: FinNumSchema.nullable().default(null), // computed = capital / monthlyBurn
  fundsMoq: z.boolean().default(false), // computed verdict: capital ≥ moq cash?
  verdict: z.string().default(""), // one-line funding-fit conclusion
});
export type FinRunwayFit = z.infer<typeof FinRunwayFitSchema>;

// The full model — persisted (later) under ownerDashboard.financials, exported
// into the pitch deck / final report. `inputs` are the raw assumptions fed in;
// the rest is the computed output.
export const FinancialModelSchema = z.object({
  currency: z.string().default("INR"),
  costStructure: z.array(FinCostLineSchema).default([]),
  priceTiers: z.array(FinPriceTierSchema).default([]),
  unitEconomics: FinUnitEconomicsSchema,
  marketSizing: FinMarketSizingSchema,
  breakEven: FinBreakEvenSchema,
  runwayFit: FinRunwayFitSchema,
  assumptions: z.array(z.string()).default([]),
  // Overall data-maturity: fraction of input numbers that are real
  // (founder_entered/derived_from_data) vs ai_estimated. Drives the "firming
  // up" progress meter. Computed.
  dataMaturityPct: z.number().min(0).max(100).default(0),
  generatedAt: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
});
export type FinancialModel = z.infer<typeof FinancialModelSchema>;

// What the finance-synthesis LLM call emits: the *assumptions* only (typed
// numbers + judgement), never the arithmetic. computeFinancials() turns this
// into a full FinancialModel using the persona audience as the demand curve.
export const FinancialInputsSchema = z.object({
  currency: z.string(),
  costStructure: z
    .array(
      z.object({
        label: z.string(),
        amount: z.number(),
        note: z.string().default(""),
        sourceConclusionIds: z.array(z.string()).default([]),
      })
    )
    .min(1),
  // Candidate price points to model (retail price per unit).
  priceTiers: z
    .array(
      z.object({
        label: z.string(),
        segment: SegmentSchema.nullable().default(null),
        price: z.number(),
        landedCogs: z.number().nullable().default(null), // null → sum costStructure
      })
    )
    .min(1)
    .max(6),
  fixedCostsPerMonth: z.number(),
  moqCashRequired: z.number(),
  reachableProspectsPerMonth: z.number(),
  cacByChannel: z
    .array(z.object({ channel: z.string(), cac: z.number() }))
    .default([]),
  ltv: z.number().nullable().default(null),
  tam: z.number(),
  sam: z.number(),
  som: z.number(),
  baseTierLabel: z.string(), // which priceTiers[].label is the recommended one
  assumptions: z.array(z.string()).default([]),
});
export type FinancialInputs = z.infer<typeof FinancialInputsSchema>;

export const BrandKitSchema = z.object({
  comparableAccounts: z.array(ComparableAccountSchema).default([]),
  brandIdentity: BrandIdentitySchema,
  socialGuidelines: SocialGuidelinesSchema,
  checklist: z.array(ChecklistItemSchema).default([]),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

// The `owner_dashboard` JSONB column. An extensible container: future
// owner-facing tools become sibling keys alongside `brandSocial`.
export const BrandSocialSectionSchema = z.object({
  kit: BrandKitSchema.nullable().default(null),
  checks: z.record(z.boolean()).default({}), // checklist item id -> done
  generatedAt: z.string().nullable().default(null), // ISO
  sourceRunId: z.string().nullable().default(null),
});
export type BrandSocialSection = z.infer<typeof BrandSocialSectionSchema>;

// Owner Dashboard › Financials. Stores the computed FinancialModel plus the raw
// `inputs` (assumptions) it was computed from, so a founder override re-runs
// computeFinancials() against the same persona audience. `editedKeys` records
// which inputs the founder changed (drives the founder_entered provenance +
// the "firming up" data-maturity meter).
export const FinancialsSectionSchema = z.object({
  model: FinancialModelSchema.nullable().default(null),
  inputs: FinancialInputsSchema.nullable().default(null),
  editedKeys: z.array(z.string()).default([]),
  generatedAt: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
});
export type FinancialsSection = z.infer<typeof FinancialsSectionSchema>;

const EMPTY_FINANCIALS = {
  model: null,
  inputs: null,
  editedKeys: [],
  generatedAt: null,
  sourceRunId: null,
};

// Owner Dashboard › Inspiration ("swipe file"). Real, verified reference
// material the founder can open and copy. Every link is checked before it is
// shown (YouTube via oEmbed; story sources via fetch) — see verifyInspiration.
export const VideoExampleSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel: z.string().default(""),
  // Best-effort 11-char id. Present only when verifyInspiration confirmed the
  // video exists; otherwise blank and the item degrades to a search link.
  youtubeId: z.string().default(""),
  // The exact phrase to find the video on YouTube — always required, so an
  // unverified item still becomes a working "search on YouTube" link.
  searchQuery: z.string().default(""),
  // Always a working link: a direct watch url when verified, else a YouTube
  // search url built from searchQuery. The UI just opens this.
  url: z.string().default(""),
  // true = a specific verified video (thumbnail resolved); false = search link.
  verified: z.boolean().default(false),
  whyRelevant: z.string(),
  takeaway: z.string(), // the specific move to copy
});
export type VideoExample = z.infer<typeof VideoExampleSchema>;

export const PlacementExampleSchema = z.object({
  id: z.string(),
  pattern: z.string(), // "Hero shot", "In-context lifestyle", "Flat-lay", …
  account: z.string(), // a real account that does it well
  accountUrl: z.string().nullable().default(null),
  platform: z.string().default(""),
  recipe: z.string(), // how to shoot/produce it
  whyItWorks: z.string(),
});
export type PlacementExample = z.infer<typeof PlacementExampleSchema>;

export const SuccessStorySchema = z.object({
  id: z.string(),
  brand: z.string(),
  platform: z.string().nullable().default(null),
  summary: z.string(),
  theMove: z.string(), // the specific play that worked
  result: z.string(), // the outcome (growth, sales, …)
  sourceUrl: z.string(), // cited, working article url
});
export type SuccessStory = z.infer<typeof SuccessStorySchema>;

export const InspirationKitSchema = z.object({
  videoExamples: z.array(VideoExampleSchema).default([]),
  placementExamples: z.array(PlacementExampleSchema).default([]),
  successStories: z.array(SuccessStorySchema).default([]),
});
export type InspirationKit = z.infer<typeof InspirationKitSchema>;

export const InspirationSectionSchema = z.object({
  kit: InspirationKitSchema.nullable().default(null),
  generatedAt: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
});
export type InspirationSection = z.infer<typeof InspirationSectionSchema>;

const EMPTY_INSPIRATION = {
  kit: null,
  generatedAt: null,
  sourceRunId: null,
};

export const OwnerDashboardSchema = z.object({
  brandSocial: BrandSocialSectionSchema.default({
    kit: null,
    checks: {},
    generatedAt: null,
    sourceRunId: null,
  }),
  financials: FinancialsSectionSchema.default(EMPTY_FINANCIALS),
  inspiration: InspirationSectionSchema.default(EMPTY_INSPIRATION),
});
export type OwnerDashboard = z.infer<typeof OwnerDashboardSchema>;


// Intake interview (Shot 8, v2.1: structured MCQ): either the next question
// — with clickable options, Cursor-style — or the final profile. The UI
// always offers a free-text fallback alongside the options.
export const IntakeOutputSchema = z.discriminatedUnion("done", [
  z.object({
    done: z.literal(false),
    question: z.string(),
    options: z.array(z.string().min(1).max(80)).max(6).default([]),
    multiSelect: z.boolean().default(false),
  }),
  z.object({
    done: z.literal(true),
    brief: z.string(),
    // funding is REQUIRED from the interviewer (the parse-retry loop forces
    // the model to produce it); it stays optional in ClientProfileSchema so
    // profiles saved before the field existed still parse.
    profile: ClientProfileSchema.extend({ funding: FundingSchema }),
  }),
]);
export type IntakeOutput = z.infer<typeof IntakeOutputSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------------------------------------------------------------------------
// Project persistence shapes (the JSONB columns of the `projects` table).
// ---------------------------------------------------------------------------

export const PendingQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).default([]),
  multiSelect: z.boolean().default(false),
});
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>;

// interview_transcript: the full chat plus the unanswered question (so a
// reload restores the clickable options), plus completion state.
// `answeredQuestions` is the stack of MCQ questions already answered (with
// their options) — it lets the UI offer "Back" to revert to any prior
// question and restore its exact choices, even after a reload.
export const InterviewTranscriptSchema = z.object({
  messages: z.array(ChatMessageSchema).default([]),
  pending: PendingQuestionSchema.nullable().default(null),
  answeredQuestions: z.array(PendingQuestionSchema).default([]),
  done: z.boolean().default(false),
  brief: z.string().optional(),
});
export type InterviewTranscript = z.infer<typeof InterviewTranscriptSchema>;

export const RunModeSchema = z.enum(["full", "scoped"]);
export type RunMode = z.infer<typeof RunModeSchema>;

// One entry of the append-only simulation_runs JSONB array.
export type SimulationRunRecord = {
  runId: string;
  timestamp: string; // ISO
  status: RunStatus;
  params: {
    brief: string;
    clientProfile: ClientProfile;
    focusQuestion: string | null;
    additionalContext: string | null;
    mode: RunMode;
    sourceRunId: string | null;
    model: string;
    miniModel: string;
    maxTokensPerRun: number;
    maxCostUsd: number;
    maxBlocksPerRun: number;
    maxDesksPerRun: number;
    maxLayers: number;
    maxCohorts: number;
    personasPerCohort: number;
    mockMode: boolean;
  };
  results: {
    tokensUsed: number;
    costUsd: number;
    blocks: Block[]; // includes conclusions
    edges: Edge[];
    cohorts: (Cohort & { personas: Persona[] })[];
    audienceAggregate: AudienceAggregate | null;
  };
};

// ---------------------------------------------------------------------------
// Per-run industry classification — the routing key for REAL structured data.
// One LLM call maps the venture to an industry, HS code(s) for physical goods,
// and OSM shop tags, so trade/tariff/local-competition providers can be matched
// to THIS venture (option C, industry-aware).
// ---------------------------------------------------------------------------
export const IndustryProfileSchema = z.object({
  industry: z.string(), // broad, e.g. "apparel & fashion"
  category: z.string().default(""), // narrower, e.g. "men's western shirts"
  isPhysicalGood: z.boolean().default(true),
  // 2–6 digit Harmonized System codes (trade + tariff lookups); [] if not a good.
  hsCodes: z.array(z.string()).max(8).default([]),
  // OpenStreetMap shop= values for the outlets that sell this (local competition).
  osmShopTags: z.array(z.string()).max(8).default([]),
  // Curated-dataset registry key (lib/datasources/library.ts).
  libraryKey: z.string().default("general"),
  keywords: z.array(z.string()).max(12).default([]),
  // Government open-dataset TOPICS relevant to this industry (e.g. "building
  // permits", "construction", "food business licenses", "retail trade"). Used
  // to discover real datasets on city/national open-data portals.
  openDataQueries: z.array(z.string()).max(6).default([]),
});
export type IndustryProfile = z.infer<typeof IndustryProfileSchema>;

// ---------------------------------------------------------------------------
// Auto-built industry knowledge pack (option A). One agent researches an
// industry and emits this; it's cached globally and injected as ground truth +
// planning guidance, so industry knowledge is never hand-authored.
// ---------------------------------------------------------------------------
export const PlanningTemplateSchema = z.object({
  // Industry-appropriate buyer/customer types (architecture → developer,
  // homeowner, institution, government; not retail shoppers).
  customerRoles: z.array(z.string()).max(10).default([]),
  // Industry-appropriate tiers/segments.
  segments: z.array(z.string()).max(8).default([]),
  // Suggested research desks for this industry.
  keyDesks: z
    .array(
      z.object({
        name: z.string(),
        domain: DomainSchema,
        why: z.string().default(""),
      })
    )
    .max(16)
    .default([]),
  // The metrics that matter (architecture → project fee, win rate, not WTP).
  kpis: z.array(z.string()).max(10).default([]),
  notes: z.string().default(""),
});
export type PlanningTemplate = z.infer<typeof PlanningTemplateSchema>;

export const IndustryKnowledgePackSchema = z.object({
  industry: z.string(),
  summary: z.string(),
  facts: z
    .array(
      z.object({
        text: z.string(),
        source: z.string().default(""),
      })
    )
    .max(20)
    .default([]),
  planningTemplate: PlanningTemplateSchema,
});
export type IndustryKnowledgePack = z.infer<typeof IndustryKnowledgePackSchema>;

// ---------------------------------------------------------------------------
// Launch Simulation — a deterministic, persona-driven, time-stepped projection
// of how a product actually sells once it launches. Given a cost price, sale
// price and ad spend, the engine (lib/launchSim.ts) fast-forwards day-by-day
// or month-by-month over the FROZEN simulated personas and reports the whole
// trajectory: who's reached, who scrolls past, who buys (on which channel),
// who refunds, plus the full P&L, inventory/deadstock and demographics.
//
// CRITICAL CONTRACT: the engine takes NO LLM call and draws every "random"
// event from a PRNG seeded by hash(inputs). So rerunning with identical inputs
// reproduces an identical trajectory — that equality is an emergent property we
// can assert as a test (scripts/launch-sim-check.ts), never a hardcoded short
// circuit. If it ever fails, the app's predictiveness has a real bug.
// ---------------------------------------------------------------------------

export const LaunchGranularitySchema = z.enum(["day", "month"]);
export type LaunchGranularity = z.infer<typeof LaunchGranularitySchema>;

export const LaunchBusinessModelSchema = z.enum([
  "generic",
  "apparel",
  "furniture",
  "consumable",
  "saas",
  "services",
  "marketplace",
]);
export type LaunchBusinessModel = z.infer<typeof LaunchBusinessModelSchema>;

export const LaunchChannelKindSchema = z.enum([
  "paid",
  "organic",
  "owned",
  "marketplace",
  "retail",
]);
export type LaunchChannelKind = z.infer<typeof LaunchChannelKindSchema>;

export const LaunchChannelInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: LaunchChannelKindSchema.default("paid"),
  spendPct: z.number().min(0).max(1).default(0),
  cpm: z.number().positive().default(250),
  reachPerStep: z.number().nonnegative().default(0),
  frequencyCap: z.number().positive().default(3),
  engagementRate: z.number().min(0).max(1).default(0.18),
  visitRate: z.number().min(0).max(1).default(0.35),
  checkoutRate: z.number().min(0).max(1).default(0.45),
  trustMultiplier: z.number().nonnegative().default(1),
  refundMultiplier: z.number().nonnegative().default(1),
  repeatMultiplier: z.number().nonnegative().default(1),
});
export type LaunchChannelInput = z.infer<typeof LaunchChannelInputSchema>;

export const LaunchAssumptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string(),
  source: z.enum(["founder_entered", "financial_model", "preset", "computed"]),
  confidence: z.number().min(0).max(1),
  basis: z.string(),
});
export type LaunchAssumption = z.infer<typeof LaunchAssumptionSchema>;

// Everything the founder can feed in. Only the first three are surfaced by
// default; the rest live under "Advanced" and default to sensible, overridable
// values resolved against the run (see resolveLaunchInputs in launchSim.ts).
export const LaunchSimInputsSchema = z.object({
  currency: z.string().default("INR"),
  businessModel: LaunchBusinessModelSchema.default("generic"),
  // --- the three headline knobs ---
  costPrice: z.number().nonnegative(), // landed COGS per unit
  salePrice: z.number().nonnegative(), // retail price per unit
  adSpendPerMonth: z.number().nonnegative(), // monthly paid-media budget

  // --- time axis ---
  granularity: LaunchGranularitySchema.default("day"),
  horizon: z.number().int().min(1).max(366).default(90), // steps to simulate

  // --- reach / ad funnel ---
  reachablePool: z.number().positive().nullable().default(null), // unique prospects ceiling (null → derived)
  cpm: z.number().positive().default(250), // ad cost per 1000 impressions
  frequencyCap: z.number().positive().default(3), // impressions/person for awareness
  targetingQuality: z.number().min(0).max(1).default(0.5), // 0 broad … 1 optimised toward high-intent
  adPlatforms: z.array(z.string()).default(["instagram", "facebook"]), // which platforms the spend buys
  organicReachPerStep: z.number().nonnegative().default(0), // non-ad new awareness per step (null→derived)
  viralityK: z.number().nonnegative().default(0.15), // word-of-mouth: new aware per recent buyer

  // --- conversion dynamics ---
  decisionSpeed: z.number().min(0).max(1).nullable().default(null), // per-step fraction of considerers who decide
  abandonRate: z.number().min(0).max(1).default(0.05), // per-step fraction who drop out of consideration

  // --- costs ---
  shippingPerOrder: z.number().nonnegative().default(120),
  paymentFeePct: z.number().min(0).max(1).default(0.02),
  fixedCostsPerMonth: z.number().nonnegative().default(0),

  // --- refunds / returns ---
  returnWindowDays: z.number().int().min(0).max(180).default(30),
  refundRateMult: z.number().nonnegative().default(1), // scales the per-persona base refund propensity
  resellablePct: z.number().min(0).max(1).default(0.7), // fraction of returned units restocked as good
  returnShippingPerOrder: z.number().nonnegative().nullable().default(null), // null → shippingPerOrder

  // --- inventory ---
  initialInventoryUnits: z.number().int().nonnegative().nullable().default(null), // null → derived from demand
  reorderLeadTimeDays: z.number().int().min(0).max(180).default(30),
  reorderEnabled: z.boolean().default(true),

  // --- repeat purchase ---
  repeatRateMult: z.number().nonnegative().default(1), // scales the per-segment annual repeat rate

  // --- realism jitter (the only randomness; seeded, so reruns still match) ---
  jitterAmplitude: z.number().min(0).max(0.5).default(0.06),
  channels: z.array(LaunchChannelInputSchema).default([]),
});
export type LaunchSimInputs = z.infer<typeof LaunchSimInputsSchema>;

// One step of the trajectory. Every figure is at real market scale.
export const LaunchSimStepSchema = z.object({
  step: z.number().int(), // 0-based index
  label: z.string(), // "Day 1" / "Month 3"
  impressions: z.number(),
  newlyReached: z.number(),
  cumulativeReached: z.number(),
  scrolledPast: z.number(), // reached this step but didn't buy
  engaged: z.number(), // reached people who interact enough to continue
  productVisits: z.number(), // product/site/store visits created by the launch
  checkoutsStarted: z.number(), // high-intent checkout or buying conversations
  newOrders: z.number(), // first-time purchases
  repeatOrders: z.number(), // returning-customer purchases
  unitsFulfilled: z.number(), // orders actually shipped (capped by inventory)
  unitsStockedOut: z.number(), // demand lost to empty shelves
  refunds: z.number(), // refunds landing this step (lagged from earlier sales)
  inventoryOnHand: z.number(),
  adSpend: z.number(),
  revenue: z.number(), // gross from fulfilled units
  refundedRevenue: z.number(), // reversed by refunds landing this step
  cogs: z.number(),
  shippingCost: z.number(),
  paymentFees: z.number(),
  refundCost: z.number(), // return shipping + write-off on non-resellable returns
  fixedCosts: z.number(),
  netProfit: z.number(),
  cumulativeNetProfit: z.number(),
  cumulativeCash: z.number(), // includes inventory purchase outflows (working-capital view)
});
export type LaunchSimStep = z.infer<typeof LaunchSimStepSchema>;

const NameCount = z.object({ name: z.string(), orders: z.number(), revenue: z.number() });
const LaunchChannelResult = z.object({
  id: z.string(),
  name: z.string(),
  kind: LaunchChannelKindSchema,
  impressions: z.number(),
  reached: z.number(),
  engaged: z.number(),
  productVisits: z.number(),
  checkoutsStarted: z.number(),
  orders: z.number(),
  revenue: z.number(),
  adSpend: z.number(),
  cac: z.number(),
});

export const LaunchSimResultSchema = z.object({
  seed: z.number(), // derived from hash(inputs) — exposed for transparency
  resolvedInputs: LaunchSimInputsSchema, // inputs after defaults/derivation
  scaleFactor: z.number(), // real prospects each sampled persona represents
  personaCount: z.number(),
  timeline: z.array(LaunchSimStepSchema),
  diagnostics: z.object({
    headline: z.string(),
    drivers: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    nextMoves: z.array(z.string()).default([]),
  }),
  summary: z.object({
    totalImpressions: z.number(),
    totalReached: z.number(),
    totalEngaged: z.number(),
    totalProductVisits: z.number(),
    totalCheckoutsStarted: z.number(),
    totalScrolledPast: z.number(),
    totalOrders: z.number(),
    newOrders: z.number(),
    repeatOrders: z.number(),
    returningCustomerSharePct: z.number(),
    unitsSold: z.number(),
    stockoutUnits: z.number(),
    refunds: z.number(),
    refundRatePct: z.number(),
    grossRevenue: z.number(),
    netRevenue: z.number(), // after refunds
    totalAdSpend: z.number(),
    adSpendPerConversion: z.number(), // "Meta spend per conversion"
    blendedCac: z.number(),
    totalCogs: z.number(),
    totalShipping: z.number(),
    totalPaymentFees: z.number(),
    totalRefundCost: z.number(),
    totalFixedCosts: z.number(),
    grossProfit: z.number(), // net revenue − COGS
    netProfit: z.number(), // bottom line over the horizon
    grossMarginPct: z.number(),
    netMarginPct: z.number(),
    deadstockUnits: z.number(),
    deadstockValue: z.number(),
    peakCapitalNeeded: z.number(), // worst cumulative cash trough (working capital)
    breakEvenStep: z.number().nullable(), // step index cumulative net profit first ≥ 0
    breakEvenLabel: z.string().nullable(),
  }),
  breakdowns: z.object({
    byChannel: z.array(NameCount),
    byAcquisitionChannel: z.array(LaunchChannelResult),
    bySegment: z.array(NameCount.extend({ refunds: z.number() })),
    byLocality: z.array(NameCount),
    byAgeBand: z.array(NameCount),
    byGender: z.array(NameCount),
    newVsReturning: z.object({ newCustomers: z.number(), returningOrders: z.number() }),
  }),
  assumptions: z.array(LaunchAssumptionSchema).default([]),
});
export type LaunchSimResult = z.infer<typeof LaunchSimResultSchema>;

// A saved scenario (persisted in the LaunchSimulation table). `name` lets the
// founder label & compare scenarios (e.g. "₹50k Meta" vs "₹200k Meta").
export const LaunchSimRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  name: z.string(),
  inputs: LaunchSimInputsSchema,
  result: LaunchSimResultSchema,
  createdAt: z.string(),
});
export type LaunchSimRecord = z.infer<typeof LaunchSimRecordSchema>;

// World model — the converged terminal object (SPEC §4.5, v2: + audience)
export type WorldModel = {
  runId: string;
  status: RunStatus;
  clientProfile: ClientProfile;
  conclusions: Conclusion[];
  edges: Edge[];
  tokensUsed: number;
  costUsd: number;
  audience: AudienceAggregate | null;
};

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

export const ProductDetailsSchema = z
  .object({
    styleKeywords: z.array(z.string()).default([]),
    aestheticReferences: z.array(z.string()).default([]),
    heroProducts: z.array(z.string()).default([]),
    occasions: z.array(z.string()).default([]),
    materialsAndFit: z.string().optional(),
    differentiation: z.string().optional(),
  })
  .default({});
export type ProductDetails = z.infer<typeof ProductDetailsSchema>;

export const ProductImageRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  visualSummary: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type ProductImageRef = z.infer<typeof ProductImageRefSchema>;

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
  productDetails: ProductDetailsSchema.optional(),
  productImages: z.array(ProductImageRefSchema).default([]).optional(),
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

// ---------------------------------------------------------------------------
// Website analysis: a web-grounded pass over the founder's site + online
// consumer opinion that bootstraps the venture profile and seeds the intake so
// it only asks what couldn't be inferred. `knownFields` lists the ClientProfile
// keys the analysis is confident about (the intake skips those).
// ---------------------------------------------------------------------------
export const WebsiteDraftProfileSchema = z.object({
  product: z.string().optional(),
  category: z.string().optional(),
  priceBand: z.string().optional(),
  geography: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  styleKeywords: z.array(z.string()).default([]),
  heroProducts: z.array(z.string()).default([]),
  differentiation: z.string().optional(),
  // Founders' existing skills / background inferred from the site (About,
  // team/founder bios, press, prior ventures). Maps to ClientProfile.experience
  // so the intake doesn't re-ask it.
  experience: z.string().optional(),
});
export type WebsiteDraftProfile = z.infer<typeof WebsiteDraftProfileSchema>;

export const WebsiteAnalysisOutputSchema = z.object({
  draftProfile: WebsiteDraftProfileSchema,
  // ClientProfile field names the analysis is confident about (intake skips them).
  knownFields: z.array(z.string()).default([]),
  // 3-6 sentence brief on what real customers say online (grounds the sim).
  consumerOpinion: z.string().default(""),
  sentiment: z
    .enum(["positive", "mixed", "negative", "unknown"])
    .default("unknown"),
  // Founder-facing recap of everything inferred, to confirm/correct in one tap.
  summary: z.string().default(""),
  sources: z.array(z.string()).default([]),
});
export type WebsiteAnalysisOutput = z.infer<typeof WebsiteAnalysisOutputSchema>;

// Stored form (output + the url + when analysed). Defaulted leniently so older
// rows / partial saves still parse.
export const WebsiteAnalysisSchema = WebsiteAnalysisOutputSchema.extend({
  url: z.string().default(""),
  analyzedAt: z.string().default(""),
});
export type WebsiteAnalysis = z.infer<typeof WebsiteAnalysisSchema>;

// --- Web-sourced market benchmark data (refines curated priors) -------------
const MarketRangeSchema = z.object({
  low: z.number(),
  mid: z.number(),
  high: z.number(),
});

// What the web-grounded pass returns for one market × category. All monetary
// fields are in the market's currency (USD for the US). Any field may be null
// when the search couldn't find a credible figure (the curated prior is kept).
export const MarketDataOutputSchema = z.object({
  currency: z.string().default("USD"),
  aov: MarketRangeSchema.nullable().default(null),
  grossMarginPct: MarketRangeSchema.nullable().default(null),
  landingCvrPct: MarketRangeSchema.nullable().default(null),
  repeatRatePct: MarketRangeSchema.nullable().default(null),
  returnRatePct: MarketRangeSchema.nullable().default(null),
  cac: MarketRangeSchema.nullable().default(null),
  cpmMeta: MarketRangeSchema.nullable().default(null),
  notes: z.string().default(""),
  sources: z.array(z.string()).default([]),
});
export type MarketDataOutput = z.infer<typeof MarketDataOutputSchema>;

// Stored per "<market>:<category>" with provenance (country, category, asOf).
export const MarketDatumSchema = MarketDataOutputSchema.extend({
  market: z.string(),
  category: z.string(),
  country: z.string().default(""),
  asOf: z.string().default(""),
});
export type MarketDatum = z.infer<typeof MarketDatumSchema>;

// What the intake route accepts to skip already-known fields.
export const IntakePrefillSchema = z.object({
  draftProfile: WebsiteDraftProfileSchema,
  knownFields: z.array(z.string()).default([]),
  consumerOpinion: z.string().default(""),
});
export type IntakePrefill = z.infer<typeof IntakePrefillSchema>;

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
  byZone: z.record(groupStat).default({}), // GoI zone (North/South/…); default {} for legacy aggregates
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
  // Liveness ping. Carries no canvas state — its only job is to refresh the
  // dashboard's lastEventTs so the stall detector ("Continue run") doesn't
  // false-fire during long, event-silent stretches (e.g. 10 cohort sims in
  // flight, each a multi-second LLM call). A no-op in the reducer.
  z.object({
    ...eventBase,
    type: z.literal("heartbeat"),
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

// v2 planning is split: shared venture context, research desks, and audience
// cohort matrix. PlannerV2Output remains as the compatibility aggregate.
export const VenturePlanningContextSchema = z.object({
  category: z.string(),
  productType: z.string(),
  businessModel: z.string(),
  tasteLed: z.boolean().default(false),
  procurementLed: z.boolean().default(false),
  physicalGood: z.boolean().default(true),
  buyerRoles: z.array(z.string()).min(1).max(10),
  channelAssumptions: z.array(z.string()).max(10).default([]),
  geographyAssumptions: z.array(z.string()).max(12).default([]),
  productSpecifics: z.array(z.string()).max(12).default([]),
  planningNotes: z.array(z.string()).max(10).default([]),
});
export type VenturePlanningContext = z.infer<typeof VenturePlanningContextSchema>;

const DeskPlanSchema = z.object({
  name: z.string(),
  domain: DomainSchema,
  mission: z.string(),
  useWebSearch: z.boolean().default(true),
  params: BlockParamsSchema.default({}),
});

export const ResearchPlannerOutputSchema = z.object({
  desks: z.array(DeskPlanSchema).min(4).max(20),
});
export type ResearchPlannerOutput = z.infer<typeof ResearchPlannerOutputSchema>;

export const CohortPlanSchema = z.object({
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
});
export type CohortPlanOutput = z.infer<typeof CohortPlanSchema>;

export const AudiencePlannerOutputSchema = z.object({
  cohortPlan: CohortPlanSchema,
});
export type AudiencePlannerOutput = z.infer<typeof AudiencePlannerOutputSchema>;

export const PlannerV2OutputSchema = z.object({
  desks: z.array(DeskPlanSchema).min(4).max(20),
  cohortPlan: CohortPlanSchema,
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
// Persona Interaction: two personas discuss a topic turn-by-turn. The user
// drives each turn ("generate reply from X"), can inject founder knowledge both
// personas then see, and can wrap up the thread into a conclusion.
// ---------------------------------------------------------------------------
// "persona" = a participant's turn (who is in personaId/speaker); "founder" =
// injected knowledge everyone sees. personaA/personaB are accepted only so
// transcripts saved by the original 2-persona version still parse.
export const PersonaConversationRoleSchema = z.enum([
  "persona",
  "founder",
  "personaA",
  "personaB",
]);
export type PersonaConversationRole = z.infer<
  typeof PersonaConversationRoleSchema
>;

export const PersonaConversationMessageSchema = z.object({
  role: PersonaConversationRoleSchema,
  speaker: z.string().min(1).max(80),
  personaId: z.string().nullable().default(null),
  content: z.string().min(1).max(2000),
  intentAfter: z.number().min(0).max(1).nullable().default(null),
  ts: z.string(),
});
export type PersonaConversationMessage = z.infer<
  typeof PersonaConversationMessageSchema
>;

// Wire shape of a saved conversation returned to the drawer.
export const PersonaConversationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  participantIds: z.array(z.string()).min(2).max(4),
  topic: z.string().default(""),
  messages: z.array(PersonaConversationMessageSchema).default([]),
  conclusion: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonaConversation = z.infer<typeof PersonaConversationSchema>;

// One generated turn from a single persona (cost-bounded: one message/click).
export const PersonaReplyOutputSchema = z.object({
  content: z.string().min(1).max(1200),
  // The speaker's own purchase intent after this exchange, if it shifted.
  intentAfter: z.number().min(0).max(1).nullable().default(null),
});
export type PersonaReplyOutput = z.infer<typeof PersonaReplyOutputSchema>;

export const PersonaConclusionOutputSchema = z.object({
  conclusion: z.string().min(1).max(1500),
});
export type PersonaConclusionOutput = z.infer<
  typeof PersonaConclusionOutputSchema
>;

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
// One persisted follow-up exchange (ask-about-this Q&A on a launch scenario or
// the financial model). Shared shape so launch + financials reuse it.
export const FollowUpTurnSchema = z.object({
  question: z.string(),
  answer: z.string(),
  ts: z.string().default(""),
});
export type FollowUpTurn = z.infer<typeof FollowUpTurnSchema>;

export const FinancialsSectionSchema = z.object({
  model: FinancialModelSchema.nullable().default(null),
  inputs: FinancialInputsSchema.nullable().default(null),
  editedKeys: z.array(z.string()).default([]),
  generatedAt: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
  // "Ask about these financials" Q&A — persists with the model.
  followUp: z.array(FollowUpTurnSchema).default([]),
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

// Owner Dashboard › Founder Story. A project-level narrative signal extracted
// from founder notes, website analysis, uploaded docs, and permitted story URLs.
// Downstream reports/playbooks/brand kits use it as qualitative context.
export const FounderStorySignalsSchema = z.object({
  founderBackground: z.string().default(""),
  originStory: z.string().default(""),
  founderMotivation: z.string().default(""),
  whyNow: z.string().default(""),
  customerInsight: z.string().default(""),
  categoryConviction: z.string().default(""),
  credibilityProof: z.array(z.string()).default([]),
  unfairAdvantages: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type FounderStorySignals = z.infer<typeof FounderStorySignalsSchema>;

export const FounderStoryEvidenceSchema = z.object({
  id: z.string(),
  sourceType: z
    .enum(["manual", "website", "document", "press", "interview", "other"])
    .default("other"),
  title: z.string().default(""),
  url: z.string().nullable().default(null),
  excerpt: z.string().default(""),
  summary: z.string().default(""),
});
export type FounderStoryEvidence = z.infer<typeof FounderStoryEvidenceSchema>;

const EMPTY_FOUNDER_STORY_SIGNALS = {
  founderBackground: "",
  originStory: "",
  founderMotivation: "",
  whyNow: "",
  customerInsight: "",
  categoryConviction: "",
  credibilityProof: [],
  unfairAdvantages: [],
  constraints: [],
  openQuestions: [],
};

export const FounderStorySectionSchema = z.object({
  signals: FounderStorySignalsSchema.default(EMPTY_FOUNDER_STORY_SIGNALS),
  // signal key -> evidence ids. Keeps provenance usable without forcing prose
  // to carry ids or citations.
  evidenceIds: z.record(z.array(z.string())).default({}),
  evidence: z.array(FounderStoryEvidenceSchema).default([]),
  sources: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
  generatedAt: z.string().nullable().default(null),
});
export type FounderStorySection = z.infer<typeof FounderStorySectionSchema>;

const EMPTY_FOUNDER_STORY = {
  signals: EMPTY_FOUNDER_STORY_SIGNALS,
  evidenceIds: {},
  evidence: [],
  sources: [],
  confidence: 0,
  generatedAt: null,
};

// ---------------------------------------------------------------------------
// Generated playbook: an LLM-enriched, web-grounded deepening of the run's
// world model into a founder-ready, per-module action plan. Regenerated on
// demand (independent of the simulation) so sparse modules — taxes/duties,
// competitors — can be expanded with current, cited specifics.
// ---------------------------------------------------------------------------
export const PlaybookEntrySchema = z.object({
  point: z.string(), // the decision-ready statement
  detail: z.string().default(""), // 1–2 sentences of specifics
  source: z.string().default(""), // URL or citation, if any
});
export type PlaybookEntry = z.infer<typeof PlaybookEntrySchema>;

export const PlaybookModuleSchema = z.object({
  module: z.string(), // e.g. "Taxes & duties", "Competitors", "Pricing"
  domain: z.string().default(""), // maps to a DOMAIN_META key for the icon/colour
  summary: z.string().default(""),
  entries: z.array(PlaybookEntrySchema).default([]),
});
export type PlaybookModule = z.infer<typeof PlaybookModuleSchema>;

export const GeneratedPlaybookSchema = z.object({
  modules: z.array(PlaybookModuleSchema).default([]),
  sources: z.array(z.string()).default([]),
  generatedAt: z.string().default(""),
  model: z.string().default(""),
});
export type GeneratedPlaybook = z.infer<typeof GeneratedPlaybookSchema>;

// ---------------------------------------------------------------------------
// Owner Dashboard › Investor OS. Project-level operating system that turns the
// research canvas into investor-grade evidence, execution tasks and fundraise
// artifacts. Most evidence is derived from existing runs/documents; manual
// entries and generated kits live in owner_dashboard.investorOS.
// ---------------------------------------------------------------------------

export const InvestorStageSchema = z.enum([
  "define",
  "validate",
  "build",
  "launch",
  "prove",
  "fundraise",
  "grow",
]);
export type InvestorStage = z.infer<typeof InvestorStageSchema>;

export const EvidenceSourceTypeSchema = z.enum([
  "conclusion",
  "document",
  "financial",
  "simulation",
  "outcome",
  "report",
  "founder",
  "website",
  "market_data",
  "manual",
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string(),
  sourceType: EvidenceSourceTypeSchema,
  title: z.string(),
  summary: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  citation: z.string().nullable().default(null),
  investorRelevance: z.string().default(""),
  linkedRunId: z.string().nullable().default(null),
  linkedConclusionIds: z.array(z.string()).default([]),
  linkedDocumentId: z.string().nullable().default(null),
  metricKey: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().default(""),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const ReadinessGateStatusSchema = z.enum([
  "blocked",
  "partial",
  "ready",
]);
export type ReadinessGateStatus = z.infer<typeof ReadinessGateStatusSchema>;

export const ReadinessGateSchema = z.object({
  id: z.string(),
  name: z.string(),
  stage: InvestorStageSchema,
  score: z.number().min(0).max(100),
  status: ReadinessGateStatusSchema,
  critical: z.boolean().default(false),
  summary: z.string().default(""),
  blockers: z.array(z.string()).default([]),
  requiredEvidence: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
});
export type ReadinessGate = z.infer<typeof ReadinessGateSchema>;

export const RoadmapItemStatusSchema = z.enum(["todo", "doing", "done"]);
export type RoadmapItemStatus = z.infer<typeof RoadmapItemStatusSchema>;

export const RoadmapItemTypeSchema = z.enum([
  "task",
  "experiment",
  "document",
  "metric",
]);
export type RoadmapItemType = z.infer<typeof RoadmapItemTypeSchema>;

export const RoadmapItemSchema = z.object({
  id: z.string(),
  stage: InvestorStageSchema,
  type: RoadmapItemTypeSchema,
  title: z.string(),
  detail: z.string().default(""),
  status: RoadmapItemStatusSchema.default("todo"),
  ownerRole: z.string().default("Founder"),
  dueDate: z.string().nullable().default(null),
  linkedGateIds: z.array(z.string()).default([]),
  requiredProof: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
});
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export const InvestorDeckSlideSchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  provenance: z
    .enum(["sourced", "simulated", "founder_entered", "actual", "estimated"])
    .default("estimated"),
});
export type InvestorDeckSlide = z.infer<typeof InvestorDeckSlideSchema>;

export const InvestorMemoSectionSchema = z.object({
  title: z.string(),
  body: z.string(),
  evidenceIds: z.array(z.string()).default([]),
});
export type InvestorMemoSection = z.infer<typeof InvestorMemoSectionSchema>;

export const InvestorKitArtifactsSchema = z.object({
  pitchDeck: z.object({
    title: z.string(),
    slides: z.array(InvestorDeckSlideSchema).default([]),
  }),
  investorMemo: z.object({
    title: z.string(),
    sections: z.array(InvestorMemoSectionSchema).default([]),
  }),
  financialModelSummary: z.object({
    status: z.string(),
    bullets: z.array(z.string()).default([]),
    evidenceIds: z.array(z.string()).default([]),
  }),
  dataRoomIndex: z.array(z.string()).default([]),
  investorQA: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        evidenceIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
  useOfFundsPlan: z.array(z.string()).default([]),
});
export type InvestorKitArtifacts = z.infer<typeof InvestorKitArtifactsSchema>;

export const InvestorKitSchema = z.object({
  id: z.string(),
  sourceRunId: z.string().nullable().default(null),
  readinessScore: z.number().min(0).max(100),
  readinessStatus: z.enum(["draft", "investor_ready"]),
  readinessSnapshot: z.array(ReadinessGateSchema).default([]),
  artifacts: InvestorKitArtifactsSchema,
  caveats: z.array(z.string()).default([]),
  // Stable keys of sections the founder hand-edited (e.g. "slide:Problem",
  // "memo:Economics", "qa:What are the unit economics?", "useOfFunds",
  // "financials"). Drives the "edited" badges and survives regeneration.
  editedSections: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type InvestorKit = z.infer<typeof InvestorKitSchema>;

// Founder overrides for a generated kit. Stored once per project (not per kit)
// so edits persist when the kit is regenerated from fresh evidence. Keyed by
// the stable section identifiers above. A null whole-list override means "use
// the generated content".
export const InvestorKitEditsSchema = z.object({
  deckSlides: z.record(z.string(), z.array(z.string())).default({}),
  memoSections: z.record(z.string(), z.string()).default({}),
  qaAnswers: z.record(z.string(), z.string()).default({}),
  useOfFundsPlan: z.array(z.string()).nullable().default(null),
  financialBullets: z.array(z.string()).nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});
export type InvestorKitEdits = z.infer<typeof InvestorKitEditsSchema>;

const EMPTY_INVESTOR_KIT_EDITS = {
  deckSlides: {},
  memoSections: {},
  qaAnswers: {},
  useOfFundsPlan: null,
  financialBullets: null,
  updatedAt: null,
};

export const InvestorOSSectionSchema = z.object({
  manualEvidence: z.array(EvidenceItemSchema).default([]),
  roadmap: z.array(RoadmapItemSchema).default([]),
  kits: z.array(InvestorKitSchema).default([]),
  edits: InvestorKitEditsSchema.default(EMPTY_INVESTOR_KIT_EDITS),
  updatedAt: z.string().nullable().default(null),
});
export type InvestorOSSection = z.infer<typeof InvestorOSSectionSchema>;

const EMPTY_INVESTOR_OS = {
  manualEvidence: [],
  roadmap: [],
  kits: [],
  edits: EMPTY_INVESTOR_KIT_EDITS,
  updatedAt: null,
};

// Owner Dashboard › Design Studio. The brand's CONCRETE design tokens — real
// hex colors, real font families, a logo direction — distilled from the
// (descriptive) brand kit + venture profile. Every downstream generator
// (collateral, logos, website) consumes these so a flyer and a landing page
// look like the same brand. Hex/font strings are kept loose (plain strings) so
// a slightly-off model output never fails the whole section's validation.
export const DesignPaletteColorSchema = z.object({
  name: z.string(), // role/label, e.g. "primary", "ink", "sand"
  hex: z.string(), // "#1A1A1A" — normalized client/server-side, not regex-gated
  usage: z.string().default(""), // where to use it
});

export const DesignTokensSchema = z.object({
  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    neutralDark: z.string(),
    neutralLight: z.string(),
    extra: z.array(DesignPaletteColorSchema).default([]),
  }),
  typography: z.object({
    headingFamily: z.string(), // Google Font family name, e.g. "Poppins"
    bodyFamily: z.string(),
    headingGoogleUrl: z.string().nullable().default(null),
    bodyGoogleUrl: z.string().nullable().default(null),
    weights: z.array(z.string()).default([]), // e.g. ["400", "600", "700"]
    pairingRationale: z.string().default(""),
  }),
  logo: z.object({
    direction: z.string(), // the concept, in words
    style: z.string(), // "wordmark" | "lettermark" | "emblem" | "combination"
    motifSuggestions: z.array(z.string()).default([]),
  }),
  motifs: z.array(z.string()).default([]), // recurring visual elements / shapes
  imagery: z.string().default(""), // photography / illustration direction
  rationale: z.string().default(""), // why these tokens fit the brand
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

// One generated marketing-collateral piece. The LLM writes only the COPY
// (content); the layout is rendered deterministically by lib/design from the
// design tokens, so a card/flyer/poster all share the brand identity.
export const CollateralTypeSchema = z.enum([
  "business-card",
  "flyer",
  "poster",
]);
export type CollateralType = z.infer<typeof CollateralTypeSchema>;

export const CollateralContentSchema = z.object({
  brandName: z.string(),
  tagline: z.string().default(""),
  headline: z.string().default(""),
  subhead: z.string().default(""),
  body: z.array(z.string()).default([]), // short lines / bullets
  cta: z.string().default(""),
  contact: z
    .object({
      name: z.string().default(""),
      role: z.string().default(""),
      email: z.string().default(""),
      phone: z.string().default(""),
      website: z.string().default(""),
    })
    .default({}),
});
export type CollateralContent = z.infer<typeof CollateralContentSchema>;

// A rendered asset: self-contained SVG (text shaped to vector paths) plus the
// copy it was built from, so it's editable, downloadable, and Figma-importable.
export const DesignAssetSchema = z.object({
  id: z.string(),
  type: CollateralTypeSchema,
  title: z.string(),
  format: z.literal("svg").default("svg"),
  svg: z.string(),
  width: z.number(),
  height: z.number(),
  content: CollateralContentSchema,
  createdAt: z.string(),
});
export type DesignAsset = z.infer<typeof DesignAssetSchema>;

// A logo: one concept with several portable SVG variants. "icon" marks are
// LLM-generated geometric SVGs (no text → render anywhere); the "wordmark" is
// rendered deterministically (brand name shaped to vector paths) so there is
// always a guaranteed, font-portable variant.
export const LogoVariantKindSchema = z.enum(["icon", "wordmark", "lockup"]);
export type LogoVariantKind = z.infer<typeof LogoVariantKindSchema>;

export const LogoVariantSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: LogoVariantKindSchema.default("icon"),
  svg: z.string(),
});
export type LogoVariant = z.infer<typeof LogoVariantSchema>;

// What the logo-marks LLM call returns: a concept + the raw geometric marks.
// (The wordmark variant is added deterministically server-side.)
export const LogoMarksOutputSchema = z.object({
  concept: z.string(),
  style: z.string(), // wordmark | lettermark | emblem | combination
  marks: z
    .array(z.object({ label: z.string(), svg: z.string() }))
    .min(1)
    .max(4),
});
export type LogoMarksOutput = z.infer<typeof LogoMarksOutputSchema>;

export const LogoAssetSchema = z.object({
  id: z.string(),
  brandName: z.string(),
  style: z.string(),
  concept: z.string(),
  variants: z.array(LogoVariantSchema).default([]),
  createdAt: z.string(),
});
export type LogoAsset = z.infer<typeof LogoAssetSchema>;

// A generated one-page website: a self-contained HTML document (inline CSS,
// Google-Fonts <link> allowed, no scripts) built from the design tokens + venture
// copy. deployUrl is set once the founder publishes it to Vercel.
export const SiteAssetSchema = z.object({
  id: z.string(),
  title: z.string(),
  brandName: z.string(),
  html: z.string(),
  deployUrl: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type SiteAsset = z.infer<typeof SiteAssetSchema>;

// What the site-generator LLM call returns (the HTML is sanitized before use).
export const SiteGenOutputSchema = z.object({
  title: z.string(),
  html: z.string(),
});
export type SiteGenOutput = z.infer<typeof SiteGenOutputSchema>;

export const DesignStudioSectionSchema = z.object({
  tokens: DesignTokensSchema.nullable().default(null),
  assets: z.array(DesignAssetSchema).default([]),
  logos: z.array(LogoAssetSchema).default([]),
  sites: z.array(SiteAssetSchema).default([]),
  generatedAt: z.string().nullable().default(null), // ISO
  sourceRunId: z.string().nullable().default(null),
});
export type DesignStudioSection = z.infer<typeof DesignStudioSectionSchema>;

const EMPTY_DESIGN_STUDIO = {
  tokens: null,
  assets: [],
  logos: [],
  sites: [],
  generatedAt: null,
  sourceRunId: null,
};

export const UsageFeatureSchema = z.object({
  key: z.string(),
  label: z.string(),
  tokensUsed: z.number().default(0),
  costUsd: z.number().default(0),
  calls: z.number().default(0),
  lastUsedAt: z.string().nullable().default(null),
});
export type UsageFeature = z.infer<typeof UsageFeatureSchema>;

export const UsageLedgerSchema = z.object({
  tokensUsed: z.number().default(0),
  costUsd: z.number().default(0),
  features: z.record(UsageFeatureSchema).default({}),
  updatedAt: z.string().nullable().default(null),
});
export type UsageLedger = z.infer<typeof UsageLedgerSchema>;

const EMPTY_USAGE_LEDGER = {
  tokensUsed: 0,
  costUsd: 0,
  features: {},
  updatedAt: null,
};

export const OwnerDashboardSchema = z.object({
  founderStory: FounderStorySectionSchema.default(EMPTY_FOUNDER_STORY),
  brandSocial: BrandSocialSectionSchema.default({
    kit: null,
    checks: {},
    generatedAt: null,
    sourceRunId: null,
  }),
  // Owner Dashboard sections are run-specific because sibling runs can model
  // different regional markets inside the same project.
  brandSocialByRun: z.record(BrandSocialSectionSchema).default({}),
  financials: FinancialsSectionSchema.default(EMPTY_FINANCIALS),
  // Financial models are run-specific: a home-market run and a destination
  // export run can share a project but must not share TAM/SAM/SOM.
  financialsByRun: z.record(FinancialsSectionSchema).default({}),
  inspiration: InspirationSectionSchema.default(EMPTY_INSPIRATION),
  inspirationByRun: z.record(InspirationSectionSchema).default({}),
  // LLM-generated playbooks, keyed by runId (regenerable per run).
  playbooks: z.record(GeneratedPlaybookSchema).default({}),
  // Project-level investor readiness, execution roadmap and fundraise kits.
  investorOS: InvestorOSSectionSchema.default(EMPTY_INVESTOR_OS),
  // Project-level brand design tokens (palette, type, logo direction) that the
  // design generators (collateral, logos, website) all consume.
  designStudio: DesignStudioSectionSchema.default(EMPTY_DESIGN_STUDIO),
  // Project-level LLM spend ledger, broken down by feature.
  usage: UsageLedgerSchema.default(EMPTY_USAGE_LEDGER),
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

export const RunModeSchema = z.enum(["full", "scoped", "export"]);
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

  // --- audience scope ---
  // Restrict the launch to one region (GoI zone, e.g. "West"). null → the whole
  // run's audience. Stored so a regional scenario re-simulates identically and
  // stands as its own saved run.
  region: z.string().nullable().default(null),

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
  // Launch calendar month (1=Jan…12=Dec). When set with a benchmark seasonality
  // curve, new-customer conversion is tilted by the month's festive multiplier.
  // null → seasonality off. Stored, so GET re-simulates identically.
  launchStartMonth: z.number().int().min(1).max(12).nullable().default(null),
  // Category attention/hype momentum as a bounded demand tilt (%). Frozen at run
  // time from the Wikipedia-interest momentum signal; 0 → neutral.
  demandMomentumPct: z.number().min(-25).max(25).default(0),
  // Explicit net month-over-month demand/acquisition growth. null means derive
  // it from the simulated audience; 2 means demand compounds by +2% each month.
  monthlyGrowthPct: z.number().min(-80).max(300).nullable().default(null),

  // --- costs ---
  shippingPerOrder: z.number().nonnegative().default(120),
  paymentFeePct: z.number().min(0).max(1).default(0.02),
  fixedCostsPerMonth: z.number().nonnegative().default(0),
  // Up-front launch/setup cash reserve. null → computed by the route from fixed
  // costs + media runway; 0 → explicitly no reserve.
  launchInvestmentReserve: z.number().nonnegative().nullable().default(null),

  // --- refunds / returns ---
  returnWindowDays: z.number().int().min(0).max(180).default(30),
  refundRateMult: z.number().nonnegative().default(1), // scales the per-persona base refund propensity
  // Industry calibration: when set (from the benchmark layer's returns/RTO rate),
  // the engine scales per-persona refund propensities so the cohort mean matches
  // this target, overriding refundRateMult/preset. null → legacy multiplier path.
  // Part of the hashed inputs, so reruns stay deterministic.
  targetRefundRatePct: z.number().min(0).max(100).nullable().default(null),
  resellablePct: z.number().min(0).max(1).default(0.7), // fraction of returned units restocked as good
  returnShippingPerOrder: z.number().nonnegative().nullable().default(null), // null → shippingPerOrder

  // --- inventory ---
  initialInventoryUnits: z.number().int().nonnegative().nullable().default(null), // null → derived from demand
  reorderLeadTimeDays: z.number().int().min(0).max(180).default(30),
  reorderEnabled: z.boolean().default(true),
  // Minimum order quantity: reorders are placed in whole MOQ batches (realistic
  // procurement → sawtooth inventory + a leftover partial batch as deadstock).
  // null → derived (~1 month of demand). Set 1 for continuous/JIT reordering.
  minOrderQtyUnits: z.number().int().nonnegative().nullable().default(null),

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
    // Inventory reconciliation: total units paid for, and units still in transit
    // (paid, undelivered) at the horizon. Default 0 for results saved before these.
    unitsPurchased: z.number().default(0),
    unitsInTransitEnd: z.number().default(0),
    peakCapitalNeeded: z.number(), // worst cumulative cash trough (working capital)
    breakEvenStep: z.number().nullable(), // step index cumulative cash first repays launch capital
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
  // "Ask about this scenario" Q&A — persisted on the scenario record.
  followUp: z.array(FollowUpTurnSchema).default([]),
  createdAt: z.string(),
});
export type LaunchSimRecord = z.infer<typeof LaunchSimRecordSchema>;

// ---------------------------------------------------------------------------
// Knowledge-driven re-run: the founder adds a real-world fact about the product
// ("essential everyday wear, rebuy every few months, ~9% returns") and an LLM
// proposes JUSTIFIED deltas to the launch assumptions — which the founder then
// approves (or not) before the deterministic engine re-runs. Unbiased by design:
// changes can move EITHER way, each carries a rationale + confidence, and nothing
// is applied silently.
// ---------------------------------------------------------------------------

// The numeric launch knobs an assumption update is allowed to touch. Each maps
// 1:1 to a LaunchSimInputs field so the UI can merge an approved change directly.
export const AssumptionFieldSchema = z.enum([
  "salePrice",
  "costPrice",
  "adSpendPerMonth",
  "cpm",
  "targetRefundRatePct",
  "repeatRateMult",
  "decisionSpeed",
  "abandonRate",
  "viralityK",
  "organicReachPerStep",
  "targetingQuality",
  "monthlyGrowthPct",
  "launchInvestmentReserve",
]);
export type AssumptionField = z.infer<typeof AssumptionFieldSchema>;

export const ProposedAssumptionSchema = z.object({
  field: AssumptionFieldSchema,
  label: z.string(), // human-readable knob name
  currentValue: z.number().nullable(),
  proposedValue: z.number(),
  rationale: z.string(), // why THIS evidence moves THIS knob, this direction
  confidence: z.number().min(0).max(1),
});
export type ProposedAssumption = z.infer<typeof ProposedAssumptionSchema>;

export const AssumptionUpdateSchema = z.object({
  summary: z.string(),
  changes: z.array(ProposedAssumptionSchema).max(12).default([]),
  caveats: z.array(z.string()).default([]),
});
export type AssumptionUpdate = z.infer<typeof AssumptionUpdateSchema>;

// ---------------------------------------------------------------------------
// Export viability (Phase 3): deterministic landed-cost / export-pricing engine.
// Takes a home-market unit COGS and builds it up to a destination-market shelf
// price across one or more fulfillment paths, then scores the required price
// against the destination audience's willingness-to-pay. Pure arithmetic over
// the inputs (mirrors the launch-sim contract): same inputs → same report.
// ---------------------------------------------------------------------------

// How the home brand reaches the destination customer. Drives duty (de minimis),
// freight mode, fulfillment cost and platform fees.
export const FulfillmentPathSchema = z.enum([
  "dtc_parcel", // per-order cross-border parcels (air); de minimis may apply
  "bulk_warehouse", // containerized import, cleared once, fulfilled from a 3PL
  "marketplace", // imported in bulk, sold + fulfilled via a marketplace (FBA)
]);
export type FulfillmentPath = z.infer<typeof FulfillmentPathSchema>;

export const ExportSimInputsSchema = z.object({
  homeCurrency: z.string().default("INR"),
  destCurrency: z.string().default("USD"),
  destCountry: z.string().default("United States"),
  // 1 home-currency unit = fxRate destination-currency units (e.g. INR→USD≈0.012).
  fxRate: z.number().positive(),
  unitCogsHome: z.number().nonnegative(), // ex-works COGS per unit, home currency
  unitWeightKg: z.number().positive().default(0.5),
  hsCode: z.string().default(""),
  // Destination import duty %, live-sourced (WITS) but overridable.
  dutyRatePct: z.number().min(0).max(100).default(0),
  // De-minimis: small DTC parcels under the threshold historically clear duty-free.
  // Status is in flux — verify per corridor; this is an explicit, overridable knob.
  deMinimisActive: z.boolean().default(true),
  deMinimisThresholdUsd: z.number().nonnegative().default(800),
  targetMarginPct: z.number().min(0).max(95).default(50), // gross margin on dest price
  salesTaxPct: z.number().min(0).max(30).default(7.5), // destination avg combined sales tax
  paymentFeePct: z.number().min(0).max(0.2).default(0.029),
  // Per-unit allocation of inland-to-port freight + export docs, in dest currency.
  originLogisticsUsd: z.number().nonnegative().default(1.2),
  // Amortization base for per-entry fees (MPF/HMF/brokerage) on a bulk shipment.
  bulkUnitsPerEntry: z.number().int().positive().default(500),
  scenarios: z
    .array(FulfillmentPathSchema)
    .min(1)
    .default(["dtc_parcel", "bulk_warehouse", "marketplace"]),
  // Destination-currency WTP samples (the destination audience's prices) to score
  // the required price against. Empty → coverage/verdict is "unknown".
  wtpSamplesDest: z.array(z.number()).default([]),
  sources: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type ExportSimInputs = z.infer<typeof ExportSimInputsSchema>;

export const ExportWaterfallLineSchema = z.object({
  label: z.string(),
  amount: z.number(), // destination currency, per unit
  note: z.string().optional(),
});
export type ExportWaterfallLine = z.infer<typeof ExportWaterfallLineSchema>;

// A destination-market launch trajectory for one fulfillment scenario (Phase 4):
// the landed cost + required price run through the launch engine over the
// destination audience — directly comparable to the home-market launch sim.
export const ExportLaunchSummarySchema = z.object({
  currency: z.string(),
  horizonLabel: z.string(), // e.g. "90 days"
  adSpendPerMonth: z.number(),
  totalOrders: z.number(),
  unitsSold: z.number(),
  netRevenue: z.number(),
  netProfit: z.number(),
  grossMarginPct: z.number(),
  netMarginPct: z.number(),
  blendedCac: z.number(),
  breakEvenLabel: z.string().nullable(),
  peakCapitalNeeded: z.number(),
});
export type ExportLaunchSummary = z.infer<typeof ExportLaunchSummarySchema>;

export const ExportScenarioResultSchema = z.object({
  path: FulfillmentPathSchema,
  label: z.string(),
  waterfall: z.array(ExportWaterfallLineSchema), // ex-works → landed, per unit
  landedCostPerUnit: z.number(),
  requiredPrice: z.number(), // dest list price that hits target margin
  unitMargin: z.number(),
  marginPct: z.number(),
  consumerPriceWithTax: z.number(), // required price + destination sales tax
  wtpMedian: z.number().nullable(),
  wtpCoveragePct: z.number().nullable(), // % of audience whose WTP ≥ required price
  verdict: z.enum(["viable", "marginal", "unviable", "unknown"]),
  // Destination launch trajectory (Phase 4). Null from the pure engine; the route
  // fills it by running the launch sim over the destination audience.
  launch: ExportLaunchSummarySchema.nullable().default(null),
  notes: z.array(z.string()).default([]),
});
export type ExportScenarioResult = z.infer<typeof ExportScenarioResultSchema>;

export const ExportViabilityReportSchema = z.object({
  resolvedInputs: ExportSimInputsSchema,
  scenarios: z.array(ExportScenarioResultSchema),
  recommended: z
    .object({ path: FulfillmentPathSchema, requiredPrice: z.number(), reason: z.string() })
    .nullable(),
  // ± bands on the recommended path's required price — the honest answer given
  // FX / tariff / de-minimis uncertainty (the live-sourced inputs that move most).
  sensitivity: z.object({
    basePath: FulfillmentPathSchema.nullable(),
    fxPlus10Pct: z.number().nullable(), // required price if home currency strengthens 10%
    fxMinus10Pct: z.number().nullable(),
    dutyZero: z.number().nullable(), // required price if duty-free
    dutyDoubled: z.number().nullable(),
    deMinimisOff: z.number().nullable(), // DTC required price if de minimis ends
  }),
  sources: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type ExportViabilityReport = z.infer<typeof ExportViabilityReportSchema>;

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

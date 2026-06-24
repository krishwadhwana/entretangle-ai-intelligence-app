import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config";
import {
  recordProjectOnlyUsage,
  recordUsage,
  type ModelTier,
  type UsageFeatureKey,
} from "./usage";
import {
  PlannerV2OutputSchema,
  VenturePlanningContextSchema,
  ResearchPlannerOutputSchema,
  AudiencePlannerOutputSchema,
  ExecutorOutputSchema,
  EntanglerOutputSchema,
  QueryOutputSchema,
  AudienceChatOutputSchema,
  PersonaReplyOutputSchema,
  PersonaConclusionOutputSchema,
  type PersonaReplyOutput,
  type PersonaConclusionOutput,
  type PersonaConversationMessage,
  IntakeOutputSchema,
  WebsiteAnalysisOutputSchema,
  MarketDataOutputSchema,
  type WebsiteAnalysisOutput,
  type MarketDataOutput,
  type IntakePrefill,
  CohortSimOutputSchema,
  BrandKitSchema,
  DesignTokensSchema,
  type DesignTokens,
  CollateralContentSchema,
  type CollateralContent,
  type CollateralType,
  LogoMarksOutputSchema,
  type LogoMarksOutput,
  SiteGenOutputSchema,
  type SiteGenOutput,
  InspirationKitSchema,
  FounderStorySectionSchema,
  type InspirationKit,
  FinancialInputsSchema,
  FinalReportSchema,
  IndustryProfileSchema,
  IndustryKnowledgePackSchema,
  type IndustryProfile,
  type IndustryKnowledgePack,
  type PlannerV2Output,
  type ExecutorOutput,
  type EntanglerOutput,
  type QueryOutput,
  type AudienceChatHistoryItem,
  type AudienceChatMode,
  type AudienceChatOutput,
  type IntakeOutput,
  type CohortSimOutput,
  type BrandKit,
  type FounderStorySection,
  type FinancialInputs,
  type FinancialModel,
  type FinalReport,
  type ChatMessage,
  type ClientProfile,
  type Conclusion,
  type Cohort,
  type Persona,
  type Block,
  type AudienceAggregate,
  AssumptionUpdateSchema,
  type AssumptionUpdate,
  GeneratedPlaybookSchema,
  type GeneratedPlaybook,
} from "./schema";
import {
  VENTURE_CONTEXT_SYSTEM,
  RESEARCH_PLANNER_SYSTEM,
  AUDIENCE_PLANNER_SYSTEM,
  ventureContextUser,
  researchPlannerUser,
  audiencePlannerUser,
  type RunFocus,
  deskSystem,
  cohortSimSystem,
  audienceSynthSystem,
  ENTANGLER_V2_SYSTEM,
  entanglerUser,
  INTAKE_SYSTEM,
  WEBSITE_ANALYSIS_SYSTEM,
  websiteAnalysisUser,
  MARKET_DATA_SYSTEM,
  marketDataUser,
  PLAYBOOK_SYSTEM,
  playbookUser,
  DATA_QA_SYSTEM,
  dataQaUser,
  ASSUMPTION_UPDATE_SYSTEM,
  assumptionUpdateUser,
  intakePrefillBlock,
  QUERY_SYSTEM,
  queryV2User,
  FINAL_REPORT_SYSTEM,
  finalReportUser,
  FOUNDER_STORY_SYSTEM,
  founderStoryUser,
  audienceChatSystem,
  audienceChatUser,
  personaReplySystem,
  personaReplyUser,
  personaConclusionSystem,
  personaConclusionUser,
  type PersonaCtx,
  BRAND_KIT_SYSTEM,
  brandKitUser,
  DESIGN_TOKENS_SYSTEM,
  designTokensUser,
  COLLATERAL_COPY_SYSTEM,
  collateralCopyUser,
  LOGO_MARKS_SYSTEM,
  logoMarksUser,
  SITE_GEN_SYSTEM,
  siteGenUser,
  INSPIRATION_SYSTEM,
  inspirationUser,
  FINANCIALS_SYSTEM,
  financialsUser,
  INDUSTRY_CLASSIFIER_SYSTEM,
  industryClassifierUser,
  INDUSTRY_KNOWLEDGE_SYSTEM,
  industryKnowledgeUser,
} from "./prompts";
import {
  mockPlannerV2Output,
  mockDeskOutput,
  mockCohortSim,
  mockEntanglerV2,
  mockAudienceSynth,
  mockQueryOutput,
  mockAudienceChatOutput,
  mockBrandKit,
  mockInspiration,
} from "./fixtures/venture-sim";
import {
  DEMOGRAPHICS_SYSTEM,
  DemographicsOutputSchema,
  demographicsUser,
  mockDemographics,
  type DemographicsOutput,
} from "./datasources/demographics";
import { benchmarksForProfile } from "./datasources/benchmarks";
import { isProviderQuotaError, isProviderTimeoutError } from "./providerErrors";

const globalForLlm = globalThis as unknown as { openai?: OpenAI };

function client(): OpenAI {
  if (!globalForLlm.openai) {
    globalForLlm.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return globalForLlm.openai;
}

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

// GPT-5.x are reasoning models: temperature is unsupported, and reasoning
// tokens count against max_completion_tokens — keep the budget generous and
// reasoning effort low so blocks stay inside BLOCK_TIMEOUT_MS.
const COMPLETION_BUDGET = 8000;
const COHORT_BUDGET = 22000; // richer personas (lifestyle, reasoning, etc.) per batch
// Owner-dashboard add-ons run inside HTTP requests, so keep every model leg
// bounded and disable SDK retries that can silently multiply latency.
const OWNER_WEB_TIMEOUT_MS = 22_000;
const OWNER_FALLBACK_TIMEOUT_MS = 25_000;
const OWNER_QA_TIMEOUT_MS = 45_000;
const MARKET_DATA_TIMEOUT_MS = 90_000;
const FINANCIALS_WEB_TIMEOUT_MS = 25_000;
const FINANCIALS_FALLBACK_TIMEOUT_MS = 65_000;
const FINANCIALS_COMPLETION_BUDGET = 6000;
const PRODUCT_IMAGE_TIMEOUT_MS = 25_000;

function baseParams(
  model: string = config.model
): Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "messages"> {
  return {
    model,
    max_completion_tokens: COMPLETION_BUDGET,
    response_format: { type: "json_object" },
    reasoning_effort: "low",
  };
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

/**
 * One LLM call parsed through a Zod schema. On parse failure: exactly one
 * retry with the Zod error appended (SPEC §1, §10); then throws, and the
 * caller fails the unit (block/cohort), not the run. Token usage from every
 * response — including failed parses — is recorded against the run.
 */
async function callJson<T>(opts: {
  runId: string | null;
  projectId?: string | null;
  feature?: UsageFeatureKey;
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxAttempts?: number;
  model?: string;
  tier?: ModelTier;
  maxCompletionTokens?: number;
  // Per-request timeout in ms. The OpenAI SDK ABORTS the request at this
  // limit (real cancellation, not a Promise.race that lets the call finish
  // and bill anyway).
  requestTimeoutMs?: number;
  // SDK retry budget. Low for cohort calls so a timed-out (stuck) call fails
  // fast instead of being retried 2× (which made one stuck call block a slot
  // for ~12 minutes).
  requestMaxRetries?: number;
}): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < (opts.maxAttempts ?? 2); attempt++) {
    const messages: Msg[] = [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ];
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `Your previous JSON output failed validation:\n${lastError}\nOutput corrected JSON only, no markdown fences.`,
      });
    }
    const response = await client().chat.completions.create(
      {
        ...baseParams(opts.model),
        ...(opts.maxCompletionTokens
          ? { max_completion_tokens: opts.maxCompletionTokens }
          : {}),
        messages,
      },
      opts.requestTimeoutMs || opts.requestMaxRetries !== undefined
        ? {
            ...(opts.requestTimeoutMs
              ? { timeout: opts.requestTimeoutMs }
              : {}),
            ...(opts.requestMaxRetries !== undefined
              ? { maxRetries: opts.requestMaxRetries }
              : {}),
          }
        : undefined
    );
    if (response.usage) {
      if (opts.runId) {
        await recordUsage(
          opts.runId,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          opts.tier ?? "frontier",
          0,
          { feature: opts.feature, projectId: opts.projectId }
        );
      } else if (opts.projectId) {
        await recordProjectOnlyUsage(
          opts.projectId,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          opts.tier ?? "frontier",
          0,
          opts.feature ?? "simulation.core"
        );
      }
    }

    const text = response.choices[0]?.message?.content ?? "";
    try {
      const parsed = opts.schema.safeParse(JSON.parse(stripFences(text)));
      if (parsed.success) return parsed.data;
      lastError = JSON.stringify(parsed.error.issues);
    } catch (e) {
      lastError = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(`LLM output failed validation after retry: ${lastError}`);
}

// ---------------------------------------------------------------------------
// The call sites. MOCK_MODE=true swaps in fixtures (SPEC §8) — all delays,
// events, persistence and UI paths stay identical to real mode.
// ---------------------------------------------------------------------------

/**
 * v2 planning compatibility wrapper. Internally split into:
 * 1. shared venture context,
 * 2. research desks,
 * 3. audience cohort matrix.
 * Callers still receive the historical combined shape.
 */
export async function callPlannerV2(
  runId: string,
  profile: ClientProfile,
  focus?: RunFocus,
  groundTruth?: string
): Promise<PlannerV2Output> {
  if (config.mockMode) return PlannerV2OutputSchema.parse(mockPlannerV2Output);
  const context = await callJson({
    runId,
    system: VENTURE_CONTEXT_SYSTEM,
    user: ventureContextUser(profile, focus, groundTruth),
    schema: VenturePlanningContextSchema,
    maxCompletionTokens: 6000,
  });
  const [research, audience] = await Promise.all([
    callJson({
      runId,
      system: RESEARCH_PLANNER_SYSTEM,
      user: researchPlannerUser(profile, context, focus, groundTruth),
      schema: ResearchPlannerOutputSchema,
      maxCompletionTokens: 14000,
    }),
    callJson({
      runId,
      system: AUDIENCE_PLANNER_SYSTEM,
      user: audiencePlannerUser(profile, context, focus, groundTruth),
      schema: AudiencePlannerOutputSchema,
      maxCompletionTokens: 18000,
    }),
  ]);
  return PlannerV2OutputSchema.parse({
    desks: research.desks,
    cohortPlan: audience.cohortPlan,
  });
}

/**
 * Incrementally extract completed string elements of the "logs" array from a
 * partial JSON snapshot — fuels true log streaming (SPEC Shot 7).
 */
export function extractCompletedLogLines(text: string): string[] {
  const m = text.match(/"logs"\s*:\s*\[/);
  if (!m) return [];
  const lines: string[] = [];
  let raw = "";
  let inString = false;
  let escaped = false;
  for (let i = (m.index ?? 0) + m[0].length; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      raw += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        try {
          lines.push(JSON.parse(`"${raw.slice(0, -1)}"`));
        } catch {
          lines.push(raw.slice(0, -1));
        }
        raw = "";
      }
    } else if (ch === '"') {
      inString = true;
      raw = "";
    } else if (ch === "]") {
      break;
    }
  }
  return lines;
}

/**
 * Web-grounded desk call (SPEC-V2 §4) via the Responses API `web_search`
 * tool. Non-streaming (search round-trips dominate latency anyway); logs are
 * replayed with pacing by blocks.ts. Any failure here throws and the caller
 * falls back to the ungrounded streaming path — a desk never dies because
 * search did.
 */
async function callDeskWebSearch(
  runId: string,
  system: string
): Promise<ExecutorOutput> {
  const response = await client().responses.create({
    model: config.model,
    tools: [{ type: "web_search" } as never],
    input: [
      { role: "system", content: system },
      { role: "user", content: "Begin. Search the web, then output JSON only." },
    ],
    max_output_tokens: COMPLETION_BUDGET,
    reasoning: { effort: "low" },
  });

  const searchCalls = Array.isArray(response.output)
    ? response.output.filter((o: { type?: string }) =>
        String(o.type ?? "").startsWith("web_search")
      ).length
    : 0;
  if (response.usage) {
    await recordUsage(
      runId,
      response.usage.input_tokens ?? 0,
      response.usage.output_tokens ?? 0,
      "frontier",
      searchCalls,
      { feature: "simulation.web_research" }
    );
  }

  const text = response.output_text ?? "";
  const parsed = ExecutorOutputSchema.safeParse(JSON.parse(stripFences(text)));
  if (!parsed.success) {
    throw new Error(
      `web desk output failed validation: ${JSON.stringify(parsed.error.issues)}`
    );
  }
  return parsed.data;
}

/**
 * Desk executor. Web-grounded desks go through the Responses API with
 * web_search (with automatic ungrounded fallback); ungrounded desks stream
 * log lines live as they generate (SPEC Shot 7).
 */
export async function callExecutor(
  runId: string,
  block: Pick<Block, "name" | "mission" | "domain">,
  profile: ClientProfile,
  inputConclusions: Conclusion[],
  onLog?: (line: string) => Promise<void>,
  webGrounded = false,
  groundTruth?: string
): Promise<ExecutorOutput> {
  if (config.mockMode) {
    return ExecutorOutputSchema.parse(mockDeskOutput(block.name));
  }

  if (webGrounded) {
    try {
      return await callDeskWebSearch(
        runId,
        deskSystem(block, profile, inputConclusions, true, groundTruth)
      );
    } catch (e) {
      console.log(
        `[llm] web search failed for "${block.name}", falling back ungrounded: ${e}`
      );
      if (onLog) await onLog("web search unavailable — using model knowledge");
    }
  }

  const system = deskSystem(block, profile, inputConclusions, false, groundTruth);
  const user = "Begin. Output JSON only.";

  const stream = await client().chat.completions.create({
    ...baseParams(),
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  // Emit log lines in order as they complete inside the streamed JSON.
  let snapshot = "";
  let emitted = 0;
  let emitChain = Promise.resolve();
  let usage: OpenAI.CompletionUsage | null = null;
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    snapshot += delta;
    if (onLog) {
      const lines = extractCompletedLogLines(snapshot);
      for (const line of lines.slice(emitted)) {
        emitted += 1;
        emitChain = emitChain.then(() => onLog(line)).catch(() => undefined);
      }
    }
  }
  await emitChain;
  if (usage) {
    await recordUsage(
      runId,
      usage.prompt_tokens,
      usage.completion_tokens,
      "frontier",
      0,
      { feature: "simulation.web_research" }
    );
  }

  let parseError: string;
  try {
    const parsed = ExecutorOutputSchema.safeParse(
      JSON.parse(stripFences(snapshot))
    );
    if (parsed.success) return parsed.data;
    parseError = JSON.stringify(parsed.error.issues);
  } catch (e) {
    parseError = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Single non-streaming retry with the validation error appended (SPEC §1).
  return callJson({
    runId,
    system,
    user: `${user}\nYour previous output failed validation:\n${parseError}\nOutput corrected JSON only, no markdown fences.`,
    schema: ExecutorOutputSchema,
    maxAttempts: 1,
  });
}

/**
 * One cohort-simulation call = 25–50 personas on the mini model
 * (SPEC-V2 §1C). This is how "thousands of agents" stay inside $5.
 */
export async function callCohortSim(
  runId: string,
  cohort: Pick<Cohort, "label" | "locality" | "country" | "segment" | "role">,
  profile: ClientProfile,
  currency: string,
  n: number,
  batchIndex = 0,
  focus?: RunFocus,
  calibration?: string
): Promise<CohortSimOutput> {
  if (config.mockMode) {
    return CohortSimOutputSchema.parse(
      mockCohortSim(cohort, currency, n, batchIndex)
    );
  }
  // Each batch is a fresh, non-overlapping draw of people from the cohort.
  const batchNote =
    batchIndex > 0
      ? ` This is persona batch #${batchIndex + 1} for this cohort: generate ${n} DIFFERENT individuals who do not overlap with earlier batches — push the demographic and attitudinal spread even wider.`
      : "";
  const out = await callJson({
    runId,
    feature: "simulation.audience",
    system: cohortSimSystem(cohort, profile, currency, n, focus, calibration),
    user: `Simulate ${n} personas now.${batchNote} Output JSON only.`,
    schema: CohortSimOutputSchema,
    model: config.miniModel,
    tier: "mini",
    maxCompletionTokens: COHORT_BUDGET,
    requestTimeoutMs: config.cohortTimeoutMs,
    requestMaxRetries: 1, // fail a stuck call fast instead of retrying 2×
  });
  return { ...out, personas: out.personas.slice(0, n) };
}

/** Audience Synthesis desk: aggregate stats -> typed conclusions. */
export async function callAudienceSynth(
  runId: string,
  profile: ClientProfile,
  aggregate: AudienceAggregate,
  groundTruth?: string,
  focus?: RunFocus
): Promise<ExecutorOutput> {
  if (config.mockMode) {
    return ExecutorOutputSchema.parse(mockAudienceSynth(aggregate));
  }
  return callJson({
    runId,
    feature: "simulation.audience",
    system: audienceSynthSystem(profile, aggregate, groundTruth, focus),
    user: "Begin. Output JSON only.",
    schema: ExecutorOutputSchema,
  });
}

/**
 * Real-demographics lookup for the audience calibration step (option A).
 * Web-grounded in real mode (so cohort weights mirror real census data);
 * deterministic fixture in mock mode. Returns null on failure — the caller
 * then keeps the planner's own weights.
 */
export async function callDemographics(
  runId: string,
  localities: PlannerV2Output["cohortPlan"]["localities"]
): Promise<DemographicsOutput | null> {
  if (localities.length === 0) return null;
  if (config.mockMode) {
    return DemographicsOutputSchema.parse(mockDemographics(localities));
  }
  try {
    const response = await client().responses.create({
      model: config.model,
      tools: [{ type: "web_search" } as never],
      input: [
        { role: "system", content: DEMOGRAPHICS_SYSTEM },
        {
          role: "user",
          content: `Localities:\n${demographicsUser(
            localities
          )}\nSearch for real figures, then output JSON only.`,
        },
      ],
      max_output_tokens: 10000,
      reasoning: { effort: "low" },
    });
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "market.data" }
      );
    }
    const parsed = DemographicsOutputSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    return parsed.success ? parsed.data : null;
  } catch (e) {
    console.log(`[llm] demographics lookup failed: ${e}`);
    return null;
  }
}

/**
 * Classify the venture into an industry + HS codes + OSM shop tags so the
 * real-data providers (trade, tariffs, local competition, curated library) can
 * be matched to THIS venture. One cheap model call (no web search); on any
 * failure returns a permissive "general" profile so the run never blocks.
 */
export async function callClassifyVenture(
  runId: string,
  profile: ClientProfile
): Promise<IndustryProfile> {
  const fallback: IndustryProfile = {
    industry: profile.category ?? "general",
    category: profile.category ?? "",
    isPhysicalGood: true,
    hsCodes: [],
    osmShopTags: [],
    libraryKey: "general",
    keywords: [],
    openDataQueries: [],
  };
  if (config.mockMode) {
    // Mock venture = Jodhpur teak furniture.
    return IndustryProfileSchema.parse({
      industry: "furniture",
      category: "premium solid-wood furniture",
      isPhysicalGood: true,
      hsCodes: ["9403", "940360"],
      osmShopTags: ["furniture"],
      libraryKey: "furniture",
      keywords: ["teak", "furniture", "dining table", "export"],
      openDataQueries: ["building permits", "retail trade"],
    });
  }
  try {
    return await callJson({
      runId,
      system: INDUSTRY_CLASSIFIER_SYSTEM,
      user: industryClassifierUser(profile),
      schema: IndustryProfileSchema,
      maxCompletionTokens: 1200,
    });
  } catch (e) {
    console.log(`[llm] industry classification failed, using general: ${e}`);
    return fallback;
  }
}

/**
 * Auto knowledge-builder (option A): research an industry once into a reusable
 * pack + planning template, web-grounded with real sources. Returns the pack
 * and the source URLs it used. Null on failure (caller falls back to the
 * curated library). Not metered to a run when runId is null.
 */
export async function callBuildIndustryKnowledge(
  runId: string | null,
  industry: string,
  geography: string[]
): Promise<{ pack: IndustryKnowledgePack; sources: string[] } | null> {
  if (config.mockMode) {
    const pack = IndustryKnowledgePackSchema.parse({
      industry,
      summary: `${industry}: auto-built knowledge pack (mock). New entrants must nail sourcing/production economics, the right buyer types, and regulation before scaling.`,
      facts: [
        { text: `${industry} has distinct manufacturing/sourcing clusters and MOQ economics.`, source: "mock:industry-body" },
        { text: `Working capital tied in inventory is the dominant constraint for new entrants.`, source: "mock:analysis" },
      ],
      planningTemplate: {
        customerRoles: ["consumer", "retail_exec", "distributor", "institutional", "influencer"],
        segments: ["budget", "middle", "affluent", "luxury"],
        keyDesks: [
          { name: "Market Demand", domain: "market", why: "size & trends" },
          { name: "Manufacturing & Sourcing", domain: "supply", why: "MOQ & lead times" },
          { name: "Unit Economics", domain: "finance", why: "margins & funding fit" },
        ],
        kpis: ["MOQ", "gross margin", "sell-through"],
        notes: "Mock pack — replace with web-grounded build in real mode.",
      },
    });
    return { pack, sources: ["mock:industry-knowledge"] };
  }
  try {
    const response = await client().responses.create({
      model: config.model,
      tools: [{ type: "web_search" } as never],
      input: [
        { role: "system", content: INDUSTRY_KNOWLEDGE_SYSTEM },
        {
          role: "user",
          content: `${industryKnowledgeUser(
            industry,
            geography
          )}\nSearch for current, real facts, then output JSON only.`,
        },
      ],
      max_output_tokens: 6000,
      reasoning: { effort: "low" },
    });
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (runId && response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "industry.data" }
      );
    }
    const parsed = IndustryKnowledgePackSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (!parsed.success) return null;
    // Collect the real URLs the facts cite as provenance.
    const sources = Array.from(
      new Set(
        parsed.data.facts
          .map((f) => f.source)
          .filter((s) => s && s.startsWith("http"))
      )
    );
    return { pack: parsed.data, sources };
  } catch (e) {
    console.log(`[llm] industry knowledge build failed: ${e}`);
    return null;
  }
}

export async function callEntangler(
  runId: string,
  blocks: {
    id: string;
    name: string;
    domain?: string;
    conclusions: Conclusion[];
  }[],
  round: number
): Promise<EntanglerOutput> {
  if (config.mockMode) {
    return EntanglerOutputSchema.parse(mockEntanglerV2(blocks, round));
  }
  return callJson({
    runId,
    system: ENTANGLER_V2_SYSTEM,
    user: entanglerUser(blocks),
    schema: EntanglerOutputSchema,
  });
}

// Intake interview (Shot 8). No run exists yet, so usage is not metered
// against a run. Mock mode walks a fixed product-first script.
export async function callIntake(
  messages: ChatMessage[],
  prefill?: IntakePrefill | null
): Promise<IntakeOutput> {
  if (config.mockMode) {
    const answers = messages.filter((m) => m.role === "user");
    const script: { question: string; options: string[]; multiSelect: boolean }[] = [
      {
        question: "Which product range are you launching first?",
        options: [
          "Men's ready-to-wear",
          "Occasion/fusion wear",
          "Jackets and overshirts",
          "Full capsule collection",
        ],
        multiSelect: true,
      },
      {
        question: "What should the visual style feel like?",
        options: [
          "Minimal quiet luxury",
          "Bold fashion-forward",
          "Heritage craft",
          "Indo-western fusion",
          "Streetwear edge",
        ],
        multiSelect: true,
      },
      {
        question: "What occasions should customers buy this for?",
        options: [
          "Work and dinners",
          "Weddings and parties",
          "Travel and resort",
          "Festive family events",
          "Everyday premium basics",
        ],
        multiSelect: true,
      },
      {
        question: "Which product cues matter most?",
        options: [
          "Sharp fit",
          "Relaxed comfort",
          "Premium fabrics",
          "Statement details",
          "Easy alterations",
        ],
        multiSelect: true,
      },
      {
        question:
          "How much capital do you have available, and how long does it need to last?",
        options: [
          "Under ₹10 lakh, 6 months",
          "₹10–25 lakh, 12 months",
          "₹25 lakh–1 crore, 18 months",
          "Over ₹1 crore, 24+ months",
        ],
        multiSelect: false,
      },
      {
        question: "What's your background with physical products?",
        options: [
          "First venture",
          "Built/sold products before",
          "Family business in this category",
          "Operator at a brand, first time founding",
        ],
        multiSelect: false,
      },
      {
        question: "Which markets are you targeting? (pick all that apply)",
        options: ["Mumbai", "Delhi NCR", "Bangalore", "Dubai / Gulf", "London / UK"],
        multiSelect: true,
      },
      {
        question: "Any restrictions I should plan around?",
        options: [
          "No outside investors",
          "Must stay online-only year one",
          "Limited time (side project)",
          "No restrictions",
        ],
        multiSelect: true,
      },
    ];
    if (answers.length <= script.length) {
      return { done: false, ...script[answers.length - 1] };
    }
    const [
      brief,
      productRange,
      style,
      occasions,
      productCues,
      capital,
      experience,
      scale,
      restrictions,
    ] = answers.map(
      (m) => m.content
    );
    const capitalLakh = parseFloat(capital.replace(/[^\d.]/g, ""));
    const runwayMatch = capital.match(/(\d+)\s*\+?\s*months/i);
    return {
      done: true,
      brief,
      profile: {
        ambitions: brief,
        product: brief,
        capitalInr: Number.isFinite(capitalLakh) ? capitalLakh * 100000 : null,
        experience,
        scale,
        restrictions: restrictions
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        goal: scale,
        category: "consumer product",
        priceBand: "premium",
        geography: scale.split(",").map((s) => s.trim()).filter(Boolean),
        targetAudience: "affluent urban consumers",
        productDetails: {
          styleKeywords: style.split(",").map((s) => s.trim()).filter(Boolean),
          aestheticReferences: [],
          heroProducts: productRange
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          occasions: occasions.split(",").map((s) => s.trim()).filter(Boolean),
          materialsAndFit: productCues,
          differentiation: style,
        },
        funding: {
          capitalAvailable: capital.split(",")[0]?.trim() || null,
          runwayMonths: runwayMatch ? parseInt(runwayMatch[1], 10) : null,
        },
      },
    };
  }

  // The client starts with a static assistant greeting; cap the number of real
  // intake questions, not the greeting plus questions.
  const questionsAsked = Math.max(
    0,
    messages.filter((m) => m.role === "assistant").length - 1
  );
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client().chat.completions.create({
      ...baseParams(),
      messages: [
        {
          role: "system",
          content:
            INTAKE_SYSTEM +
            (prefill ? intakePrefillBlock(prefill) : "") +
            (questionsAsked >= 10
              ? "\nYou have asked 10 questions. You MUST output done:true now."
              : "") +
            (attempt > 0
              ? `\nYour previous output failed validation:\n${lastError}`
              : ""),
        },
        ...messages,
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    try {
      const parsed = IntakeOutputSchema.safeParse(JSON.parse(stripFences(text)));
      if (parsed.success) return parsed.data;
      lastError = JSON.stringify(parsed.error.issues);
    } catch (e) {
      lastError = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(`Intake output failed validation after retry: ${lastError}`);
}

export async function callQuery(
  runId: string,
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null,
  question: string
): Promise<QueryOutput> {
  if (config.mockMode) {
    return QueryOutputSchema.parse({
      ...mockQueryOutput,
      citedConclusionIds: conclusions.slice(0, 3).map((c) => c.id),
    });
  }
  return callJson({
    runId,
    feature: "simulation.chat",
    system: QUERY_SYSTEM,
    user: queryV2User(profile, conclusions, aggregate, question),
    schema: QueryOutputSchema,
  });
}

export async function callFounderStory(
  context: unknown,
  projectId: string | null = null
): Promise<FounderStorySection> {
  if (config.mockMode) {
    return FounderStorySectionSchema.parse({
      signals: {
        founderBackground: "Mock founder background extracted from supplied evidence.",
        originStory: "Mock origin story for the venture.",
        founderMotivation: "Mock founder motivation.",
        whyNow: "Mock why-now signal.",
        customerInsight: "Mock customer insight.",
        categoryConviction: "Mock category conviction.",
        credibilityProof: ["Mock proof asset"],
        unfairAdvantages: ["Mock unfair advantage"],
        constraints: ["Mock constraint"],
        openQuestions: ["Which founder details should be confirmed before publishing?"],
      },
      evidenceIds: {},
      evidence: [],
      sources: [],
      confidence: 0.2,
    });
  }
  return callJson({
    runId: null,
    projectId,
    feature: "founder.story",
    system: FOUNDER_STORY_SYSTEM,
    user: founderStoryUser(context),
    schema: FounderStorySectionSchema,
    maxCompletionTokens: 6000,
  });
}

export async function callFinalReport(
  runId: string,
  profile: ClientProfile,
  blocks: Pick<Block, "id" | "name" | "domain" | "kind" | "conclusions">[],
  aggregate: AudienceAggregate | null,
  financials: FinancialModel | null = null,
  founderStory: FounderStorySection | null = null
): Promise<FinalReport> {
  if (config.mockMode) {
    return FinalReportSchema.parse({
      title: `Final report: ${profile.product}`,
      executiveSummary:
        "Mock final report synthesising market, product, customer, competitor, economics and action-plan findings.",
      verdict:
        "Proceed only after validating the highest-risk assumptions in pricing, channel economics and customer adoption.",
      sections: [
        {
          title: "Market analysis",
          summary: "The market has identifiable demand pockets but requires focused entry.",
          bullets: ["Prioritise the strongest geography/segment pair.", "Use desk findings to size the first wedge."],
          citedConclusionIds: blocks.flatMap((b) => b.conclusions).slice(0, 2).map((c) => c.id),
        },
        {
          title: "Product analysis",
          summary: "The offer needs crisp positioning and proof of differentiated value.",
          bullets: ["Tighten the product promise.", "Validate the feature or SKU that drives conversion."],
          citedConclusionIds: [],
        },
        {
          title: "Customer perception",
          summary: "Audience reactions split between clear utility and adoption objections.",
          bullets: ["Use supportive language in messaging.", "Defuse the dominant objections early."],
          citedConclusionIds: [],
        },
        {
          title: "Competitors",
          summary: "Competitive pressure requires a narrow, defensible beachhead.",
          bullets: ["Map direct substitutes.", "Avoid broad undifferentiated launch claims."],
          citedConclusionIds: [],
        },
        {
          title: "Economic viability",
          summary: "Economics depend on pricing discipline and channel costs.",
          bullets: ["Protect gross margin.", "Run a unit-economics pilot before scaling."],
          citedConclusionIds: [],
        },
        {
          title: "How to act",
          summary: "Move through a staged validation plan before committing full capital.",
          bullets: ["Pilot with the highest-intent cohort.", "Measure conversion, CAC, margin and repeat purchase."],
          citedConclusionIds: [],
        },
      ],
      nextActions: [
        "Choose one launch segment and one primary channel.",
        "Run a small paid or partner pilot with explicit success thresholds.",
        "Revise pricing and messaging using the strongest objections.",
      ],
      risks: [
        "The simulated audience is directional and must be validated with real buyers.",
        "Unit economics can break if acquisition, discounts or operations costs are underestimated.",
      ],
    });
  }
  return callJson({
    runId,
    system: FINAL_REPORT_SYSTEM,
    user: finalReportUser(profile, blocks, aggregate, financials, founderStory),
    schema: FinalReportSchema,
    maxCompletionTokens: 16000,
  });
}

export async function callAudienceChat(
  runId: string,
  profile: ClientProfile,
  cohort: Cohort,
  personas: Persona[],
  mode: AudienceChatMode,
  question: string,
  history: AudienceChatHistoryItem[]
): Promise<AudienceChatOutput> {
  if (config.mockMode) {
    return AudienceChatOutputSchema.parse(
      mockAudienceChatOutput(mode, personas, question)
    );
  }
  return callJson({
    runId,
    system: audienceChatSystem(profile, cohort, personas, mode),
    user: audienceChatUser(question, history),
    schema: AudienceChatOutputSchema,
    model: config.miniModel,
    tier: "mini",
    maxCompletionTokens: 5000,
    requestTimeoutMs: config.blockTimeoutMs,
    requestMaxRetries: 1,
  });
}

/**
 * Persona Interaction: generate ONE in-character reply from `speaker` in an
 * ongoing two-persona discussion. One message per call = bounded cost (the user
 * clicks to advance each turn). Founder-injected notes ride along in `history`
 * as role "founder" so both personas reason over the new knowledge.
 */
export async function callPersonaReply(
  runId: string,
  profile: ClientProfile,
  speaker: PersonaCtx,
  others: PersonaCtx[],
  topic: string,
  history: PersonaConversationMessage[]
): Promise<PersonaReplyOutput> {
  if (config.mockMode) {
    return PersonaReplyOutputSchema.parse({
      content: `[${speaker.persona.name}] (mock) Responding to ${others
        .map((o) => o.persona.name)
        .join(", ")} about ${topic || "the product"}.`,
      intentAfter: null,
    });
  }
  return callJson({
    runId,
    system: personaReplySystem(profile, speaker, others, topic),
    user: personaReplyUser(
      history.map((m) => ({
        role: m.role,
        speaker: m.speaker,
        content: m.content,
      })),
      speaker.persona.name
    ),
    schema: PersonaReplyOutputSchema,
    model: config.miniModel,
    tier: "mini",
    maxCompletionTokens: 1200,
    requestTimeoutMs: config.blockTimeoutMs,
    requestMaxRetries: 1,
  });
}

/** Synthesize a finished two-persona discussion into a founder conclusion. */
export async function callPersonaConclusion(
  runId: string,
  profile: ClientProfile,
  participants: PersonaCtx[],
  topic: string,
  history: PersonaConversationMessage[]
): Promise<PersonaConclusionOutput> {
  if (config.mockMode) {
    return PersonaConclusionOutputSchema.parse({
      conclusion: `(mock) ${participants
        .map((p) => p.persona.name)
        .join(", ")} discussed ${topic || "the product"}.`,
    });
  }
  return callJson({
    runId,
    system: personaConclusionSystem(profile, participants, topic),
    user: personaConclusionUser(
      history.map((m) => ({
        role: m.role,
        speaker: m.speaker,
        content: m.content,
      }))
    ),
    schema: PersonaConclusionOutputSchema,
    model: config.miniModel,
    tier: "mini",
    maxCompletionTokens: 1500,
    requestTimeoutMs: config.blockTimeoutMs,
    requestMaxRetries: 1,
  });
}

/**
 * Owner Dashboard › Brand & Social Action Plan (one call over the converged
 * world model). Web-grounded so comparable accounts come back as REAL, cited
 * handles (the ~60/40 mix); on any web/parse failure it falls back to a plain
 * JSON call (ungrounded accounts) — like the desks, it never hard-fails.
 */
function ownerProviderFallbackReason(e: unknown): string {
  if (isProviderQuotaError(e)) return "provider quota was unavailable";
  if (isProviderTimeoutError(e)) return "provider request timed out";
  return "provider request failed";
}

function shouldUseOwnerLocalFallback(e: unknown): boolean {
  return isProviderQuotaError(e) || isProviderTimeoutError(e);
}

function profileProduct(profile: ClientProfile): string {
  return profile.product || profile.category || "the product";
}

function profileAudience(profile: ClientProfile): string {
  return (
    profile.targetAudience ||
    profile.geography?.join(", ") ||
    profile.scale ||
    "the target customer"
  );
}

function fallbackBrandKit(
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null,
  reason: string
): BrandKit {
  const product = profileProduct(profile);
  const audience = profileAudience(profile);
  const category = profile.category || "category";
  const topFindings = conclusions
    .map((c) => `${c.claim}: ${c.value}`)
    .filter(Boolean)
    .slice(0, 4);
  const segmentCount =
    aggregate?.bySegment && typeof aggregate.bySegment === "object"
      ? Object.keys(aggregate.bySegment).length
      : 0;
  return BrandKitSchema.parse({
    comparableAccounts: [
      {
        id: "category-leaders",
        name: `${category} category leaders`,
        platform: "Instagram / TikTok",
        handle: "@category-benchmark",
        url: null,
        followers: null,
        grounded: false,
        whyRelevant: `Fast fallback generated because ${reason}; use this as a search target for ${product} brands serving ${audience}.`,
        whatToEmulate:
          "Collect 5-8 recent posts from brands with clear product demos, founder proof, and repeated customer objections.",
        source: null,
      },
      {
        id: "creator-led-proofs",
        name: "Creator-led proof accounts",
        platform: "YouTube / Instagram",
        handle: "@creator-benchmark",
        url: null,
        followers: null,
        grounded: false,
        whyRelevant:
          "The simulated audience needs concrete usage proof before purchase; creator-style explainers can compress trust-building.",
        whatToEmulate:
          "Use one product problem, one demo, one before/after, and one objection reply per short-form post.",
        source: null,
      },
    ],
    brandIdentity: {
      voice: `Clear, confident, and specific to ${audience}; avoid vague premium language unless it proves a product benefit.`,
      positioning: `${product} should be positioned around the strongest simulated buying trigger, then backed with visible proof, price clarity, and risk reversal.`,
      visualCodes: [
        "Close product detail shots",
        "In-use customer context",
        "Simple comparison frames",
        "Proof-led captions",
      ],
      namingCues: [
        product,
        category,
        ...(profile.productDetails?.styleKeywords ?? []).slice(0, 3),
      ].filter(Boolean),
      doList: [
        "Lead with the product outcome in the first line.",
        "Turn the top audience objection into a recurring content series.",
        "Show price, quality cues, and fulfillment trust signals together.",
        ...topFindings.slice(0, 2),
      ],
      dontList: [
        "Do not bury the product behind lifestyle-only imagery.",
        "Do not copy competitor tone without matching the proof standard.",
        "Do not launch paid creative before testing three organic hooks.",
      ],
    },
    socialGuidelines: {
      contentPillars: [
        "Product proof",
        "Objection handling",
        "Founder/process trust",
        "Customer use cases",
      ],
      platformPlan: [
        {
          platform: "Instagram",
          segment: segmentCount > 1 ? "highest-intent segments" : null,
          cadence: "4-5 posts/reels per week",
          formats: ["Reels", "carousels", "stories"],
          notes: "Prioritize demos, customer objections, and visual proof.",
        },
        {
          platform: "YouTube Shorts",
          segment: null,
          cadence: "2-3 shorts per week",
          formats: ["short demos", "comparison clips"],
          notes: "Use search-friendly titles around the product problem.",
        },
      ],
    },
    checklist: [
      {
        id: "setup-proof-library",
        category: "Setup",
        title: "Build a proof library",
        detail:
          "Save 20 product shots, demos, testimonials, process clips, and objection replies before running ads.",
        priority: "now",
      },
      {
        id: "brand-positioning-line",
        category: "Brand",
        title: "Lock one positioning line",
        detail: `Write a one-line promise for ${product} aimed at ${audience}.`,
        priority: "now",
      },
      {
        id: "content-objection-series",
        category: "Content",
        title: "Create an objection series",
        detail: "Publish one short post for price, quality, trust, delivery, and fit/use-case objections.",
        priority: "soon",
      },
      {
        id: "growth-small-budget-test",
        category: "Growth",
        title: "Run a small creative test",
        detail: "Test 3 hooks x 2 formats before scaling spend.",
        priority: "soon",
      },
      {
        id: "outreach-creator-shortlist",
        category: "Outreach",
        title: "Shortlist creators",
        detail: "Find 10 niche creators whose audience matches the simulated buyer profile.",
        priority: "later",
      },
    ],
  });
}

export async function callBrandKit(
  runId: string,
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null,
  founderStory: FounderStorySection | null = null
): Promise<BrandKit> {
  if (config.mockMode) return BrandKitSchema.parse(mockBrandKit);

  const system = `${BRAND_KIT_SYSTEM}\n\n--- INPUT ---\n${brandKitUser(
    profile,
    conclusions,
    aggregate,
    founderStory
  )}`;

  // Preferred path: Responses API with web_search so accounts are verifiable.
  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              "Search the web to verify comparable accounts, then output JSON only.",
          },
        ],
        max_output_tokens: 8000,
        reasoning: { effort: "low" },
      },
      { timeout: OWNER_WEB_TIMEOUT_MS, maxRetries: 0 }
    );
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "brand.social" }
      );
    }
    const parsed = BrandKitSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (parsed.success) return parsed.data;
    throw new Error(
      `brand kit (web) failed validation: ${JSON.stringify(parsed.error.issues)}`
    );
  } catch (e) {
    console.error(`[brandkit] web-grounded path failed, falling back:`, e);
    if (shouldUseOwnerLocalFallback(e)) {
      return fallbackBrandKit(
        profile,
        conclusions,
        aggregate,
        ownerProviderFallbackReason(e)
      );
    }
    // Ungrounded fallback — accounts come from model knowledge (grounded:false).
    try {
      return await callJson({
        runId,
        feature: "brand.social",
        system: BRAND_KIT_SYSTEM,
        user: brandKitUser(profile, conclusions, aggregate, founderStory),
        schema: BrandKitSchema,
        maxCompletionTokens: 8000,
        requestTimeoutMs: OWNER_FALLBACK_TIMEOUT_MS,
        requestMaxRetries: 0,
      });
    } catch (fallbackError) {
      console.error(`[brandkit] JSON fallback failed:`, fallbackError);
      return fallbackBrandKit(
        profile,
        conclusions,
        aggregate,
        ownerProviderFallbackReason(fallbackError)
      );
    }
  }
}

// Deterministic fallback tokens — a neutral, legible system used in mock mode
// and when the model call fails. Never the headline experience, just a floor so
// the Design Studio always has something coherent to render from.
const FALLBACK_DESIGN_TOKENS: DesignTokens = {
  palette: {
    primary: "#1F2937",
    secondary: "#4F46E5",
    accent: "#F59E0B",
    neutralDark: "#111827",
    neutralLight: "#F9FAFB",
    extra: [],
  },
  typography: {
    headingFamily: "Poppins",
    bodyFamily: "Inter",
    headingGoogleUrl:
      "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap",
    bodyGoogleUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
    weights: ["400", "600", "700"],
    pairingRationale:
      "A geometric heading over a neutral grotesque body reads as modern and trustworthy.",
  },
  logo: {
    direction: "Clean wordmark in the heading family with a tight, confident set.",
    style: "wordmark",
    motifSuggestions: ["Single accent dot", "Subtle baseline underline"],
  },
  motifs: ["Rounded corners", "Generous whitespace"],
  imagery: "Bright, uncluttered product shots on the light neutral.",
  rationale: "A safe, legible default until brand-specific tokens are generated.",
};

/**
 * Distill the brand's CONCRETE design tokens (hex palette, Google-Font pairing,
 * logo direction) from the venture profile + (optional) brand kit, founder
 * story and product-image notes. A pure synthesis call (no web search). On
 * provider/parse failure, returns the neutral fallback so the Design Studio
 * always has a coherent system to render downstream assets from.
 */
export async function callDesignTokens(
  runId: string | null,
  projectId: string | null,
  profile: ClientProfile,
  brandKit: BrandKit | null,
  founderStory: FounderStorySection | null = null,
  productImageNotes: string[] = [],
  guidance = ""
): Promise<DesignTokens> {
  if (config.mockMode) return DesignTokensSchema.parse(FALLBACK_DESIGN_TOKENS);
  try {
    return await callJson({
      runId,
      projectId,
      feature: "design.tokens",
      system: DESIGN_TOKENS_SYSTEM,
      user: designTokensUser(
        profile,
        brandKit,
        founderStory,
        productImageNotes,
        guidance
      ),
      schema: DesignTokensSchema,
      maxCompletionTokens: 3000,
      requestTimeoutMs: OWNER_FALLBACK_TIMEOUT_MS,
      requestMaxRetries: 0,
    });
  } catch (e) {
    console.error(`[design-tokens] generation failed, using fallback:`, e);
    return DesignTokensSchema.parse(FALLBACK_DESIGN_TOKENS);
  }
}

/**
 * Write the COPY for one collateral piece (business card / flyer / poster). The
 * layout is rendered deterministically from the design tokens, so this returns
 * words only. A pure synthesis call; throws on provider/parse failure (the
 * route surfaces it — there is no sensible generic copy fallback).
 */
export async function callCollateralCopy(
  runId: string | null,
  projectId: string | null,
  type: CollateralType,
  profile: ClientProfile,
  brandKit: BrandKit | null,
  brief: string
): Promise<CollateralContent> {
  if (config.mockMode) {
    return CollateralContentSchema.parse({
      brandName: profile.product || "Your Brand",
      tagline: "(mock) crafted for you",
      headline: "Launch with confidence",
      subhead: "(mock) collateral copy",
      body: ["Benefit one", "Benefit two", "Benefit three"],
      cta: "Get started today",
      contact: {},
    });
  }
  return callJson({
    runId,
    projectId,
    feature: "design.collateral",
    system: COLLATERAL_COPY_SYSTEM,
    user: collateralCopyUser(type, profile, brandKit, brief),
    schema: CollateralContentSchema,
    maxCompletionTokens: 1200,
    requestTimeoutMs: OWNER_FALLBACK_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
}

/**
 * Author 2-3 raw SVG logo MARKS (geometry only, no text) for the venture from
 * its design tokens. The SVGs are sanitized by the caller before use. A pure
 * synthesis call; throws on provider/parse failure (the route surfaces it and
 * falls back to the deterministic wordmark).
 */
export async function callLogoMarks(
  runId: string | null,
  projectId: string | null,
  profile: ClientProfile,
  tokens: DesignTokens,
  brandKit: BrandKit | null,
  brief = ""
): Promise<LogoMarksOutput> {
  if (config.mockMode) {
    return LogoMarksOutputSchema.parse({
      concept: "(mock) a simple geometric mark.",
      style: "emblem",
      marks: [
        {
          label: "Mock circle",
          svg: `<svg width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="96" fill="${tokens.palette.primary}"/></svg>`,
        },
      ],
    });
  }
  return callJson({
    runId,
    projectId,
    feature: "design.logo",
    system: LOGO_MARKS_SYSTEM,
    user: logoMarksUser(profile, tokens, brandKit, brief),
    schema: LogoMarksOutputSchema,
    maxCompletionTokens: 4000,
    requestTimeoutMs: OWNER_QA_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
}

/**
 * Generate a complete, self-contained one-page landing site (HTML + inline CSS,
 * no scripts) styled from the design tokens. The HTML is sanitized by the
 * caller before preview/deploy. Larger token budget since it returns a full
 * document; throws on provider/parse failure (the route surfaces it).
 */
export async function callSiteGenerator(
  runId: string | null,
  projectId: string | null,
  profile: ClientProfile,
  tokens: DesignTokens,
  brandKit: BrandKit | null,
  brief: string
): Promise<SiteGenOutput> {
  if (config.mockMode) {
    return SiteGenOutputSchema.parse({
      title: `${profile.product || "Brand"} — mock site`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${
        profile.product || "Brand"
      }</title></head><body style="font-family:system-ui;padding:48px;background:${
        tokens.palette.neutralLight
      };color:${tokens.palette.neutralDark}"><h1 style="color:${
        tokens.palette.primary
      }">${profile.product || "Brand"}</h1><p>(mock) landing site.</p></body></html>`,
    });
  }
  return callJson({
    runId,
    projectId,
    feature: "design.site",
    system: SITE_GEN_SYSTEM,
    user: siteGenUser(profile, tokens, brandKit, brief),
    schema: SiteGenOutputSchema,
    maxCompletionTokens: 12000,
    requestTimeoutMs: OWNER_QA_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
}

/**
 * Answer a founder's follow-up question about a specific simulation object (a
 * launch scenario or a financial model). Grounded strictly in the JSON given.
 */
export async function callDataQuestion(
  runId: string,
  subject: string,
  contextJson: string,
  question: string,
  history: { question: string; answer: string }[]
): Promise<string> {
  if (config.mockMode) return `(mock) Answer about ${subject}: ${question}`;
  const out = await callJson({
    runId,
    feature: "simulation.chat",
    system: DATA_QA_SYSTEM,
    user: dataQaUser(subject, contextJson, question, history),
    schema: z.object({ answer: z.string() }),
    maxCompletionTokens: 700,
    requestTimeoutMs: OWNER_QA_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
  return out.answer;
}

/**
 * Knowledge-driven re-run: given the founder's new fact about the product plus
 * the current launch context, propose justified numeric deltas to the launch
 * assumptions (never applied here — the founder approves them first). Returns an
 * empty change list when the knowledge doesn't justify any change.
 */
export async function callAssumptionUpdate(
  runId: string,
  contextJson: string,
  knowledge: string
): Promise<AssumptionUpdate> {
  if (config.mockMode) {
    return AssumptionUpdateSchema.parse({
      summary: `(mock) considered: ${knowledge.slice(0, 60)}`,
      changes: [],
      caveats: ["mock mode — no changes proposed"],
    });
  }
  return callJson({
    runId,
    feature: "simulation.chat",
    system: ASSUMPTION_UPDATE_SYSTEM,
    user: assumptionUpdateUser(contextJson, knowledge),
    schema: AssumptionUpdateSchema,
    maxCompletionTokens: 1400,
    requestTimeoutMs: OWNER_QA_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
}

/**
 * Source current, cited market benchmarks for one country × category to refine
 * the curated priors. Web-grounded; on web/parse failure, throws (the caller
 * keeps the curated priors). No runId — runs at project setup.
 */
export async function callMarketData(
  projectId: string | null,
  country: string,
  category: string
): Promise<MarketDataOutput> {
  if (config.mockMode) {
    return MarketDataOutputSchema.parse({
      currency: "USD",
      aov: { low: 60, mid: 90, high: 150 },
      returnRatePct: { low: 18, mid: 25, high: 35 },
      notes: `(mock) ${country} ${category} benchmarks`,
      sources: ["mock://market-data"],
    });
  }
  const response = await client().responses.create(
    {
      model: config.model,
      tools: [{ type: "web_search" } as never],
      input: [
        { role: "system", content: MARKET_DATA_SYSTEM },
        { role: "user", content: marketDataUser(country, category) },
      ],
      max_output_tokens: 4000,
      reasoning: { effort: "low" },
    },
    { timeout: MARKET_DATA_TIMEOUT_MS, maxRetries: 0 }
  );
  const searchCalls = Array.isArray(response.output)
    ? response.output.filter((o: { type?: string }) =>
        String(o.type ?? "").startsWith("web_search")
      ).length
    : 0;
  if (projectId && response.usage) {
    await recordProjectOnlyUsage(
      projectId,
      response.usage.input_tokens ?? 0,
      response.usage.output_tokens ?? 0,
      "frontier",
      searchCalls,
      "market.data"
    );
  }
  const parsed = MarketDataOutputSchema.safeParse(
    JSON.parse(stripFences(response.output_text ?? ""))
  );
  if (!parsed.success) {
    throw new Error(
      `market data failed validation: ${JSON.stringify(parsed.error.issues)}`
    );
  }
  return parsed.data;
}

/**
 * Deepen a run's world model into a founder-ready playbook — web-grounded so it
 * can add current, cited tax rates and named competitors the simulation was thin
 * on. Independent of the run engine, so it can be regenerated on demand. If the
 * web-grounded path is slow or invalid, it returns a source-light fallback built
 * from the run's completed findings instead of timing out the HTTP request.
 */
function fallbackPlaybook(
  profile: ClientProfile,
  conclusionsByDomain: Record<string, { claim: string; value: string }[]>,
  reason: string
): GeneratedPlaybook {
  const product = profileProduct(profile);
  const domains = Object.entries(conclusionsByDomain)
    .filter(([, items]) => items.length > 0)
    .slice(0, 8);
  const modules =
    domains.length > 0
      ? domains.map(([domain, items]) => ({
          module: domain.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          domain,
          summary: `Fast fallback from completed simulation findings because ${reason}. Use this module as a decision checklist for ${product}.`,
          entries: items.slice(0, 4).map((item) => ({
            point: item.claim,
            detail: item.value,
            source: "",
          })),
        }))
      : [
          {
            module: "Launch Priorities",
            domain: "synthesis",
            summary: `Fast fallback generated because ${reason}.`,
            entries: [
              {
                point: `Validate demand for ${product}`,
                detail:
                  "Use the strongest audience segment, top objection, and price sensitivity from the run before scaling spend.",
                source: "",
              },
              {
                point: "Check duties, taxes, and compliance manually",
                detail:
                  "The web-grounded pass did not complete, so confirm current rates with an official source before execution.",
                source: "",
              },
            ],
          },
        ];
  return GeneratedPlaybookSchema.parse({
    modules,
    sources: [],
    generatedAt: "",
    model: "local-fallback",
  });
}

export async function callGeneratePlaybook(
  runId: string,
  profile: ClientProfile,
  conclusionsByDomain: Record<string, { claim: string; value: string }[]>,
  founderStory: FounderStorySection | null = null
): Promise<GeneratedPlaybook> {
  if (config.mockMode) {
    return GeneratedPlaybookSchema.parse({
      modules: [
        {
          module: "Taxes & duties",
          domain: "regulation",
          summary: "(mock) tax + duty overview",
          entries: [{ point: "GST 18% on this category", detail: "(mock)", source: "" }],
        },
      ],
      sources: [],
      generatedAt: "",
      model: "mock",
    });
  }
  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: PLAYBOOK_SYSTEM },
          {
            role: "user",
            content:
              playbookUser(profile, conclusionsByDomain, founderStory) +
              "\n\nSearch only for the highest-impact current tax/duty rates and named competitors for this product and market. Keep the playbook concise and output JSON only.",
          },
        ],
        max_output_tokens: 6000,
        reasoning: { effort: "low" },
      },
      { timeout: OWNER_WEB_TIMEOUT_MS, maxRetries: 0 }
    );
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "playbook" }
      );
    }
    const parsed = GeneratedPlaybookSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (parsed.success) return parsed.data;
    console.error(
      `[playbook] validation failed: ${JSON.stringify(parsed.error.issues).slice(0, 200)}`
    );
    return fallbackPlaybook(profile, conclusionsByDomain, "web output failed validation");
  } catch (e) {
    console.error(`[playbook] web-grounded path failed:`, e);
    return fallbackPlaybook(
      profile,
      conclusionsByDomain,
      ownerProviderFallbackReason(e)
    );
  }
}

/**
 * Bootstrap a venture from the founder's website + online consumer opinion.
 * Web-grounded (reads the site and searches real reviews/sentiment); on web or
 * parse failure it falls back to an ungrounded JSON pass from the URL alone.
 * No runId — this runs at project creation, before any run exists.
 */
export async function callWebsiteAnalysis(
  url: string,
  projectId: string | null = null
): Promise<WebsiteAnalysisOutput> {
  if (config.mockMode) {
    return WebsiteAnalysisOutputSchema.parse({
      draftProfile: {
        product: `(mock) product from ${url}`,
        category: "apparel & fashion",
        priceBand: "premium",
        styleKeywords: ["minimal", "contemporary"],
        heroProducts: [],
      },
      knownFields: ["product", "category", "priceBand"],
      consumerOpinion:
        "(mock) Customers like the fit and fabric; some flag pricing and delivery times.",
      sentiment: "mixed",
      summary: `(mock) Inferred a premium contemporary apparel brand from ${url}.`,
      sources: [url],
    });
  }
  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: WEBSITE_ANALYSIS_SYSTEM },
          { role: "user", content: websiteAnalysisUser(url) },
        ],
        max_output_tokens: 6000,
        reasoning: { effort: "low" },
      },
      { timeout: OWNER_WEB_TIMEOUT_MS, maxRetries: 0 }
    );
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (projectId && response.usage) {
      await recordProjectOnlyUsage(
        projectId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        "website.analysis"
      );
    }
    const parsed = WebsiteAnalysisOutputSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (parsed.success) return parsed.data;
    throw new Error(
      `website analysis (web) failed validation: ${JSON.stringify(
        parsed.error.issues
      )}`
    );
  } catch (e) {
    console.error(`[website-analysis] web path failed, falling back:`, e);
    return callJson({
      runId: null,
      projectId,
      feature: "website.analysis",
      system: WEBSITE_ANALYSIS_SYSTEM,
      user: websiteAnalysisUser(url),
      schema: WebsiteAnalysisOutputSchema,
      maxCompletionTokens: 6000,
      requestTimeoutMs: OWNER_FALLBACK_TIMEOUT_MS,
      requestMaxRetries: 0,
    });
  }
}

const ProductImageAnalysisSchema = z.object({
  visualSummary: z.string().min(1).max(900),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
});
export type ProductImageAnalysis = z.infer<typeof ProductImageAnalysisSchema>;

export async function callProductImageAnalysis(args: {
  fileName: string;
  dataUrl: string;
  product?: string;
}): Promise<ProductImageAnalysis> {
  if (config.mockMode) {
    return {
      visualSummary: `(mock) Product reference image ${args.fileName} for ${args.product ?? "the venture"}.`,
      tags: ["product reference"],
    };
  }

  const response = await client().responses.create(
    {
      model: config.model,
      input: [
        {
          role: "system",
          content:
            "You inspect founder-uploaded product reference images for business simulation. Describe only visible product traits: category, silhouette or shape, materials, color, finish, styling cues, construction details, use case, and likely positioning. Avoid guessing brand claims, price, location, identity, or demographics. Output JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Product context: ${args.product ?? "unknown"}\nImage file: ${args.fileName}\nReturn {"visualSummary":"...","tags":["..."]}.`,
            },
            {
              type: "input_image",
              image_url: args.dataUrl,
              detail: "low",
            },
          ],
        } as never,
      ],
      max_output_tokens: 1200,
      reasoning: { effort: "low" },
    },
    { timeout: PRODUCT_IMAGE_TIMEOUT_MS, maxRetries: 0 }
  );

  return ProductImageAnalysisSchema.parse(
    JSON.parse(stripFences(response.output_text ?? ""))
  );
}

/**
 * Owner Dashboard › Inspiration ("swipe file"): real video examples, product-
 * placement patterns, and social success stories. Web-grounded so every url is
 * one the model actually found; on web/parse failure it falls back to a JSON
 * call. The links are then VERIFIED (verifyInspiration) before they reach the
 * founder — generation and verification are deliberately separate so the route
 * can drop dead links without re-prompting.
 */
function fallbackInspiration(
  profile: ClientProfile,
  conclusions: Conclusion[],
  reason: string
): InspirationKit {
  const product = profileProduct(profile);
  const audience = profileAudience(profile);
  const category = profile.category || product;
  const search = (q: string) =>
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const topObjection =
    conclusions.find((c) => /objection|risk|barrier|concern/i.test(c.claim))
      ?.value ?? "price, trust, quality, and delivery objections";
  return InspirationKitSchema.parse({
    videoExamples: [
      {
        id: "product-demo-search",
        title: `${product} product demo examples`,
        channel: "YouTube search",
        youtubeId: "",
        searchQuery: `${product} product demo ${category}`,
        url: search(`${product} product demo ${category}`),
        verified: false,
        whyRelevant: `Fast fallback generated because ${reason}; use the search results to pick real demos in this category.`,
        takeaway:
          "Copy the structure: problem hook, close-up proof, use context, and a clear purchase reason.",
      },
      {
        id: "objection-content-search",
        title: `${category} objection-handling examples`,
        channel: "YouTube search",
        youtubeId: "",
        searchQuery: `${category} customer objections product review`,
        url: search(`${category} customer objections product review`),
        verified: false,
        whyRelevant: `Your simulated audience needs reassurance around ${topObjection}.`,
        takeaway:
          "Turn each objection into one short video with the answer shown visually, not just stated.",
      },
    ],
    placementExamples: [
      {
        id: "in-context-lifestyle-shot",
        pattern: "In-context lifestyle shot",
        account: "Category benchmark search",
        accountUrl: null,
        platform: "Instagram / TikTok",
        recipe: `Show ${product} being used by ${audience}, with the product visible in the first second.`,
        whyItWorks:
          "It lets the buyer imagine ownership while still preserving product clarity.",
      },
      {
        id: "detail-proof-carousel",
        pattern: "Detail proof carousel",
        account: "Product proof benchmark",
        accountUrl: null,
        platform: "Instagram",
        recipe:
          "Frame material, fit/finish, packaging, and outcome as four swipeable proof points.",
        whyItWorks:
          "It answers quality concerns without forcing the audience to read a long caption.",
      },
      {
        id: "founder-process-clip",
        pattern: "Founder/process clip",
        account: "Founder-led benchmark",
        accountUrl: null,
        platform: "Reels / Shorts",
        recipe:
          "Film a 15-30 second process moment with one line explaining why it matters for the customer.",
        whyItWorks:
          "Founder/process proof builds trust when the brand is still early.",
      },
    ],
    successStories: [],
  });
}

export async function callInspiration(
  runId: string,
  profile: ClientProfile,
  conclusions: Conclusion[]
): Promise<InspirationKit> {
  if (config.mockMode) return InspirationKitSchema.parse(mockInspiration);

  const system = `${INSPIRATION_SYSTEM}\n\n--- INPUT ---\n${inspirationUser(
    profile,
    conclusions
  )}`;

  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              "Search the web to find real, current examples, then output JSON only.",
          },
        ],
        max_output_tokens: 8000,
        reasoning: { effort: "low" },
      },
      { timeout: OWNER_WEB_TIMEOUT_MS, maxRetries: 0 }
    );
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "inspiration" }
      );
    }
    const parsed = InspirationKitSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (parsed.success) return parsed.data;
    throw new Error(
      `inspiration (web) failed validation: ${JSON.stringify(parsed.error.issues)}`
    );
  } catch (e) {
    console.error(`[inspiration] web-grounded path failed, falling back:`, e);
    if (shouldUseOwnerLocalFallback(e)) {
      return fallbackInspiration(
        profile,
        conclusions,
        ownerProviderFallbackReason(e)
      );
    }
    try {
      return await callJson({
        runId,
        feature: "inspiration",
        system: INSPIRATION_SYSTEM,
        user: inspirationUser(profile, conclusions),
        schema: InspirationKitSchema,
        maxCompletionTokens: 8000,
        requestTimeoutMs: OWNER_FALLBACK_TIMEOUT_MS,
        requestMaxRetries: 0,
      });
    } catch (fallbackError) {
      console.error(`[inspiration] JSON fallback failed:`, fallbackError);
      return fallbackInspiration(
        profile,
        conclusions,
        ownerProviderFallbackReason(fallbackError)
      );
    }
  }
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

async function fetchOk(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    // A browser-ish UA — many publishers 403 unknown agents (would wrongly drop
    // a real source). GET (not HEAD) since some hosts reject HEAD.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    clearTimeout(t);
    return res.status < 400;
  } catch {
    return false;
  }
}

// A YouTube video EXISTS iff its thumbnail resolves. This beats oEmbed, which
// returns 401 for real videos that merely disable embedding (label/brand
// videos often do) — those are still perfectly watchable via a link, so oEmbed
// would wrongly drop them. The thumbnail is served regardless of embed policy
// and 404s only for genuinely non-existent ids.
async function youtubeExists(id: string): Promise<boolean> {
  try {
    const res = await fetch(`https://img.youtube.com/vi/${id}/hqdefault.jpg`, {
      signal: AbortSignal.timeout(6000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// Enrich a verified video with oEmbed's real title/channel when available, so
// those fields are never the model's guess. Returns null on network error
// (caller already confirmed existence, so we just keep the model's text).
async function youtubeMeta(
  id: string
): Promise<{ title?: string; channel?: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${id}`
      )}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null; // 401 (embedding disabled) etc. — keep model text
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title, channel: data.author_name };
  } catch {
    return null;
  }
}

/**
 * Trust gate for the Inspiration swipe file (verified-only). Drops anything we
 * can't confirm is live:
 *  - videos: real 11-char YouTube id whose thumbnail resolves (existence),
 *    title/channel enriched from oEmbed when reachable;
 *  - success stories: a sourceUrl that fetches < 400;
 *  - placement accountUrl: kept if present (IG/TikTok can't be reliably checked
 *    without auth).
 * Runs all checks concurrently. Mock mode skips this (fixtures are pre-clean).
 */
export async function verifyInspiration(
  kit: InspirationKit
): Promise<InspirationKit> {
  if (config.mockMode) return kit;

  const searchUrl = (v: InspirationKit["videoExamples"][number]) =>
    `https://www.youtube.com/results?search_query=${encodeURIComponent(
      v.searchQuery || `${v.title} ${v.channel}`.trim()
    )}`;

  const videos = await Promise.all(
    kit.videoExamples.map(async (v) => {
      // Drop only an item with nothing to act on (no id AND no searchable text).
      if (!v.youtubeId && !v.searchQuery && !v.title) return null;
      // Verified specific video — the thumbnail (not oEmbed) proves existence.
      if (YT_ID_RE.test(v.youtubeId) && (await youtubeExists(v.youtubeId))) {
        const meta = await youtubeMeta(v.youtubeId);
        return {
          ...v,
          verified: true,
          url: `https://www.youtube.com/watch?v=${v.youtubeId}`,
          title: meta?.title || v.title,
          channel: meta?.channel || v.channel,
        };
      }
      // Fallback: a working YouTube search link (verified-only chose this over
      // showing a fabricated specific id).
      return { ...v, verified: false, youtubeId: "", url: searchUrl(v) };
    })
  );

  const stories = await Promise.all(
    kit.successStories.map(async (s) =>
      s.sourceUrl && (await fetchOk(s.sourceUrl)) ? s : null
    )
  );

  return {
    videoExamples: videos.filter(
      (v): v is InspirationKit["videoExamples"][number] => v !== null
    ),
    placementExamples: kit.placementExamples,
    successStories: stories.filter(
      (s): s is InspirationKit["successStories"][number] => s !== null
    ),
  };
}

// Mock assumptions for MOCK_MODE — shaped like a furniture venture so the
// deterministic engine has something realistic to compute against.
const mockFinancialInputs: FinancialInputs = FinancialInputsSchema.parse({
  currency: "INR",
  costStructure: [
    { label: "Materials", amount: 24000, note: "solid teak timber" },
    { label: "Labour", amount: 11000, note: "workshop build" },
    { label: "Hardware & finish", amount: 7000, note: "" },
  ],
  priceTiers: [
    { label: "Entry", segment: "budget", price: 80000, landedCogs: null },
    { label: "Core", segment: "middle", price: 120000, landedCogs: null },
    { label: "Premium", segment: "affluent", price: 180000, landedCogs: null },
  ],
  fixedCostsPerMonth: 300000,
  moqCashRequired: 4000000,
  reachableProspectsPerMonth: 1800,
  cacByChannel: [
    { channel: "instagram", cac: 4000 },
    { channel: "google", cac: 6000 },
  ],
  ltv: null,
  tam: 5_000_000_000,
  sam: 800_000_000,
  som: 60_000_000,
  baseTierLabel: "Core",
  assumptions: [
    "Single-purchase LTV proxy until repeat-rate data exists",
    "Reach is early-stage budget-constrained, not whole-market",
  ],
});

/**
 * Owner Dashboard › Financials. Emits the ASSUMPTIONS for the financial model
 * (typed numbers only — computeFinancials() does the arithmetic). Web-grounded
 * so TAM/SAM and competitor price points are real; falls back to a plain JSON
 * call on any web/parse failure, exactly like callBrandKit.
 */
export async function callFinancialInputs(
  runId: string,
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null,
  currency: string
): Promise<FinancialInputs> {
  if (config.mockMode)
    return FinancialInputsSchema.parse({ ...mockFinancialInputs, currency });

  // Anchor CAC/COGS/AOV/CVR/RTO to real public-report ranges for this venture's
  // category × geography, instead of letting the model invent them.
  const { block: benchmarkBlock } = benchmarksForProfile(profile);
  const baseUser = financialsUser(profile, conclusions, aggregate, currency);
  const user = `${baseUser}\n\n${benchmarkBlock}`;

  const system = `${FINANCIALS_SYSTEM}\n\n--- INPUT ---\n${user}`;

  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              "Search the web to sanity-check market size and prices, then output JSON only.",
          },
        ],
        max_output_tokens: FINANCIALS_COMPLETION_BUDGET,
        reasoning: { effort: "low" },
      },
      { timeout: FINANCIALS_WEB_TIMEOUT_MS, maxRetries: 0 }
    );
    const searchCalls = Array.isArray(response.output)
      ? response.output.filter((o: { type?: string }) =>
          String(o.type ?? "").startsWith("web_search")
        ).length
      : 0;
    if (response.usage) {
      await recordUsage(
        runId,
        response.usage.input_tokens ?? 0,
        response.usage.output_tokens ?? 0,
        "frontier",
        searchCalls,
        { feature: "financials" }
      );
    }
    const parsed = FinancialInputsSchema.safeParse(
      JSON.parse(stripFences(response.output_text ?? ""))
    );
    if (parsed.success) return parsed.data;
    throw new Error(
      `financials (web) failed validation: ${JSON.stringify(parsed.error.issues)}`
    );
  } catch (e) {
    console.error(`[financials] web-grounded path failed, falling back:`, e);
    return callJson({
      runId,
      feature: "financials",
      system: FINANCIALS_SYSTEM,
      user,
      schema: FinancialInputsSchema,
      maxCompletionTokens: FINANCIALS_COMPLETION_BUDGET,
      maxAttempts: 1,
      requestTimeoutMs: FINANCIALS_FALLBACK_TIMEOUT_MS,
      requestMaxRetries: 0,
    });
  }
}

import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config";
import { recordUsage, type ModelTier } from "./usage";
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
  type WebsiteAnalysisOutput,
  type IntakePrefill,
  CohortSimOutputSchema,
  BrandKitSchema,
  InspirationKitSchema,
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
  intakePrefillBlock,
  QUERY_SYSTEM,
  queryV2User,
  FINAL_REPORT_SYSTEM,
  finalReportUser,
  audienceChatSystem,
  audienceChatUser,
  personaReplySystem,
  personaReplyUser,
  personaConclusionSystem,
  personaConclusionUser,
  type PersonaCtx,
  BRAND_KIT_SYSTEM,
  brandKitUser,
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
const FINANCIALS_WEB_TIMEOUT_MS = 12_000;
const FINANCIALS_FALLBACK_TIMEOUT_MS = 30_000;

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
    if (opts.runId && response.usage) {
      await recordUsage(
        opts.runId,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        opts.tier ?? "frontier"
      );
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
      searchCalls
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
    await recordUsage(runId, usage.prompt_tokens, usage.completion_tokens);
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
        searchCalls
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
        searchCalls
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
    system: QUERY_SYSTEM,
    user: queryV2User(profile, conclusions, aggregate, question),
    schema: QueryOutputSchema,
  });
}

export async function callFinalReport(
  runId: string,
  profile: ClientProfile,
  blocks: Pick<Block, "id" | "name" | "domain" | "kind" | "conclusions">[],
  aggregate: AudienceAggregate | null,
  financials: FinancialModel | null = null
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
    user: finalReportUser(profile, blocks, aggregate, financials),
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
export async function callBrandKit(
  runId: string,
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null
): Promise<BrandKit> {
  if (config.mockMode) return BrandKitSchema.parse(mockBrandKit);

  const system = `${BRAND_KIT_SYSTEM}\n\n--- INPUT ---\n${brandKitUser(
    profile,
    conclusions,
    aggregate
  )}`;

  // Preferred path: Responses API with web_search so accounts are verifiable.
  try {
    const response = await client().responses.create({
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
      max_output_tokens: 16000,
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
        searchCalls
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
    // Ungrounded fallback — accounts come from model knowledge (grounded:false).
    return callJson({
      runId,
      system: BRAND_KIT_SYSTEM,
      user: brandKitUser(profile, conclusions, aggregate),
      schema: BrandKitSchema,
      maxCompletionTokens: 16000,
    });
  }
}

/**
 * Bootstrap a venture from the founder's website + online consumer opinion.
 * Web-grounded (reads the site and searches real reviews/sentiment); on web or
 * parse failure it falls back to an ungrounded JSON pass from the URL alone.
 * No runId — this runs at project creation, before any run exists.
 */
export async function callWebsiteAnalysis(
  url: string
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
    const response = await client().responses.create({
      model: config.model,
      tools: [{ type: "web_search" } as never],
      input: [
        { role: "system", content: WEBSITE_ANALYSIS_SYSTEM },
        { role: "user", content: websiteAnalysisUser(url) },
      ],
      max_output_tokens: 6000,
      reasoning: { effort: "low" },
    });
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
      system: WEBSITE_ANALYSIS_SYSTEM,
      user: websiteAnalysisUser(url),
      schema: WebsiteAnalysisOutputSchema,
      maxCompletionTokens: 6000,
    });
  }
}

/**
 * Owner Dashboard › Inspiration ("swipe file"): real video examples, product-
 * placement patterns, and social success stories. Web-grounded so every url is
 * one the model actually found; on web/parse failure it falls back to a JSON
 * call. The links are then VERIFIED (verifyInspiration) before they reach the
 * founder — generation and verification are deliberately separate so the route
 * can drop dead links without re-prompting.
 */
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
    const response = await client().responses.create({
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
      max_output_tokens: 16000,
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
        searchCalls
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
    return callJson({
      runId,
      system: INSPIRATION_SYSTEM,
      user: inspirationUser(profile, conclusions),
      schema: InspirationKitSchema,
      maxCompletionTokens: 16000,
    });
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
        max_output_tokens: 16000,
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
        searchCalls
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
      system: FINANCIALS_SYSTEM,
      user,
      schema: FinancialInputsSchema,
      maxCompletionTokens: 16000,
      maxAttempts: 1,
      requestTimeoutMs: FINANCIALS_FALLBACK_TIMEOUT_MS,
      requestMaxRetries: 0,
    });
  }
}

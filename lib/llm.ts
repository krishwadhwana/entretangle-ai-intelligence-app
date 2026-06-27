import OpenAI, { toFile } from "openai";
import { File as NodeFile } from "node:buffer";
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
  type WebsiteAnalysis,
  type WebsiteCollectedInfo,
  type FinancialInputs,
  type FinancialModel,
  type FinalReport,
  type ChatMessage,
  type ClientProfile,
  type ProductImageRef,
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

function ensureFileGlobal(): void {
  if (typeof globalThis.File === "undefined") {
    Object.defineProperty(globalThis, "File", {
      value: NodeFile,
      configurable: true,
      writable: true,
    });
  }
}

ensureFileGlobal();
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
  collectWebsiteEvidence,
  mergeWebsiteCollectedInfo,
} from "./websiteIntel";
import {
  DEMOGRAPHICS_SYSTEM,
  DemographicsOutputSchema,
  demographicsUser,
  mockDemographics,
  type DemographicsOutput,
} from "./datasources/demographics";
import { benchmarksForProfile } from "./datasources/benchmarks";
import { isProviderQuotaError, isProviderTimeoutError } from "./providerErrors";
import {
  CostCapError,
  estimateCostUsd,
  estimateTokens,
  projectedSpend,
  releaseReservation,
  reserveBudget,
} from "./costGuard";

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
const WEBSITE_ANALYSIS_WEB_TIMEOUT_MS = 75_000;
const WEBSITE_ANALYSIS_FALLBACK_TIMEOUT_MS = 35_000;
const DESIGN_SITE_TIMEOUT_MS = 240_000;
const MARKET_DATA_TIMEOUT_MS = 90_000;
const FINANCIALS_WEB_TIMEOUT_MS = 25_000;
const FINANCIALS_FALLBACK_TIMEOUT_MS = 65_000;
const FINANCIALS_COMPLETION_BUDGET = 6000;
const PRODUCT_IMAGE_TIMEOUT_MS = 25_000;
const DESIGN_IMAGE_TIMEOUT_MS = 120_000;
const MIDJOURNEY_TIMEOUT_MS = 10 * 60_000;
const GEMINI_IMAGE_TIMEOUT_MS = 120_000;

export type ProductImageInput = {
  ref: ProductImageRef;
  dataUrl?: string;
  buffer?: Buffer;
};

function dataUrlParts(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function parseJsonArrayEnv(name: string): unknown[] {
  let raw = process.env[name]?.trim();
  if (!raw) return [];
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    raw = raw.slice(1, -1);
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function numberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function collateralImageSize(type: CollateralType): "1024x1024" | "1024x1536" {
  return type === "flyer" ? "1024x1536" : "1024x1024";
}

type AdVisualPromptAudit = {
  scenePrompt: string;
  midjourneyPrompt?: string;
  geminiPrompt?: string;
  openaiPrompt?: string;
  productReference?: {
    id: string;
    name: string;
    sourceKind?: string;
    url?: string;
    sourcePageUrl?: string;
    visualSummary?: string;
    tags?: string[];
    usage?: string;
  };
  socialInspiration?: {
    id: string;
    name: string;
    visualSummary?: string;
    tags?: string[];
  }[];
};

type AdVisualResult = {
  dataUrl: string;
  prompt: string;
  generationPrompt: AdVisualPromptAudit;
};

type AdVisualInstructionMode = {
  forbidHumans: boolean;
  productOnly: boolean;
};

function compactPromptLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

function lineAfterVariantPrefix(value: string): string {
  return value.replace(/^Variant role:\s*[^.]+\.?\s*/i, "").trim();
}

function lineAfterLabeledPrefix(value: string): string {
  return value.replace(/^[A-Za-z ]+:\s*/i, "").trim();
}

function adVisualInstructionMode(visualBrief: string): AdVisualInstructionMode {
  const text = visualBrief.toLowerCase();
  const forbidHumans =
    /\bno[-\s]*(?:humans?|people|persons?|models?|faces?|hands?|body\s*parts?|bodies)\b/.test(
      text
    ) ||
    /\bwithout\s+(?:any\s+)?(?:humans?|people|persons?|models?|faces?|hands?|body\s*parts?|bodies)\b/.test(
      text
    ) ||
    /\b(?:only|just)\s+(?:nature|natural\s+scenery|the\s+environment)\s+and\s+(?:the\s+)?products?\b/.test(
      text
    ) ||
    /\bproducts?[-\s]*only\b/.test(text);
  const productOnly =
    forbidHumans ||
    /\b(?:only|just)\s+(?:the\s+)?products?\b/.test(text) ||
    /\bstill[-\s]*life\b/.test(text);
  return { forbidHumans, productOnly };
}

function noHumanScenePrompt(sceneHint: string, productName: string): string {
  const cleanHint = compactPromptLine(
    sceneHint
      .replace(/\bNO[-\s]*HUMANS?\b/gi, "")
      .replace(
        /\bno[-\s]*(?:humans?|people|persons?|models?|faces?|hands?|body\s*parts?|bodies)\b/gi,
        ""
      )
      .replace(
        /\bwithout\s+(?:any\s+)?(?:humans?|people|persons?|models?|faces?|hands?|body\s*parts?|bodies)\b/gi,
        ""
      )
      .replace(
        /\b(?:only|just)\s+(?:nature|natural\s+scenery|the\s+environment)\s+and\s+(?:the\s+)?products?\b/gi,
        "natural surroundings with the product as the only subject"
      )
      .replace(/\bproducts?[-\s]*only\b/gi, "product-only")
  );
  const base =
    cleanHint ||
    `an artistic product-only still life for ${productName} in natural surroundings`;
  return compactPromptLine(
    `Photorealistic product-only still life for ${productName}: ${base}. No humans, people, models, faces, hands, arms, legs, bodies, skin, portraits, or body parts. The product is the only subject with natural non-human surroundings.`
  );
}

function scenePromptFromVisualBrief(
  visualBrief: string,
  productName: string,
  instructionMode = adVisualInstructionMode(visualBrief)
): string {
  const lines = visualBrief
    .split(/\n+/)
    .map((line) => compactPromptLine(line))
    .filter(Boolean);
  const direct = lines.find(
    (line) =>
      !/^Variant role:/i.test(line) &&
      !/^Composition hint:/i.test(line) &&
      !/^Product reference target:/i.test(line) &&
      !/^Style note:/i.test(line) &&
      !/^Required composition lane:/i.test(line) &&
      !/templates?\s+(are\s+)?(on|off)/i.test(line) &&
      !/do not render/i.test(line)
  );
  const variant = lines.find((line) => /^Variant role:/i.test(line));
  const style = lines.find((line) => /^Style note:/i.test(line));
  const styleNote = style ? lineAfterLabeledPrefix(style) : "";
  if (instructionMode.forbidHumans) {
    const userScene =
      styleNote ||
      direct ||
      lines.find(
        (line) =>
          !/^Variant role:/i.test(line) &&
          !/^Composition hint:/i.test(line) &&
          !/^Product reference target:/i.test(line)
      ) ||
      "";
    return noHumanScenePrompt(userScene, productName).slice(0, 520);
  }
  const styleIsUseful =
    styleNote &&
    !/polished product-led|model-product|highly artistic|product-led campaign|no readable text|no generated image text|captions?|typography|template|layout|logo/i.test(
      styleNote
    );
  const base = variant ? lineAfterVariantPrefix(variant) : direct;
  const withStyle =
    variant && styleIsUseful ? `${base}, ${styleNote}` : base;
  const fallback = productName
    ? `A model holding a bottle of ${productName} to her face, close-up`
    : "A model holding a product bottle to her face, close-up";
  return compactPromptLine(withStyle || fallback).slice(0, 240);
}

function promptTokens(value: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "body",
    "hair",
    "care",
    "premium",
    "product",
    "bottle",
    "close",
    "up",
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !stop.has(token))
  );
}

function isLogoReference(image: ProductImageInput): boolean {
  const haystack = [
    image.ref.name,
    image.ref.visualSummary,
    ...(image.ref.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\blogo\b|wordmark|brand mark/.test(haystack);
}

function isWeakProductSwapReference(image: ProductImageInput): boolean {
  const haystack = [
    image.ref.name,
    image.ref.url,
    image.ref.sourceUrl,
    image.ref.sourcePageUrl,
    image.ref.visualSummary,
    ...(image.ref.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /ingredient|texture|carton|packaging|combo|bundle|with packaging|hero ingredient|fresh figs|coconut, the hero|fruit|shell|overview/.test(
    haystack
  );
}

function isSocialInspirationReference(image: ProductImageInput): boolean {
  return (
    image.ref.usage === "social-inspiration" ||
    (image.ref.tags ?? []).some((tag) => /social[-\s]?inspiration/i.test(tag))
  );
}

function productTargetHint(visualBrief: string): string {
  const match = visualBrief.match(/^Product reference target:\s*(.+)$/im);
  return compactPromptLine(match?.[1] ?? "");
}

function selectProductReference(args: {
  productImages?: ProductImageInput[];
  visualBrief: string;
  copy: CollateralContent;
  profile: ClientProfile;
}): ProductImageInput | null {
  const allCandidates = (args.productImages ?? []).filter(
    (image) =>
      (image.dataUrl || image.buffer) &&
      !isLogoReference(image) &&
      !isSocialInspirationReference(image)
  );
  const cleanCandidates = allCandidates.filter(
    (image) => !isWeakProductSwapReference(image)
  );
  const candidates = cleanCandidates.length ? cleanCandidates : allCandidates;
  if (!candidates.length) return null;
  const targetHint = productTargetHint(args.visualBrief).toLowerCase();
  const query = [
    args.visualBrief,
    args.copy.headline,
    args.copy.subhead,
    args.copy.body.join(" "),
  ].join(" ");
  const tokens = promptTokens(query);
  const scored = candidates.map((image, index) => {
    const haystack = [
      image.ref.name,
      image.ref.visualSummary,
      ...(image.ref.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = image.ref.sourceKind === "uploaded" ? 100 : 0;
    if (image.ref.usage === "product-reference") score += 80;
    if (/\/assets\/(?:shampoo|conditioner|bodywash)-\d+ml\.png/i.test(image.ref.url || "")) {
      score += 80;
    }
    if (/\bpng\b|\.png/i.test(image.ref.url || image.ref.mimeType || "")) {
      score += 10;
    }
    if (targetHint) {
      if (/conditioner/.test(targetHint) && /conditioner|fig/.test(haystack)) {
        score += 120;
      }
      if (/shampoo/.test(targetHint) && /shampoo|scalp/.test(haystack)) {
        score += 120;
      }
      if (/body\s*wash|bodywash/.test(targetHint) && /body\s*wash|bodywash|kokum/.test(haystack)) {
        score += 120;
      }
      if (/two|bundle|hair and body/.test(targetHint) && /combo|body\s*wash|bodywash|conditioner|shampoo/.test(haystack)) {
        score += 60;
      }
    }
    for (const token of tokens) {
      if (haystack.includes(token)) score += 8;
    }
    if (/conditioner/.test(query.toLowerCase()) && /conditioner|fig/.test(haystack)) {
      score += 40;
    }
    if (/shampoo|scalp|coconut/.test(query.toLowerCase()) && /shampoo|scalp|coconut/.test(haystack)) {
      score += 40;
    }
    if (/body\s*wash|bodywash|kokum/.test(query.toLowerCase()) && /body\s*wash|bodywash|kokum/.test(haystack)) {
      score += 40;
    }
    return { image, score: score - index * 0.01 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.image ?? null;
}

function productReferenceAudit(
  image: ProductImageInput | null
): AdVisualPromptAudit["productReference"] | undefined {
  if (!image) return undefined;
  return {
    id: image.ref.id,
    name: image.ref.name,
    sourceKind: image.ref.sourceKind,
    url: image.ref.url,
    sourcePageUrl: image.ref.sourcePageUrl,
    visualSummary: image.ref.visualSummary,
    tags: image.ref.tags,
    usage: image.ref.usage,
  };
}

function socialInspirationAudit(
  images?: ProductImageInput[]
): AdVisualPromptAudit["socialInspiration"] | undefined {
  const refs = (images ?? [])
    .filter(isSocialInspirationReference)
    .slice(0, 4)
    .map((image) => ({
      id: image.ref.id,
      name: image.ref.name,
      visualSummary: image.ref.visualSummary,
      tags: image.ref.tags,
    }));
  return refs.length ? refs : undefined;
}

function socialInspirationPromptNote(images?: ProductImageInput[]): string {
  const refs = socialInspirationAudit(images);
  if (!refs?.length) return "";
  const lines = refs
    .map((ref, index) => {
      const summary = compactPromptLine(ref.visualSummary ?? ref.name);
      const tags = (ref.tags ?? [])
        .filter((tag) => !/social[-\s]?inspiration/i.test(tag))
        .slice(0, 4)
        .join(", ");
      return `${index + 1}. ${summary}${tags ? ` (${tags})` : ""}`;
    })
    .join(" ");
  return `Social inspiration guidance: use these only for art direction, mood, lighting, framing, setting, and styling; do not copy them exactly and do not treat their products as the product reference. ${lines}`;
}

function buildMidjourneyScenePrompt(
  scenePrompt: string,
  surface: "ad" | "website" | undefined,
  instructionMode?: AdVisualInstructionMode
): string {
  const params = [
    surface === "website" ? "--ar 16:9" : "--ar 1:1",
    "--v 7 --raw --s 50",
    surface === "website" ? "--c 8" : "--c 10",
    instructionMode?.forbidHumans
      ? "--no text typography fake-logo watermark poster flyer ad-layout CTA UI screenshot split-screen slider humans people person model face hands arms legs body skin hair portrait selfie"
      : "--no text typography fake-logo watermark poster flyer ad-layout CTA UI screenshot split-screen slider ingredient props coconut shells fruit slices figs product-only still-life carton packaging",
  ].join(" ");
  return `${scenePrompt}\n${params}`;
}

function buildGeminiProductSwapPrompt(
  scenePrompt: string,
  productReference: ProductImageInput | null,
  instructionMode?: AdVisualInstructionMode
): string {
  if (instructionMode?.forbidHumans) {
    return [
      "Image 1 is the generated product-only scene.",
      productReference
        ? `Image 2 is the actual product photo: ${productReference.ref.name}.`
        : "No product reference image was provided.",
      "Replace only the placeholder product in Image 1 with the product from Image 2.",
      "Keep the product-only composition, natural surroundings, surface, crop, background, lighting, shadows, and camera angle from Image 1.",
      "If Image 1 contains any person, model, face, hand, arm, leg, body, skin, portrait, or body part, remove it completely.",
      "The final image must contain only the product and non-human environment.",
      "Match the product perspective, scale, occlusion, reflections, and shadows so it looks physically present in the scene.",
      "Preserve the real product logo, mark, label artwork, color, cap, bottle shape, and proportions exactly as visible in Image 2.",
      "The final bottle must show the real front mark/logo from Image 2; do not omit, blur, hide, simplify, or invent it.",
      "Do not add or create any headline, CTA, caption, poster, black panel, template, frame, UI, watermark, fake logo, extra label text, or graphic design.",
      `Scene intent: ${scenePrompt}.`,
    ].join("\n");
  }
  return [
    "Image 1 is the Midjourney scene.",
    productReference
      ? `Image 2 is the actual product photo: ${productReference.ref.name}.`
      : "No product reference image was provided.",
    "Replace only the placeholder product in Image 1 with the product from Image 2.",
    "Keep the model, face, pose, crop, background, lighting, shadows, hand placement, and camera angle from Image 1.",
    "Match the product perspective, scale, occlusion, reflections, and shadows so it looks physically present in the scene.",
    "Preserve the real product logo, mark, label artwork, color, cap, bottle shape, and proportions exactly as visible in Image 2.",
    "The final bottle must show the real front mark/logo from Image 2; do not omit, blur, hide, simplify, or invent it.",
    "If the scene angle hides the product front, rotate or place the replacement bottle just enough to keep the real mark visible while preserving believable hand placement.",
    "Do not add ingredient props such as coconuts, figs, fruit slices, shells, loose botanicals, cartons, or texture swatches.",
    "Do not add or create any headline, CTA, caption, poster, black panel, template, frame, UI, watermark, fake logo, extra label text, or graphic design.",
    `Scene intent: ${scenePrompt}.`,
  ].join("\n");
}

function buildOpenAIProductSwapPrompt(
  scenePrompt: string,
  productReference: ProductImageInput | null,
  hasScene: boolean,
  instructionMode?: AdVisualInstructionMode
): string {
  return hasScene
    ? buildGeminiProductSwapPrompt(scenePrompt, productReference, instructionMode)
    : instructionMode?.forbidHumans
      ? [
          productReference
            ? `Use the provided product image as the exact product reference: ${productReference.ref.name}.`
            : "Create the product scene from the prompt.",
          scenePrompt,
          "Create a photorealistic product-only still life. No humans, people, models, faces, hands, arms, legs, bodies, skin, portraits, or body parts.",
          "The final image must contain only the product and non-human natural surroundings.",
          "Preserve the real product logo, mark, label artwork, color, cap, bottle shape, and proportions when a product reference is provided.",
          "Keep the real front product mark visible. Do not omit, blur, hide, simplify, or invent it.",
          "No headline, CTA, caption, poster, black panel, template, frame, UI, watermark, fake logo, or graphic design.",
        ].join("\n")
    : [
        productReference
          ? `Use the provided product image as the exact product reference: ${productReference.ref.name}.`
          : "Create the product scene from the prompt.",
        scenePrompt,
        "Preserve the real product logo, mark, label artwork, color, cap, bottle shape, and proportions when a product reference is provided.",
        "Keep the real front product mark visible. Do not omit, blur, hide, simplify, or invent it.",
        "No ingredient props such as coconuts, figs, fruit slices, shells, loose botanicals, cartons, or texture swatches.",
        "No headline, CTA, caption, poster, black panel, template, frame, UI, watermark, fake logo, or graphic design.",
      ].join("\n");
}

function collectStringUrls(value: unknown, urls: string[] = []): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>)}\]]+/gi)) {
      urls.push(match[0].replace(/[),.;\]]+$/g, ""));
    }
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringUrls(item, urls);
    return urls;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringUrls(item, urls);
  }
  return urls;
}

function isLikelyImageUrl(url: string): boolean {
  return (
    /cdn\.midjourney\.com/i.test(url) ||
    /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url)
  );
}

function mimeFromImageUrl(url: string): string {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,*/*" },
    signal: AbortSignal.timeout(PRODUCT_IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch generated image (${response.status}).`);
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
    mimeFromImageUrl(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Generated image download was empty.");
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function runMidjourneyActor(prompt: string): Promise<string | null> {
  const token = process.env.APIFY_TOKEN?.trim();
  const actorId =
    process.env.APIFY_MIDJOURNEY_ACTOR_ID?.trim() ||
    "igolaizola~midjourney-automation";
  const cookies = parseJsonArrayEnv("APIFY_MIDJOURNEY_COOKIES");
  if (!token || !cookies.length) {
    console.warn(
      `[design] Midjourney skipped: ${
        !token ? "APIFY_TOKEN missing" : "APIFY_MIDJOURNEY_COOKIES empty"
      }.`
    );
    return null;
  }

  const input = {
    cookies,
    prompts: [prompt],
    mode: process.env.APIFY_MIDJOURNEY_MODE?.trim() || "relaxed",
    upscale: process.env.APIFY_MIDJOURNEY_UPSCALE?.trim() || "",
    privacy: boolEnv("APIFY_MIDJOURNEY_PRIVACY", false),
    concurrency: Math.max(1, Math.round(numberEnv("APIFY_MIDJOURNEY_CONCURRENCY", 1))),
    minWait: Math.round(numberEnv("APIFY_MIDJOURNEY_MIN_WAIT", 5)),
    maxWait: Math.round(numberEnv("APIFY_MIDJOURNEY_MAX_WAIT", 10)),
    jobTimeout: Math.round(numberEnv("APIFY_MIDJOURNEY_JOB_TIMEOUT", 300)),
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  };

  const waitSeconds = Math.min(
    600,
    Math.max(60, Math.ceil(MIDJOURNEY_TIMEOUT_MS / 1000))
  );
  const runUrl = new URL(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs`
  );
  runUrl.searchParams.set("token", token);
  runUrl.searchParams.set("waitForFinish", String(waitSeconds));

  const runResponse = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(MIDJOURNEY_TIMEOUT_MS + 15_000),
  });
  const runJson = (await runResponse.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (!runResponse.ok) {
    throw new Error(
      runJson.error?.message || `Midjourney actor failed (${runResponse.status}).`
    );
  }
  const run: Record<string, unknown> =
    runJson.data ?? (runJson as unknown as Record<string, unknown>);
  const status = String(run.status ?? "");
  if (status && status !== "SUCCEEDED") {
    throw new Error(`Midjourney actor ended with status ${status}.`);
  }
  const datasetId = String(run.defaultDatasetId ?? "");
  if (!datasetId) throw new Error("Midjourney actor returned no dataset.");

  const datasetUrl = new URL(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`
  );
  datasetUrl.searchParams.set("token", token);
  datasetUrl.searchParams.set("clean", "true");
  datasetUrl.searchParams.set("format", "json");
  const datasetResponse = await fetch(datasetUrl, {
    signal: AbortSignal.timeout(PRODUCT_IMAGE_TIMEOUT_MS),
  });
  const items = (await datasetResponse.json().catch(() => [])) as unknown;
  if (!datasetResponse.ok) {
    throw new Error(`Could not read Midjourney results (${datasetResponse.status}).`);
  }

  const urls = collectStringUrls(items);
  const imageUrl = urls.find(isLikelyImageUrl) ?? urls[0] ?? null;
  console.info(
    imageUrl
      ? "[design] Midjourney scene generated."
      : "[design] Midjourney actor succeeded but returned no image URL."
  );
  return imageUrl;
}

async function callGeminiImageComposite(args: {
  projectId: string;
  scenePrompt: string;
  sceneDataUrl: string;
  productImages: ProductImageInput[];
  instructionMode?: AdVisualInstructionMode;
}): Promise<{ dataUrl: string; prompt: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = (process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image")
    .split("#")[0]
    .trim();
  const scene = dataUrlParts(args.sceneDataUrl);
  if (!scene) throw new Error("Midjourney scene image was not a valid data URL.");

  const productReferences = args.productImages
    .filter((image) => image.dataUrl || image.buffer)
    .slice(0, 1);
  const geminiPrompt = buildGeminiProductSwapPrompt(
    args.scenePrompt,
    productReferences[0] ?? null,
    args.instructionMode
  );
  const imageParts = [
    { inlineData: { mimeType: scene.mimeType, data: scene.data } },
    ...productReferences.flatMap((image) => {
      if (image.dataUrl) {
        const parts = dataUrlParts(image.dataUrl);
        if (parts) return [{ inlineData: parts }];
      }
      if (!image.buffer) return [];
      return {
        inlineData: {
          mimeType: image.ref.mimeType,
          data: image.buffer.toString("base64"),
        },
      };
    }),
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: geminiPrompt,
              },
              ...imageParts,
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof json.error === "object" &&
      json.error &&
      "message" in json.error &&
      typeof json.error.message === "string"
        ? json.error.message
        : `Gemini image edit failed (${response.status}).`;
    throw new Error(message);
  }

  const usage = json.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  if (usage) {
    await recordProjectOnlyUsage(
      args.projectId,
      usage.promptTokenCount ?? 0,
      usage.candidatesTokenCount ?? 0,
      "frontier",
      0,
      "design.collateral"
    );
  }

  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  for (const candidate of candidates) {
    const content =
      candidate && typeof candidate === "object" && "content" in candidate
        ? (candidate.content as { parts?: unknown[] })
        : null;
    for (const part of content?.parts ?? []) {
      if (!part || typeof part !== "object") continue;
      const inlineData =
        "inlineData" in part
          ? (part.inlineData as { mimeType?: string; data?: string })
          : "inline_data" in part
            ? (part.inline_data as { mimeType?: string; data?: string })
            : null;
      if (inlineData?.data) {
        console.info("[design] Gemini product composite generated.");
        return {
          dataUrl: `data:${inlineData.mimeType || "image/png"};base64,${
            inlineData.data
          }`,
          prompt: geminiPrompt,
        };
      }
    }
  }
  throw new Error("Gemini returned no image.");
}

async function callOpenAIAdVisualImage(args: {
  projectId: string;
  type: CollateralType;
  scenePrompt: string;
  productImages: ProductImageInput[];
  sceneDataUrl?: string;
  instructionMode?: AdVisualInstructionMode;
}): Promise<{ dataUrl: string; prompt: string }> {
  ensureFileGlobal();
  const productReferences = args.productImages
    .filter((image) => image.dataUrl || image.buffer)
    .slice(0, 1);
  const prompt = buildOpenAIProductSwapPrompt(
    args.scenePrompt,
    productReferences[0] ?? null,
    Boolean(args.sceneDataUrl),
    args.instructionMode
  );
  const scene = args.sceneDataUrl ? dataUrlParts(args.sceneDataUrl) : null;
  const imageInputs = [
    ...(scene
      ? [
          {
            name: "midjourney-scene.png",
            mimeType: scene.mimeType,
            buffer: Buffer.from(scene.data, "base64"),
          },
        ]
      : []),
    ...productReferences.flatMap((image) => {
      const parts = image.dataUrl ? dataUrlParts(image.dataUrl) : null;
      const buffer =
        image.buffer ?? (parts ? Buffer.from(parts.data, "base64") : null);
      if (!buffer) return [];
      return [
        {
          name: image.ref.name,
          mimeType: parts?.mimeType ?? image.ref.mimeType,
          buffer,
        },
      ];
    }),
  ];
  const imageParams = {
    model: process.env.IMAGE_MODEL ?? "gpt-image-2",
    prompt,
    n: 1,
    size: collateralImageSize(args.type),
    quality: "medium" as const,
    output_format: "png" as const,
    background: "opaque" as const,
  };
  const imageFiles = await Promise.all(
    imageInputs.map((image, index) =>
      toFile(
        image.buffer,
        image.name || `image-reference-${index + 1}.png`,
        { type: image.mimeType }
      )
    )
  );
  const imageModel = String(imageParams.model);
  const supportsInputFidelity =
    !imageModel.startsWith("gpt-image-2") &&
    imageModel !== "gpt-image-1-mini" &&
    imageModel !== "dall-e-2";
  const editImageParams = supportsInputFidelity
    ? { ...imageParams, image: imageFiles, input_fidelity: "high" as const }
    : { ...imageParams, image: imageFiles };
  const response = imageFiles.length
    ? await client().images.edit(editImageParams, {
        timeout: DESIGN_IMAGE_TIMEOUT_MS,
        maxRetries: 0,
      })
    : await client().images.generate(imageParams, {
        timeout: DESIGN_IMAGE_TIMEOUT_MS,
        maxRetries: 0,
      });

  if (response.usage) {
    await recordProjectOnlyUsage(
      args.projectId,
      response.usage.input_tokens ?? 0,
      response.usage.output_tokens ?? 0,
      "frontier",
      0,
      "design.collateral"
    );
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image.");
  console.info(
    imageFiles.length
      ? "[design] OpenAI image edit generated visual."
      : "[design] OpenAI image generation produced visual."
  );
  return { dataUrl: `data:image/png;base64,${b64}`, prompt };
}

export async function callWebsiteImageCutout(args: {
  projectId: string;
  image: ProductImageInput;
  brandName: string;
}): Promise<{ dataUrl: string; prompt: string }> {
  ensureFileGlobal();
  const parts = args.image.dataUrl ? dataUrlParts(args.image.dataUrl) : null;
  const buffer =
    args.image.buffer ?? (parts ? Buffer.from(parts.data, "base64") : null);
  const mimeType = parts?.mimeType ?? args.image.ref.mimeType;
  if (!buffer || !/^image\/(?:png|jpe?g|webp)$/i.test(mimeType)) {
    throw new Error("Cutout source must be a PNG, JPEG, or WebP image.");
  }
  const prompt = [
    `Remove the background from this ${args.brandName} product image.`,
    "Return a transparent PNG cutout that preserves the exact product, package shape, label, logo, typography, color, proportions, and edge detail.",
    "Do not redesign the product, do not add props, do not add a new background, and do not crop off the object.",
    "Keep natural shadows only if they are attached to the product and work on any website background.",
  ].join(" ");
  const file = await toFile(
    buffer,
    args.image.ref.name || "website-product-source.png",
    { type: mimeType }
  );
  const response = await client().images.edit(
    {
      model: process.env.WEBSITE_CUTOUT_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2",
      image: [file],
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
      background: "transparent",
    } as never,
    { timeout: DESIGN_IMAGE_TIMEOUT_MS, maxRetries: 0 }
  );
  if (response.usage) {
    await recordProjectOnlyUsage(
      args.projectId,
      response.usage.input_tokens ?? 0,
      response.usage.output_tokens ?? 0,
      "frontier",
      0,
      "design.site"
    );
  }
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Background removal returned no image.");
  return { dataUrl: `data:image/png;base64,${b64}`, prompt };
}

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
  // Reserve the call's worst-case budget before dispatch so concurrent fan-out
  // can't collectively overshoot the run's cost/token cap (cost guard).
  const estInputTokens = estimateTokens(opts.system + opts.user);
  const estOutputTokens = opts.maxCompletionTokens ?? COMPLETION_BUDGET;
  const estTokens = estInputTokens + estOutputTokens;
  const estUsd = estimateCostUsd(
    opts.tier ?? "frontier",
    estInputTokens,
    estOutputTokens
  );
  if (opts.runId && !reserveBudget(opts.runId, estUsd, estTokens)) {
    throw new CostCapError(opts.runId, projectedSpend(opts.runId));
  }
  try {
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
  } finally {
    if (opts.runId) releaseReservation(opts.runId, estUsd, estTokens);
  }
}

/**
 * Decode the (possibly partial) value of the FIRST `"<field>": "..."` string in
 * a streamed JSON snapshot — lets us surface a model's prose answer token-by-
 * token before the full JSON object has finished generating. Returns null until
 * the field's opening quote has arrived. Tolerates a snapshot that ends mid-
 * escape by falling back to the raw (still-readable) text.
 */
export function extractStreamingStringField(
  text: string,
  field: string
): string | null {
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*"`));
  if (!m) return null;
  let raw = "";
  let escaped = false;
  for (let i = (m.index ?? 0) + m[0].length; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      raw += ch;
      escaped = false;
    } else if (ch === "\\") {
      raw += ch;
      escaped = true;
    } else if (ch === '"') {
      break; // closing quote — value complete
    } else {
      raw += ch;
    }
  }
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw; // mid-escape / partial — show what we have
  }
}

/**
 * Streaming sibling of {@link callJson}: runs ONE streamed completion, surfaces
 * the named string field's text as it arrives via `onDelta` (full value each
 * time — the client replaces, not appends), then validates the assembled JSON
 * through the schema. On a parse/validation miss it falls back to a single
 * clean non-streaming call so callers still get a typed result. Same cost-guard
 * reservation + usage recording as callJson.
 */
async function callJsonStream<T>(opts: {
  runId: string | null;
  projectId?: string | null;
  feature?: UsageFeatureKey;
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  streamField: string;
  onDelta: (textSoFar: string) => void | Promise<void>;
  model?: string;
  tier?: ModelTier;
  maxCompletionTokens?: number;
  requestTimeoutMs?: number;
  requestMaxRetries?: number;
}): Promise<T> {
  const estInputTokens = estimateTokens(opts.system + opts.user);
  const estOutputTokens = opts.maxCompletionTokens ?? COMPLETION_BUDGET;
  const estTokens = estInputTokens + estOutputTokens;
  const estUsd = estimateCostUsd(
    opts.tier ?? "frontier",
    estInputTokens,
    estOutputTokens
  );
  if (opts.runId && !reserveBudget(opts.runId, estUsd, estTokens)) {
    throw new CostCapError(opts.runId, projectedSpend(opts.runId));
  }
  let snapshot = "";
  try {
    const stream = await client().chat.completions.create(
      {
        ...baseParams(opts.model),
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.maxCompletionTokens
          ? { max_completion_tokens: opts.maxCompletionTokens }
          : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      },
      opts.requestTimeoutMs || opts.requestMaxRetries !== undefined
        ? {
            ...(opts.requestTimeoutMs ? { timeout: opts.requestTimeoutMs } : {}),
            ...(opts.requestMaxRetries !== undefined
              ? { maxRetries: opts.requestMaxRetries }
              : {}),
          }
        : undefined
    );
    let lastSent: string | null = null;
    let usage: OpenAI.CompletionUsage | null = null;
    let emitChain: Promise<void> = Promise.resolve();
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      snapshot += delta;
      const field = extractStreamingStringField(snapshot, opts.streamField);
      if (field !== null && field !== lastSent) {
        lastSent = field;
        const text = field;
        emitChain = emitChain
          .then(() => opts.onDelta(text))
          .catch(() => undefined);
      }
    }
    await emitChain;
    if (usage) {
      if (opts.runId) {
        await recordUsage(
          opts.runId,
          usage.prompt_tokens,
          usage.completion_tokens,
          opts.tier ?? "frontier",
          0,
          { feature: opts.feature, projectId: opts.projectId }
        );
      } else if (opts.projectId) {
        await recordProjectOnlyUsage(
          opts.projectId,
          usage.prompt_tokens,
          usage.completion_tokens,
          opts.tier ?? "frontier",
          0,
          opts.feature ?? "simulation.core"
        );
      }
    }
  } finally {
    if (opts.runId) releaseReservation(opts.runId, estUsd, estTokens);
  }

  try {
    const parsed = opts.schema.safeParse(JSON.parse(stripFences(snapshot)));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the non-streaming retry
  }
  // Streamed JSON didn't validate — one clean non-streaming call (the prose the
  // user already saw stands; this just recovers a well-typed object).
  return callJson({
    runId: opts.runId,
    projectId: opts.projectId,
    feature: opts.feature,
    system: opts.system,
    user: opts.user,
    schema: opts.schema,
    model: opts.model,
    tier: opts.tier,
    maxCompletionTokens: opts.maxCompletionTokens,
    maxAttempts: 1,
    requestTimeoutMs: opts.requestTimeoutMs,
    requestMaxRetries: opts.requestMaxRetries,
  });
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
  // Reserve frontier budget incl. one estimated web-search call (cost guard).
  const estTokens = estimateTokens(system) + COMPLETION_BUDGET;
  const estUsd = estimateCostUsd(
    "frontier",
    estimateTokens(system),
    COMPLETION_BUDGET,
    1
  );
  if (!reserveBudget(runId, estUsd, estTokens)) {
    throw new CostCapError(runId, projectedSpend(runId));
  }
  try {
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
  } finally {
    releaseReservation(runId, estUsd, estTokens);
  }
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

  // Reserve frontier budget for the ungrounded streaming desk call. The web
  // path (above) and the validation-retry fallback (callJson, below) reserve
  // separately, so this guards exactly the streaming branch (cost guard).
  const estTokens = estimateTokens(system + user) + COMPLETION_BUDGET;
  const estUsd = estimateCostUsd(
    "frontier",
    estimateTokens(system + user),
    COMPLETION_BUDGET
  );
  if (!reserveBudget(runId, estUsd, estTokens)) {
    throw new CostCapError(runId, projectedSpend(runId));
  }
  let snapshot = "";
  try {
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
  } finally {
    releaseReservation(runId, estUsd, estTokens);
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
  question: string,
  answerInstructions: string | null = null
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
    user: queryV2User(
      profile,
      conclusions,
      aggregate,
      question,
      answerInstructions
    ),
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
    maxCompletionTokens: 4000,
    // Simple persona JSON on the mini model — a parse failure is rare and a
    // full re-call costs more latency than it's worth; fail fast (no retry).
    maxAttempts: 1,
    requestTimeoutMs: config.blockTimeoutMs,
    requestMaxRetries: 1,
  });
}

/**
 * Streaming variant of {@link callAudienceChat}: surfaces the persona's reply
 * prose (the first message's `content`) via `onDelta` token-by-token, then
 * returns the full typed output for persistence / intent re-derivation.
 */
export async function callAudienceChatStream(
  runId: string,
  profile: ClientProfile,
  cohort: Cohort,
  personas: Persona[],
  mode: AudienceChatMode,
  question: string,
  history: AudienceChatHistoryItem[],
  onDelta: (textSoFar: string) => void | Promise<void>
): Promise<AudienceChatOutput> {
  if (config.mockMode) {
    const out = await callAudienceChat(
      runId,
      profile,
      cohort,
      personas,
      mode,
      question,
      history
    );
    await onDelta(out.messages[0]?.content ?? "");
    return out;
  }
  return callJsonStream({
    runId,
    system: audienceChatSystem(profile, cohort, personas, mode),
    user: audienceChatUser(question, history),
    schema: AudienceChatOutputSchema,
    streamField: "content",
    onDelta,
    model: config.miniModel,
    tier: "mini",
    maxCompletionTokens: 4000,
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
    maxAttempts: 1, // simple persona JSON — fail fast instead of re-calling
    requestTimeoutMs: config.blockTimeoutMs,
    requestMaxRetries: 1,
  });
}

/**
 * Streaming variant of {@link callPersonaReply}: the reply prose is surfaced
 * via `onDelta` as it generates so the UI shows tokens immediately instead of
 * waiting for the whole turn. Returns the same typed output once complete.
 */
export async function callPersonaReplyStream(
  runId: string,
  profile: ClientProfile,
  speaker: PersonaCtx,
  others: PersonaCtx[],
  topic: string,
  history: PersonaConversationMessage[],
  onDelta: (textSoFar: string) => void | Promise<void>
): Promise<PersonaReplyOutput> {
  if (config.mockMode) {
    const out = await callPersonaReply(
      runId,
      profile,
      speaker,
      others,
      topic,
      history
    );
    await onDelta(out.content);
    return out;
  }
  return callJsonStream({
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
    streamField: "content",
    onDelta,
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
    maxAttempts: 1, // simple persona JSON — fail fast instead of re-calling
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
    postConcepts: [
      {
        id: "hero-product-proof-post",
        platform: "Instagram",
        format: "Reel",
        hook: `${product} proof in 10 seconds`,
        caption: `Show the product close-up, name the main buyer objection, then answer it with one visible proof point for ${audience}.`,
        sourceUrls: [],
        visualSourceUrls: [],
        notes: `Fallback concept generated because ${reason}. Replace with collected product/article evidence after website analysis refreshes.`,
      },
      {
        id: "price-quality-carousel",
        platform: "Instagram",
        format: "Carousel",
        hook: "What the price really includes",
        caption:
          "Use five slides to explain materials, finish, durability, fulfillment, and customer risk reversal without sounding defensive.",
        sourceUrls: [],
        visualSourceUrls: [],
        notes: "Use observed listing prices when available.",
      },
    ],
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
  founderStory: FounderStorySection | null = null,
  websiteAnalysis: WebsiteAnalysis | null = null
): Promise<BrandKit> {
  if (config.mockMode) return BrandKitSchema.parse(mockBrandKit);

  const system = `${BRAND_KIT_SYSTEM}\n\n--- INPUT ---\n${brandKitUser(
    profile,
    conclusions,
    aggregate,
    founderStory,
    websiteAnalysis
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
        user: brandKitUser(
          profile,
          conclusions,
          aggregate,
          founderStory,
          websiteAnalysis
        ),
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
    customFonts: [],
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
 * story, product-image notes, and optional pre-collected website evidence. On
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
  guidance = "",
  websiteAnalysis: WebsiteAnalysis | null = null
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
        guidance,
        websiteAnalysis
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
 * Write the COPY for one collateral piece (ad / business card / flyer / poster). The
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
  brief: string,
  websiteAnalysis: WebsiteAnalysis | null = null
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
    user: collateralCopyUser(type, profile, brandKit, brief, websiteAnalysis),
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
 * Generate a complete, self-contained static website (HTML + inline CSS, no
 * scripts) styled from the design tokens. The HTML/files are sanitized by the
 * caller before preview/export/deploy. Larger token budget since rich brands
 * can return a multi-page file tree.
 */
export async function callSiteGenerator(
  runId: string | null,
  projectId: string | null,
  profile: ClientProfile,
  tokens: DesignTokens,
  brandKit: BrandKit | null,
  brief: string,
  productImages: ProductImageInput[] = [],
  websiteAnalysis: WebsiteAnalysis | null = null,
  brandAssets: {
    brandName: string;
    logoSvg?: string;
    logoImageDataUrl?: string;
    logoSourceUrl?: string;
  } | null = null,
  options: { promoMessages?: string[]; multiPage?: boolean } = {}
): Promise<SiteGenOutput> {
  if (config.mockMode) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${
      profile.product || "Brand"
    }</title></head><body style="font-family:system-ui;padding:48px;background:${
      tokens.palette.neutralLight
    };color:${tokens.palette.neutralDark}"><h1 style="color:${
      tokens.palette.primary
    }">${profile.product || "Brand"}</h1><p>(mock) static website.</p></body></html>`;
    return SiteGenOutputSchema.parse({
      title: `${profile.product || "Brand"} — mock site`,
      html,
      files: [{ path: "index.html", content: html, contentType: "text/html" }],
    });
  }
  return callJson({
    runId,
    projectId,
    feature: "design.site",
    model: process.env.SITE_MODEL || "gpt-5.5",
    system: SITE_GEN_SYSTEM,
    user: siteGenUser(
      profile,
      tokens,
      brandKit,
      brief,
      productImages.map((image, index) => ({
        placeholder: `PRODUCT_IMAGE_${index + 1}`,
        name: image.ref.name,
        visualSummary: image.ref.visualSummary ?? "",
        tags: image.ref.tags ?? [],
        availableForInlineEmbed: Boolean(image.dataUrl),
      })),
      websiteAnalysis,
      brandAssets,
      options
    ),
    schema: SiteGenOutputSchema,
    maxCompletionTokens: 26000,
    requestTimeoutMs: DESIGN_SITE_TIMEOUT_MS,
    requestMaxRetries: 0,
  });
}

export async function callAdVisualImage(args: {
  projectId: string;
  type: CollateralType;
  profile: ClientProfile;
  tokens: DesignTokens;
  brandKit: BrandKit | null;
  visualBrief: string;
  copy: CollateralContent;
  productImages?: ProductImageInput[];
  surface?: "ad" | "website";
}): Promise<AdVisualResult> {
  const instructionMode = adVisualInstructionMode(args.visualBrief);
  const productReference = selectProductReference({
    productImages: args.productImages,
    visualBrief: args.visualBrief,
    copy: args.copy,
    profile: args.profile,
  });
  const productRefs = productReference ? [productReference] : [];
  const baseScenePrompt = scenePromptFromVisualBrief(
    args.visualBrief,
    productReference?.ref.name ||
      args.profile.product ||
      args.profile.category ||
      "product",
    instructionMode
  );
  const inspirationNote = socialInspirationPromptNote(args.productImages);
  const scenePrompt = compactPromptLine(
    [baseScenePrompt, inspirationNote].filter(Boolean).join(" ")
  ).slice(0, instructionMode.forbidHumans ? 900 : 620);
  const promptAudit: AdVisualPromptAudit = {
    scenePrompt,
    productReference: productReferenceAudit(productReference),
    socialInspiration: socialInspirationAudit(args.productImages),
  };

  if (args.type === "ad") {
    const midjourneyPrompt = buildMidjourneyScenePrompt(
      scenePrompt,
      args.surface,
      instructionMode
    );
    promptAudit.midjourneyPrompt = midjourneyPrompt;
    try {
      const midjourneyUrl = await runMidjourneyActor(midjourneyPrompt);
      if (midjourneyUrl) {
        const sceneDataUrl = await fetchImageAsDataUrl(midjourneyUrl);
        try {
          const gemini = await callGeminiImageComposite({
            projectId: args.projectId,
            scenePrompt,
            sceneDataUrl,
            productImages: productRefs,
            instructionMode,
          });
          promptAudit.geminiPrompt = gemini.prompt;
          return {
            dataUrl: gemini.dataUrl,
            prompt: gemini.prompt,
            generationPrompt: promptAudit,
          };
        } catch (geminiError) {
          console.error(
            "[design] Gemini product-composite failed; falling back to OpenAI image edit:",
            geminiError
          );
          const openai = await callOpenAIAdVisualImage({
            projectId: args.projectId,
            type: args.type,
            scenePrompt,
            productImages: productRefs,
            sceneDataUrl,
            instructionMode,
          });
          promptAudit.openaiPrompt = openai.prompt;
          return {
            dataUrl: openai.dataUrl,
            prompt: openai.prompt,
            generationPrompt: promptAudit,
          };
        }
      }
    } catch (midjourneyError) {
      console.error(
        "[design] Midjourney social pipeline failed; falling back to OpenAI image generation:",
        midjourneyError
      );
    }
  }

  const openai = await callOpenAIAdVisualImage({
    projectId: args.projectId,
    type: args.type,
    scenePrompt,
    productImages: productRefs,
    instructionMode,
  });
  promptAudit.openaiPrompt = openai.prompt;
  return {
    dataUrl: openai.dataUrl,
    prompt: openai.prompt,
    generationPrompt: promptAudit,
  };
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
  category: string,
  businessModel?: string
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
        { role: "user", content: marketDataUser(country, category, businessModel) },
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

function collectedInfoSourceUrls(info: WebsiteCollectedInfo): string[] {
  const urls = [
    ...info.productImages.map((image) => image.sourceUrl || image.url),
    ...info.products.map((product) => product.url || product.imageUrl),
    ...info.listingEvidence.map((listing) => listing.url),
    ...info.priceRanges.map((range) => range.sourceUrl),
    ...info.newsArticles.map((article) => article.url),
    ...info.socialProfiles.map((link) => link.url),
    ...info.marketplaceLinks.map((link) => link.url),
    ...info.facts.map((fact) => fact.sourceUrl),
  ];
  return Array.from(
    new Set(
      urls.filter((url): url is string => Boolean(url && /^https?:\/\//i.test(url)))
    )
  );
}

function websiteAnalysisScrapeFallback(
  url: string,
  scrapedInfo: WebsiteCollectedInfo,
  reason: string
): WebsiteAnalysisOutput {
  const productNames = scrapedInfo.products
    .map((product) => product.name)
    .filter(Boolean);
  const category = scrapedInfo.products.find((product) => product.category)
    ?.category;
  const priceTexts = [
    ...scrapedInfo.priceRanges.map((range) => range.text),
    ...scrapedInfo.listingEvidence.map((listing) => listing.priceText),
  ].filter((text): text is string => Boolean(text));
  const priceBand = Array.from(new Set(priceTexts)).slice(0, 3).join("; ");
  const factSummary = scrapedInfo.facts
    .slice(0, 3)
    .map((fact) => `${fact.label}: ${fact.value}`)
    .join("; ");
  const brand = scrapedInfo.brandName || new URL(url).hostname.replace(/^www\./, "");
  const collectedCounts = [
    `${scrapedInfo.productImages.length} images`,
    `${scrapedInfo.products.length} products`,
    `${scrapedInfo.listingEvidence.length} listings`,
    `${scrapedInfo.priceRanges.length} price ranges`,
  ].join(", ");
  const openQuestions = Array.from(
    new Set([
      ...scrapedInfo.openQuestions,
      `AI synthesis was skipped because ${reason}; refresh analysis later to verify customer sentiment and positioning.`,
    ])
  );

  return WebsiteAnalysisOutputSchema.parse({
    draftProfile: {
      product: productNames.slice(0, 3).join(", ") || brand,
      category,
      priceBand: priceBand || undefined,
      heroProducts: productNames.slice(0, 8),
      styleKeywords: [],
      differentiation: factSummary || undefined,
    },
    knownFields: [
      productNames.length || brand ? "product" : "",
      category ? "category" : "",
      priceBand ? "priceBand" : "",
      factSummary ? "differentiation" : "",
    ].filter(Boolean),
    consumerOpinion:
      "Customer sentiment could not be verified before the AI request timed out. The collected site evidence is still available for review.",
    sentiment: "unknown",
    summary: `Collected site evidence for ${brand} (${collectedCounts}). AI synthesis did not complete, so confirm the product positioning, audience, and customer sentiment before launching a run.`,
    infoCollected: {
      ...scrapedInfo,
      openQuestions,
    },
    sources: Array.from(new Set([url, ...collectedInfoSourceUrls(scrapedInfo)])).slice(
      0,
      80
    ),
  });
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
      infoCollected: {
        brandName: "Mock Apparel",
        productImages: [
          {
            url: "https://images.unsplash.com/photo-1523398002811-999ca8dec234",
            alt: "Mock apparel product photo",
            caption: "Representative product imagery found on the brand site.",
            sourceUrl: url,
            kind: "product",
          },
        ],
        products: [
          {
            name: "Signature shirt",
            description: "Contemporary hero product used for mock analysis.",
            category: "apparel",
            url,
            priceText: "$80-$120",
          },
        ],
        listingEvidence: [
          {
            productName: "Signature shirt",
            brand: "Mock Apparel",
            source: "Brand site",
            sourceType: "brand_site",
            url,
            imageUrl: "https://images.unsplash.com/photo-1523398002811-999ca8dec234",
            currency: "USD",
            price: 120,
            priceText: "$120",
            availability: "Available",
            isBrandProduct: true,
            confidence: 0.9,
            observedAt: new Date().toISOString().slice(0, 10),
            notes: "Mock brand-site listing.",
          },
          {
            productName: "Comparable premium shirt",
            brand: "Comparable D2C brand",
            source: "Amazon",
            sourceType: "amazon",
            url,
            currency: "USD",
            minPrice: 80,
            maxPrice: 140,
            priceText: "$80-$140",
            isBrandProduct: false,
            confidence: 0.65,
            observedAt: new Date().toISOString().slice(0, 10),
            notes: "Mock comparable marketplace price evidence.",
          },
        ],
        priceRanges: [
          {
            label: "Core apparel",
            currency: "USD",
            min: 80,
            max: 160,
            text: "$80-$160",
            sourceUrl: url,
            notes: "Mock observed price range.",
          },
        ],
        newsArticles: [
          {
            title: "Mock Apparel expands its contemporary basics line",
            url,
            source: "Mock Press",
            summary: "Sample press item for local development.",
          },
        ],
        socialProfiles: [
          { label: "Instagram", url, detail: "@mockapparel" },
        ],
        marketplaceLinks: [],
        facts: [
          {
            label: "Positioning",
            value: "Premium contemporary apparel for urban customers.",
            sourceUrl: url,
          },
        ],
        openQuestions: ["Verify exact stockists and current best-selling SKUs."],
      },
      sources: [url],
    });
  }
  const scrapedInfo = await collectWebsiteEvidence(url).catch((error) => {
    console.error("[website-analysis] direct site crawl failed:", error);
    return null;
  });
  const userPrompt = websiteAnalysisUser(url, scrapedInfo);
  const mergeAnalysis = (
    output: WebsiteAnalysisOutput
  ): WebsiteAnalysisOutput => {
    if (!scrapedInfo) return output;
    const infoCollected = mergeWebsiteCollectedInfo({
      scraped: scrapedInfo,
      model: output.infoCollected,
    });
    return WebsiteAnalysisOutputSchema.parse({
      ...output,
      infoCollected,
      sources: Array.from(
        new Set([
          ...collectedInfoSourceUrls(scrapedInfo),
          ...output.sources,
          ...collectedInfoSourceUrls(output.infoCollected),
        ])
      ).slice(0, 80),
    });
  };
  try {
    const response = await client().responses.create(
      {
        model: config.model,
        tools: [{ type: "web_search" } as never],
        input: [
          { role: "system", content: WEBSITE_ANALYSIS_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        max_output_tokens: 6000,
        reasoning: { effort: "low" },
      },
      { timeout: WEBSITE_ANALYSIS_WEB_TIMEOUT_MS, maxRetries: 0 }
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
    if (parsed.success) return mergeAnalysis(parsed.data);
    throw new Error(
      `website analysis (web) failed validation: ${JSON.stringify(
        parsed.error.issues
      )}`
    );
  } catch (e) {
    console.error(`[website-analysis] web path failed, falling back:`, e);
    if (scrapedInfo && shouldUseOwnerLocalFallback(e)) {
      return websiteAnalysisScrapeFallback(
        url,
        scrapedInfo,
        ownerProviderFallbackReason(e)
      );
    }
    try {
      return await callJson({
        runId: null,
        projectId,
        feature: "website.analysis",
        system: WEBSITE_ANALYSIS_SYSTEM,
        user: userPrompt,
        schema: WebsiteAnalysisOutputSchema,
        maxCompletionTokens: 6000,
        requestTimeoutMs: WEBSITE_ANALYSIS_FALLBACK_TIMEOUT_MS,
        requestMaxRetries: 0,
      }).then(mergeAnalysis);
    } catch (fallbackError) {
      if (scrapedInfo && shouldUseOwnerLocalFallback(fallbackError)) {
        return websiteAnalysisScrapeFallback(
          url,
          scrapedInfo,
          ownerProviderFallbackReason(fallbackError)
        );
      }
      throw fallbackError;
    }
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
  usage?: "product-reference" | "social-inspiration";
}): Promise<ProductImageAnalysis> {
  if (config.mockMode) {
    return {
      visualSummary:
        args.usage === "social-inspiration"
          ? `(mock) Social inspiration image ${args.fileName} for composition, lighting, mood, and styling.`
          : `(mock) Product reference image ${args.fileName} for ${args.product ?? "the venture"}.`,
      tags:
        args.usage === "social-inspiration"
          ? ["social inspiration"]
          : ["product reference"],
    };
  }

  const socialInspiration =
    args.usage === "social-inspiration"
      ? "You inspect uploaded social-media inspiration images for art direction. Describe visible composition, framing, lighting, mood, setting, surface, camera angle, color treatment, styling, and product-presentation cues. Do not identify people or infer demographics. Do not describe it as the product to preserve."
      : "You inspect founder-uploaded product reference images for business simulation. Describe only visible product traits: category, silhouette or shape, materials, color, finish, styling cues, construction details, use case, and likely positioning. Avoid guessing brand claims, price, location, identity, or demographics.";

  const response = await client().responses.create(
    {
      model: config.model,
      input: [
        {
          role: "system",
          content: `${socialInspiration} Output JSON only.`,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Product context: ${args.product ?? "unknown"}\nImage file: ${args.fileName}\nUsage: ${args.usage ?? "product-reference"}\nReturn {"visualSummary":"...","tags":["..."]}.`,
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

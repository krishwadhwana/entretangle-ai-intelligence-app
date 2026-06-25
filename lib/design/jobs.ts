import { z } from "zod";
import { createHash } from "crypto";
import { renderCollateral, COLLATERAL_LABELS } from "./collateral";
import { buildLogoVariants, sanitizeSvg } from "./logo";
import { appendJobProgress } from "../jobs";
import {
  callAdVisualImage,
  callCollateralCopy,
  callDesignTokens,
  callLogoMarks,
  type ProductImageInput,
  callSiteGenerator,
  callWebsiteAnalysis,
} from "../llm";
import {
  CollateralContentSchema,
  CollateralTypeSchema,
  DesignAssetSchema,
  LogoAssetSchema,
  SiteAssetSchema,
  WebsiteAnalysisSchema,
} from "../schema";
import {
  getFounderStory,
  getProject,
  saveDesignAsset,
  saveDesignTokens,
  saveLogoAsset,
  saveSiteAsset,
  saveWebsiteAnalysis,
} from "../store";
import {
  ensureProductImageryHtml,
  looksLikeHtmlDoc,
  polishGeneratedSiteHtmlWithAssets,
  sanitizeSiteHtml,
} from "./site";
import {
  fetchScrapedProductImage,
  readProductImageFile,
  scrapedProductImageCandidates,
} from "../productImages";
import type {
  BrandKit,
  ClientProfile,
  DesignTokens,
  LogoAsset,
  ProductImageRef,
  SiteFile,
  WebsiteAnalysis,
} from "../schema";

const BasePayloadSchema = z.object({
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
  sourceWebsiteUrl: z.string().trim().max(400).default(""),
});

const TokensPayloadSchema = BasePayloadSchema.extend({
  guidance: z.string().trim().max(2000).default(""),
});

const LogoPayloadSchema = BasePayloadSchema.extend({
  brief: z.string().trim().max(2000).default(""),
});

const CollateralPayloadSchema = BasePayloadSchema.extend({
  type: CollateralTypeSchema,
  brief: z.string().trim().max(2000).default(""),
  useTemplates: z.boolean().default(true),
  useAiVisual: z.boolean().default(false),
  useProductImages: z.boolean().default(false),
  visualBrief: z.string().trim().max(2000).default(""),
  templateBrief: z.string().trim().max(1000).default(""),
  generationRunId: z.string().trim().max(160).default(""),
  generationRunLabel: z.string().trim().max(220).default(""),
  generationRunCreatedAt: z.string().trim().max(80).default(""),
  generationRunStamp: z.string().trim().max(80).default(""),
  content: CollateralContentSchema.optional(),
});

const SitePayloadSchema = BasePayloadSchema.extend({
  brief: z.string().trim().max(2000).default(""),
});

function assetId(type: string, seed: string): string {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `${type}-${slug || "asset"}-${suffix}`;
}

async function projectOrThrow(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("project not found");
  if (!project.ventureProfile) throw new Error("Finish the venture intake first.");
  return project;
}

function normalizeSourceWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/[),.;\]]+$/g, "");
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameSourceUrl(a: string | null | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeSourceWebsiteUrl(a) === b;
}

async function resolveWebsiteAnalysis(
  projectId: string,
  existing: WebsiteAnalysis | null,
  sourceWebsiteUrl: string
): Promise<WebsiteAnalysis | null> {
  const normalizedUrl = normalizeSourceWebsiteUrl(sourceWebsiteUrl);
  if (!normalizedUrl) return existing;
  if (sameSourceUrl(existing?.url, normalizedUrl)) return existing;

  try {
    const out = await callWebsiteAnalysis(normalizedUrl, projectId);
    const analysis = WebsiteAnalysisSchema.parse({
      ...out,
      url: normalizedUrl,
      analyzedAt: new Date().toISOString(),
    });
    await saveWebsiteAnalysis(projectId, analysis).catch(() => undefined);
    return analysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : "website analysis failed";
    throw new Error(`Could not pull ${normalizedUrl}: ${message}`);
  }
}

function websiteImageNotes(analysis: WebsiteAnalysis | null): string[] {
  const info = analysis?.infoCollected;
  if (!info) return [];
  return [
    ...info.productImages.slice(0, 8).map((image) =>
      [
        image.kind,
        image.alt || image.caption || "website image",
        image.sourceUrl || image.url,
      ]
        .filter(Boolean)
        .join(" - ")
    ),
    ...info.products.slice(0, 6).map((product) =>
      [
        product.name,
        product.category,
        product.priceText,
        product.description,
      ]
        .filter(Boolean)
        .join(" - ")
    ),
  ];
}

function cleanProjectBrandName(name: string): string {
  return name
    .replace(/\b(final|test|demo|draft|copy)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function websiteBrandName(
  profile: ClientProfile,
  projectName: string,
  websiteAnalysis: WebsiteAnalysis | null
): string {
  const scrapedBrand = websiteAnalysis?.infoCollected?.brandName?.trim();
  if (scrapedBrand) return scrapedBrand;
  const cleanedProject = cleanProjectBrandName(projectName);
  if (cleanedProject) return cleanedProject;
  return profile.product || "Brand";
}

function websiteLogoSvg(logos: LogoAsset[] | undefined): string | null {
  const logo = logos?.[0];
  if (!logo) return null;
  const preferred =
    logo.variants.find((variant) => variant.kind === "lockup") ??
    logo.variants.find((variant) => variant.kind === "wordmark") ??
    logo.variants.find((variant) => variant.kind === "icon") ??
    null;
  return preferred ? sanitizeSvg(preferred.svg) : null;
}

function websiteHeroSubhead(
  profile: ClientProfile,
  projectName: string,
  websiteAnalysis: WebsiteAnalysis | null
): string {
  const differentiation = profile.productDetails?.differentiation?.trim();
  const looksScraped =
    differentiation &&
    /\b(Page inspected|Collections|Shop)\b|[;|]/i.test(differentiation);
  if (
    differentiation &&
    !looksScraped &&
    differentiation.split(/\s+/).length <= 24
  ) {
    return differentiation;
  }
  const heroProducts = profile.productDetails?.heroProducts ?? [];
  if (heroProducts.length) {
    return `A product-led ritual built around ${heroProducts[0]}, styled for everyday hair and body care.`;
  }
  const product = profile.product || websiteAnalysis?.infoCollected?.products?.[0]?.name;
  if (product) {
    return `${product} presented as a polished, product-first ritual for the customers most likely to buy.`;
  }
  return profile.targetAudience || profile.goal || profile.ambitions || projectName;
}

function stableId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function istStamp(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}_IST`;
}

function fallbackAdRunMeta(useTemplates: boolean): {
  generationRunId: string;
  generationRunLabel: string;
  generationRunCreatedAt: string;
  generationRunStamp: string;
} {
  const now = new Date();
  const stamp = istStamp(now);
  const suffix = Math.random().toString(36).slice(2, 7);
  return {
    generationRunId: `ad-run-${stamp}-${suffix}`,
    generationRunLabel: `Server-stamped creative · ${stamp.replace(
      /_/g,
      " "
    )} · ${useTemplates ? "Template" : "No template"}`,
    generationRunCreatedAt: now.toISOString(),
    generationRunStamp: stamp,
  };
}

async function loadProductImageInputs(
  projectId: string,
  images: ProductImageRef[] | undefined,
  websiteAnalysis: WebsiteAnalysis | null = null
): Promise<ProductImageInput[]> {
  const refs = (images ?? []).slice(0, 4);
  const localInputs = await Promise.all(
    refs.map(async (ref) => {
      try {
        const buffer = await readProductImageFile(projectId, ref);
        return {
          ref,
          buffer,
          dataUrl: `data:${ref.mimeType};base64,${buffer.toString("base64")}`,
        };
      } catch {
        return { ref };
      }
    })
  );
  const remoteInputs = await Promise.all(
    scrapedProductImageCandidates(websiteAnalysis, 8)
      .slice(0, 6)
      .map(async (candidate): Promise<ProductImageInput | null> => {
        const fetched = await fetchScrapedProductImage(candidate);
        if (!fetched) return null;
        const ref: ProductImageRef = {
          id: `scraped-${stableId(candidate.url)}`,
          name: candidate.name,
          url: candidate.url,
          mimeType: fetched.mimeType,
          size: fetched.buffer.length,
          uploadedAt: websiteAnalysis?.analyzedAt || new Date().toISOString(),
          visualSummary: candidate.visualSummary,
          tags: candidate.tags,
          sourceUrl: candidate.url,
          sourcePageUrl: candidate.sourcePageUrl,
          sourceKind: "scraped",
        };
        return {
          ref,
          buffer: fetched.buffer,
          dataUrl: fetched.dataUrl,
        };
      })
  );
  return [
    ...localInputs,
    ...remoteInputs.filter((input): input is ProductImageInput => Boolean(input)),
  ].slice(0, 6);
}

function replaceProductImagePlaceholders(
  html: string,
  productImages: ProductImageInput[]
): string {
  return productImages.reduce((out, image, index) => {
    if (!image.dataUrl) return out;
    return out.replaceAll(`PRODUCT_IMAGE_${index + 1}`, image.dataUrl);
  }, html);
}

function isHtmlSiteFile(file: Pick<SiteFile, "path" | "contentType">): boolean {
  return (
    file.contentType.toLowerCase().includes("html") ||
    /\.html?$/i.test(file.path)
  );
}

function sanitizeSiteFilePath(value: string, index: number): string {
  let path = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  path = path
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!path) path = index === 0 ? "index.html" : `page-${index + 1}.html`;
  if (!/\.[a-z0-9]{1,8}$/i.test(path)) path = `${path}.html`;
  return path;
}

function uniqueSitePath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const extMatch = path.match(/(\.[a-z0-9]{1,8})$/i);
  const ext = extMatch?.[1] ?? ".html";
  const base = extMatch ? path.slice(0, -ext.length) : path;
  let suffix = 2;
  while (used.has(`${base}-${suffix}${ext}`)) suffix += 1;
  const next = `${base}-${suffix}${ext}`;
  used.add(next);
  return next;
}

function normalizeSiteFiles(args: {
  out: { html: string; files: SiteFile[] };
  productImages: ProductImageInput[];
  productImagePlaceholders: {
    placeholder: string;
    name: string;
    visualSummary?: string | null;
    availableForInlineEmbed?: boolean;
  }[];
  brandName: string;
  heroSubhead: string;
  logoSvg: string | null;
}): SiteFile[] {
  const rawFiles = args.out.files.map((file, index) => ({
    ...file,
    path: sanitizeSiteFilePath(file.path, index),
    contentType: file.contentType || "text/html",
  }));
  const indexFileIndex = rawFiles.findIndex((file) => file.path === "index.html");
  if (args.out.html.trim()) {
    if (indexFileIndex >= 0) {
      rawFiles[indexFileIndex] = {
        ...rawFiles[indexFileIndex],
        content: args.out.html,
        contentType: "text/html",
      };
    } else {
      rawFiles.unshift({
        path: "index.html",
        content: args.out.html,
        contentType: "text/html",
      });
    }
  }
  if (!rawFiles.length) {
    throw new Error("The generated site did not include any files.");
  }
  if (!rawFiles.some((file) => file.path === "index.html")) {
    rawFiles[0] = { ...rawFiles[0], path: "index.html", contentType: "text/html" };
  }

  const used = new Set<string>();
  return rawFiles.map((file) => {
    const path = uniqueSitePath(file.path, used);
    const htmlFile = isHtmlSiteFile({ ...file, path });
    if (!htmlFile) {
      return {
        path,
        content: replaceProductImagePlaceholders(file.content, args.productImages),
        contentType: file.contentType,
      };
    }
    const withImages =
      path === "index.html"
        ? ensureProductImageryHtml(file.content, args.productImagePlaceholders, {
            brandName: args.brandName,
            tagline: args.heroSubhead,
          })
        : file.content;
    const content = sanitizeSiteHtml(
      polishGeneratedSiteHtmlWithAssets(
        replaceProductImagePlaceholders(withImages, args.productImages),
        {
          brandName: args.brandName,
          logoSvg: args.logoSvg,
          heroSubhead: args.heroSubhead,
        }
      )
    );
    if (!looksLikeHtmlDoc(content)) {
      throw new Error(`The generated site file ${path} was malformed.`);
    }
    return { path, content, contentType: "text/html" };
  });
}

function dataUrlByteSize(dataUrl: string): number {
  const match = dataUrl.match(/^data:[^;,]+;base64,(.+)$/);
  if (!match) return 0;
  return Buffer.byteLength(match[1], "base64");
}

async function generateWebsiteHeroVisual(args: {
  projectId: string;
  profile: ClientProfile;
  tokens: DesignTokens;
  brandKit: BrandKit | null;
  brief: string;
  productImages: ProductImageInput[];
}): Promise<ProductImageInput> {
  const productName = args.profile.product || args.profile.category || "brand";
  const heroProducts = args.profile.productDetails?.heroProducts?.length
    ? ` Hero products: ${args.profile.productDetails.heroProducts.join(", ")}.`
    : "";
  const differentiation = args.profile.productDetails?.differentiation
    ? ` Differentiation: ${args.profile.productDetails.differentiation}.`
    : "";
  const visual = await callAdVisualImage({
    projectId: args.projectId,
    type: "ad",
    profile: args.profile,
    tokens: args.tokens,
    brandKit: args.brandKit,
    visualBrief: [
      "Create the main website hero campaign visual, not a social feed layout.",
      "It should feel like the strongest ad creative expanded into a premium full-bleed landing-page hero: product-first, editorial, commercial, immersive, crop-safe for desktop/mobile, with natural clean copy space and no readable text.",
      args.brief ? `Founder website brief: ${args.brief}` : "",
      heroProducts,
      differentiation,
    ]
      .filter(Boolean)
      .join(" "),
    copy: {
      brandName: productName,
      tagline: args.profile.goal || args.profile.ambitions || "",
      headline: productName,
      subhead: args.profile.targetAudience || args.profile.priceBand || "",
      body: [],
      cta: "Shop now",
      contact: {
        name: "",
        role: "",
        email: "",
        phone: "",
        website: "",
      },
    },
    productImages: args.productImages,
    surface: "website",
  });
  return {
    ref: {
      id: `website-hero-${Date.now().toString(36)}`,
      name: "Generated website campaign hero",
      url: "#generated-website-hero",
      mimeType: "image/png",
      size: dataUrlByteSize(visual.dataUrl),
      uploadedAt: new Date().toISOString(),
      visualSummary:
        "Generated landing-page hero visual produced through the Midjourney scene, Gemini product-composite, and OpenAI fallback pipeline.",
      tags: ["generated", "website", "hero", "midjourney", "gemini"],
    },
    dataUrl: visual.dataUrl,
  };
}

export async function runDesignStudioJob(args: {
  type: "design_tokens" | "design_logo" | "design_collateral" | "design_site";
  projectId: string;
  payload: unknown;
  jobId?: string;
}): Promise<Record<string, unknown>> {
  const project = await projectOrThrow(args.projectId);
  const profile = project.ventureProfile;
  if (!profile) throw new Error("Finish the venture intake first.");
  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;

  if (args.type === "design_tokens") {
    const payload = TokensPayloadSchema.parse(args.payload ?? {});
    const founderStory = await getFounderStory(args.projectId).catch(() => null);
    const websiteAnalysis = await resolveWebsiteAnalysis(
      args.projectId,
      project.websiteAnalysis,
      payload.sourceWebsiteUrl
    );
    const tokens = await callDesignTokens(
      payload.sourceRunId,
      args.projectId,
      profile,
      brandKit,
      founderStory,
      websiteImageNotes(websiteAnalysis),
      payload.guidance,
      websiteAnalysis
    );
    const designStudio = await saveDesignTokens(
      args.projectId,
      tokens,
      payload.sourceRunId,
      new Date().toISOString()
    );
    return { designStudio };
  }

  const tokens = project.ownerDashboard?.designStudio?.tokens ?? null;
  if (!tokens) {
    throw new Error("Generate design tokens before creating design assets.");
  }

  if (args.type === "design_logo") {
    const payload = LogoPayloadSchema.parse(args.payload ?? {});
    const brandName = profile.product || project.name;
    let concept = "Wordmark logo built from the brand's heading font.";
    let style = tokens.logo.style || "wordmark";
    let marks: { label: string; svg: string }[] = [];
    try {
      const out = await callLogoMarks(
        payload.sourceRunId,
        args.projectId,
        profile,
        tokens,
        brandKit,
        payload.brief
      );
      concept = out.concept;
      style = out.style;
      marks = out.marks;
    } catch (error) {
      console.error("[logo] marks generation failed, wordmark only:", error);
    }
    const logo = LogoAssetSchema.parse({
      id: `logo-${Date.now().toString(36)}`,
      brandName,
      style,
      concept,
      variants: await buildLogoVariants(brandName, tokens, marks),
      createdAt: new Date().toISOString(),
    });
    const studio = await saveLogoAsset(args.projectId, logo);
    return { logo, logos: studio.logos };
  }

  if (args.type === "design_collateral") {
    const payload = CollateralPayloadSchema.parse(args.payload ?? {});
    const isSocial = payload.type === "ad";
    const templateBrief =
      payload.useTemplates && payload.templateBrief
        ? payload.templateBrief
        : "";
    const websiteAnalysis = await resolveWebsiteAnalysis(
      args.projectId,
      project.websiteAnalysis,
      payload.sourceWebsiteUrl
    );
    const content =
      payload.content ??
      (await callCollateralCopy(
        payload.sourceRunId,
        args.projectId,
        payload.type,
        profile,
        brandKit,
        [payload.brief, templateBrief ? `Template direction: ${templateBrief}` : ""]
          .filter(Boolean)
          .join("\n"),
        websiteAnalysis
      ));
    const shouldGenerateVisual =
      payload.type !== "business-card" &&
      (isSocial || payload.useAiVisual || payload.useProductImages);
    const shouldUseProductImages = isSocial || payload.useProductImages;
    const productImages = shouldUseProductImages
      ? await loadProductImageInputs(
          args.projectId,
          profile.productImages,
          websiteAnalysis
        )
      : [];
    const visualBrief =
      payload.visualBrief ||
      (shouldUseProductImages
        ? "Use the available product references as the hero product visual in a polished social ad. Preserve product shape, color, material, finish, and packaging cues."
        : "Create a polished campaign visual for this social ad.");
    const visualBriefWithTemplate = [
      visualBrief,
      templateBrief
        ? `Final template/layout direction: ${templateBrief}. Leave copy space and visual balance for that template.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const visual =
      shouldGenerateVisual
        ? await callAdVisualImage({
            projectId: args.projectId,
            type: payload.type,
            profile,
            tokens,
            brandKit,
            visualBrief: visualBriefWithTemplate,
            copy: content,
            productImages: shouldUseProductImages ? productImages : undefined,
          })
        : null;
    const { svg, width, height } = await renderCollateral(payload.type, tokens, content, {
      visualImageDataUrl: visual?.dataUrl,
      useTemplateFrame: payload.useTemplates,
    });
    const generatedRunMeta =
      isSocial && !payload.generationRunId
        ? fallbackAdRunMeta(payload.useTemplates)
        : null;
    const asset = DesignAssetSchema.parse({
      id: assetId(payload.type, content.brandName),
      type: payload.type,
      title: `${COLLATERAL_LABELS[payload.type]} — ${content.brandName}`,
      format: "svg",
      svg,
      width,
      height,
      content,
      ...(visualBriefWithTemplate ? { visualBrief: visualBriefWithTemplate } : {}),
      ...(templateBrief ? { templateBrief } : {}),
      ...(payload.generationRunId || generatedRunMeta
        ? {
            generationRunId:
              payload.generationRunId || generatedRunMeta?.generationRunId,
          }
        : {}),
      ...(payload.generationRunLabel || generatedRunMeta
        ? {
            generationRunLabel:
              payload.generationRunLabel || generatedRunMeta?.generationRunLabel,
          }
        : {}),
      ...(payload.generationRunCreatedAt || generatedRunMeta
        ? {
            generationRunCreatedAt:
              payload.generationRunCreatedAt ||
              generatedRunMeta?.generationRunCreatedAt,
          }
        : {}),
      ...(payload.generationRunStamp || generatedRunMeta
        ? {
            generationRunStamp:
              payload.generationRunStamp || generatedRunMeta?.generationRunStamp,
          }
        : {}),
      templateFrameEnabled: payload.useTemplates,
      ...(visual?.generationPrompt
        ? { generationPrompt: visual.generationPrompt }
        : {}),
      createdAt: new Date().toISOString(),
    });
    const studio = await saveDesignAsset(args.projectId, asset);
    return { asset, assets: studio.assets };
  }

  const payload = SitePayloadSchema.parse(args.payload ?? {});
  await appendJobProgress(args.jobId, {
    label: "Reading brand context",
    detail:
      "Loading the venture profile, design tokens, overview evidence, product photographs, and saved logo assets.",
    code: "const context = { profile, tokens, overviewEvidence, productImages, logo };",
    status: "running",
  });
  const websiteAnalysis = await resolveWebsiteAnalysis(
    args.projectId,
    project.websiteAnalysis,
    payload.sourceWebsiteUrl
  );
  await appendJobProgress(args.jobId, {
    label: websiteAnalysis ? "Overview evidence ready" : "Supplying brand info",
    detail: websiteAnalysis
      ? "Using the Overview section as source material for products, press, social links, prices, facts, and imagery."
      : "No overview evidence is saved, so GPT will build from the founder profile, brief, brand kit, and available references.",
    code: websiteAnalysis
      ? "source = compactWebsiteEvidence(project.websiteAnalysis);"
      : "source = { clientProfile, founderBrief, brandVoice, positioning };",
    status: "running",
  });
  const productImages = await loadProductImageInputs(
    args.projectId,
    profile.productImages,
    websiteAnalysis
  );
  await appendJobProgress(args.jobId, {
    label: "Preparing visual assets",
    detail: `Loaded ${productImages.length} product or overview image reference${
      productImages.length === 1 ? "" : "s"
    } for the website build.`,
    code: `const productImages = [${productImages
      .map((image) => `"${image.ref.name}"`)
      .join(", ")}];`,
    status: "running",
  });
  const websiteHeroVisual = await generateWebsiteHeroVisual({
    projectId: args.projectId,
    profile,
    tokens,
    brandKit,
    brief: payload.brief,
    productImages,
  });
  await appendJobProgress(args.jobId, {
    label: "Hero campaign visual generated",
    detail:
      "Created a website-scale campaign image so the first viewport is image-led rather than a generic text block.",
    code: "PRODUCT_IMAGE_1 = generatedHeroVisual.dataUrl;",
    status: "running",
  });
  const siteProductImages = [websiteHeroVisual, ...productImages].slice(0, 6);
  const brandName = websiteBrandName(profile, project.name, websiteAnalysis);
  const heroSubhead = websiteHeroSubhead(profile, project.name, websiteAnalysis);
  const logoSvg = websiteLogoSvg(project.ownerDashboard?.designStudio?.logos);
  await appendJobProgress(args.jobId, {
    label: "GPT 5.5 is coding the site",
    detail:
      "Generating a static website file tree. Richer brands can become multi-page sites instead of one landing page.",
    code:
      "return { files: ['index.html', 'products.html', 'story.html', ...], html: indexHtml };",
    status: "running",
  });
  const out = await callSiteGenerator(
    payload.sourceRunId,
    args.projectId,
    profile,
    tokens,
    brandKit,
    payload.brief,
    siteProductImages,
    websiteAnalysis,
    logoSvg ? { brandName, logoSvg } : null
  );
  const productImagePlaceholders = siteProductImages.map((image, index) => ({
    placeholder: `PRODUCT_IMAGE_${index + 1}`,
    name: image.ref.name,
    visualSummary: image.ref.visualSummary ?? "",
    availableForInlineEmbed: Boolean(image.dataUrl),
  }));
  const files = normalizeSiteFiles({
    out,
    productImages: siteProductImages,
    productImagePlaceholders,
    brandName,
    heroSubhead,
    logoSvg,
  });
  const html = files.find((file) => file.path === "index.html")?.content ?? files[0].content;
  if (!looksLikeHtmlDoc(html)) throw new Error("The generated site was malformed.");
  const createdAt = new Date();
  const stamp = istStamp(createdAt);
  const generationRunId = `site-run-${stamp}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  await appendJobProgress(args.jobId, {
    label: "Packaging static files",
    detail: `Prepared ${files.length} website file${
      files.length === 1 ? "" : "s"
    } for preview history and ZIP download.`,
    code: files.map((file) => `/${file.path}`).join("\n"),
    status: "running",
  });
  const site = SiteAssetSchema.parse({
    id: `site-${Date.now().toString(36)}`,
    title: out.title,
    brandName,
    html,
    files,
    deployUrl: null,
    generationRunId,
    generationRunLabel: `Website build · ${stamp.replace(/_/g, " ")}`,
    generationRunCreatedAt: createdAt.toISOString(),
    generationRunStamp: stamp,
    sourceWebsiteUrl: websiteAnalysis?.url ?? payload.sourceWebsiteUrl,
    brief: payload.brief,
    createdAt: createdAt.toISOString(),
  });
  const studio = await saveSiteAsset(args.projectId, site);
  await appendJobProgress(args.jobId, {
    label: "Saved to website history",
    detail:
      "The generation is now available in the timestamped history, file browser, preview, and client ZIP export.",
    code: `history.add("${site.generationRunStamp}", ${JSON.stringify(
      files.map((file) => file.path)
    )});`,
    status: "done",
  });
  return { site, sites: studio.sites };
}

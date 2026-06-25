import { z } from "zod";
import { createHash } from "crypto";
import { renderCollateral, COLLATERAL_LABELS } from "./collateral";
import { buildLogoVariants } from "./logo";
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
import { ensureProductImageryHtml, looksLikeHtmlDoc, sanitizeSiteHtml } from "./site";
import {
  fetchScrapedProductImage,
  readProductImageFile,
  scrapedProductImageCandidates,
} from "../productImages";
import type {
  BrandKit,
  ClientProfile,
  DesignTokens,
  ProductImageRef,
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

function stableId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
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
        payload.brief,
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
    const visual =
      shouldGenerateVisual
        ? await callAdVisualImage({
            projectId: args.projectId,
            type: payload.type,
            profile,
            tokens,
            brandKit,
            visualBrief,
            copy: content,
            productImages: shouldUseProductImages ? productImages : undefined,
          })
        : null;
    const { svg, width, height } = await renderCollateral(payload.type, tokens, content, {
      visualImageDataUrl: visual?.dataUrl,
      useTemplateFrame: payload.useTemplates,
    });
    const asset = DesignAssetSchema.parse({
      id: assetId(payload.type, content.brandName),
      type: payload.type,
      title: `${COLLATERAL_LABELS[payload.type]} — ${content.brandName}`,
      format: "svg",
      svg,
      width,
      height,
      content,
      ...(visualBrief ? { visualBrief } : {}),
      createdAt: new Date().toISOString(),
    });
    const studio = await saveDesignAsset(args.projectId, asset);
    return { asset, assets: studio.assets };
  }

  const payload = SitePayloadSchema.parse(args.payload ?? {});
  const websiteAnalysis = await resolveWebsiteAnalysis(
    args.projectId,
    project.websiteAnalysis,
    payload.sourceWebsiteUrl
  );
  const productImages = await loadProductImageInputs(
    args.projectId,
    profile.productImages,
    websiteAnalysis
  );
  const websiteHeroVisual = await generateWebsiteHeroVisual({
    projectId: args.projectId,
    profile,
    tokens,
    brandKit,
    brief: payload.brief,
    productImages,
  });
  const siteProductImages = [websiteHeroVisual, ...productImages].slice(0, 6);
  const out = await callSiteGenerator(
    payload.sourceRunId,
    args.projectId,
    profile,
    tokens,
    brandKit,
    payload.brief,
    siteProductImages,
    websiteAnalysis
  );
  const productImagePlaceholders = siteProductImages.map((image, index) => ({
    placeholder: `PRODUCT_IMAGE_${index + 1}`,
    name: image.ref.name,
    visualSummary: image.ref.visualSummary ?? "",
    availableForInlineEmbed: Boolean(image.dataUrl),
  }));
  const imageLedHtml = ensureProductImageryHtml(out.html, productImagePlaceholders, {
    brandName: profile.product || project.name,
    tagline:
      profile.productDetails?.differentiation ||
      profile.targetAudience ||
      profile.goal ||
      profile.ambitions ||
      profile.product ||
      project.name,
  });
  const html = sanitizeSiteHtml(
    replaceProductImagePlaceholders(imageLedHtml, siteProductImages)
  );
  if (!looksLikeHtmlDoc(html)) throw new Error("The generated site was malformed.");
  const site = SiteAssetSchema.parse({
    id: `site-${Date.now().toString(36)}`,
    title: out.title,
    brandName: profile.product || project.name,
    html,
    deployUrl: null,
    createdAt: new Date().toISOString(),
  });
  const studio = await saveSiteAsset(args.projectId, site);
  return { site, sites: studio.sites };
}

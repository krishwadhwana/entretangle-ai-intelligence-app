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
  callWebsiteImageCutout,
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
import { COLLATERAL_COPY_SYSTEM, collateralCopyUser } from "../prompts";
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
  WebsiteCollectedImage,
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
  socialPrompt: z
    .object({
      brief: z.string().trim().max(2000).default(""),
      visualBrief: z.string().trim().max(2000).default(""),
      templateBrief: z.string().trim().max(1000).default(""),
      useTemplates: z.boolean().default(false),
    })
    .optional(),
  content: CollateralContentSchema.optional(),
});

const SitePayloadSchema = BasePayloadSchema.extend({
  brief: z.string().trim().max(2000).default(""),
  removeImageBackgrounds: z.boolean().default(true),
  useCreativeAssets: z.boolean().default(true),
  includeCheckout: z.boolean().default(true),
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

type WebsiteLogoAsset = {
  logoSvg: string | null;
  logoImageDataUrl: string | null;
  sourceUrl?: string;
  sourceKind?: "standalone-logo" | "package-crop";
};

function logoImageCandidates(
  websiteAnalysis: WebsiteAnalysis | null
): WebsiteCollectedImage[] {
  const images = websiteAnalysis?.infoCollected?.productImages ?? [];
  return images.filter((image) => {
    const haystack = `${image.kind} ${image.alt ?? ""} ${image.caption ?? ""} ${
      image.url
    }`.toLowerCase();
    return image.kind === "logo" || /\b(logo|wordmark|brandmark)\b/.test(haystack);
  });
}

function logoMimeFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return null;
}

function imageDataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function packageLogoCropDataUrl(sourceDataUrl: string, brandName: string): string {
  const label = brandName.replace(/"/g, "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="190" viewBox="0 0 640 190" role="img" aria-label="${label} source wordmark"><defs><clipPath id="crop"><rect x="0" y="0" width="640" height="190" rx="12"/></clipPath></defs><g clip-path="url(#crop)"><image href="${sourceDataUrl}" x="-90" y="-215" width="820" height="820" preserveAspectRatio="xMidYMid slice"/></g></svg>`;
  return svgDataUrl(svg);
}

function packageLogoCandidates(
  websiteAnalysis: WebsiteAnalysis | null
): WebsiteCollectedImage[] {
  const info = websiteAnalysis?.infoCollected;
  if (!info) return [];
  const images: WebsiteCollectedImage[] = [
    ...info.productImages.filter((image) =>
      ["product", "lifestyle", "other"].includes(image.kind)
    ),
    ...info.products
      .filter((product) => product.imageUrl)
      .map((product) => ({
        url: product.imageUrl || "",
        alt: product.name,
        caption: product.description || product.priceText,
        sourceUrl: product.url,
        kind: "product" as const,
      })),
  ];
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!/^https?:\/\//i.test(image.url) || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

async function fetchImageCandidate(
  url: string,
  maxBytes = 2 * 1024 * 1024
): Promise<{ mimeType: string; buffer: Buffer } | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "image/svg+xml,image/png,image/jpeg,image/webp,image/gif,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
      logoMimeFromUrl(url) ||
      "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

async function fetchWebsiteLogoAsset(
  websiteAnalysis: WebsiteAnalysis | null,
  brandName: string
): Promise<WebsiteLogoAsset | null> {
  for (const image of logoImageCandidates(websiteAnalysis).slice(0, 4)) {
    if (!/^https?:\/\//i.test(image.url)) continue;
    const fetched = await fetchImageCandidate(image.url);
    if (!fetched) continue;
    const { mimeType, buffer } = fetched;
    if (mimeType === "image/svg+xml" || image.url.toLowerCase().includes(".svg")) {
      const logoSvg = sanitizeSvg(buffer.toString("utf8"));
      if (logoSvg) {
        return {
          logoSvg,
          logoImageDataUrl: null,
          sourceUrl: image.url,
          sourceKind: "standalone-logo",
        };
      }
      continue;
    }
    if (/^image\/(?:png|jpe?g|webp|gif)$/i.test(mimeType)) {
      return {
        logoSvg: null,
        logoImageDataUrl: imageDataUrl(mimeType, buffer),
        sourceUrl: image.url,
        sourceKind: "standalone-logo",
      };
    }
  }
  for (const image of packageLogoCandidates(websiteAnalysis).slice(0, 4)) {
    const fetched = await fetchImageCandidate(image.url, 4 * 1024 * 1024);
    if (!fetched || !/^image\/(?:png|jpe?g|webp)$/i.test(fetched.mimeType)) {
      continue;
    }
    return {
      logoSvg: null,
      logoImageDataUrl: packageLogoCropDataUrl(
        imageDataUrl(fetched.mimeType, fetched.buffer),
        brandName
      ),
      sourceUrl: image.url,
      sourceKind: "package-crop",
    };
  }
  return null;
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

// Looping announcement-bar phrases, inferred from the Overview/profile. We
// surface a real discount/offer ONLY when one is present in the brief or
// evidence (never fabricate "10% off"); otherwise we loop grounded USP/benefit
// lines like "SULPHATE-FREE FORMULATION" or "SHOP <hero product>".
const PROMO_USP_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /sulphate[-\s]?free|sulfate[-\s]?free/i, label: "SULPHATE-FREE FORMULATION" },
  { re: /paraben[-\s]?free/i, label: "PARABEN-FREE" },
  { re: /cruelty[-\s]?free/i, label: "CRUELTY-FREE & KIND" },
  { re: /\bvegan\b/i, label: "100% VEGAN" },
  { re: /\borganic\b/i, label: "CERTIFIED ORGANIC INGREDIENTS" },
  { re: /\bnatural\b/i, label: "MADE WITH NATURAL INGREDIENTS" },
  { re: /hand[-\s]?made|handcrafted|small[-\s]?batch/i, label: "MADE IN SMALL BATCHES" },
  { re: /made in india/i, label: "MADE IN INDIA" },
  { re: /dermatolog/i, label: "DERMATOLOGICALLY TESTED" },
  { re: /gluten[-\s]?free/i, label: "GLUTEN-FREE" },
  { re: /\b(plastic[-\s]?free|recyclab|sustainab|eco[-\s]?friendly)\b/i, label: "SUSTAINABLE PACKAGING" },
];

function derivePromoMessages(
  profile: ClientProfile,
  websiteAnalysis: WebsiteAnalysis | null,
  brief: string
): string[] {
  const info = websiteAnalysis?.infoCollected;
  const haystack = [
    brief,
    profile.productDetails?.differentiation,
    profile.product,
    profile.category,
    ...(profile.productDetails?.heroProducts ?? []),
    ...((info?.products ?? []).flatMap((product) => [
      product.name,
      product.description,
      product.category,
    ])),
    ...((info?.facts ?? []).map((fact) => `${fact.label} ${fact.value}`)),
    ...((info?.priceRanges ?? []).map((range) => range.text)),
  ]
    .filter((value): value is string => Boolean(value))
    .join("  ");

  const messages: string[] = [];
  const push = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim().toUpperCase();
    if (clean.length > 2 && clean.length <= 46 && !messages.includes(clean)) {
      messages.push(clean);
    }
  };

  // 1. Real offers only (grounded in brief/evidence).
  const offerRe =
    /(flat\s+)?\d{1,2}\s*%\s*off[^.;|\n]{0,26}|free\s+(?:shipping|delivery)[^.;|\n]{0,18}|buy\s*\d\s*get\s*\d[^.;|\n]{0,14}/gi;
  for (const match of haystack.matchAll(offerRe)) push(match[0]);

  // 2. Grounded USP/benefit lines.
  for (const { re, label } of PROMO_USP_PATTERNS) {
    if (re.test(haystack)) push(label);
  }

  // 3. A "shop the hero product" nudge.
  const hero =
    profile.productDetails?.heroProducts?.[0] ||
    info?.products?.[0]?.name ||
    profile.product;
  if (hero) push(`SHOP ${hero}`);

  // 4. Safe non-fabricated fallback.
  if (!messages.length) {
    push("NEW ARRIVALS");
    if (profile.category) push(`${profile.category} MADE SIMPLE`);
    push("FREE SHIPPING ON FIRST ORDERS");
  }
  return messages.slice(0, 4);
}

// Does the brief/evidence call for a real multi-page site rather than one
// landing page? Checkout flows, explicit "multi-page" asks, or a brand with
// several products all imply it.
function wantsMultiPage(
  profile: ClientProfile,
  websiteAnalysis: WebsiteAnalysis | null,
  brief: string,
  includeCheckout: boolean
): boolean {
  if (includeCheckout) return true;
  const text = (brief || "").toLowerCase();
  if (
    /multi[-\s]?page|multiple pages|\bpages\b|several pages|sub[-\s]?pages|\bcheckout\b|\bcart\b|shop page|products page|about (?:us )?page|contact page|\bstorefront\b|\bstore\b/.test(
      text
    )
  ) {
    return true;
  }
  const products = websiteAnalysis?.infoCollected?.products?.length ?? 0;
  const heroes = profile.productDetails?.heroProducts?.length ?? 0;
  return products >= 2 || heroes >= 2;
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

function productImageUsage(ref: ProductImageRef): "product-reference" | "social-inspiration" {
  if (ref.usage === "social-inspiration") return "social-inspiration";
  if ((ref.tags ?? []).some((tag) => /social[-\s]?inspiration/i.test(tag))) {
    return "social-inspiration";
  }
  return "product-reference";
}

async function loadProductImageInputs(
  projectId: string,
  images: ProductImageRef[] | undefined,
  websiteAnalysis: WebsiteAnalysis | null = null,
  includeSocialInspiration = false
): Promise<ProductImageInput[]> {
  const localRefs = images ?? [];
  const productRefs = localRefs.filter(
    (ref) => productImageUsage(ref) === "product-reference"
  );
  const inspirationRefs = localRefs.filter(
    (ref) => productImageUsage(ref) === "social-inspiration"
  );
  const refs = [
    ...productRefs.slice(0, 6),
    ...(includeSocialInspiration ? inspirationRefs.slice(0, 4) : []),
  ].slice(0, 8);
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
  ].slice(0, 10);
}

function dataUrlMimeType(dataUrl: string): string {
  return dataUrl.match(/^data:([^;,]+)[;,]/)?.[1]?.toLowerCase() || "image/png";
}

function creativeImageInputs(
  assets: unknown[] | undefined,
  limit = 4
): ProductImageInput[] {
  const imageAssets = (assets ?? [])
    .filter((asset): asset is {
      id?: string;
      title?: string;
      type?: string;
      visualImageDataUrl?: string;
      visualBrief?: string;
      createdAt?: string;
      content?: { headline?: string; subhead?: string; body?: string[] };
    } => {
      if (!asset || typeof asset !== "object") return false;
      const value = asset as { type?: unknown; visualImageDataUrl?: unknown };
      return value.type === "ad" && typeof value.visualImageDataUrl === "string";
    })
    .slice(0, limit);

  return imageAssets.map((asset, index) => {
    const dataUrl = asset.visualImageDataUrl || "";
    const headline = asset.content?.headline || asset.title || "Saved ad creative";
    const summary = [
      "Saved Design Studio ad creative. Use this as campaign art direction, hero/editorial image material, or a section background.",
      asset.visualBrief,
      asset.content?.subhead,
      ...(asset.content?.body ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      ref: {
        id: `website-creative-${asset.id || index}`,
        name: headline,
        url: `#design-creative-${asset.id || index}`,
        mimeType: dataUrlMimeType(dataUrl),
        size: dataUrlByteSize(dataUrl),
        uploadedAt: asset.createdAt || new Date().toISOString(),
        visualSummary: summary,
        tags: ["creative", "ad", "campaign", "website-reference"],
        usage: "social-inspiration",
      },
      dataUrl,
    };
  });
}

function shouldCreateWebsiteCutout(image: ProductImageInput): boolean {
  if (!image.dataUrl && !image.buffer) return false;
  if (image.ref.usage === "social-inspiration") return false;
  const tags = (image.ref.tags ?? []).join(" ").toLowerCase();
  if (/\b(creative|hero|generated|social[-\s]?inspiration)\b/.test(tags)) {
    return false;
  }
  if (/image\/gif|image\/svg/i.test(image.ref.mimeType)) return false;
  return true;
}

async function createWebsiteProductCutouts(args: {
  projectId: string;
  brandName: string;
  productImages: ProductImageInput[];
}): Promise<ProductImageInput[]> {
  const candidates = args.productImages.filter(shouldCreateWebsiteCutout).slice(0, 4);
  const cutouts = await Promise.all(
    candidates.map(async (image): Promise<ProductImageInput | null> => {
      try {
        const result = await callWebsiteImageCutout({
          projectId: args.projectId,
          image,
          brandName: args.brandName,
        });
        return {
          ref: {
            ...image.ref,
            id: `${image.ref.id}-cutout`,
            name: `${image.ref.name} cutout`,
            url: `#transparent-cutout-${image.ref.id}`,
            mimeType: "image/png",
            size: dataUrlByteSize(result.dataUrl),
            visualSummary: [
              image.ref.visualSummary,
              "Transparent-background product cutout for website product cards, shopping grids, checkout summaries, and layered ecommerce layouts.",
            ]
              .filter(Boolean)
              .join(" "),
            tags: Array.from(
              new Set([
                ...(image.ref.tags ?? []),
                "transparent-cutout",
                "background-removed",
                "product-card",
              ])
            ),
          },
          dataUrl: result.dataUrl,
        };
      } catch (error) {
        console.warn("[design-site] background removal failed", error);
        return null;
      }
    })
  );
  return cutouts.filter((image): image is ProductImageInput => Boolean(image));
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

function escapeSiteText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleCaseFromPath(path: string): string {
  return path
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function commerceProductRows(
  images: {
    placeholder: string;
    name: string;
    visualSummary?: string | null;
    availableForInlineEmbed?: boolean;
  }[]
): string {
  const usable = images
    .filter((image) => image.availableForInlineEmbed !== false)
    .slice(0, 4);
  const rows = usable.length
    ? usable
    : [{ placeholder: "", name: "Hero product", visualSummary: "" }];
  return rows
    .map(
      (image, index) => `<article class="commerce-item">
        ${
          image.placeholder
            ? `<img src="${image.placeholder}" alt="${escapeSiteText(image.name)}">`
            : `<div class="commerce-fallback" aria-hidden="true"></div>`
        }
        <div>
          <h2>${escapeSiteText(image.name || `Product ${index + 1}`)}</h2>
          <p>${escapeSiteText(
            image.visualSummary ||
              "Selected from the product range and ready for checkout."
          )}</p>
        </div>
        <strong>${index === 0 ? "Featured" : "Add to order"}</strong>
      </article>`
    )
    .join("");
}

function commercePageHtml(args: {
  brandName: string;
  title: string;
  kind: "cart" | "checkout";
  productImages: {
    placeholder: string;
    name: string;
    visualSummary?: string | null;
    availableForInlineEmbed?: boolean;
  }[];
}): string {
  const brand = escapeSiteText(args.brandName || "Brand");
  const isCheckout = args.kind === "checkout";
  const rows = commerceProductRows(args.productImages);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeSiteText(
    args.title
  )}</title><style>:root{--primary:#111;--secondary:#e8e0d4;--accent:#f4a037;--neutral-dark:#111;--neutral-light:#fffaf4;--heading-font:Georgia,serif;--body-font:Inter,Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--neutral-light);color:var(--neutral-dark);font-family:var(--body-font);line-height:1.45}a{color:inherit;text-decoration:none}.commerce-shell{min-height:100vh;padding:clamp(96px,12vw,150px) clamp(20px,6vw,84px) clamp(48px,7vw,84px)}.commerce-kicker{margin:0 0 12px;font-size:12px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:color-mix(in srgb,var(--neutral-dark) 58%,transparent)}h1{max-width:10ch;margin:0;font-family:var(--heading-font);font-size:clamp(42px,7vw,92px);line-height:.95;letter-spacing:0}.commerce-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.42fr);gap:clamp(24px,5vw,64px);margin-top:clamp(36px,6vw,76px);align-items:start}.commerce-list{display:grid;gap:14px}.commerce-item{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:18px;align-items:center;border-top:1px solid color-mix(in srgb,var(--neutral-dark) 16%,transparent);padding:18px 0}.commerce-item img,.commerce-fallback{width:104px;aspect-ratio:4/5;object-fit:contain;background:rgba(255,255,255,.65)}.commerce-item h2{margin:0;font-family:var(--heading-font);font-size:clamp(20px,2.4vw,34px);line-height:1}.commerce-item p{margin:7px 0 0;max-width:58ch;color:color-mix(in srgb,var(--neutral-dark) 68%,transparent)}.commerce-item strong{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.commerce-panel{position:sticky;top:24px;border:1px solid color-mix(in srgb,var(--neutral-dark) 14%,transparent);background:rgba(255,255,255,.68);padding:22px}.commerce-panel h2{margin:0 0 16px;font-family:var(--heading-font);font-size:28px}.commerce-panel label{display:grid;gap:6px;margin-bottom:12px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:color-mix(in srgb,var(--neutral-dark) 62%,transparent)}.commerce-panel input,.commerce-panel select{min-height:44px;border:1px solid color-mix(in srgb,var(--neutral-dark) 18%,transparent);background:#fff;padding:0 12px;font:inherit}.commerce-panel button,.commerce-panel a.cta{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;margin-top:14px;border:0;background:var(--neutral-dark);color:var(--neutral-light);font-weight:900;letter-spacing:.03em}.commerce-total{display:flex;justify-content:space-between;border-top:1px solid color-mix(in srgb,var(--neutral-dark) 18%,transparent);padding-top:14px;margin-top:14px;font-weight:900}@media(max-width:820px){.commerce-grid{grid-template-columns:1fr}.commerce-panel{position:static}.commerce-item{grid-template-columns:82px minmax(0,1fr)}.commerce-item strong{grid-column:2}.commerce-item img,.commerce-fallback{width:82px}}</style></head><body><main class="commerce-shell"><p class="commerce-kicker">${brand}</p><h1>${
    isCheckout ? "Secure checkout" : "Shopping cart"
  }</h1><div class="commerce-grid"><section class="commerce-list" aria-label="Order items">${rows}</section><aside class="commerce-panel"><h2>${
    isCheckout ? "Order details" : "Cart summary"
  }</h2>${
    isCheckout
      ? `<form action="#"><label>Email<input type="email" placeholder="you@example.com"></label><label>Shipping name<input type="text" placeholder="Full name"></label><label>Address<input type="text" placeholder="Street, city"></label><label>Delivery<select><option>Standard delivery</option><option>Express delivery</option></select></label><div class="commerce-total"><span>Estimated total</span><span>Review</span></div><button type="submit">Place order</button></form>`
      : `<p>Review the selected products, then continue to checkout. This static export is ready for a developer to connect to a real cart or Shopify checkout.</p><div class="commerce-total"><span>Subtotal</span><span>Review</span></div><a class="cta" href="checkout.html">Continue to checkout</a>`
  }</aside></div></main></body></html>`;
}

function ensureCommerceFiles(args: {
  rawFiles: SiteFile[];
  brandName: string;
  productImagePlaceholders: {
    placeholder: string;
    name: string;
    visualSummary?: string | null;
    availableForInlineEmbed?: boolean;
  }[];
  includeCheckout: boolean;
}): SiteFile[] {
  if (!args.includeCheckout || !args.productImagePlaceholders.length) {
    return args.rawFiles;
  }
  const hasCart = args.rawFiles.some((file) => /(^|\/)cart\.html?$/i.test(file.path));
  const hasCheckout = args.rawFiles.some((file) =>
    /(^|\/)checkout\.html?$/i.test(file.path)
  );
  const additions: SiteFile[] = [];
  if (!hasCart) {
    additions.push({
      path: "cart.html",
      content: commercePageHtml({
        brandName: args.brandName,
        title: `${args.brandName} Cart`,
        kind: "cart",
        productImages: args.productImagePlaceholders,
      }),
      contentType: "text/html",
    });
  }
  if (!hasCheckout) {
    additions.push({
      path: "checkout.html",
      content: commercePageHtml({
        brandName: args.brandName,
        title: `${args.brandName} Checkout`,
        kind: "checkout",
        productImages: args.productImagePlaceholders,
      }),
      contentType: "text/html",
    });
  }
  return [...args.rawFiles, ...additions];
}

type SitePlaceholder = {
  placeholder: string;
  name: string;
  visualSummary?: string | null;
  availableForInlineEmbed?: boolean;
};

// Shared shell for server-synthesized inner pages. Inline tokens match the
// generated palette closely enough; the polish pass then layers the real
// header, promo bar, fonts, and animations so every page reads as one brand.
function editorialPageShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeSiteText(
    title
  )}</title><style>:root{--primary:#101010;--secondary:#e8e0d4;--accent:#f4a037;--neutral-dark:#101010;--neutral-light:#fffaf4;--heading-font:Georgia,serif;--body-font:Inter,Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--neutral-light);color:var(--neutral-dark);font-family:var(--body-font);line-height:1.5}a{color:inherit;text-decoration:none}img{max-width:100%}.et-page{padding:clamp(118px,15vw,180px) clamp(20px,6vw,84px) clamp(56px,8vw,96px);max-width:1180px;margin:0 auto}.et-page__kicker{margin:0 0 12px;font-size:12px;font-weight:850;letter-spacing:.14em;text-transform:uppercase;color:color-mix(in srgb,var(--neutral-dark) 56%,transparent)}.et-page h1{margin:0;font-family:var(--heading-font);font-size:clamp(40px,6vw,84px);line-height:.98;max-width:16ch;letter-spacing:0}.et-page__lead{max-width:60ch;margin:20px 0 0;font-size:clamp(17px,1.8vw,21px);line-height:1.55;color:color-mix(in srgb,var(--neutral-dark) 80%,transparent)}.et-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:18px;margin-top:clamp(36px,5vw,64px)}.et-card{display:flex;flex-direction:column;border:1px solid color-mix(in srgb,var(--neutral-dark) 12%,transparent);background:#fff;overflow:hidden}.et-card>img{width:100%;aspect-ratio:4/5;object-fit:contain;background:color-mix(in srgb,var(--neutral-light) 82%,#fff);padding:16px}.et-card__body{display:flex;flex-direction:column;flex:1;padding:16px 18px 20px}.et-card h2{margin:0;font-family:var(--heading-font);font-size:21px;line-height:1.08}.et-card p{margin:8px 0 0;font-size:14px;color:color-mix(in srgb,var(--neutral-dark) 66%,transparent)}.et-card__price{margin-top:12px;font-weight:850;letter-spacing:.02em}.et-card .cta{margin-top:auto;display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:16px;background:var(--neutral-dark);color:var(--neutral-light);font-weight:800;letter-spacing:.04em}.et-prose{max-width:64ch;margin-top:clamp(28px,4vw,48px);font-size:17px;line-height:1.72}.et-prose p{margin:0 0 18px}.et-form{display:grid;gap:12px;max-width:460px;margin-top:30px}.et-form label{display:grid;gap:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:color-mix(in srgb,var(--neutral-dark) 60%,transparent)}.et-form input,.et-form textarea{border:1px solid color-mix(in srgb,var(--neutral-dark) 18%,transparent);background:#fff;padding:12px;font:inherit}.et-form input{min-height:46px}.et-form button{min-height:50px;border:0;background:var(--neutral-dark);color:var(--neutral-light);font-weight:900;letter-spacing:.04em}.et-links{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}.et-links a{border:1px solid color-mix(in srgb,var(--neutral-dark) 18%,transparent);padding:11px 16px;font-weight:700;font-size:14px}@media(max-width:680px){.et-grid{grid-template-columns:1fr 1fr;gap:12px}}</style></head><body><main class="et-page">${bodyHtml}</main></body></html>`;
}

function productCardsFromEvidence(
  placeholders: SitePlaceholder[],
  websiteAnalysis: WebsiteAnalysis | null
): string {
  // Skip the first placeholder (the generated full-bleed hero) for the grid.
  const imgs = placeholders.filter((image) => image.availableForInlineEmbed).slice(1);
  const products = (websiteAnalysis?.infoCollected?.products ?? []).slice(0, 8);
  type Card = { name: string; desc: string; price: string; img: string };
  const cards: Card[] = products.length
    ? products.map((product, index) => ({
        name: product.name,
        desc: product.description || product.category || "",
        price: product.priceText || "",
        img: imgs.length ? imgs[index % imgs.length].placeholder : "",
      }))
    : imgs.map((image) => ({
        name: image.name,
        desc: image.visualSummary || "",
        price: "",
        img: image.placeholder,
      }));
  if (!cards.length) {
    cards.push({
      name: "The full range",
      desc: "Explore the products and pick the format that fits your routine.",
      price: "",
      img: "",
    });
  }
  return cards
    .slice(0, 9)
    .map(
      (card) => `<article class="et-card">${
        card.img
          ? `<img src="${card.img}" alt="${escapeSiteText(card.name)}">`
          : ""
      }<div class="et-card__body"><h2>${escapeSiteText(card.name)}</h2>${
        card.desc
          ? `<p>${escapeSiteText(card.desc.slice(0, 160))}</p>`
          : ""
      }${
        card.price ? `<div class="et-card__price">${escapeSiteText(card.price)}</div>` : ""
      }<a class="cta" href="cart.html">Add to cart</a></div></article>`
    )
    .join("");
}

function productsPageHtml(args: {
  brandName: string;
  heroSubhead: string;
  placeholders: SitePlaceholder[];
  websiteAnalysis: WebsiteAnalysis | null;
}): string {
  const body = `<p class="et-page__kicker">${escapeSiteText(args.brandName)}</p><h1>The range</h1><p class="et-page__lead">${escapeSiteText(
    args.heroSubhead || "Every product in the lineup, built for everyday use."
  )}</p><div class="et-grid">${productCardsFromEvidence(
    args.placeholders,
    args.websiteAnalysis
  )}</div>`;
  return editorialPageShell(`${args.brandName} — Products`, body);
}

function storyPageHtml(args: {
  brandName: string;
  profile: ClientProfile;
  websiteAnalysis: WebsiteAnalysis | null;
}): string {
  const details = args.profile.productDetails;
  const paragraphs = [
    details?.differentiation,
    args.profile.goal,
    args.profile.ambitions,
    args.profile.targetAudience
      ? `Made for ${args.profile.targetAudience}.`
      : "",
    ...(args.websiteAnalysis?.infoCollected?.facts ?? [])
      .filter((fact) => !/page inspected/i.test(fact.label))
      .slice(0, 3)
      .map((fact) => `${fact.label}: ${fact.value}`),
  ]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  if (!paragraphs.length) {
    paragraphs.push(
      `${args.brandName} is built around a simple idea: a product-led ritual that is easy to repeat and easy to love.`
    );
  }
  const prose = paragraphs
    .map((value) => `<p>${escapeSiteText(value)}</p>`)
    .join("");
  const body = `<p class="et-page__kicker">Our story</p><h1>Built around the product, not the noise.</h1><div class="et-prose">${prose}</div>`;
  return editorialPageShell(`${args.brandName} — Story`, body);
}

function contactPageHtml(args: {
  brandName: string;
  websiteAnalysis: WebsiteAnalysis | null;
}): string {
  const info = args.websiteAnalysis?.infoCollected;
  const links = [
    ...(info?.socialProfiles ?? []),
    ...(info?.marketplaceLinks ?? []),
  ].slice(0, 6);
  const linkHtml = links.length
    ? `<div class="et-links">${links
        .map(
          (link) =>
            `<a href="${escapeSiteText(link.url)}">${escapeSiteText(
              link.label || link.detail || "Visit"
            )}</a>`
        )
        .join("")}</div>`
    : "";
  const body = `<p class="et-page__kicker">${escapeSiteText(
    args.brandName
  )}</p><h1>Get in touch</h1><p class="et-page__lead">Questions about the products, stockists, or wholesale? Send a note and we'll get back to you.</p><form class="et-form" action="#"><label>Name<input type="text" placeholder="Your name"></label><label>Email<input type="email" placeholder="you@example.com"></label><label>Message<textarea rows="4" placeholder="How can we help?"></textarea></label><button type="submit">Send message</button></form>${linkHtml}`;
  return editorialPageShell(`${args.brandName} — Contact`, body);
}

// When the brief/evidence calls for a multi-page site but the model returned a
// single landing page, synthesize the missing core pages from evidence so the
// result is a real site (and the nav has somewhere to go), not one long page.
function ensureCorePages(args: {
  rawFiles: SiteFile[];
  multiPage: boolean;
  brandName: string;
  heroSubhead: string;
  profile: ClientProfile;
  websiteAnalysis: WebsiteAnalysis | null;
  productImagePlaceholders: SitePlaceholder[];
}): SiteFile[] {
  if (!args.multiPage) return args.rawFiles;
  const contentPages = args.rawFiles.filter(
    (file) =>
      isHtmlSiteFile(file) &&
      !/(^|\/)(cart|checkout)\.html?$/i.test(file.path)
  );
  // The model already produced a genuine multi-page site — leave it alone.
  if (contentPages.length >= 3) return args.rawFiles;
  const has = (re: RegExp) => args.rawFiles.some((file) => re.test(file.path));
  const additions: SiteFile[] = [];
  if (!has(/(^|\/)(products|shop|collection)s?\.html?$/i)) {
    additions.push({
      path: "products.html",
      content: productsPageHtml({
        brandName: args.brandName,
        heroSubhead: args.heroSubhead,
        placeholders: args.productImagePlaceholders,
        websiteAnalysis: args.websiteAnalysis,
      }),
      contentType: "text/html",
    });
  }
  if (!has(/(^|\/)(story|about)\.html?$/i)) {
    additions.push({
      path: "story.html",
      content: storyPageHtml({
        brandName: args.brandName,
        profile: args.profile,
        websiteAnalysis: args.websiteAnalysis,
      }),
      contentType: "text/html",
    });
  }
  if (!has(/(^|\/)contact\.html?$/i)) {
    additions.push({
      path: "contact.html",
      content: contactPageHtml({
        brandName: args.brandName,
        websiteAnalysis: args.websiteAnalysis,
      }),
      contentType: "text/html",
    });
  }
  return [...args.rawFiles, ...additions];
}

function siteNavLinks(files: Pick<SiteFile, "path">[]): { label: string; href: string }[] {
  const paths = files.map((file) => file.path);
  const links: { label: string; href: string }[] = [{ label: "Home", href: "index.html" }];
  const preferred = [
    "products.html",
    "shop.html",
    "story.html",
    "about.html",
    "contact.html",
    "cart.html",
    "checkout.html",
    "journal.html",
    "press.html",
  ];
  for (const path of preferred) {
    if (paths.includes(path) && !links.some((link) => link.href === path)) {
      links.push({ label: titleCaseFromPath(path), href: path });
    }
  }
  if (links.length === 1) {
    return [
      { label: "Ritual", href: "#ritual" },
      { label: "Products", href: "#products" },
      { label: "Join", href: "#join" },
      { label: "Shop", href: "#shop" },
    ];
  }
  const limited = links.slice(0, 5);
  if (
    paths.includes("checkout.html") &&
    !limited.some((link) => link.href === "checkout.html")
  ) {
    return [...limited.slice(0, 4), { label: "Checkout", href: "checkout.html" }];
  }
  return limited;
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
  logoImageDataUrl: string | null;
  headingFamily: string | null;
  bodyFamily: string | null;
  includeCheckout: boolean;
  multiPage: boolean;
  profile: ClientProfile;
  websiteAnalysis: WebsiteAnalysis | null;
  promoMessages: string[];
}): SiteFile[] {
  let rawFiles = args.out.files.map((file, index) => ({
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
  rawFiles = ensureCommerceFiles({
    rawFiles,
    brandName: args.brandName,
    productImagePlaceholders: args.productImagePlaceholders,
    includeCheckout: args.includeCheckout,
  });
  rawFiles = ensureCorePages({
    rawFiles,
    multiPage: args.multiPage,
    brandName: args.brandName,
    heroSubhead: args.heroSubhead,
    profile: args.profile,
    websiteAnalysis: args.websiteAnalysis,
    productImagePlaceholders: args.productImagePlaceholders,
  });

  const used = new Set<string>();
  const navLinks = siteNavLinks(rawFiles);
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
          logoImageDataUrl: args.logoImageDataUrl,
          heroSubhead: args.heroSubhead,
          headingFamily: args.headingFamily,
          bodyFamily: args.bodyFamily,
          navLinks,
          promoMessages: args.promoMessages,
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

const SECTION_VISUAL_BRIEFS: { tag: string; brief: string }[] = [
  {
    tag: "lifestyle",
    brief:
      "Lifestyle/context campaign image for a website proof or story band: the product in a real everyday setting, natural light, editorial composition, generous clean negative space, no readable text, captions, logos, or UI.",
  },
  {
    tag: "detail",
    brief:
      "Macro detail / ingredient-texture campaign image for a website feature block: an extreme close-up of the product material, texture, or key ingredient, premium studio lighting, clean negative space, no readable text, captions, logos, or UI.",
  },
];

// Generate a small, bounded set of extra website section graphics — the same
// image pipeline the social/collateral generator uses — to fill the gap when
// the brand has few saved ad creatives. Cost-aware: only `count` images.
async function generateSupportingWebsiteVisuals(args: {
  projectId: string;
  profile: ClientProfile;
  tokens: DesignTokens;
  brandKit: BrandKit | null;
  brief: string;
  productImages: ProductImageInput[];
  count: number;
}): Promise<ProductImageInput[]> {
  const briefs = SECTION_VISUAL_BRIEFS.slice(0, Math.max(0, args.count));
  if (!briefs.length) return [];
  const productName = args.profile.product || args.profile.category || "brand";
  const results = await Promise.all(
    briefs.map(async (variant, index): Promise<ProductImageInput | null> => {
      try {
        const visual = await callAdVisualImage({
          projectId: args.projectId,
          type: "ad",
          profile: args.profile,
          tokens: args.tokens,
          brandKit: args.brandKit,
          visualBrief: [
            variant.brief,
            args.brief ? `Founder website brief: ${args.brief}` : "",
          ]
            .filter(Boolean)
            .join(" "),
          copy: {
            brandName: productName,
            tagline: args.profile.goal || args.profile.ambitions || "",
            headline: productName,
            subhead: args.profile.targetAudience || args.profile.priceBand || "",
            body: [],
            cta: "",
            contact: { name: "", role: "", email: "", phone: "", website: "" },
          },
          productImages: args.productImages,
          surface: "website",
        });
        return {
          ref: {
            id: `website-section-${variant.tag}-${Date.now().toString(36)}-${index}`,
            name: `Generated ${variant.tag} website visual`,
            url: `#generated-website-${variant.tag}`,
            mimeType: "image/png",
            size: dataUrlByteSize(visual.dataUrl),
            uploadedAt: new Date().toISOString(),
            visualSummary: `Generated ${variant.tag} campaign visual for website proof bands, feature blocks, or section backgrounds. Editorial campaign imagery, not a SKU packshot.`,
            tags: [
              "generated",
              "website",
              "section",
              variant.tag,
              "creative",
              "website-reference",
            ],
            usage: "social-inspiration",
          },
          dataUrl: visual.dataUrl,
        };
      } catch (error) {
        console.warn("[design-site] supporting visual failed", error);
        return null;
      }
    })
  );
  return results.filter((image): image is ProductImageInput => Boolean(image));
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
    const copyBrief = [
      payload.brief,
      templateBrief ? `Template direction: ${templateBrief}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const collateralPrompt = {
      system: COLLATERAL_COPY_SYSTEM,
      user: collateralCopyUser(
        payload.type,
        profile,
        brandKit,
        copyBrief,
        websiteAnalysis
      ),
      brief: copyBrief,
    };
    const content =
      payload.content ??
      (await callCollateralCopy(
        payload.sourceRunId,
        args.projectId,
        payload.type,
        profile,
        brandKit,
        copyBrief,
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
          websiteAnalysis,
          isSocial
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
    const socialPrompt =
      isSocial
        ? payload.socialPrompt ?? {
            brief: payload.brief,
            visualBrief: payload.visualBrief,
            templateBrief,
            useTemplates: payload.useTemplates,
          }
        : undefined;
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
      ...(visual?.dataUrl ? { visualImageDataUrl: visual.dataUrl } : {}),
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
      ...(socialPrompt ? { socialPrompt } : {}),
      ...(visual?.generationPrompt
        ? { generationPrompt: visual.generationPrompt }
        : {}),
      collateralPrompt,
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
  // Prefer reusing graphics the social/collateral generator already produced;
  // we only generate extra section visuals to fill the gap (max 2).
  const savedCreatives = payload.useCreativeAssets
    ? creativeImageInputs(project.ownerDashboard?.designStudio?.assets, 4)
    : [];
  await appendJobProgress(args.jobId, {
    label: "Preparing visual assets",
    detail: `Loaded ${productImages.length} product/overview reference${
      productImages.length === 1 ? "" : "s"
    } and ${savedCreatives.length} saved ad creative${
      savedCreatives.length === 1 ? "" : "s"
    } for the website build.`,
    code: `const websiteImages = [${[...productImages, ...savedCreatives]
      .map((image) => `"${image.ref.name}"`)
      .join(", ")}];`,
    status: "running",
  });
  const visualReferences = [...productImages, ...savedCreatives];
  const websiteHeroVisual = await generateWebsiteHeroVisual({
    projectId: args.projectId,
    profile,
    tokens,
    brandKit,
    brief: payload.brief,
    productImages: visualReferences,
  });
  await appendJobProgress(args.jobId, {
    label: "Hero campaign visual generated",
    detail:
      "Created a website-scale campaign image so the first viewport is image-led rather than a generic text block.",
    code: "PRODUCT_IMAGE_1 = generatedHeroVisual.dataUrl;",
    status: "running",
  });
  const supportingVisualCount = payload.useCreativeAssets
    ? Math.max(0, 2 - savedCreatives.length)
    : 0;
  const supportingVisuals = supportingVisualCount
    ? await generateSupportingWebsiteVisuals({
        projectId: args.projectId,
        profile,
        tokens,
        brandKit,
        brief: payload.brief,
        productImages: visualReferences,
        count: supportingVisualCount,
      })
    : [];
  const creativeImages = [...savedCreatives, ...supportingVisuals];
  if (payload.useCreativeAssets) {
    await appendJobProgress(args.jobId, {
      label: "Section graphics ready",
      detail: supportingVisuals.length
        ? `Reused ${savedCreatives.length} saved creative${
            savedCreatives.length === 1 ? "" : "s"
          } and generated ${supportingVisuals.length} extra section visual${
            supportingVisuals.length === 1 ? "" : "s"
          } (lifestyle/detail) for proof bands and feature blocks.`
        : `Reused ${savedCreatives.length} saved Design Studio creative${
            savedCreatives.length === 1 ? "" : "s"
          } as website section graphics; no extra generation needed.`,
      code: `const sectionGraphics = [...savedCreatives, ...generated].slice(0, 2 + saved);`,
      status: "running",
    });
  }
  const brandName = websiteBrandName(profile, project.name, websiteAnalysis);
  const cutoutImages = payload.removeImageBackgrounds
    ? await createWebsiteProductCutouts({
        projectId: args.projectId,
        brandName,
        productImages,
      })
    : [];
  if (payload.removeImageBackgrounds) {
    await appendJobProgress(args.jobId, {
      label: "Prepared product cutouts",
      detail: cutoutImages.length
        ? `Removed backgrounds from ${cutoutImages.length} product image${
            cutoutImages.length === 1 ? "" : "s"
          } so product cards, cart rows, and checkout summaries can sit cleanly on the site palette.`
        : "Tried product cutouts, but no background-removal result was needed or available; originals remain available.",
      code: `const cutouts = removeBackground(productImages).filter(Boolean);`,
      status: "running",
    });
  }
  // Order matters: the 10-image cap must not slice off the section graphics or
  // background-removed cutouts in favour of raw originals. Hero first (it is
  // PRODUCT_IMAGE_1), then clean cutouts, then the section/creative graphics,
  // then any remaining original photos.
  const siteProductImages = [
    websiteHeroVisual,
    ...cutoutImages.slice(0, 4),
    ...creativeImages.slice(0, 3),
    ...productImages,
  ].slice(0, 10);
  const heroSubhead = websiteHeroSubhead(profile, project.name, websiteAnalysis);
  const sourceLogo = await fetchWebsiteLogoAsset(websiteAnalysis, brandName);
  const generatedLogoSvg = websiteLogoSvg(project.ownerDashboard?.designStudio?.logos);
  // Logo priority: a real standalone logo pulled from Overview → the generated
  // Design Studio logo → a cropped source package mark (last resort) → a clean
  // text wordmark (handled downstream). The product-package crop was producing
  // the odd "cropped bottle" header, so it never beats a real/generated logo.
  let logoSvg: string | null = null;
  let logoImageDataUrl: string | null = null;
  let logoSourceUrl: string | undefined;
  let logoOrigin: "overview-standalone" | "generated" | "overview-package" | "wordmark" =
    "wordmark";
  if (sourceLogo?.sourceKind === "standalone-logo") {
    logoSvg = sourceLogo.logoSvg;
    logoImageDataUrl = sourceLogo.logoImageDataUrl;
    logoSourceUrl = sourceLogo.sourceUrl;
    logoOrigin = "overview-standalone";
  } else if (generatedLogoSvg) {
    logoSvg = generatedLogoSvg;
    logoOrigin = "generated";
  } else if (sourceLogo?.sourceKind === "package-crop") {
    logoImageDataUrl = sourceLogo.logoImageDataUrl;
    logoSourceUrl = sourceLogo.sourceUrl;
    logoOrigin = "overview-package";
  }
  await appendJobProgress(args.jobId, {
    label:
      logoOrigin === "overview-standalone"
        ? "Using the real logo from Overview"
        : logoOrigin === "generated"
          ? "Using the generated brand logo"
          : logoOrigin === "overview-package"
            ? "Using a cropped source package mark"
            : "Using a clean text wordmark",
    detail:
      logoOrigin === "overview-standalone"
        ? "Found and embedded the actual logo collected from Overview, so the website header uses the brand's real mark."
        : logoOrigin === "generated"
          ? "No standalone logo was collected from Overview, so the header uses the logo generated in Design Studio."
          : logoOrigin === "overview-package"
            ? "No standalone logo or generated logo was available, so the header uses a cropped source package wordmark as a last resort."
            : "No logo asset was available, so the header uses a clean text wordmark from the brand name.",
    code: `brandAssets.logoSource = "${logoSourceUrl ?? logoOrigin}";`,
    status: "running",
  });
  await appendJobProgress(args.jobId, {
    label: "GPT 5.5 is coding the site",
    detail:
      "Generating a static website file tree. Richer brands can become multi-page sites instead of one landing page.",
    code:
      "return { files: ['index.html', 'products.html', 'story.html', ...], html: indexHtml };",
    status: "running",
  });
  const promoMessages = derivePromoMessages(profile, websiteAnalysis, payload.brief);
  const multiPage = wantsMultiPage(
    profile,
    websiteAnalysis,
    payload.brief,
    payload.includeCheckout
  );
  const out = await callSiteGenerator(
    payload.sourceRunId,
    args.projectId,
    profile,
    tokens,
    brandKit,
    payload.brief,
    siteProductImages,
    websiteAnalysis,
    logoSvg || logoImageDataUrl
      ? {
          brandName,
          logoSvg: logoSvg ?? undefined,
          logoImageDataUrl: logoImageDataUrl ?? undefined,
          logoSourceUrl,
        }
      : null,
    { promoMessages, multiPage }
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
    logoImageDataUrl,
    headingFamily: tokens.typography.headingFamily,
    bodyFamily: tokens.typography.bodyFamily,
    includeCheckout: payload.includeCheckout,
    multiPage,
    profile,
    websiteAnalysis,
    promoMessages,
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

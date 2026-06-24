import { z } from "zod";
import { renderCollateral, COLLATERAL_LABELS } from "./collateral";
import { buildLogoVariants } from "./logo";
import {
  callAdVisualImage,
  callCollateralCopy,
  callDesignTokens,
  callLogoMarks,
  type ProductImageInput,
  callSiteGenerator,
} from "../llm";
import {
  CollateralContentSchema,
  CollateralTypeSchema,
  DesignAssetSchema,
  LogoAssetSchema,
  SiteAssetSchema,
} from "../schema";
import {
  getFounderStory,
  getProject,
  saveDesignAsset,
  saveDesignTokens,
  saveLogoAsset,
  saveSiteAsset,
} from "../store";
import { looksLikeHtmlDoc, sanitizeSiteHtml } from "./site";
import { readProductImageFile } from "../productImages";
import type { ProductImageRef } from "../schema";

const BasePayloadSchema = z.object({
  sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
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
  visualMode: z.enum(["layout", "ai", "product"]).default("layout"),
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
  return `${type}-${slug || "asset"}-${Date.now().toString(36)}`;
}

async function projectOrThrow(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("project not found");
  if (!project.ventureProfile) throw new Error("Finish the venture intake first.");
  return project;
}

async function loadProductImageInputs(
  projectId: string,
  images: ProductImageRef[] | undefined
): Promise<ProductImageInput[]> {
  const refs = (images ?? []).slice(0, 4);
  return Promise.all(
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

export async function runDesignStudioJob(args: {
  type: "design_tokens" | "design_logo" | "design_collateral" | "design_site";
  projectId: string;
  payload: unknown;
}): Promise<Record<string, unknown>> {
  const project = await projectOrThrow(args.projectId);
  const profile = project.ventureProfile;
  if (!profile) throw new Error("Finish the venture intake first.");
  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;
  const productImages = await loadProductImageInputs(
    args.projectId,
    profile.productImages
  );

  if (args.type === "design_tokens") {
    const payload = TokensPayloadSchema.parse(args.payload ?? {});
    const founderStory = await getFounderStory(args.projectId).catch(() => null);
    const tokens = await callDesignTokens(
      payload.sourceRunId,
      args.projectId,
      profile,
      brandKit,
      founderStory,
      [],
      payload.guidance
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
    const content =
      payload.content ??
      (await callCollateralCopy(
        payload.sourceRunId,
        args.projectId,
        payload.type,
        profile,
        brandKit,
        payload.brief
      ));
    const shouldGenerateVisual =
      payload.type !== "business-card" && payload.visualMode !== "layout";
    const visualBrief =
      payload.visualBrief ||
      (payload.visualMode === "product"
        ? "Use the uploaded product references as the hero product visual in a polished social ad. Preserve product shape, color, material, finish, and packaging cues."
        : "");
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
            productImages:
              payload.visualMode === "product" ? productImages : undefined,
          })
        : null;
    const { svg, width, height } = await renderCollateral(payload.type, tokens, content, {
      visualImageDataUrl: visual?.dataUrl,
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
  const out = await callSiteGenerator(
    payload.sourceRunId,
    args.projectId,
    profile,
    tokens,
    brandKit,
    payload.brief,
    productImages
  );
  const html = sanitizeSiteHtml(
    replaceProductImagePlaceholders(out.html, productImages)
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

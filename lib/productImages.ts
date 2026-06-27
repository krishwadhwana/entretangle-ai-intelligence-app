import { randomUUID } from "crypto";
import type { ProductImageRef, WebsiteAnalysis } from "./schema";
import { deleteObject, getObject, putObject } from "./storage";

export const MAX_PRODUCT_IMAGES = 12;
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
export const REMOTE_PRODUCT_IMAGE_TIMEOUT_MS = 8_000;

export type ScrapedProductImageCandidate = {
  url: string;
  name: string;
  visualSummary: string;
  tags: string[];
  sourcePageUrl?: string;
};

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeType;
}

function mimeFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return null;
}

export function productImageExtension(mimeType: string): string | null {
  return MIME_EXT[normalizeMimeType(mimeType)] ?? null;
}

export function isSupportedProductImageMime(mimeType: string): boolean {
  return productImageExtension(mimeType) !== null;
}

export function createProductImageId(): string {
  return randomUUID();
}

export function productImageUrl(projectId: string, imageId: string): string {
  return `/api/projects/${encodeURIComponent(
    projectId
  )}/product-images/${encodeURIComponent(imageId)}`;
}

// Object-storage key for a product image (S3/R2 key, or local-fallback path
// under data/uploads/). Slash-delimited so it maps cleanly onto both.
export function productImageStorageKey(
  projectId: string,
  imageId: string,
  mimeType: string
): string {
  const ext = productImageExtension(mimeType);
  if (!ext) throw new Error(`unsupported image type: ${mimeType}`);
  return `product-images/${projectId}/${imageId}.${ext}`;
}

export async function saveProductImageFile(
  projectId: string,
  imageId: string,
  mimeType: string,
  buffer: Buffer
): Promise<void> {
  await putObject(
    productImageStorageKey(projectId, imageId, mimeType),
    buffer,
    mimeType
  );
}

export async function readProductImageFile(
  projectId: string,
  image: ProductImageRef
): Promise<Buffer> {
  const stored = await getObject(
    productImageStorageKey(projectId, image.id, image.mimeType)
  );
  if (!stored) throw new Error("image file missing");
  return stored.body;
}

export async function deleteProductImageFile(
  projectId: string,
  image: ProductImageRef
): Promise<void> {
  await deleteObject(
    productImageStorageKey(projectId, image.id, image.mimeType)
  );
}

export function safeProductImageName(name: string): string {
  const clean = name.replace(/[^\w.\- ()]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 120) || "product image";
}

export function scrapedProductImageCandidates(
  analysis: WebsiteAnalysis | null,
  limit = 12
): ScrapedProductImageCandidate[] {
  const info = analysis?.infoCollected;
  if (!info) return [];

  const seen = new Set<string>();
  const candidates: ScrapedProductImageCandidate[] = [];
  const add = (entry: {
    url?: string;
    name: string;
    visualSummary: string;
    tags: (string | undefined)[];
    sourcePageUrl?: string;
  }) => {
    if (!entry.url || !/^https?:\/\//i.test(entry.url) || seen.has(entry.url)) {
      return;
    }
    seen.add(entry.url);
    candidates.push({
      url: entry.url,
      name: safeProductImageName(entry.name),
      visualSummary: entry.visualSummary,
      tags: entry.tags.filter(Boolean) as string[],
      sourcePageUrl: entry.sourcePageUrl,
    });
  };

  for (const image of info.productImages) {
    if (image.kind === "logo" || image.kind === "founder") continue;
    add({
      url: image.url,
      name: image.alt || image.caption || "scraped product image",
      visualSummary: `${image.caption || "Product image scraped from the analyzed website."}${
        image.sourceUrl ? ` Source: ${image.sourceUrl}.` : ""
      }`,
      tags: ["scraped", "website", image.kind],
      sourcePageUrl: image.sourceUrl,
    });
  }

  for (const product of info.products) {
    add({
      url: product.imageUrl,
      name: product.name,
      visualSummary: [
        product.description || "Product image from the analyzed website.",
        product.priceText ? `Observed price: ${product.priceText}.` : "",
        product.url ? `Source: ${product.url}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      tags: ["scraped", "product", product.category],
      sourcePageUrl: product.url,
    });
  }

  for (const listing of info.listingEvidence) {
    add({
      url: listing.imageUrl,
      name: listing.productName,
      visualSummary: `Listing image from ${listing.source || "source"}${
        listing.priceText ? ` with observed price ${listing.priceText}` : ""
      }. Source: ${listing.url}.`,
      tags: ["scraped", "listing", listing.sourceType],
      sourcePageUrl: listing.url,
    });
  }

  return candidates.slice(0, limit);
}

export async function fetchScrapedProductImage(
  candidate: ScrapedProductImageCandidate,
  timeoutMs = REMOTE_PRODUCT_IMAGE_TIMEOUT_MS
): Promise<{ buffer: Buffer; mimeType: string; dataUrl: string } | null> {
  try {
    const response = await fetch(candidate.url, {
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PRODUCT_IMAGE_BYTES) return null;

    const mimeType = normalizeMimeType(
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
        mimeFromUrl(candidate.url) ||
        ""
    );
    if (!isSupportedProductImageMime(mimeType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_PRODUCT_IMAGE_BYTES) return null;

    return {
      buffer,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

function normalizePublicOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function publicProductImageReferenceUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return null;

  const origin =
    normalizePublicOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizePublicOrigin(process.env.PUBLIC_APP_URL) ||
    normalizePublicOrigin(process.env.APP_URL) ||
    normalizePublicOrigin(process.env.VERCEL_URL) ||
    normalizePublicOrigin(process.env.RAILWAY_PUBLIC_DOMAIN);
  return origin ? new URL(url, origin).toString() : null;
}

import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { ProductImageRef } from "./schema";

export const MAX_PRODUCT_IMAGES = 12;
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function productImageExtension(mimeType: string): string | null {
  return MIME_EXT[mimeType] ?? null;
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

export function productImageStoragePath(
  projectId: string,
  imageId: string,
  mimeType: string
): string {
  const ext = productImageExtension(mimeType);
  if (!ext) throw new Error(`unsupported image type: ${mimeType}`);
  return path.join(
    process.cwd(),
    "data",
    "uploads",
    "product-images",
    projectId,
    `${imageId}.${ext}`
  );
}

export async function saveProductImageFile(
  projectId: string,
  imageId: string,
  mimeType: string,
  buffer: Buffer
): Promise<void> {
  const filePath = productImageStoragePath(projectId, imageId, mimeType);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function readProductImageFile(
  projectId: string,
  image: ProductImageRef
): Promise<Buffer> {
  return readFile(productImageStoragePath(projectId, image.id, image.mimeType));
}

export async function deleteProductImageFile(
  projectId: string,
  image: ProductImageRef
): Promise<void> {
  await rm(productImageStoragePath(projectId, image.id, image.mimeType), {
    force: true,
  });
}

export function safeProductImageName(name: string): string {
  const clean = name.replace(/[^\w.\- ()]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 120) || "product image";
}

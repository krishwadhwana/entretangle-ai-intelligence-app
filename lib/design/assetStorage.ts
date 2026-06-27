import { deleteObject, getObject, putObject } from "../storage";
import type { CustomFont, DesignAsset, SiteAsset, SiteFile } from "../schema";
import { assetImageUrl, assetSvgUrl, fontUrl, siteFileUrl } from "./assetUrls";

export { assetImageUrl, assetSvgUrl, fontUrl, siteFileUrl };

// ---------------------------------------------------------------------------
// Externalize heavy Design Studio bytes (rendered SVGs, generated site HTML/
// files, uploaded fonts, hero images) out of the owner_dashboard JSONB and into
// object storage. The JSONB keeps only small keys + serving URLs; the bytes
// live in R2 (or the local fallback). Write paths call the externalize*()
// helpers; serving routes resolve a key (with legacy inline fallback); the
// deploy path uses hydrateSiteFiles() to get the real bytes back.
// ---------------------------------------------------------------------------

const FONT_EXT: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  truetype: "ttf",
  opentype: "otf",
};

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type DecodedDataUrl = { buffer: Buffer; mimeType: string };

/** Decode a base64 data URL into bytes + mime type. Returns null if not one. */
export function decodeDataUrl(value: string | undefined): DecodedDataUrl | null {
  if (!value) return null;
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1] };
}

// --- key builders ----------------------------------------------------------

export function assetSvgKey(projectId: string, assetId: string): string {
  return `design-assets/${projectId}/${assetId}.svg`;
}

export function assetImageKey(
  projectId: string,
  assetId: string,
  mimeType: string,
): string {
  const ext = IMAGE_EXT[mimeType.toLowerCase()] ?? "png";
  return `design-assets/${projectId}/${assetId}.${ext}`;
}

export function siteFileKey(
  projectId: string,
  siteId: string,
  filePath: string,
): string {
  const clean = filePath.replace(/^\/+/, "") || "index.html";
  return `design-sites/${projectId}/${siteId}/${clean}`;
}

export function fontKey(
  projectId: string,
  fontId: string,
  format: string,
): string {
  const ext = FONT_EXT[format.toLowerCase()] ?? "bin";
  return `design-fonts/${projectId}/${fontId}.${ext}`;
}

// --- externalize on write --------------------------------------------------

/** Move a collateral asset's heavy bytes (svg, hero image) to storage. */
export async function externalizeDesignAsset(
  projectId: string,
  asset: DesignAsset,
): Promise<DesignAsset> {
  let next = asset;

  // Rendered SVG -> storage.
  if (next.svg && !next.svgKey) {
    const key = assetSvgKey(projectId, next.id);
    await putObject(key, Buffer.from(next.svg, "utf8"), "image/svg+xml");
    next = { ...next, svg: "", svgKey: key };
  }

  // Legacy inline hero image (base64 data URL) -> storage. New rows already
  // arrive with visualImageKey set + a serving URL in visualImageDataUrl.
  if (!next.visualImageKey) {
    const decoded = decodeDataUrl(next.visualImageDataUrl);
    if (decoded) {
      const key = assetImageKey(projectId, next.id, decoded.mimeType);
      await putObject(key, decoded.buffer, decoded.mimeType);
      next = {
        ...next,
        visualImageKey: key,
        visualImageDataUrl: assetImageUrl(projectId, next.id),
      };
    }
  }

  return next;
}

/** Move a site's html + each file's content to storage. */
export async function externalizeSiteAsset(
  projectId: string,
  site: SiteAsset,
): Promise<SiteAsset> {
  let html = site.html;
  let htmlKey = site.htmlKey;
  if (html && !htmlKey) {
    htmlKey = siteFileKey(projectId, site.id, "index.html");
    await putObject(htmlKey, Buffer.from(html, "utf8"), "text/html");
    html = "";
  }

  const files: SiteFile[] = [];
  for (const file of site.files) {
    if (file.content && !file.contentKey) {
      const key = siteFileKey(projectId, site.id, file.path);
      await putObject(
        key,
        Buffer.from(file.content, "utf8"),
        file.contentType || "text/html",
      );
      files.push({ ...file, content: "", contentKey: key });
    } else {
      files.push(file);
    }
  }

  return { ...site, html, htmlKey, files };
}

/** Move uploaded font bytes (base64 dataUrl) to storage. */
export async function externalizeFonts(
  projectId: string,
  fonts: CustomFont[],
): Promise<CustomFont[]> {
  const out: CustomFont[] = [];
  for (const font of fonts) {
    const decoded = !font.key ? decodeDataUrl(font.dataUrl) : null;
    if (decoded) {
      const key = fontKey(projectId, font.id, font.format);
      await putObject(key, decoded.buffer, decoded.mimeType || "font/woff2");
      out.push({ ...font, dataUrl: "", key, url: fontUrl(projectId, font.id) });
    } else {
      out.push(font);
    }
  }
  return out;
}

// --- resolve on read (serving routes) --------------------------------------

/** The SVG bytes for an asset: storage if externalized, else legacy inline. */
export async function resolveAssetSvg(
  asset: Pick<DesignAsset, "svg" | "svgKey">,
): Promise<string | null> {
  if (asset.svgKey) {
    const stored = await getObject(asset.svgKey);
    return stored ? stored.body.toString("utf8") : null;
  }
  return asset.svg || null;
}

/** A site file's text: storage if externalized, else legacy inline. */
export async function resolveSiteFile(
  site: SiteAsset,
  filePath: string,
): Promise<{ content: string; contentType: string } | null> {
  if (!filePath || filePath === "index.html") {
    if (site.htmlKey) {
      const stored = await getObject(site.htmlKey);
      return stored
        ? { content: stored.body.toString("utf8"), contentType: "text/html" }
        : null;
    }
    if (site.html) return { content: site.html, contentType: "text/html" };
  }
  const file = site.files.find((f) => f.path === filePath);
  if (!file) {
    // index.html may live only in files[]
    const index = site.files.find((f) => f.path === "index.html");
    if (filePath === "index.html" && index) {
      return resolveSiteFileEntry(index);
    }
    return null;
  }
  return resolveSiteFileEntry(file);
}

async function resolveSiteFileEntry(
  file: SiteFile,
): Promise<{ content: string; contentType: string } | null> {
  const contentType = file.contentType || "text/html";
  if (file.contentKey) {
    const stored = await getObject(file.contentKey);
    return stored
      ? { content: stored.body.toString("utf8"), contentType }
      : null;
  }
  return file.content ? { content: file.content, contentType } : null;
}

/** A custom font's bytes: storage if externalized, else legacy base64 dataUrl. */
export async function resolveFont(
  font: CustomFont,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (font.key) {
    const stored = await getObject(font.key);
    return stored
      ? { buffer: stored.body, contentType: font.mimeType || stored.contentType }
      : null;
  }
  const decoded = decodeDataUrl(font.dataUrl);
  return decoded
    ? { buffer: decoded.buffer, contentType: decoded.mimeType }
    : null;
}

/** Re-hydrate a site's html + file contents from storage (for deploy/zip). */
export async function hydrateSiteFiles(
  site: SiteAsset,
): Promise<{ html: string; files: SiteFile[] }> {
  const html = site.htmlKey
    ? (await getObject(site.htmlKey))?.body.toString("utf8") ?? ""
    : site.html;
  const files = await Promise.all(
    site.files.map(async (file) => {
      if (!file.contentKey) return file;
      const stored = await getObject(file.contentKey);
      return { ...file, content: stored?.body.toString("utf8") ?? "" };
    }),
  );
  return { html, files };
}

// --- cleanup on delete -----------------------------------------------------

export async function deleteDesignAssetObjects(
  asset: Pick<DesignAsset, "svgKey" | "visualImageKey">,
): Promise<void> {
  await Promise.allSettled([
    asset.svgKey ? deleteObject(asset.svgKey) : Promise.resolve(),
    asset.visualImageKey ? deleteObject(asset.visualImageKey) : Promise.resolve(),
  ]);
}

export async function deleteSiteObjects(site: SiteAsset): Promise<void> {
  const keys = [
    site.htmlKey,
    ...site.files.map((f) => f.contentKey),
  ].filter((k): k is string => Boolean(k));
  await Promise.allSettled(keys.map((k) => deleteObject(k)));
}

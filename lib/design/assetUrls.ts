// Same-origin serving URLs for externalized Design Studio assets. Pure string
// builders with no server-only imports, so both the client component and the
// server (assetStorage.ts) can use them without pulling the storage SDK into
// the browser bundle.

export function assetSvgUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/design/asset-svg/${encodeURIComponent(assetId)}`;
}

export function assetImageUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/design/asset-image/${encodeURIComponent(assetId)}`;
}

export function siteFileUrl(
  projectId: string,
  siteId: string,
  filePath = "index.html",
): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/design/site-file/${encodeURIComponent(siteId)}`;
  return filePath && filePath !== "index.html"
    ? `${base}?path=${encodeURIComponent(filePath)}`
    : base;
}

export function fontUrl(projectId: string, fontId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/design/font/${encodeURIComponent(fontId)}`;
}

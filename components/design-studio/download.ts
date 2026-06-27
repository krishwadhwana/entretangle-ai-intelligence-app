// Download / SVG-to-PNG / client-side ZIP helpers extracted from
// DesignStudioSection.tsx (behavior-preserving; pure browser utilities).
import type { DesignAsset, SiteAsset, SiteFile } from "@/lib/schema";

function istParts(date: Date): Record<string, string> {
  return Object.fromEntries(
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
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSvgString(svg: string, id: string) {
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${id}.svg`);
}

// Pull intrinsic pixel size from the SVG header so logo variants (which don't
// carry stored dimensions) still rasterize at the right resolution.
function svgDims(svg: string, fallback = 512): { width: number; height: number } {
  const w = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/);
  const h = svg.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/);
  return {
    width: w ? Math.round(Number(w[1])) : fallback,
    height: h ? Math.round(Number(h[1])) : fallback,
  };
}

// Rasterize a self-contained SVG to PNG fully client-side (glyphs are already
// vector paths, so no fonts are needed) — keeps the server free of native deps.
function downloadPngString(svg: string, width: number, height: number, id: string) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${id}.png`);
      }, "image/png");
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}


function dataUrlExtension(dataUrl: string): string {
  const mime = dataUrl.match(/^data:([^;,]+)[;,]/)?.[1]?.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "png";
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function downloadVisualImage(asset: DesignAsset) {
  if (!asset.visualImageDataUrl) return;
  // visualImageDataUrl is either a base64 data URL (legacy rows) or a
  // same-origin serving URL (image now lives in object storage). Both work as
  // an <a href> download; derive the extension from whichever form we have.
  const ext = asset.visualImageDataUrl.startsWith("data:")
    ? dataUrlExtension(asset.visualImageDataUrl)
    : asset.visualImageKey?.split(".").pop()?.toLowerCase() || "png";
  downloadDataUrl(
    asset.visualImageDataUrl,
    `${asset.id}-generated-image.${ext}`
  );
}

function downloadPromptAudit(asset: DesignAsset) {
  if (!asset.generationPrompt && !asset.collateralPrompt) return;
  downloadBlob(
    new Blob(
      [
        JSON.stringify(
          {
            id: asset.id,
            title: asset.title,
            type: asset.type,
            createdAt: asset.createdAt,
            visualBrief: asset.visualBrief,
            templateBrief: asset.templateBrief,
            content: asset.content,
            generationPrompt: asset.generationPrompt ?? null,
            collateralPrompt: asset.collateralPrompt ?? null,
          },
          null,
          2
        ),
      ],
      {
        type: "application/json",
      }
    ),
    `${asset.id}-prompts.json`
  );
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatGeneratedAtIst(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown IST time";
  const p = istParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} IST`;
}

function siteGenerationStamp(site: SiteAsset): string {
  if (site.generationRunStamp) return site.generationRunStamp;
  const date = new Date(site.createdAt);
  if (Number.isNaN(date.getTime())) return site.id;
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}_IST`;
}

function siteFolderName(site: SiteAsset): string {
  return `website-${siteGenerationStamp(site)}`;
}

function siteFiles(site: SiteAsset): SiteFile[] {
  return site.files?.length
    ? site.files
    : [{ path: "index.html", content: site.html, contentType: "text/html" }];
}

function siteDownloadName(site: SiteAsset): string {
  const stamp = site.createdAt.replace(/[:.]/g, "-").slice(0, 19);
  return `index-${stamp || site.id}.html`;
}

function siteFileDownloadName(site: SiteAsset, file: SiteFile): string {
  const clean = file.path.split("/").filter(Boolean).join("-");
  return `${siteFolderName(site)}-${clean || siteDownloadName(site)}`;
}

function siteZipDownloadName(site: SiteAsset): string {
  return `${siteFolderName(site)}.zip`;
}

function svgPreviewSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | (month << 5) | date.getDate(),
  };
}

function zipHeader(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function zipBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function makeZipBlob(files: SiteFile[], createdAt: string): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const created = new Date(createdAt);
  const stamp = zipDosDateTime(
    Number.isNaN(created.getTime()) ? new Date() : created
  );
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = zipHeader(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, stamp.time, true);
    local.view.setUint16(12, stamp.date, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    local.view.setUint16(28, 0, true);
    chunks.push(local.bytes, name, data);

    const centralHeader = zipHeader(46);
    centralHeader.view.setUint32(0, 0x02014b50, true);
    centralHeader.view.setUint16(4, 20, true);
    centralHeader.view.setUint16(6, 20, true);
    centralHeader.view.setUint16(8, 0x0800, true);
    centralHeader.view.setUint16(10, 0, true);
    centralHeader.view.setUint16(12, stamp.time, true);
    centralHeader.view.setUint16(14, stamp.date, true);
    centralHeader.view.setUint32(16, crc, true);
    centralHeader.view.setUint32(20, data.length, true);
    centralHeader.view.setUint32(24, data.length, true);
    centralHeader.view.setUint16(28, name.length, true);
    centralHeader.view.setUint16(30, 0, true);
    centralHeader.view.setUint16(32, 0, true);
    centralHeader.view.setUint16(34, 0, true);
    centralHeader.view.setUint16(36, 0, true);
    centralHeader.view.setUint32(38, 0, true);
    centralHeader.view.setUint32(42, offset, true);
    central.push(centralHeader.bytes, name);
    offset += local.bytes.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = zipHeader(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  end.view.setUint16(20, 0, true);
  return new Blob([...chunks, ...central, end.bytes].map(zipBlobPart), {
    type: "application/zip",
  });
}


export {
  istParts,
  downloadBlob,
  downloadSvgString,
  svgDims,
  downloadPngString,
  dataUrlExtension,
  downloadDataUrl,
  downloadVisualImage,
  downloadPromptAudit,
  formatGeneratedAt,
  formatGeneratedAtIst,
  siteGenerationStamp,
  siteFolderName,
  siteFiles,
  siteDownloadName,
  siteFileDownloadName,
  siteZipDownloadName,
  svgPreviewSrc,
  makeZipBlob,
};

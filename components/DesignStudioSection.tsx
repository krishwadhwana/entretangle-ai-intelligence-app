"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Archive,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  FileImage,
  FolderTree,
  Globe,
  Hexagon,
  Image as ImageIcon,
  Info,
  Link2,
  Loader2,
  Megaphone,
  Palette,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import type {
  CollateralType,
  CustomFont,
  DesignAsset,
  DesignStudioSection as DesignStudioState,
  DesignTokens,
  LogoAsset,
  SiteAsset,
  SiteFile,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";
import {
  customFontFaceCss,
  DESIGN_FONT_OPTIONS,
  familyFromFileName,
  fontCssStack,
  fontFaceFormat,
  googleFontUrlForFamilies,
  googleFontUrlForFamily,
} from "@/lib/design/fontLibrary";

// Max uploaded font size. Fonts ride inline (base64) in the tokens JSON, so keep
// them small enough to stay well under request/JSONB limits.
const MAX_CUSTOM_FONT_BYTES = 2 * 1024 * 1024;

const AD_TYPE: CollateralType = "ad";
const AD_CAMPAIGN_PACK_TYPE = "ad-campaign" as const;
type CollateralRunType = CollateralType | typeof AD_CAMPAIGN_PACK_TYPE;
type GenerationRunMeta = {
  generationRunId: string;
  generationRunLabel: string;
  generationRunCreatedAt: string;
  generationRunStamp: string;
};
type AdRunFolder = {
  id: string;
  label: string;
  createdAtMs: number;
  stamp?: string;
  templateFrameEnabled?: boolean;
  assets: DesignAsset[];
};

const AD_CAMPAIGN_VARIANTS = [
  {
    name: "Prospecting hook",
    angle:
      "lead with the sharpest new-customer problem, desire, or objection",
    productTarget: "shampoo or conditioner bottle",
    visuals: [
      "A model holding a shampoo bottle against her cheek, close-up, wet hair, front of bottle angled toward camera.",
      "A model pressing a conditioner bottle beside her jawline, close-up beauty pose, front mark visible.",
      "A model holding a body wash bottle near her shoulder, close-up editorial pose, front of bottle visible.",
    ],
    composition:
      "close-up lifestyle portrait, shallow depth of field, no ingredient props",
  },
  {
    name: "Offer test",
    angle:
      "turn the current launch offer, bundle, sample, or discount into a direct-response ad",
    productTarget: "body wash bottle",
    visuals: [
      "A model holding a body wash bottle at collarbone height, close-up, front label facing camera.",
      "A model with wet hair holding a body wash bottle beside her face, close-up, soft natural light.",
      "A model presenting a shower bottle near her neck in a minimal bathroom, close-up, front mark visible.",
    ],
    composition:
      "model-led offer pose, clean bathroom background, no fruit or shell props",
  },
  {
    name: "Proof retargeting",
    angle:
      "use product facts, source-site evidence, founder proof, or social proof for warm audiences",
    productTarget: "conditioner bottle",
    visuals: [
      "A model in a shower holding a conditioner bottle against her wet shoulder, macro close-up, front mark visible.",
      "A model holding a conditioner bottle beside her face, high-fashion beauty pose, shallow depth of field.",
      "A model clasping a conditioner bottle against her collarbone, close-up, dewy skin, front label visible.",
    ],
    composition:
      "macro model-and-product detail, wet texture, no ingredient props",
  },
  {
    name: "Routine reminder",
    angle:
      "make the product feel like a repeatable everyday ritual instead of a one-off purchase",
    productTarget: "body wash or shampoo bottle",
    visuals: [
      "A model wrapped in a towel holding a shower bottle near her face, close-up, front label toward camera.",
      "A model in soft morning bathroom light holding a shampoo bottle near her cheek, close-up, relaxed ritual pose.",
      "A model holding a body wash bottle beside her face after a shower, close-up, no foam covering the bottle.",
    ],
    composition:
      "model-led bathroom ritual portrait, no product-only still life",
  },
];

const FONT_PREVIEW_URL = googleFontUrlForFamilies(
  DESIGN_FONT_OPTIONS.map((font) => font.family)
);
const FONT_PREVIEW_CSS = FONT_PREVIEW_URL
  ? `@import url("${FONT_PREVIEW_URL}");`
  : "";

function seededIndex(seed: string, offset: number, length: number): number {
  if (length <= 1) return 0;
  let total = offset * 131;
  for (const char of seed) total += char.charCodeAt(0);
  return Math.abs(total) % length;
}

function campaignScenePrompt(
  variant: (typeof AD_CAMPAIGN_VARIANTS)[number],
  index: number,
  runId: string
): string {
  return variant.visuals[seededIndex(runId, index, variant.visuals.length)];
}

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

function createGenerationRunMeta(
  kind: "Campaign pack" | "Single creative",
  useTemplates: boolean
): GenerationRunMeta {
  const now = new Date();
  const p = istParts(now);
  const stamp = `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}_IST`;
  const suffix = Math.random().toString(36).slice(2, 7);
  return {
    generationRunId: `ad-run-${stamp}-${suffix}`,
    generationRunLabel: `${kind} · ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} IST · ${
      useTemplates ? "Template" : "No template"
    }`,
    generationRunCreatedAt: now.toISOString(),
    generationRunStamp: stamp,
  };
}

function buildAdRunFolders(adAssets: DesignAsset[]): AdRunFolder[] {
  const byId = new Map<string, AdRunFolder>();
  for (const asset of adAssets) {
    const id = asset.generationRunId || "legacy-ad-assets";
    const createdAt = Date.parse(asset.generationRunCreatedAt || asset.createdAt);
    const prior = byId.get(id);
    if (prior) {
      prior.assets.push(asset);
      prior.createdAtMs = Math.max(
        prior.createdAtMs,
        Number.isFinite(createdAt) ? createdAt : 0
      );
      if (asset.templateFrameEnabled !== undefined) {
        prior.templateFrameEnabled = asset.templateFrameEnabled;
      }
      continue;
    }
    byId.set(id, {
      id,
      label:
        asset.generationRunLabel ||
        "Previous assets · before run folders were added",
      createdAtMs: Number.isFinite(createdAt) ? createdAt : 0,
      stamp: asset.generationRunStamp,
      templateFrameEnabled: asset.templateFrameEnabled,
      assets: [asset],
    });
  }
  return [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function extractWebsiteUrl(value: string): string {
  const match = value.match(
    /(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s]*)?/i
  );
  return match ? match[0].replace(/[),.;\]]+$/g, "") : "";
}

type JobStatus = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string | null;
  result?: unknown;
};

type WebsiteImageRef = {
  url: string;
  name: string;
  kind: string;
  sourceUrl?: string;
  summary?: string;
};

type DesignJobProgressEntry = {
  at: string;
  label: string;
  detail?: string;
  code?: string;
  status?: "queued" | "running" | "done" | "failed";
};

// A readable text color (black/white) for a given hex background, so swatch
// labels stay legible without depending on the generated palette's contrast.
function readableOn(hex: string): string {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const int = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(int)) return "#000";
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}

function Swatch({ name, hex, usage }: { name: string; hex: string; usage?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <div
        className="flex h-16 items-end p-2"
        style={{ backgroundColor: hex, color: readableOn(hex) }}
      >
        <span className="text-[11px] font-semibold capitalize">{name}</span>
      </div>
      <div className="bg-white px-2 py-1.5">
        <p className="font-mono text-[11px] uppercase text-neutral-600">{hex}</p>
        {usage ? (
          <p className="mt-0.5 text-[10px] leading-snug text-neutral-400">{usage}</p>
        ) : null}
      </div>
    </div>
  );
}

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function listToCsv(value: string[] | undefined): string {
  return (value ?? []).join(", ");
}

async function readJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function jobProgressFromResult(result: unknown): DesignJobProgressEntry[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const progress = (result as { progress?: unknown }).progress;
  if (!Array.isArray(progress)) return [];
  return progress
    .map((entry): DesignJobProgressEntry | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const item = entry as Record<string, unknown>;
      if (typeof item.label !== "string") return null;
      return {
        at: typeof item.at === "string" ? item.at : new Date().toISOString(),
        label: item.label,
        detail: typeof item.detail === "string" ? item.detail : undefined,
        code: typeof item.code === "string" ? item.code : undefined,
        status:
          item.status === "queued" ||
          item.status === "running" ||
          item.status === "done" ||
          item.status === "failed"
            ? item.status
            : undefined,
      };
    })
    .filter((entry): entry is DesignJobProgressEntry => Boolean(entry));
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
      />
    </label>
  );
}

type FontPickerOption = {
  family: string;
  role: "heading" | "body";
  category: string;
  stack: string;
  custom?: boolean;
};

function fontOptionsForRole(
  role: "heading" | "body",
  current: string,
  customFonts: CustomFont[]
): FontPickerOption[] {
  const customOptions: FontPickerOption[] = customFonts.map((font) => ({
    family: font.family,
    role,
    category: "Uploaded font",
    stack: fontCssStack(font.family, role),
    custom: true,
  }));
  const customFamilies = new Set(
    customOptions.map((font) => font.family.toLowerCase())
  );
  const standard: FontPickerOption[] = DESIGN_FONT_OPTIONS.filter(
    (font) =>
      (font.role === role || font.role === "both") &&
      !customFamilies.has(font.family.toLowerCase())
  ).map((font) => ({
    family: font.family,
    role,
    category: font.category,
    stack: font.stack,
  }));
  const options = [...customOptions, ...standard];
  if (
    current.trim() &&
    !options.some(
      (font) => font.family.toLowerCase() === current.trim().toLowerCase()
    )
  ) {
    return [
      {
        family: current.trim(),
        role,
        category: "Current custom",
        stack: fontCssStack(current, role),
      },
      ...options,
    ];
  }
  return options;
}

function FontPicker({
  label,
  value,
  role,
  customFonts,
  onChange,
  onUpload,
  uploading,
}: {
  label: string;
  value: string;
  role: "heading" | "body";
  customFonts: CustomFont[];
  onChange: (value: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const fileInputId = `font-upload-${role}`;
  const options = fontOptionsForRole(role, value, customFonts);
  const current =
    options.find(
      (font) => font.family.toLowerCase() === value.trim().toLowerCase()
    ) ?? options[0];
  const stack = fontCssStack(current?.family || value, role);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((font) => font.family.toLowerCase().includes(q))
    : options;
  const exactMatch = options.some(
    (font) => font.family.toLowerCase() === q
  );

  const applyTyped = () => {
    const typed = query.trim();
    if (!typed) return;
    onChange(typed);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left outline-none transition-colors hover:border-indigo-300 focus:border-indigo-400"
      >
        <span className="min-w-0">
          <span
            className="block truncate text-[18px] leading-tight text-neutral-900"
            style={{ fontFamily: stack }}
          >
            {value || current?.family || "Select font"}
          </span>
          <span className="block truncate text-[10px] uppercase tracking-wide text-neutral-400">
            {current?.category || "Font"}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-neutral-200 bg-white p-1 shadow-xl">
          <div className="flex items-center gap-1.5 p-1">
            <input
              type="text"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyTyped();
                }
              }}
              placeholder="Type a font name…"
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-indigo-400"
            />
            <label
              htmlFor={fileInputId}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              title="Upload .woff2, .woff, .ttf or .otf"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload
            </label>
            <input
              id={fileInputId}
              type="file"
              accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
          </div>
          {query.trim() && !exactMatch ? (
            <button
              type="button"
              onClick={applyTyped}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-indigo-700 transition-colors hover:bg-indigo-50"
            >
              <Check className="h-3.5 w-3.5 shrink-0" />
              Use “{query.trim()}”
            </button>
          ) : null}
          <div className="max-h-72 overflow-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-neutral-400">
                No matching fonts.
              </p>
            ) : (
              filtered.map((font) => {
                const selected =
                  font.family.toLowerCase() === value.trim().toLowerCase();
                return (
                  <button
                    key={`${role}-${font.family}`}
                    type="button"
                    onClick={() => {
                      onChange(font.family);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      selected
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-neutral-800 hover:bg-neutral-50"
                    }`}
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-[20px] leading-tight"
                      style={{ fontFamily: font.stack }}
                    >
                      Fresh rituals
                    </span>
                    {font.custom ? (
                      <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-600">
                        Uploaded
                      </span>
                    ) : null}
                    <span className="w-24 shrink-0 truncate text-[11px] text-neutral-500">
                      {font.family}
                    </span>
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
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

function downloadSvg(asset: DesignAsset) {
  downloadSvgString(asset.svg, asset.id);
}

function downloadPng(asset: DesignAsset) {
  downloadPngString(asset.svg, asset.width, asset.height, asset.id);
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

function PipelineStep({
  label,
  info,
}: {
  label: string;
  info: string;
}) {
  return (
    <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700">
      <input
        type="checkbox"
        checked
        disabled
        readOnly
        aria-label={`${label} always enabled`}
        className="h-3.5 w-3.5 accent-neutral-900"
      />
      <span className="truncate">{label}</span>
      <span className="group relative ml-auto flex h-4 w-4 shrink-0 items-center justify-center text-neutral-400">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-64 rounded-md border border-neutral-200 bg-white p-2 text-[11px] font-normal leading-snug text-neutral-600 shadow-lg group-hover:block">
          {info}
        </span>
      </span>
    </span>
  );
}

function AssetCard({
  asset,
  onDelete,
}: {
  asset: DesignAsset;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-center bg-neutral-50 p-3">
        <img
          src={svgPreviewSrc(asset.svg)}
          alt={asset.title}
          className="h-auto max-w-full"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3 py-2">
        <p className="truncate text-[11px] text-neutral-500">{asset.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => downloadSvg(asset)}
            title="Download SVG (editable / Figma-ready)"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => downloadPng(asset)}
            title="Download PNG"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <FileImage className="h-3.5 w-3.5" />
          </button>
          {asset.visualImageDataUrl ? (
            <button
              onClick={() => downloadVisualImage(asset)}
              title="Download generated image"
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {asset.generationPrompt || asset.collateralPrompt ? (
            <button
              onClick={() => downloadPromptAudit(asset)}
              title="Download generation and collateral prompts"
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <Type className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            onClick={() => onDelete(asset.id)}
            title="Delete"
            className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneratedAssetSection({
  type,
  label,
  assets,
  makingType,
  onGenerate,
  onDelete,
}: {
  type: CollateralType;
  label: string;
  assets: DesignAsset[];
  makingType: CollateralRunType | null;
  onGenerate: (type: CollateralType) => void;
  onDelete: (id: string) => void;
}) {
  const busy = makingType !== null;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <FileImage className="h-3.5 w-3.5" /> {label}
        </p>
        <button
          onClick={() => onGenerate(type)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
        >
          {makingType === type ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {assets.length ? `Regenerate ${label.toLowerCase()}` : `Generate ${label.toLowerCase()}`}
        </button>
      </div>
      {assets.length ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-neutral-400">
          No {label.toLowerCase()} generated yet.
        </p>
      )}
    </section>
  );
}

function LogoCard({
  logo,
  onDelete,
}: {
  logo: LogoAsset;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[11px] leading-snug text-neutral-500">{logo.concept}</p>
        <button
          onClick={() => onDelete(logo.id)}
          title="Delete logo"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {logo.variants.map((v) => {
          const dims = svgDims(v.svg);
          return (
            <div
              key={v.id}
              className="flex flex-col rounded-lg border border-neutral-100 bg-neutral-50"
            >
              <div
                className="flex h-24 items-center justify-center p-2"
                dangerouslySetInnerHTML={{
                  __html: v.svg.replace(
                    "<svg ",
                    '<svg style="max-width:100%;max-height:100%;height:auto;" '
                  ),
                }}
              />
              <div className="flex items-center justify-between gap-1 border-t border-neutral-100 px-2 py-1">
                <span className="truncate text-[10px] text-neutral-500">
                  {v.label}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => downloadSvgString(v.svg, v.id)}
                    title="Download SVG"
                    className="rounded p-0.5 text-neutral-400 hover:text-neutral-700"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() =>
                      downloadPngString(v.svg, dims.width, dims.height, v.id)
                    }
                    title="Download PNG"
                    className="rounded p-0.5 text-neutral-400 hover:text-neutral-700"
                  >
                    <FileImage className="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function downloadHtml(site: SiteAsset, file?: SiteFile) {
  const target = file ?? siteFiles(site)[0];
  downloadBlob(
    new Blob([target.content], { type: target.contentType || "text/html" }),
    file ? siteFileDownloadName(site, file) : siteDownloadName(site)
  );
}

function downloadSiteZip(site: SiteAsset) {
  downloadBlob(makeZipBlob(siteFiles(site), site.createdAt), siteZipDownloadName(site));
}

function openHtmlPreview(site: SiteAsset, file?: SiteFile) {
  const target = file ?? siteFiles(site)[0];
  const url = URL.createObjectURL(
    new Blob([target.content], { type: target.contentType || "text/html" })
  );
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function SiteCard({
  site,
  isLatest,
  deployEnabled,
  deploying,
  onDeploy,
  onDelete,
}: {
  site: SiteAsset;
  isLatest: boolean;
  deployEnabled: boolean;
  deploying: boolean;
  onDeploy: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const hasHtml = site.html.trim().length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="relative h-72 bg-neutral-50">
        {hasHtml ? (
          <>
            {/* Live preview of the self-contained, script-free page. */}
            <iframe
              key={`${site.id}-${site.createdAt}`}
              title={site.title}
              srcDoc={site.html}
              sandbox="allow-forms allow-popups"
              onLoad={() => setLoaded(true)}
              className="block h-72 w-full border-0 bg-white"
            />
            {!loaded ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white text-[11px] text-neutral-400">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Loading preview…
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-neutral-400">
            Preview HTML is empty.
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isLatest
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {isLatest ? "Latest" : "Older"}
            </span>
            <span className="text-[10px] text-neutral-400">
              Generated {formatGeneratedAt(site.createdAt)}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-neutral-500">{site.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {site.deployUrl ? (
            <a
              href={site.deployUrl}
              target="_blank"
              rel="noreferrer"
              title="Open live site"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Live
            </a>
          ) : null}
          <button
            onClick={() => downloadHtml(site)}
            title={`Download ${siteDownloadName(site)}`}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => openHtmlPreview(site)}
            disabled={!hasHtml}
            title="Open preview in a new tab"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {deployEnabled ? (
            <button
              onClick={() => onDeploy(site.id)}
              disabled={deploying}
              title="Publish to Vercel"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
              {deploying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {site.deployUrl ? "Redeploy" : "Publish"}
            </button>
          ) : null}
          <button
            onClick={() => onDelete(site.id)}
            title="Delete"
            className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function WebsiteCodingConsole({
  progress,
  running,
}: {
  progress: DesignJobProgressEntry[];
  running: boolean;
}) {
  if (!running && !progress.length) return null;
  const entries = progress.length
    ? progress
    : [
        {
          at: new Date().toISOString(),
          label: "Queued",
          detail: "Waiting for the design worker to start the website build.",
          code: "await worker.claim('design_site');",
          status: "queued" as const,
        },
      ];
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-300">
          <Code2 className="h-3.5 w-3.5" />
          {running ? "GPT 5.5 live coding" : "Last website build log"}
        </p>
        {running ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
            <Loader2 className="h-3 w-3 animate-spin" /> Running
          </span>
        ) : null}
      </div>
      <div className="max-h-64 space-y-3 overflow-auto px-3 py-3">
        {entries.map((entry, index) => (
          <div key={`${entry.at}-${index}`} className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-white">
                {entry.label}
              </span>
              <span className="text-[10px] text-neutral-500">
                {formatGeneratedAtIst(entry.at)}
              </span>
            </div>
            {entry.detail ? (
              <p className="text-[11px] leading-relaxed text-neutral-300">
                {entry.detail}
              </p>
            ) : null}
            {entry.code ? (
              <pre className="overflow-x-auto rounded-md bg-black/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-emerald-200">
                {entry.code}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SiteHistoryBrowser({
  sites,
  selectedSiteId,
  selectedPath,
  deployEnabled,
  deployingId,
  onSelectSite,
  onSelectPath,
  onDeploy,
  onDelete,
}: {
  sites: SiteAsset[];
  selectedSiteId: string;
  selectedPath: string;
  deployEnabled: boolean;
  deployingId: string | null;
  onSelectSite: (id: string) => void;
  onSelectPath: (path: string) => void;
  onDeploy: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const activeSite =
    sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;
  const files = activeSite ? siteFiles(activeSite) : [];
  const activeFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [activeSite?.id, activeFile?.path]);

  useEffect(() => {
    if (activeFile && activeFile.path !== selectedPath) {
      onSelectPath(activeFile.path);
    }
  }, [activeFile, onSelectPath, selectedPath]);

  if (!activeSite || !activeFile) {
    return (
      <p className="text-[12px] text-neutral-400">No website design yet.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-neutral-200 bg-neutral-50 p-3 lg:border-b-0 lg:border-r">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <FolderTree className="h-3.5 w-3.5" /> Website history
          </p>
          <div className="space-y-2">
            {sites.map((site, index) => {
              const selected = site.id === activeSite.id;
              return (
                <button
                  key={site.id}
                  onClick={() => {
                    onSelectSite(site.id);
                    onSelectPath(siteFiles(site)[0]?.path ?? "index.html");
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-neutral-900 bg-white text-neutral-900 shadow-sm"
                      : "border-neutral-200 bg-white text-neutral-500 hover:border-indigo-200 hover:text-neutral-800"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold">
                      {index === 0 ? "Latest" : "Generation"}
                    </span>
                    <span className="shrink-0 text-[10px] text-neutral-400">
                      {siteFiles(site).length} file
                      {siteFiles(site).length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400">
                    <Clock className="h-3 w-3" />
                    {formatGeneratedAtIst(
                      site.generationRunCreatedAt || site.createdAt
                    )}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-neutral-400">
                    /{siteFolderName(site)}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-neutral-800">
                {activeSite.title}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-neutral-400">
                /{siteFolderName(activeSite)}/{activeFile.path}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <select
                value={activeFile.path}
                onChange={(e) => onSelectPath(e.target.value)}
                className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[11px] outline-none focus:border-indigo-400"
                title="Preview file"
              >
                {files.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </select>
              {activeSite.deployUrl ? (
                <a
                  href={activeSite.deployUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open live site"
                  className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <button
                onClick={() => downloadHtml(activeSite, activeFile)}
                title={`Download ${activeFile.path}`}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <FileCode2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => downloadSiteZip(activeSite)}
                title={`Download ${siteZipDownloadName(activeSite)}`}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => openHtmlPreview(activeSite, activeFile)}
                title="Open selected file in a new tab"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              {deployEnabled ? (
                <button
                  onClick={() => onDeploy(activeSite.id)}
                  disabled={deployingId === activeSite.id}
                  title="Publish static site to Vercel"
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {deployingId === activeSite.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  {activeSite.deployUrl ? "Redeploy" : "Publish"}
                </button>
              ) : null}
              <button
                onClick={() => onDelete(activeSite.id)}
                title="Delete generation"
                className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="relative h-[460px] bg-neutral-50">
            <iframe
              key={`${activeSite.id}-${activeFile.path}`}
              title={`${activeSite.title} ${activeFile.path}`}
              srcDoc={activeFile.content}
              sandbox="allow-forms allow-popups"
              onLoad={() => setLoaded(true)}
              className="block h-full w-full border-0 bg-white"
            />
            {!loaded ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white text-[11px] text-neutral-400">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Loading preview…
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DesignStudioSection({
  projectId,
  sourceRunId,
  refreshKey = 0,
}: {
  projectId: string | null;
  sourceRunId?: string | null;
  refreshKey?: number;
}) {
  const [studio, setStudio] = useState<DesignStudioState | null>(null);
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [logos, setLogos] = useState<LogoAsset[]>([]);
  const [sites, setSites] = useState<SiteAsset[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedSitePath, setSelectedSitePath] = useState("index.html");
  const [websiteBuildProgress, setWebsiteBuildProgress] = useState<
    DesignJobProgressEntry[]
  >([]);
  const [tokenDraft, setTokenDraft] = useState<DesignTokens | null>(null);
  const [uploadingFont, setUploadingFont] = useState<"heading" | "body" | null>(
    null
  );
  const [tokenGuidance, setTokenGuidance] = useState("");
  const [sourceWebsiteUrl, setSourceWebsiteUrl] = useState("");
  const [logoBrief, setLogoBrief] = useState("");
  const [deployEnabled, setDeployEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [makingType, setMakingType] = useState<CollateralRunType | null>(null);
  const [makingLogo, setMakingLogo] = useState(false);
  const [makingSite, setMakingSite] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [websiteBrief, setWebsiteBrief] = useState("");
  const [socialBrief, setSocialBrief] = useState("");
  const [collateralBrief, setCollateralBrief] = useState("");
  const [useSocialTemplates, setUseSocialTemplates] = useState(false);
  const [socialTemplateBrief, setSocialTemplateBrief] = useState("");
  const [socialVisualBrief, setSocialVisualBrief] = useState("");
  const [selectedAdRunId, setSelectedAdRunId] = useState("");
  const [websiteImageRefs, setWebsiteImageRefs] = useState<WebsiteImageRef[]>([]);
  const [pullingRefs, setPullingRefs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStudio = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/design/tokens`);
    if (res.ok) {
      const data = (await readJsonResponse(res)) as {
        designStudio: DesignStudioState | null;
        sourceWebsiteUrl?: string;
        websiteImageRefs?: WebsiteImageRef[];
      };
      const { designStudio } = data;
      setStudio(designStudio);
      setAssets(designStudio?.assets ?? []);
      setLogos(designStudio?.logos ?? []);
      const nextSites = designStudio?.sites ?? [];
      setSites(nextSites);
      setSelectedSiteId((current) =>
        current && nextSites.some((site) => site.id === current)
          ? current
          : nextSites[0]?.id ?? ""
      );
      setSelectedSitePath((current) => current || "index.html");
      setTokenDraft(designStudio?.tokens ?? null);
      setSourceWebsiteUrl((current) => current || data.sourceWebsiteUrl || "");
      setWebsiteImageRefs(data.websiteImageRefs ?? []);
    }
    const siteRes = await fetch(`/api/projects/${projectId}/design/site`);
    if (siteRes.ok) {
      const { deployEnabled: enabled } = (await readJsonResponse(siteRes)) as {
        deployEnabled?: boolean;
      };
      setDeployEnabled(Boolean(enabled));
    }
  }, [projectId]);

  const waitForJob = useCallback(
    async (
      jobId: string,
      fallback: string,
      onJobUpdate?: (job: JobStatus) => void
    ): Promise<JobStatus> => {
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = (await readJsonResponse(res)) as {
          job?: JobStatus;
          error?: unknown;
        };
        if (!res.ok) {
          throw new Error(providerErrorMessage(data.error ?? data, fallback));
        }
        if (data.job) onJobUpdate?.(data.job);
        if (data.job?.status === "succeeded") {
          await refreshStudio();
          return data.job;
        }
        if (data.job?.status === "failed" || data.job?.status === "cancelled") {
          throw new Error(data.job.error || fallback);
        }
      }
      throw new Error("Generation is still running. Refresh in a moment.");
    },
    [refreshStudio]
  );

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await refreshStudio();
      } catch {
        /* best-effort hydration */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, refreshStudio]);

  const generateTokens = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/design/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceRunId: sourceRunId ?? null,
          sourceWebsiteUrl:
            sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance),
          guidance: tokenGuidance,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      if (data.jobId) {
        await waitForJob(String(data.jobId), "Design token generation failed.");
        return;
      }
      const next = data.designStudio as DesignStudioState;
      setStudio(next);
      setTokenDraft(next.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [projectId, sourceRunId, sourceWebsiteUrl, tokenGuidance, waitForJob]);

  const pullProductRefs = useCallback(async () => {
    if (!projectId) return;
    const url = sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance);
    if (!url) {
      setError("Add a source website first, e.g. letssmush.com.");
      return;
    }
    setPullingRefs(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Website pull failed (${res.status}).`)
        );
        return;
      }
      setSourceWebsiteUrl(url);
      await refreshStudio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Website pull failed.");
    } finally {
      setPullingRefs(false);
    }
  }, [projectId, refreshStudio, sourceWebsiteUrl, tokenGuidance]);

  const saveTokenDraft = useCallback(async () => {
    if (!projectId || !tokenDraft) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/design/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceRunId: sourceRunId ?? null,
          tokens: tokenDraft,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Save failed (${res.status}).`)
        );
        return;
      }
      const next = data.designStudio as DesignStudioState;
      setStudio(next);
      setTokenDraft(next.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setGenerating(false);
    }
  }, [projectId, sourceRunId, tokenDraft]);

  const generateCollateralAsset = useCallback(
    async (
      type: CollateralType,
      options: {
        brief?: string;
        visualBrief?: string;
        templateBrief?: string;
        generationRunId?: string;
        generationRunLabel?: string;
        generationRunCreatedAt?: string;
        generationRunStamp?: string;
        useTemplates?: boolean;
        useAiVisual?: boolean;
        useProductImages?: boolean;
      } = {}
    ) => {
      if (!projectId) return;
      const isSocial = type === AD_TYPE;
      const resolvedUseTemplates =
        options.useTemplates ??
        (type === "business-card" ? true : isSocial ? useSocialTemplates : true);
      const visualBrief =
        options.visualBrief ?? (isSocial ? socialVisualBrief : "");
      const res = await fetch(`/api/projects/${projectId}/design/collateral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          brief: options.brief ?? (isSocial ? socialBrief : collateralBrief),
          useTemplates: resolvedUseTemplates,
          useAiVisual: options.useAiVisual ?? isSocial,
          useProductImages:
            options.useProductImages ??
            (type === "business-card" ? false : isSocial),
          visualBrief,
          templateBrief:
            options.templateBrief ??
            (isSocial && useSocialTemplates ? socialTemplateBrief : ""),
          generationRunId: options.generationRunId ?? "",
          generationRunLabel: options.generationRunLabel ?? "",
          generationRunCreatedAt: options.generationRunCreatedAt ?? "",
          generationRunStamp: options.generationRunStamp ?? "",
          sourceRunId: sourceRunId ?? null,
          sourceWebsiteUrl:
            sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance),
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(
            data.error ?? data,
            `Generation failed (${res.status}).`
          )
        );
      }
      if (data.jobId) {
        await waitForJob(String(data.jobId), "Collateral generation failed.");
        return;
      }
      setAssets((data.assets as DesignAsset[]) ?? []);
    },
    [
      projectId,
      socialBrief,
      collateralBrief,
      useSocialTemplates,
      socialTemplateBrief,
      socialVisualBrief,
      sourceRunId,
      sourceWebsiteUrl,
      tokenGuidance,
      waitForJob,
    ]
  );

  const makeCollateral = useCallback(
    async (type: CollateralType) => {
      if (!projectId) return;
      setMakingType(type);
      setError(null);
      try {
        const runMeta =
          type === AD_TYPE
            ? createGenerationRunMeta("Single creative", useSocialTemplates)
            : null;
        if (runMeta) setSelectedAdRunId(runMeta.generationRunId);
        await generateCollateralAsset(type, runMeta ?? {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generation failed.");
      } finally {
        setMakingType(null);
      }
    },
    [generateCollateralAsset, projectId, useSocialTemplates]
  );

  const makeAdCampaignPack = useCallback(async () => {
    if (!projectId) return;
    const baseBrief =
      socialBrief.trim() ||
      "Launch paid ad campaign using the current brand, product references, source website, and offer evidence.";
    const baseVisualBrief =
      socialVisualBrief.trim() ||
      "Polished product-led campaign visual with no readable text, captions, sliders, UI, labels, or typography inside the generated image.";
    setMakingType(AD_CAMPAIGN_PACK_TYPE);
    setError(null);
    try {
      const runMeta = createGenerationRunMeta(
        "Campaign pack",
        useSocialTemplates
      );
      setSelectedAdRunId(runMeta.generationRunId);
      for (let index = 0; index < AD_CAMPAIGN_VARIANTS.length; index += 1) {
        const variant = AD_CAMPAIGN_VARIANTS[index];
        await generateCollateralAsset(AD_TYPE, {
          ...runMeta,
          brief: [
            baseBrief,
            `Campaign post ${index + 1} of ${AD_CAMPAIGN_VARIANTS.length}.`,
            `Campaign variant: ${variant.name}.`,
            `Angle: ${variant.angle}.`,
            "This post must be meaningfully different from the other posts in the pack: different hook, copy angle, scene, framing, pose/props, and visual rhythm.",
            "Do not reuse the same headline, subhead, body proof, CTA wording, or composition as another campaign post.",
          ].join("\n"),
          useTemplates: useSocialTemplates,
          useAiVisual: true,
          useProductImages: true,
          templateBrief: useSocialTemplates ? socialTemplateBrief : "",
          visualBrief: [
            `Variant role: ${variant.name}. ${campaignScenePrompt(
              variant,
              index,
              runMeta.generationRunId
            )}`,
            `Product reference target: ${variant.productTarget}.`,
            `Style note: ${baseVisualBrief}`,
            `Composition hint: ${variant.composition}.`,
          ].join("\n"),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Campaign generation failed.");
    } finally {
      setMakingType(null);
    }
  }, [
    generateCollateralAsset,
    projectId,
    socialBrief,
    socialTemplateBrief,
    socialVisualBrief,
    useSocialTemplates,
  ]);

  const removeAsset = useCallback(
    async (assetId: string) => {
      if (!projectId) return;
      const prev = assets;
      setAssets((a) => a.filter((x) => x.id !== assetId)); // optimistic
      try {
        const res = await fetch(
          `/api/projects/${projectId}/design/collateral?assetId=${encodeURIComponent(
            assetId
          )}`,
          { method: "DELETE" }
        );
        if (!res.ok) setAssets(prev); // revert on failure
      } catch {
        setAssets(prev);
      }
    },
    [projectId, assets]
  );

  const makeLogo = useCallback(async () => {
    if (!projectId) return;
    setMakingLogo(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/design/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRunId: sourceRunId ?? null, brief: logoBrief }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      if (data.jobId) {
        await waitForJob(String(data.jobId), "Logo generation failed.");
        return;
      }
      setLogos((data.logos as LogoAsset[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setMakingLogo(false);
    }
  }, [projectId, sourceRunId, logoBrief, waitForJob]);

  const removeLogo = useCallback(
    async (logoId: string) => {
      if (!projectId) return;
      const prev = logos;
      setLogos((l) => l.filter((x) => x.id !== logoId)); // optimistic
      try {
        const res = await fetch(
          `/api/projects/${projectId}/design/logo?logoId=${encodeURIComponent(
            logoId
          )}`,
          { method: "DELETE" }
        );
        if (!res.ok) setLogos(prev);
      } catch {
        setLogos(prev);
      }
    },
    [projectId, logos]
  );

  const makeSite = useCallback(async () => {
    if (!projectId) return;
    setMakingSite(true);
    setError(null);
    setWebsiteBuildProgress([
      {
        at: new Date().toISOString(),
        label: "Queued website build",
        detail:
          "Waiting for the worker to start GPT 5.5 website generation and static file packaging.",
        code: "enqueueProjectJob(projectId, 'design_site', payload);",
        status: "queued",
      },
    ]);
    try {
      const res = await fetch(`/api/projects/${projectId}/design/site`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          brief: websiteBrief,
          sourceRunId: sourceRunId ?? null,
          sourceWebsiteUrl:
            sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance),
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      if (data.jobId) {
        const job = await waitForJob(
          String(data.jobId),
          "Website generation failed.",
          (jobUpdate) => {
            const progress = jobProgressFromResult(jobUpdate.result);
            if (progress.length) setWebsiteBuildProgress(progress);
          }
        );
        const progress = jobProgressFromResult(job.result);
        if (progress.length) setWebsiteBuildProgress(progress);
        if (
          job.result &&
          typeof job.result === "object" &&
          !Array.isArray(job.result)
        ) {
          const site = (job.result as { site?: SiteAsset }).site;
          if (site?.id) {
            setSelectedSiteId(site.id);
            setSelectedSitePath(siteFiles(site)[0]?.path ?? "index.html");
          }
        }
        return;
      }
      const nextSites = (data.sites as SiteAsset[]) ?? [];
      setSites(nextSites);
      setSelectedSiteId(nextSites[0]?.id ?? "");
      setSelectedSitePath(
        nextSites[0] ? siteFiles(nextSites[0])[0]?.path ?? "index.html" : "index.html"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setMakingSite(false);
    }
  }, [
    projectId,
    websiteBrief,
    sourceRunId,
    sourceWebsiteUrl,
    tokenGuidance,
    waitForJob,
  ]);

  const deploySite = useCallback(
    async (siteId: string) => {
      if (!projectId) return;
      setDeployingId(siteId);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/design/site`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deploy", siteId }),
        });
        const data = await readJsonResponse(res);
        if (!res.ok) {
          setError(
            providerErrorMessage(data.error ?? data, `Deploy failed (${res.status}).`)
          );
          return;
        }
        const updated = data.site as SiteAsset | null;
        if (updated) {
          setSites((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Deploy failed.");
      } finally {
        setDeployingId(null);
      }
    },
    [projectId]
  );

  const removeSite = useCallback(
    async (siteId: string) => {
      if (!projectId) return;
      const prev = sites;
      const optimistic = sites.filter((x) => x.id !== siteId);
      setSites(optimistic); // optimistic
      if (selectedSiteId === siteId) {
        setSelectedSiteId(optimistic[0]?.id ?? "");
        setSelectedSitePath(
          optimistic[0] ? siteFiles(optimistic[0])[0]?.path ?? "index.html" : "index.html"
        );
      }
      try {
        const res = await fetch(
          `/api/projects/${projectId}/design/site?siteId=${encodeURIComponent(
            siteId
          )}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          setSites(prev);
          if (selectedSiteId === siteId) setSelectedSiteId(siteId);
        }
      } catch {
        setSites(prev);
        if (selectedSiteId === siteId) setSelectedSiteId(siteId);
      }
    },
    [projectId, selectedSiteId, sites]
  );

  const updatePalette = useCallback(
    (key: keyof DesignTokens["palette"], value: string) => {
      setTokenDraft((prev) =>
        prev
          ? {
              ...prev,
              palette: { ...prev.palette, [key]: value },
            }
          : prev
      );
    },
    []
  );

  const updateTypography = useCallback(
    (key: keyof DesignTokens["typography"], value: string | string[]) => {
      setTokenDraft((prev) =>
        prev
          ? {
              ...prev,
              typography: { ...prev.typography, [key]: value },
            }
          : prev
      );
    },
    []
  );

  const updateTypographyFamily = useCallback(
    (key: "headingFamily" | "bodyFamily", value: string) => {
      setTokenDraft((prev) => {
        if (!prev) return prev;
        const urlKey =
          key === "headingFamily" ? "headingGoogleUrl" : "bodyGoogleUrl";
        const previousFamily = prev.typography[key];
        const nextTypography = {
          ...prev.typography,
          [key]: value,
          [urlKey]: googleFontUrlForFamily(value),
          weights: prev.typography.weights.length
            ? prev.typography.weights
            : ["400", "500", "600", "700"],
        };
        if (
          key === "headingFamily" &&
          previousFamily &&
          prev.typography.pairingRationale
            .toLowerCase()
            .includes(previousFamily.toLowerCase())
        ) {
          nextTypography.pairingRationale = `${value} sets the headline voice while ${nextTypography.bodyFamily} keeps product copy clear and usable.`;
        }
        return { ...prev, typography: nextTypography };
      });
    },
    []
  );

  const uploadCustomFont = useCallback(
    async (key: "headingFamily" | "bodyFamily", file: File) => {
      const role = key === "headingFamily" ? "heading" : "body";
      const format = fontFaceFormat(file.type, file.name);
      if (!format) {
        setError("Unsupported font file. Upload .woff2, .woff, .ttf, or .otf.");
        return;
      }
      if (file.size > MAX_CUSTOM_FONT_BYTES) {
        setError("Font file is too large (max 2MB). Try a .woff2 export.");
        return;
      }
      setUploadingFont(role);
      setError(null);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const family = familyFromFileName(file.name);
        const font: CustomFont = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `font-${file.name}-${file.size}`,
          family,
          dataUrl,
          format,
          mimeType: file.type || `font/${format}`,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        };
        const urlKey =
          key === "headingFamily" ? "headingGoogleUrl" : "bodyGoogleUrl";
        setTokenDraft((prev) => {
          if (!prev) return prev;
          const existing = prev.typography.customFonts ?? [];
          const customFonts = [
            font,
            ...existing.filter(
              (f) => f.family.toLowerCase() !== family.toLowerCase()
            ),
          ];
          return {
            ...prev,
            typography: {
              ...prev.typography,
              customFonts,
              [key]: family,
              [urlKey]: null, // uploaded face — no Google URL
              weights: prev.typography.weights.length
                ? prev.typography.weights
                : ["400", "500", "600", "700"],
            },
          };
        });
      } catch {
        setError("Could not read that font file.");
      } finally {
        setUploadingFont(null);
      }
    },
    []
  );

  const updateLogo = useCallback(
    (key: keyof DesignTokens["logo"], value: string | string[]) => {
      setTokenDraft((prev) =>
        prev
          ? {
              ...prev,
              logo: { ...prev.logo, [key]: value },
            }
          : prev
      );
    },
    []
  );

  const updateTokenList = useCallback(
    (key: "motifs", value: string) => {
      setTokenDraft((prev) =>
        prev ? { ...prev, [key]: csvToList(value) } : prev
      );
    },
    []
  );

  const updateTokenText = useCallback(
    (key: "imagery" | "rationale", value: string) => {
      setTokenDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const tokens = tokenDraft ?? studio?.tokens ?? null;
  const palette = tokens?.palette;
  const customFontCss = useMemo(
    () => customFontFaceCss(tokens?.typography.customFonts ?? []),
    [tokens?.typography.customFonts]
  );
  const tokensDirty = useMemo(
    () =>
      Boolean(tokenDraft && JSON.stringify(tokenDraft) !== JSON.stringify(studio?.tokens ?? null)),
    [studio?.tokens, tokenDraft]
  );
  const adAssets = useMemo(
    () => assets.filter((asset) => asset.type === AD_TYPE),
    [assets]
  );
  const adRunFolders = useMemo(() => buildAdRunFolders(adAssets), [adAssets]);
  const selectedAdRun =
    adRunFolders.find((run) => run.id === selectedAdRunId) ?? adRunFolders[0];
  const visibleAdAssets = selectedAdRun?.assets ?? [];
  const businessCardAssets = useMemo(
    () => assets.filter((asset) => asset.type === "business-card"),
    [assets]
  );
  const flyerAssets = useMemo(
    () => assets.filter((asset) => asset.type === "flyer"),
    [assets]
  );
  const posterAssets = useMemo(
    () => assets.filter((asset) => asset.type === "poster"),
    [assets]
  );

  useEffect(() => {
    if (!adRunFolders.length) {
      setSelectedAdRunId("");
      return;
    }
    setSelectedAdRunId((current) =>
      current && adRunFolders.some((run) => run.id === current)
        ? current
        : adRunFolders[0].id
    );
  }, [adRunFolders]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const hasSourceWebsite = Boolean(
    sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance)
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      {FONT_PREVIEW_CSS ? <style>{FONT_PREVIEW_CSS}</style> : null}
      {customFontCss ? <style>{customFontCss}</style> : null}
      <div className="mb-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <Palette className="h-4 w-4 text-indigo-600" /> Design Studio
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
            The brand&apos;s concrete design tokens — colors, type, and logo
            direction — plus branded collateral generated from them.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}

      <section className="mb-5 rounded-xl border border-neutral-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            AI token direction
          </span>
          <textarea
            value={tokenGuidance}
            onChange={(e) => setTokenGuidance(e.target.value)}
            placeholder="Optional direction, e.g. 'more premium skincare, less playful; use teal, cream, coral; editorial serif headline font'"
            rows={3}
            className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
          />
        </label>
        <label className="mt-2 block">
          <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            <Link2 className="h-3 w-3" /> Source website
          </span>
          <input
            value={sourceWebsiteUrl}
            onChange={(e) => setSourceWebsiteUrl(e.target.value)}
            placeholder="letssmush.com"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={generateTokens}
            disabled={generating || !projectId}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {hasSourceWebsite
              ? tokens
                ? "Pull site + regenerate tokens"
                : "Pull site + generate tokens"
              : tokens
                ? "Regenerate tokens"
                : "Generate tokens"}
          </button>
          {tokens ? (
            <button
              onClick={saveTokenDraft}
              disabled={generating || !projectId || !tokenDraft || !tokensDirty}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {tokensDirty ? "Save token edits" : "Saved"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="mb-5 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <FileImage className="h-3.5 w-3.5" /> Product refs
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
              Scraped images from the source site that ad campaign generation
              can use as Midjourney references and product-preservation inputs.
            </p>
          </div>
          <button
            onClick={pullProductRefs}
            disabled={pullingRefs || !projectId || !hasSourceWebsite}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
          >
            {pullingRefs ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {websiteImageRefs.length ? "Regenerate refs" : "Pull product refs"}
          </button>
        </div>
        {websiteImageRefs.length ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {websiteImageRefs.slice(0, 8).map((ref) => (
              <a
                key={ref.url}
                href={ref.sourceUrl || ref.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
                title={ref.summary || ref.name}
              >
                <div className="aspect-square bg-white">
                  <img
                    src={ref.url}
                    alt={ref.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-neutral-500">
                    {ref.name}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-neutral-300 group-hover:text-indigo-500" />
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-neutral-400">
            No scraped product refs yet. Add a source website above and pull refs.
          </p>
        )}
      </section>

      {!tokens ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-8 text-center text-[12px] text-neutral-400">
          No design tokens yet. Generate them from the brand kit and venture
          profile to unlock the collateral generators.
        </div>
      ) : (
        <div className="space-y-6">
          {palette ? (
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Palette
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                <Swatch name="primary" hex={palette.primary} />
                <Swatch name="secondary" hex={palette.secondary} />
                <Swatch name="accent" hex={palette.accent} />
                <Swatch name="dark" hex={palette.neutralDark} />
                <Swatch name="light" hex={palette.neutralLight} />
                {palette.extra.map((c) => (
                  <Swatch key={c.name} name={c.name} hex={c.hex} usage={c.usage} />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field
                  label="Primary"
                  value={palette.primary}
                  onChange={(v) => updatePalette("primary", v)}
                  placeholder="#0F766E"
                />
                <Field
                  label="Secondary"
                  value={palette.secondary}
                  onChange={(v) => updatePalette("secondary", v)}
                  placeholder="#FF7A59"
                />
                <Field
                  label="Accent"
                  value={palette.accent}
                  onChange={(v) => updatePalette("accent", v)}
                  placeholder="#FACC15"
                />
                <Field
                  label="Dark"
                  value={palette.neutralDark}
                  onChange={(v) => updatePalette("neutralDark", v)}
                  placeholder="#102A2F"
                />
                <Field
                  label="Light"
                  value={palette.neutralLight}
                  onChange={(v) => updatePalette("neutralLight", v)}
                  placeholder="#FFF7EA"
                />
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                <Type className="h-3.5 w-3.5" /> Typography
              </p>
              <button
                type="button"
                onClick={saveTokenDraft}
                disabled={generating || !projectId || !tokenDraft || !tokensDirty}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : tokensDirty ? (
                  <Save className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {tokensDirty ? "Save fonts" : "Fonts saved"}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FontPicker
                label="Heading font"
                value={tokens.typography.headingFamily}
                role="heading"
                customFonts={tokens.typography.customFonts ?? []}
                uploading={uploadingFont === "heading"}
                onChange={(v) => updateTypographyFamily("headingFamily", v)}
                onUpload={(file) => void uploadCustomFont("headingFamily", file)}
              />
              <FontPicker
                label="Body font"
                value={tokens.typography.bodyFamily}
                role="body"
                customFonts={tokens.typography.customFonts ?? []}
                uploading={uploadingFont === "body"}
                onChange={(v) => updateTypographyFamily("bodyFamily", v)}
                onUpload={(file) => void uploadCustomFont("bodyFamily", file)}
              />
            </div>
            <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Font preview
                  </p>
                  <p
                    className="text-3xl font-bold leading-tight text-neutral-900"
                    style={{
                      fontFamily: fontCssStack(
                        tokens.typography.headingFamily,
                        "heading"
                      ),
                    }}
                  >
                    Fresh rituals for modern brands
                  </p>
                  <p
                    className="mt-3 text-[13px] leading-relaxed text-neutral-600"
                    style={{
                      fontFamily: fontCssStack(tokens.typography.bodyFamily, "body"),
                    }}
                  >
                    A quick look at how the selected body face reads across
                    product copy, social captions, landing pages, and pitch
                    assets.
                  </p>
                </div>
                <div
                  className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-neutral-800"
                  style={{
                    fontFamily: fontCssStack(tokens.typography.bodyFamily, "body"),
                  }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    Families
                  </p>
                  <p
                    className="mt-2 text-xl leading-snug text-neutral-900"
                    style={{
                      fontFamily: fontCssStack(
                        tokens.typography.headingFamily,
                        "heading"
                      ),
                    }}
                  >
                    {tokens.typography.headingFamily}
                  </p>
                  <p className="mt-1 text-[12px] text-neutral-500">
                    {tokens.typography.bodyFamily}
                  </p>
                </div>
              </div>
            </div>
            {tokens.typography.pairingRationale ? (
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
                {tokens.typography.pairingRationale}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Logo direction
            </p>
            <textarea
              value={tokens.logo.direction}
              onChange={(e) => updateLogo("direction", e.target.value)}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field
                label="Style"
                value={tokens.logo.style}
                onChange={(v) => updateLogo("style", v)}
                placeholder="wordmark, emblem, lettermark, combination"
              />
              <Field
                label="Motif ideas"
                value={listToCsv(tokens.logo.motifSuggestions)}
                onChange={(v) => updateLogo("motifSuggestions", csvToList(v))}
                placeholder="water droplet, monogram, ritual mark"
              />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field
                label="Brand motifs"
                value={listToCsv(tokens.motifs)}
                onChange={(v) => updateTokenList("motifs", v)}
                placeholder="soft arcs, product tiles, editorial borders"
              />
              <Field
                label="Imagery"
                value={tokens.imagery}
                onChange={(v) => updateTokenText("imagery", v)}
                placeholder="bright product shots, wet bathroom textures"
              />
            </div>
          </section>

          {/* Logo generator */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                <Hexagon className="h-3.5 w-3.5" /> Logo
              </p>
              <button
                onClick={makeLogo}
                disabled={makingLogo}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                {makingLogo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Hexagon className="h-3.5 w-3.5" />
                )}
                {logos.length ? "Regenerate logo" : "Generate logo"}
              </button>
            </div>
            <textarea
              value={logoBrief}
              onChange={(e) => setLogoBrief(e.target.value)}
              placeholder="Optional logo brief — e.g. 'minimal droplet monogram, no leaf, premium but warm, should work as an app icon'"
              rows={2}
              className="mb-3 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            {logos.length ? (
              <div className="space-y-3">
                {logos.map((logo) => (
                  <LogoCard key={logo.id} logo={logo} onDelete={removeLogo} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-neutral-400">
                No logo yet — generate editable SVG marks plus a wordmark built
                from your brand font. Download any variant as SVG or PNG.
              </p>
            )}
          </section>

          {/* Website generator */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                <Globe className="h-3.5 w-3.5" /> Website design
              </p>
              <button
                onClick={makeSite}
                disabled={makingSite}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                {makingSite ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
                {sites.length ? "Regenerate website" : "Generate website"}
              </button>
            </div>
            <input
              value={websiteBrief}
              onChange={(e) => setWebsiteBrief(e.target.value)}
              placeholder="Website brief — e.g. 'multi-page product site for hydration cleanser, emphasize bundles, press, stockists, and Instagram'"
              className="mb-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            <WebsiteCodingConsole
              progress={websiteBuildProgress}
              running={makingSite}
            />
            {sites.length ? (
              <SiteHistoryBrowser
                sites={sites}
                selectedSiteId={selectedSiteId}
                selectedPath={selectedSitePath}
                deployEnabled={deployEnabled}
                deployingId={deployingId}
                onSelectSite={setSelectedSiteId}
                onSelectPath={setSelectedSitePath}
                onDeploy={deploySite}
                onDelete={removeSite}
              />
            ) : (
              <p className="text-[12px] text-neutral-400">
                No website design yet.
              </p>
            )}
            {!deployEnabled ? (
              <p className="mt-1 text-[10px] text-neutral-300">
                Set <code>VERCEL_TOKEN</code> to enable one-click publish.
              </p>
            ) : null}
          </section>

          {/* Ad campaign generator */}
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                <Megaphone className="h-3.5 w-3.5" /> Ad campaigns
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={makeAdCampaignPack}
                  disabled={makingType !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
                >
                  {makingType === AD_CAMPAIGN_PACK_TYPE ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  Generate campaign pack
                </button>
                <button
                  onClick={() => makeCollateral(AD_TYPE)}
                  disabled={makingType !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {makingType === AD_TYPE ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Single creative
                </button>
              </div>
            </div>
            <input
              value={socialBrief}
              onChange={(e) => setSocialBrief(e.target.value)}
              placeholder="Campaign brief — e.g. 'Instagram launch ads for barrier repair duo, 20% off'"
              className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            <div className="mb-2 grid grid-cols-1 gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700">
                <input
                  type="checkbox"
                  checked={useSocialTemplates}
                  onChange={(e) => setUseSocialTemplates(e.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                Templates
              </label>
              <PipelineStep
                label="Midjourney scene"
                info="Always on for campaign images. We use Midjourney first for art direction: model pose, scene, lighting, composition, and copy space."
              />
              <PipelineStep
                label="Gemini product swap"
                info="Always on after Midjourney. Gemini receives the scene plus real product photos and overview images, then swaps in the actual product photorealistically."
              />
              <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700 sm:col-span-3">
                No generated image text
              </span>
            </div>
            {useSocialTemplates ? (
              <textarea
                value={socialTemplateBrief}
                onChange={(e) => setSocialTemplateBrief(e.target.value)}
                placeholder="Template direction — e.g. 'premium skincare editorial with big headline, small CTA, lots of white space'"
                rows={2}
                className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
              />
            ) : null}
            <textarea
              value={socialVisualBrief}
              onChange={(e) => setSocialVisualBrief(e.target.value)}
              placeholder="Visual direction — e.g. 'glossy product macro with wet skin texture, no text'"
              rows={3}
              className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            {adRunFolders.length ? (
              <>
                <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Campaign run
                  </label>
                  <select
                    value={selectedAdRun?.id ?? ""}
                    onChange={(e) => setSelectedAdRunId(e.target.value)}
                    className="w-full rounded-md border border-neutral-200 bg-white px-2 py-2 text-[12px] text-neutral-700 outline-none focus:border-indigo-400"
                  >
                    {adRunFolders.map((run, index) => (
                      <option key={run.id} value={run.id}>
                        {index === 0 ? "Latest — " : ""}
                        {run.label} · {run.assets.length} creative
                        {run.assets.length === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  {selectedAdRun ? (
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Showing {visibleAdAssets.length} creative
                      {visibleAdAssets.length === 1 ? "" : "s"} from{" "}
                      {selectedAdRun.stamp
                        ? selectedAdRun.stamp.replace(/_/g, " ")
                        : selectedAdRun.label}
                      {selectedAdRun.templateFrameEnabled !== undefined
                        ? ` · ${
                            selectedAdRun.templateFrameEnabled
                              ? "Template on"
                              : "Template off"
                          }`
                        : ""}
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleAdAssets.map((asset) => (
                    <AssetCard key={asset.id} asset={asset} onDelete={removeAsset} />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-neutral-400">
                No ad campaign creatives yet.
              </p>
            )}
          </section>

          {/* Collateral generator */}
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Collateral brief
            </p>
            <input
              value={collateralBrief}
              onChange={(e) => setCollateralBrief(e.target.value)}
              placeholder="Shared collateral brief — e.g. 'premium sample-card handout for a pop-up'"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
          </section>

          <GeneratedAssetSection
            type="business-card"
            label="Business card"
            assets={businessCardAssets}
            makingType={makingType}
            onGenerate={makeCollateral}
            onDelete={removeAsset}
          />
          <GeneratedAssetSection
            type="flyer"
            label="Flyer"
            assets={flyerAssets}
            makingType={makingType}
            onGenerate={makeCollateral}
            onDelete={removeAsset}
          />
          <GeneratedAssetSection
            type="poster"
            label="Poster"
            assets={posterAssets}
            makingType={makingType}
            onGenerate={makeCollateral}
            onDelete={removeAsset}
          />

          {studio?.generatedAt ? (
            <p className="text-[10px] text-neutral-300">
              Tokens generated {new Date(studio.generatedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

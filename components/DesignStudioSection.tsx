"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileImage,
  Globe,
  Hexagon,
  Link2,
  Loader2,
  Megaphone,
  Palette,
  RefreshCw,
  Rocket,
  Trash2,
  Type,
} from "lucide-react";
import type {
  CollateralType,
  DesignAsset,
  DesignStudioSection as DesignStudioState,
  DesignTokens,
  LogoAsset,
  SiteAsset,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";

const AD_TYPE: CollateralType = "ad";
const AD_CAMPAIGN_PACK_TYPE = "ad-campaign" as const;
type CollateralRunType = CollateralType | typeof AD_CAMPAIGN_PACK_TYPE;

const AD_CAMPAIGN_VARIANTS = [
  {
    name: "Prospecting hook",
    angle:
      "lead with the sharpest new-customer problem, desire, or objection",
    visual:
      "Human in-use scene: a model naturally holding or applying the product near the face/body when category-appropriate, intimate close crop, broad appeal, clean copy space.",
    composition:
      "lifestyle model moment, skin/hair/body context, shallow depth of field",
  },
  {
    name: "Offer test",
    angle:
      "turn the current launch offer, bundle, sample, or discount into a direct-response ad",
    visual:
      "Product-first commerce composition with tactile props, ingredient/texture cues, strong hero product placement, and uncluttered negative space.",
    composition:
      "studio tabletop or shelf scene, product packshot emphasis, no model",
  },
  {
    name: "Proof retargeting",
    angle:
      "use product facts, source-site evidence, founder proof, or social proof for warm audiences",
    visual:
      "Trust-building editorial scene focused on product detail, outcome texture, usage proof, or premium material finish.",
    composition:
      "macro/editorial proof scene, close product detail, distinct from the other campaign posts",
  },
];

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
};

type WebsiteImageRef = {
  url: string;
  name: string;
  kind: string;
  sourceUrl?: string;
  summary?: string;
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

function siteDownloadName(site: SiteAsset): string {
  const stamp = site.createdAt.replace(/[:.]/g, "-").slice(0, 19);
  return `index-${stamp || site.id}.html`;
}

function svgPreviewSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

function downloadHtml(site: SiteAsset) {
  downloadBlob(new Blob([site.html], { type: "text/html" }), siteDownloadName(site));
}

function openHtmlPreview(site: SiteAsset) {
  const url = URL.createObjectURL(new Blob([site.html], { type: "text/html" }));
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
  const [tokenDraft, setTokenDraft] = useState<DesignTokens | null>(null);
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
  const [useSocialTemplates, setUseSocialTemplates] = useState(true);
  const [socialVisualBrief, setSocialVisualBrief] = useState("");
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
      setSites(designStudio?.sites ?? []);
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
    async (jobId: string, fallback: string) => {
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
        if (data.job?.status === "succeeded") {
          await refreshStudio();
          return;
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
        useTemplates?: boolean;
        useAiVisual?: boolean;
        useProductImages?: boolean;
      } = {}
    ) => {
      if (!projectId) return;
      const isSocial = type === AD_TYPE;
      const res = await fetch(`/api/projects/${projectId}/design/collateral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          brief: options.brief ?? (isSocial ? socialBrief : collateralBrief),
          useTemplates:
            options.useTemplates ??
            (type === "business-card" ? true : isSocial ? useSocialTemplates : true),
          useAiVisual: options.useAiVisual ?? isSocial,
          useProductImages:
            options.useProductImages ??
            (type === "business-card" ? false : isSocial),
          visualBrief:
            options.visualBrief ?? (isSocial ? socialVisualBrief : ""),
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
        await generateCollateralAsset(type);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generation failed.");
      } finally {
        setMakingType(null);
      }
    },
    [generateCollateralAsset, projectId]
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
      for (let index = 0; index < AD_CAMPAIGN_VARIANTS.length; index += 1) {
        const variant = AD_CAMPAIGN_VARIANTS[index];
        await generateCollateralAsset(AD_TYPE, {
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
          visualBrief: [
            baseVisualBrief,
            `Variant role: ${variant.name}. ${variant.visual}`,
            `Required composition lane: ${variant.composition}.`,
            "Do not render readable text in the image unless the founder explicitly requested in-image text in the visual direction; if text is requested, it must be handled in the final Gemini edit, never in the Midjourney scene.",
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
        await waitForJob(String(data.jobId), "Website generation failed.");
        return;
      }
      setSites((data.sites as SiteAsset[]) ?? []);
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
      setSites((s) => s.filter((x) => x.id !== siteId)); // optimistic
      try {
        const res = await fetch(
          `/api/projects/${projectId}/design/site?siteId=${encodeURIComponent(
            siteId
          )}`,
          { method: "DELETE" }
        );
        if (!res.ok) setSites(prev);
      } catch {
        setSites(prev);
      }
    },
    [projectId, sites]
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const tokens = tokenDraft ?? studio?.tokens ?? null;
  const palette = tokens?.palette;
  const adAssets = assets.filter((asset) => asset.type === AD_TYPE);
  const businessCardAssets = assets.filter((asset) => asset.type === "business-card");
  const flyerAssets = assets.filter((asset) => asset.type === "flyer");
  const posterAssets = assets.filter((asset) => asset.type === "poster");
  const hasSourceWebsite = Boolean(
    sourceWebsiteUrl.trim() || extractWebsiteUrl(tokenGuidance)
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
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
              disabled={generating || !projectId || !tokenDraft}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              Save token edits
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
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <Type className="h-3.5 w-3.5" /> Typography
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field
                label="Heading font"
                value={tokens.typography.headingFamily}
                onChange={(v) => updateTypography("headingFamily", v)}
                placeholder="Playfair Display"
              />
              <Field
                label="Body font"
                value={tokens.typography.bodyFamily}
                onChange={(v) => updateTypography("bodyFamily", v)}
                placeholder="Inter"
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
                      fontFamily: `${tokens.typography.headingFamily}, Georgia, serif`,
                    }}
                  >
                    Fresh rituals for modern brands
                  </p>
                  <p
                    className="mt-3 text-[13px] leading-relaxed text-neutral-600"
                    style={{
                      fontFamily: `${tokens.typography.bodyFamily}, Inter, Arial, sans-serif`,
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
                    fontFamily: `${tokens.typography.bodyFamily}, Inter, Arial, sans-serif`,
                  }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    Families
                  </p>
                  <p
                    className="mt-2 text-xl leading-snug text-neutral-900"
                    style={{
                      fontFamily: `${tokens.typography.headingFamily}, Georgia, serif`,
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
              placeholder="Homepage brief — e.g. 'launch page for hydration cleanser, emphasize subscription and bundles'"
              className="mb-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            {sites.length ? (
              <div className="space-y-3">
                {sites.map((site, index) => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    isLatest={index === 0}
                    deployEnabled={deployEnabled}
                    deploying={deployingId === site.id}
                    onDeploy={deploySite}
                    onDelete={removeSite}
                  />
                ))}
              </div>
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
              <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700">
                Midjourney scene
              </span>
              <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700">
                Gemini product swap
              </span>
              <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[11px] font-medium text-neutral-700 sm:col-span-3">
                No generated image text
              </span>
            </div>
            <textarea
              value={socialVisualBrief}
              onChange={(e) => setSocialVisualBrief(e.target.value)}
              placeholder="Visual direction — e.g. 'glossy product macro with wet skin texture, no text'"
              rows={3}
              className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            {adAssets.length ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {adAssets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onDelete={removeAsset} />
                ))}
              </div>
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

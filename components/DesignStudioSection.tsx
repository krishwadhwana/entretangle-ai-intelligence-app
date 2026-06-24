"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileImage,
  Globe,
  Hexagon,
  Loader2,
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
  LogoAsset,
  SiteAsset,
} from "@/lib/schema";
import { providerErrorMessage } from "@/lib/providerErrors";

const COLLATERAL_TYPES: { type: CollateralType; label: string }[] = [
  { type: "business-card", label: "Business card" },
  { type: "flyer", label: "Flyer" },
  { type: "poster", label: "Poster" },
];

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

function AssetCard({
  asset,
  onDelete,
}: {
  asset: DesignAsset;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div
        className="flex items-center justify-center bg-neutral-50 p-3"
        // The SVG is self-contained; scale it to fit the card width.
        dangerouslySetInnerHTML={{
          __html: asset.svg.replace(
            "<svg ",
            '<svg style="max-width:100%;height:auto;" '
          ),
        }}
      />
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
  downloadBlob(new Blob([site.html], { type: "text/html" }), "index.html");
}

function SiteCard({
  site,
  deployEnabled,
  deploying,
  onDeploy,
  onDelete,
}: {
  site: SiteAsset;
  deployEnabled: boolean;
  deploying: boolean;
  onDeploy: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* Live preview of the self-contained, script-free page. */}
      <iframe
        title={site.title}
        srcDoc={site.html}
        sandbox=""
        className="h-72 w-full border-0 bg-white"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-3 py-2">
        <p className="truncate text-[11px] text-neutral-500">{site.title}</p>
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
            title="Download index.html"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Download className="h-3.5 w-3.5" />
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
  const [deployEnabled, setDeployEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [makingType, setMakingType] = useState<CollateralType | null>(null);
  const [makingLogo, setMakingLogo] = useState(false);
  const [makingSite, setMakingSite] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/design/tokens`);
        if (res.ok) {
          const { designStudio } = (await res.json()) as {
            designStudio: DesignStudioState | null;
          };
          if (!cancelled) {
            setStudio(designStudio);
            setAssets(designStudio?.assets ?? []);
            setLogos(designStudio?.logos ?? []);
            setSites(designStudio?.sites ?? []);
          }
        }
        // Whether one-click Vercel publish is configured (VERCEL_TOKEN set).
        const siteRes = await fetch(`/api/projects/${projectId}/design/site`);
        if (siteRes.ok) {
          const { deployEnabled: enabled } = (await siteRes.json()) as {
            deployEnabled?: boolean;
          };
          if (!cancelled) setDeployEnabled(Boolean(enabled));
        }
      } catch {
        /* best-effort hydration */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  const generateTokens = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/design/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRunId: sourceRunId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      setStudio(data.designStudio as DesignStudioState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [projectId, sourceRunId]);

  const makeCollateral = useCallback(
    async (type: CollateralType) => {
      if (!projectId) return;
      setMakingType(type);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/design/collateral`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, brief, sourceRunId: sourceRunId ?? null }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(
            providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
          );
          return;
        }
        setAssets((data.assets as DesignAsset[]) ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generation failed.");
      } finally {
        setMakingType(null);
      }
    },
    [projectId, brief, sourceRunId]
  );

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
        body: JSON.stringify({ sourceRunId: sourceRunId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      setLogos((data.logos as LogoAsset[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setMakingLogo(false);
    }
  }, [projectId, sourceRunId]);

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
          brief,
          sourceRunId: sourceRunId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          providerErrorMessage(data.error ?? data, `Generation failed (${res.status}).`)
        );
        return;
      }
      setSites((data.sites as SiteAsset[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setMakingSite(false);
    }
  }, [projectId, brief, sourceRunId]);

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
        const data = await res.json();
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const tokens = studio?.tokens ?? null;
  const palette = tokens?.palette;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <Palette className="h-4 w-4 text-indigo-600" /> Design Studio
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
            The brand&apos;s concrete design tokens — colors, type, and logo
            direction — plus branded collateral generated from them.
          </p>
        </div>
        <button
          onClick={generateTokens}
          disabled={generating || !projectId}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {tokens ? "Regenerate tokens" : "Generate tokens"}
        </button>
      </div>

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}

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
            </section>
          ) : null}

          <section>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <Type className="h-3.5 w-3.5" /> Typography
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-neutral-400">
                  Heading
                </p>
                <p className="mt-1 text-lg font-semibold text-neutral-800">
                  {tokens.typography.headingFamily}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-neutral-400">
                  Body
                </p>
                <p className="mt-1 text-lg text-neutral-800">
                  {tokens.typography.bodyFamily}
                </p>
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
            <p className="mt-1 text-[12px] leading-relaxed text-neutral-700">
              {tokens.logo.direction}
            </p>
            <p className="mt-1 text-[11px] capitalize text-neutral-400">
              Style: {tokens.logo.style}
            </p>
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
                {logos.length ? "New concept" : "Generate logo"}
              </button>
            </div>
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

          {/* Collateral generator */}
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Collateral
            </p>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Optional brief — e.g. 'launch flyer for the summer drop, 20% off'"
              className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-indigo-400"
            />
            <div className="flex flex-wrap gap-2">
              {COLLATERAL_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => makeCollateral(type)}
                  disabled={makingType !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {makingType === type ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {label}
                </button>
              ))}
            </div>

            {assets.length ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {assets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onDelete={removeAsset} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-neutral-400">
                No collateral yet — pick a format above to generate one. Download
                as SVG (editable, imports into Figma) or PNG.
              </p>
            )}
          </section>

          {/* Website generator */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                <Globe className="h-3.5 w-3.5" /> Website
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
                {sites.length ? "New version" : "Generate site"}
              </button>
            </div>
            {sites.length ? (
              <div className="space-y-3">
                {sites.map((site) => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    deployEnabled={deployEnabled}
                    deploying={deployingId === site.id}
                    onDeploy={deploySite}
                    onDelete={removeSite}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-neutral-400">
                No site yet — generate a one-page landing site from your tokens.
                Preview it live, download <code>index.html</code>
                {deployEnabled ? ", or publish straight to Vercel." : "."}
              </p>
            )}
            {!deployEnabled ? (
              <p className="mt-1 text-[10px] text-neutral-300">
                Set <code>VERCEL_TOKEN</code> to enable one-click publish.
              </p>
            ) : null}
          </section>

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

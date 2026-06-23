import satori from "satori";
import type { DesignTokens, LogoVariant } from "@/lib/schema";
import { loadBrandFonts } from "./fonts";

// ---------------------------------------------------------------------------
// Logo generation. LLM-authored marks (geometry only) are sanitized here, and a
// deterministic wordmark is rendered via Satori (brand name shaped to vector
// paths) so there's always one guaranteed, font-portable variant. Everything is
// self-contained SVG: editable, scalable, and Figma-importable.
// ---------------------------------------------------------------------------

// The marks come from our own LLM call, not user input, but we still strip any
// active/external content before it's injected into the dashboard DOM: scripts,
// event handlers, foreignObject, <image>, and external/href URLs.
export function sanitizeSvg(raw: string): string | null {
  let svg = raw.trim();
  // Drop accidental markdown fences.
  svg = svg.replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/\s*```$/, "");
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start === -1 || end === -1) return null;
  svg = svg.slice(start, end + "</svg>".length);

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<image\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "") // onclick=… (double-quoted)
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "") // onclick=… (single-quoted)
    .replace(/\s(?:xlink:href|href)\s*=\s*["'](?:https?:|\/\/|data:)[^"']*["']/gi, "");

  // Reject anything that still references a remote resource.
  if (/url\(\s*['"]?https?:/i.test(svg) || /<script/i.test(svg)) return null;
  return svg;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "logo"
  );
}

/**
 * Deterministic wordmark: the brand name in the heading font on a transparent
 * canvas, shaped to vector paths by Satori — always available, never needs the
 * font installed to render. Width scales with the name length.
 */
export async function buildWordmarkSvg(
  brandName: string,
  tokens: DesignTokens
): Promise<string> {
  const fonts = await loadBrandFonts(
    tokens.typography.headingFamily,
    tokens.typography.bodyFamily
  );
  const fontSize = 96;
  const height = 200;
  const width = Math.max(360, Math.round(brandName.length * fontSize * 0.62) + 96);
  const node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 48px",
      },
      children: {
        type: "div",
        props: {
          style: {
            display: "flex",
            fontFamily: tokens.typography.headingFamily,
            fontWeight: 700,
            fontSize: `${fontSize}px`,
            color: tokens.palette.primary,
          },
          children: brandName,
        },
      },
    },
  };
  return satori(node as never, { width, height, fonts });
}

export type LogoBuildInput = {
  concept: string;
  style: string;
  marks: { label: string; svg: string }[];
};

/**
 * Assemble logo variants: sanitized LLM marks + the deterministic wordmark. The
 * wordmark is always included so the founder never ends up with zero usable
 * variants even if every mark fails sanitization.
 */
export async function buildLogoVariants(
  brandName: string,
  tokens: DesignTokens,
  marks: LogoBuildInput["marks"]
): Promise<LogoVariant[]> {
  const variants: LogoVariant[] = [];
  marks.forEach((m, i) => {
    const clean = sanitizeSvg(m.svg);
    if (clean) {
      variants.push({
        id: `icon-${slug(m.label)}-${i}`,
        label: m.label || `Mark ${i + 1}`,
        kind: "icon",
        svg: clean,
      });
    }
  });
  const wordmark = await buildWordmarkSvg(brandName, tokens);
  variants.push({
    id: `wordmark-${slug(brandName)}`,
    label: "Wordmark",
    kind: "wordmark",
    svg: wordmark,
  });
  return variants;
}

import type { StoredChunk } from "./store";
import type { WebsiteAnalysis } from "./schema";

export type FounderStorySourceType =
  | "manual"
  | "website"
  | "document"
  | "press"
  | "interview"
  | "other";

export type FounderStoryPromptEvidence = {
  id: string;
  sourceType: FounderStorySourceType;
  title: string;
  url: string | null;
  text: string;
};

export type FounderStorySkippedUrl = {
  url: string;
  reason: string;
};

const STORY_TERMS = [
  "founder",
  "founded",
  "origin",
  "mission",
  "about",
  "why",
  "story",
  "journey",
  "background",
  "started",
  "created",
  "experience",
  "team",
  "values",
  "purpose",
  "problem",
  "customer",
  "craft",
  "credibility",
];

const LICENSED_HTML_HOSTS = ["crunchbase.com"];

function clampText(text: string, maxChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "source"
  );
}

function stableId(prefix: string, seed: string, index: number): string {
  return `${prefix}-${slug(seed)}-${index + 1}`;
}

function hostMatches(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function extractReadableText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function titleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? clampText(decodeBasicEntities(match[1]), 140) : "";
}

function storyScore(text: string): number {
  const lower = text.toLowerCase();
  return STORY_TERMS.reduce(
    (sum, term) => sum + (lower.includes(term) ? 1 : 0),
    0
  );
}

export function websiteAnalysisEvidence(
  analysis: WebsiteAnalysis | null | undefined
): FounderStoryPromptEvidence | null {
  if (!analysis) return null;
  const draft = analysis.draftProfile ?? {};
  const text = clampText(
    [
      analysis.summary && `Summary: ${analysis.summary}`,
      draft.experience && `Founder experience: ${draft.experience}`,
      draft.differentiation && `Differentiation: ${draft.differentiation}`,
      draft.styleKeywords?.length
        ? `Style keywords: ${draft.styleKeywords.join(", ")}`
        : "",
      analysis.consumerOpinion &&
        `Online consumer opinion: ${analysis.consumerOpinion}`,
    ]
      .filter(Boolean)
      .join("\n"),
    6000
  );
  if (text.length < 20) return null;
  return {
    id: "website-analysis",
    sourceType: "website",
    title: "Saved website analysis",
    url: analysis.url || null,
    text,
  };
}

export function documentChunkEvidence(
  chunks: StoredChunk[],
  limit = 8
): FounderStoryPromptEvidence[] {
  return chunks
    .map((chunk, idx) => ({
      chunk,
      idx,
      score: storyScore(chunk.content),
    }))
    .filter((item) => item.score > 0 || chunks.length <= limit)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, idx }) => ({
      id: stableId("doc", `${chunk.docName}-${chunk.idx}`, idx),
      sourceType: "document" as const,
      title: `${chunk.docName} #${chunk.idx + 1}`,
      url: null,
      text: clampText(chunk.content, 2200),
    }));
}

export async function fetchFounderStoryUrl(
  rawUrl: string,
  index: number
): Promise<{
  evidence: FounderStoryPromptEvidence | null;
  skipped: FounderStorySkippedUrl | null;
}> {
  let parsed: URL;
  try {
    parsed = normalizeUrl(rawUrl);
  } catch {
    return {
      evidence: null,
      skipped: { url: rawUrl, reason: "Invalid URL" },
    };
  }

  if (LICENSED_HTML_HOSTS.some((host) => hostMatches(parsed.hostname, host))) {
    return {
      evidence: null,
      skipped: {
        url: parsed.toString(),
        reason:
          "Crunchbase pages are licensed data; import via permitted API/export or paste the allowed excerpt as notes.",
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
        "user-agent":
          "Mozilla/5.0 (compatible; EntretangleFounderStory/1.0)",
      },
    });
    if (!response.ok) {
      return {
        evidence: null,
        skipped: {
          url: parsed.toString(),
          reason: `Fetch failed with HTTP ${response.status}`,
        },
      };
    }
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
      return {
        evidence: null,
        skipped: {
          url: parsed.toString(),
          reason: `Unsupported content type: ${type || "unknown"}`,
        },
      };
    }
    const body = await response.text();
    const title = titleFromHtml(body) || parsed.hostname;
    const text = clampText(extractReadableText(body), 6000);
    if (text.length < 80) {
      return {
        evidence: null,
        skipped: {
          url: parsed.toString(),
          reason: "No readable story text found",
        },
      };
    }
    return {
      evidence: {
        id: stableId("url", `${parsed.hostname}-${title}`, index),
        sourceType: "press",
        title,
        url: parsed.toString(),
        text,
      },
      skipped: null,
    };
  } catch (error) {
    return {
      evidence: null,
      skipped: {
        url: parsed.toString(),
        reason:
          error instanceof Error ? error.message : "Fetch failed unexpectedly",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

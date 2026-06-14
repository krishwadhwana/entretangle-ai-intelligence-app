import { config } from "../config";
import { callBuildIndustryKnowledge } from "../llm";
import { getIndustryKnowledge, upsertIndustryKnowledge } from "../store";
import {
  IndustryKnowledgePackSchema,
  type IndustryKnowledgePack,
} from "../schema";

// ---------------------------------------------------------------------------
// Auto industry knowledge (option A). getOrBuild returns a cached pack if it's
// fresh, otherwise builds one (web-grounded), caches it globally, and returns
// it. This is the "feed data for every industry without doing it manually"
// layer: the first venture in an industry pays the build; everyone reuses it
// until it goes stale. Provenance (sources) + freshness (builtAt) travel with
// the pack and are surfaced in the injected ground truth.
// ---------------------------------------------------------------------------

// Rebuild when older than this many days (env-overridable).
function ttlDays(): number {
  const v = process.env.INDUSTRY_KNOWLEDGE_TTL_DAYS;
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : 30;
}

function slug(industry: string, libraryKey: string): string {
  const base = (libraryKey && libraryKey !== "general" ? libraryKey : industry)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "general";
}

export type BuiltKnowledge = {
  pack: IndustryKnowledgePack;
  sources: string[];
  builtAt: Date;
  fresh: boolean;
};

/**
 * Cached-or-built industry knowledge. Never throws — returns null if it can't
 * be built and nothing is cached (caller falls back to the curated library).
 */
export async function getOrBuildIndustryKnowledge(
  runId: string | null,
  industry: string,
  libraryKey: string,
  geography: string[]
): Promise<BuiltKnowledge | null> {
  const key = slug(industry, libraryKey);

  // 1. Cache hit & fresh → reuse.
  const cached = await getIndustryKnowledge(key).catch(() => null);
  const ageMs = cached ? Date.now() - new Date(cached.builtAt).getTime() : Infinity;
  const fresh = cached != null && ageMs < ttlDays() * 24 * 60 * 60 * 1000;
  if (cached && fresh) {
    const parsed = IndustryKnowledgePackSchema.safeParse(cached.pack);
    if (parsed.success) {
      return {
        pack: parsed.data,
        sources: cached.sources,
        builtAt: new Date(cached.builtAt),
        fresh: true,
      };
    }
  }

  // 2. Build a fresh pack (web-grounded in real mode).
  const built = await callBuildIndustryKnowledge(runId, industry, geography);
  if (built) {
    // Cache globally for the next venture in this industry. Skip persistence in
    // mock mode so the deterministic fixture never pollutes the real cache.
    if (!config.mockMode) {
      await upsertIndustryKnowledge({
        industryKey: key,
        industry,
        pack: built.pack,
        sources: built.sources,
        builtModel: config.model,
      }).catch((e) =>
        console.error(`[knowledge] cache upsert failed for ${key}:`, e)
      );
    }
    return { pack: built.pack, sources: built.sources, builtAt: new Date(), fresh: false };
  }

  // 3. Build failed → fall back to a stale cache if we have one.
  if (cached) {
    const parsed = IndustryKnowledgePackSchema.safeParse(cached.pack);
    if (parsed.success) {
      return {
        pack: parsed.data,
        sources: cached.sources,
        builtAt: new Date(cached.builtAt),
        fresh: false,
      };
    }
  }
  return null;
}

/** Render the knowledge pack as labelled ground truth, with freshness + sources. */
export function formatIndustryKnowledge(k: BuiltKnowledge): string {
  const facts = k.pack.facts
    .map((f) => `- ${f.text}${f.source ? ` (${f.source})` : ""}`)
    .join("\n");
  const asOf = k.builtAt.toISOString().slice(0, 10);
  const sources = k.sources.length ? k.sources.join(", ") : "auto-research";
  return `AUTO-BUILT INDUSTRY KNOWLEDGE (real, as of ${asOf}${
    k.fresh ? "" : " — refreshed this run"
  }; treat as grounded context, cite sources when used):
${k.pack.summary}
${facts}
Sources: ${sources}
END INDUSTRY KNOWLEDGE.`;
}

/** Render the planning template as guidance for the planner. */
export function formatPlanningTemplate(k: BuiltKnowledge): string {
  const t = k.pack.planningTemplate;
  if (
    t.customerRoles.length === 0 &&
    t.keyDesks.length === 0 &&
    t.kpis.length === 0
  )
    return "";
  const desks = t.keyDesks
    .map((d) => `${d.name} (${d.domain})${d.why ? ` — ${d.why}` : ""}`)
    .join("; ");
  return `INDUSTRY PLANNING TEMPLATE for ${k.pack.industry} (use this to shape
desks and the audience — these are the REAL buyer types, segments and metrics
for this industry, which may differ from consumer-retail defaults):
- Customer/buyer types: ${t.customerRoles.join(", ") || "n/a"}
- Segments: ${t.segments.join(", ") || "n/a"}
- Suggested desks: ${desks || "n/a"}
- Key metrics (KPIs): ${t.kpis.join(", ") || "n/a"}
${t.notes ? `- Note: ${t.notes}` : ""}
Map these onto the available cohort roles/segments as closely as the schema
allows, and make each desk mission reflect these buyers and metrics.
END PLANNING TEMPLATE.`;
}

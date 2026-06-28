// ---------------------------------------------------------------------------
// The sourcing worker job. Builds a search query from the project's venture
// profile, runs each configured sourcing source (live when configured, else
// deterministic fixtures), dedupes against existing rows, and inserts new
// manufacturers into the project's sourcing table. Progress is streamed to the
// job result so the UI can poll it.
// ---------------------------------------------------------------------------
import { prisma } from "../db";
import { config } from "../config";
import { log } from "../log";
import { appendJobProgress } from "../jobs";
import { ClientProfileSchema } from "../schema";
import { createManufacturer } from "../manufacturers/store";
import { autoSources, getSource } from "./registry";
import type { RawManufacturer, SourcingQuery, SourcingSource } from "./types";

export type SourcingPayload = {
  projectId: string;
  /** Restrict to specific source keys; default = all auto-runnable sources. */
  sourceKeys?: string[];
  /** Rows to request per source (default 12). */
  limit?: number;
  /** "discover" (wide, pre-lab-report) vs "refine" (narrow, post-lab-report). */
  phase?: "discover" | "refine";
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "our", "that", "this", "from", "into",
  "product", "products", "brand", "premium", "quality", "made",
]);

function buildQuery(
  profile: ReturnType<typeof ClientProfileSchema.parse> | null,
  limit: number,
): SourcingQuery {
  const product = profile?.product?.trim() || profile?.category?.trim() || "product";
  const category = profile?.category?.trim() || undefined;
  const regions = (profile?.geography ?? []).filter(Boolean);
  const keywords = Array.from(
    new Set(
      `${category ?? ""} ${product}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    ),
  ).slice(0, 6);
  return { product, category, keywords, regions, limit };
}

// Dedupe key: prefer the website host (most reliable), else name+country.
function dedupeKey(name: string, country?: string | null, website?: string | null): string {
  if (website) {
    try {
      return "w:" + new URL(website).host.toLowerCase().replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return "n:" + name.trim().toLowerCase() + "|" + (country ?? "").trim().toLowerCase();
}

export async function runSourcingJob(
  payload: unknown,
  jobId?: string,
): Promise<Record<string, unknown>> {
  const p = (payload ?? {}) as SourcingPayload;
  if (!p.projectId) throw new Error("sourcing job missing projectId");
  const limit = Math.min(Math.max(p.limit ?? 12, 1), 50);

  const project = await prisma.project.findUnique({
    where: { id: p.projectId },
    select: { ventureProfile: true },
  });
  if (!project) throw new Error(`project not found: ${p.projectId}`);

  const profile = (() => {
    try {
      return project.ventureProfile ? ClientProfileSchema.parse(project.ventureProfile) : null;
    } catch {
      return null;
    }
  })();
  const query = buildQuery(profile, limit);
  await appendJobProgress(jobId, {
    label: "Built sourcing query",
    detail: `${query.product}${query.category ? ` (${query.category})` : ""} · regions: ${
      query.regions.join(", ") || "any"
    }`,
    status: "running",
  });

  const sources: SourcingSource[] = (p.sourceKeys?.length
    ? p.sourceKeys.map(getSource).filter((s): s is SourcingSource => Boolean(s))
    : autoSources()
  );
  if (!sources.length) throw new Error("no runnable sourcing sources");

  // Existing rows → dedupe set.
  const existing = await prisma.manufacturer.findMany({
    where: { projectId: p.projectId },
    select: { name: true, country: true, website: true },
  });
  const seen = new Set(existing.map((m) => dedupeKey(m.name, m.country, m.website)));

  const bySource: Record<string, number> = {};
  let found = 0;
  let inserted = 0;
  let skipped = 0;

  for (const source of sources) {
    const live = !config.mockMode && source.legalMode !== "manual_only" && source.isConfigured();
    let raws: RawManufacturer[] = [];
    try {
      raws = live ? await source.search(query) : source.mockSearch(query);
    } catch (e) {
      await appendJobProgress(jobId, {
        label: `${source.label} failed`,
        detail: e instanceof Error ? e.message : "search error",
        status: "failed",
      });
      log.warn("sourcing source failed", { source: source.key, error: String(e) });
      continue;
    }
    found += raws.length;

    let added = 0;
    for (const r of raws) {
      const key = dedupeKey(r.name, r.country, r.website);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      await createManufacturer(p.projectId, {
        name: r.name,
        products: r.products ?? null,
        region: r.region ?? null,
        country: r.country ?? null,
        website: r.website ?? null,
        source: source.key,
        sourceUrl: r.sourceUrl ?? null,
        moq: r.moq ?? null,
        moqUnit: r.moqUnit ?? "units",
        samplePrice: r.samplePrice ?? null,
        unitPrice: r.unitPrice ?? null,
        currency: r.currency ?? "USD",
        leadTimeDays: r.leadTimeDays ?? null,
        paymentTerms: r.paymentTerms ?? null,
        verified: r.verified ?? false,
        status: r.status ?? "lead",
      });
      added++;
      inserted++;
    }
    bySource[source.key] = added;
    await appendJobProgress(jobId, {
      label: `${source.label}${live ? "" : " (mock)"}`,
      detail: `${raws.length} found · ${added} added`,
      status: "done",
    });
  }

  return { found, inserted, skipped, bySource, query, phase: p.phase ?? "discover" };
}

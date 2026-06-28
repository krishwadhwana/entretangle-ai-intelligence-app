// Progression tracker — the founder-facing record of how solid each part of a
// venture is, scored over time. Shapes + presets shared by the store, the API
// and the UI. The DB model lives in prisma/schema.prisma (ProjectDimension).

import { z } from "zod";

// ── Status ──────────────────────────────────────────────────────────────────
export const DIMENSION_STATUSES = [
  "not_started",
  "in_progress",
  "blocked",
  "done",
] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

export const STATUS_LABELS: Record<DimensionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const DIMENSION_KINDS = ["score", "meter"] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];

export const DIMENSION_GROUPS = [
  "venture",
  "company",
  "supply",
  "sourcing",
  "general",
] as const;

export const GROUP_LABELS: Record<string, string> = {
  venture: "Venture",
  company: "Company & legal",
  supply: "Product & supply",
  sourcing: "Sourcing",
  general: "Other",
};

// ── Money-invested-vs-output meter bands ─────────────────────────────────────
// The user's meter: 10% VERY LOW → 25% getting started → 50% good (slight
// tweaks) → higher = dialled in. Rendered as a labelled band under the score.
export type MeterBand = { min: number; label: string; tone: "low" | "mid" | "good" | "high" };
export const MONEY_VS_OUTPUT_BANDS: MeterBand[] = [
  { min: 0, label: "Very low — early, lots to learn", tone: "low" },
  { min: 25, label: "Low but getting started, learning to improve output", tone: "mid" },
  { min: 50, label: "Good — some trial & error, product needs slight tweaks", tone: "good" },
  { min: 75, label: "Strong — investment is converting to real output", tone: "high" },
];

export function meterBand(pct: number): MeterBand {
  return [...MONEY_VS_OUTPUT_BANDS].reverse().find((b) => pct >= b.min) ?? MONEY_VS_OUTPUT_BANDS[0];
}

// ── Preset dimensions ────────────────────────────────────────────────────────
// Every project is seeded with these on first open. The user can add custom
// dimensions and nested scenarios on top (fixed-set + custom-add).
export type PresetDimension = {
  key: string;
  label: string;
  group: string;
  kind: DimensionKind;
  help: string;
};

export const PRESET_DIMENSIONS: PresetDimension[] = [
  {
    key: "idea",
    label: "Idea",
    group: "venture",
    kind: "score",
    help: "How solid is the core idea? (e.g. sim-tested, demand validated)",
  },
  {
    key: "planning",
    label: "Planning",
    group: "venture",
    kind: "score",
    help: "Team, product packaging, brand identity, operating plan.",
  },
  {
    key: "business_plan",
    label: "Business Plan",
    group: "venture",
    kind: "score",
    help: "Product, GTM fit, monetisation, gross & net margins.",
  },
  {
    key: "company_registration",
    label: "Company Registration",
    group: "company",
    kind: "score",
    help: "Add a scenario per jurisdiction/structure — each scored on its own.",
  },
  {
    key: "lab_report",
    label: "Product Lab Report",
    group: "supply",
    kind: "score",
    help: "Lab testing toward the product recipe — track ETA and money spent.",
  },
  {
    key: "money_vs_output",
    label: "Money Invested vs Output",
    group: "venture",
    kind: "meter",
    help: "How much has been invested relative to the output achieved so far.",
  },
];

export const PRESET_KEYS = new Set(PRESET_DIMENSIONS.map((p) => p.key));

// ── Wire shapes (API ⇄ UI) ───────────────────────────────────────────────────
export const EvidenceItemSchema = z.object({
  label: z.string().min(1).max(200),
  url: z.string().url().max(2000),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const CreateDimensionSchema = z.object({
  label: z.string().min(1).max(120),
  group: z.string().min(1).max(40).optional(),
  kind: z.enum(DIMENSION_KINDS).optional(),
  scoreMax: z.number().int().min(1).max(100000).optional(),
  // When present, the new dimension is a scenario nested under this dimension.
  parentId: z.string().min(1).max(60).optional(),
});

export const UpdateDimensionSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    score: z.number().int().min(0).max(100000).nullable().optional(),
    scoreMax: z.number().int().min(1).max(100000).optional(),
    status: z.enum(DIMENSION_STATUSES).optional(),
    notes: z.string().max(8000).nullable().optional(),
    eta: z.string().datetime().nullable().optional(),
    moneySpent: z.number().min(0).max(1e12).nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    evidence: z.array(EvidenceItemSchema).max(50).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export type DimensionEventDTO = {
  score: number | null;
  scoreMax: number | null;
  status: string | null;
  note: string | null;
  moneySpent: number | null;
  createdAt: string;
};

export type DimensionDTO = {
  id: string;
  parentId: string | null;
  key: string;
  label: string;
  group: string;
  kind: DimensionKind;
  isCustom: boolean;
  isScenario: boolean;
  score: number | null;
  scoreMax: number;
  status: DimensionStatus;
  notes: string | null;
  eta: string | null;
  moneySpent: number | null;
  currency: string;
  evidence: EvidenceItem[];
  sortOrder: number;
  help?: string;
  children: DimensionDTO[];
  history: DimensionEventDTO[];
};

// Overall venture progression = mean of normalised top-level score dimensions
// (meters and empty scores excluded). Scenarios roll up into their parent.
export function overallProgress(dims: DimensionDTO[]): number | null {
  const scored: number[] = [];
  for (const d of dims) {
    if (d.kind !== "score") continue;
    const value = effectiveScore(d);
    if (value === null) continue;
    scored.push(value);
  }
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}

// A dimension's normalised 0..100 score. If it has scenarios, use the best
// scenario (the chosen path), else its own score.
export function effectiveScore(d: DimensionDTO): number | null {
  const norm = (s: number | null, max: number) =>
    s === null ? null : Math.round((s / Math.max(1, max)) * 100);
  if (d.children.length) {
    const childScores = d.children
      .map((c) => norm(c.score, c.scoreMax))
      .filter((x): x is number => x !== null);
    if (childScores.length) return Math.max(...childScores);
  }
  return norm(d.score, d.scoreMax);
}

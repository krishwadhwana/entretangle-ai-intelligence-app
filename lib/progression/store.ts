// Data access for the venture progression tracker. All reads/writes for
// ProjectDimension + ProjectDimensionEvent live here (mirrors the lib/store.ts
// convention of keeping Prisma out of route handlers).

import { randomUUID } from "crypto";
import { prisma } from "../db";
import {
  PRESET_DIMENSIONS,
  PRESET_KEYS,
  EvidenceItemSchema,
  type DimensionDTO,
  type DimensionEventDTO,
  type DimensionKind,
  type DimensionStatus,
  type EvidenceItem,
} from "./presets";

type DimensionRow = {
  id: string;
  parentId: string | null;
  key: string;
  label: string;
  group: string;
  kind: string;
  isCustom: boolean;
  isScenario: boolean;
  score: number | null;
  scoreMax: number;
  status: string;
  notes: string | null;
  eta: Date | null;
  moneySpent: number | null;
  currency: string;
  evidence: unknown;
  sortOrder: number;
  history?: EventRow[];
  children?: DimensionRow[];
};

type EventRow = {
  score: number | null;
  scoreMax: number | null;
  status: string | null;
  note: string | null;
  moneySpent: number | null;
  createdAt: Date;
};

const HELP_BY_KEY = new Map(PRESET_DIMENSIONS.map((p) => [p.key, p.help]));

function parseEvidence(value: unknown): EvidenceItem[] {
  const parsed = EvidenceItemSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function toEventDTO(e: EventRow): DimensionEventDTO {
  return {
    score: e.score,
    scoreMax: e.scoreMax,
    status: e.status,
    note: e.note,
    moneySpent: e.moneySpent,
    createdAt: e.createdAt.toISOString(),
  };
}

function toDTO(row: DimensionRow): DimensionDTO {
  return {
    id: row.id,
    parentId: row.parentId,
    key: row.key,
    label: row.label,
    group: row.group,
    kind: row.kind as DimensionKind,
    isCustom: row.isCustom,
    isScenario: row.isScenario,
    score: row.score,
    scoreMax: row.scoreMax,
    status: row.status as DimensionStatus,
    notes: row.notes,
    eta: row.eta ? row.eta.toISOString() : null,
    moneySpent: row.moneySpent,
    currency: row.currency,
    evidence: parseEvidence(row.evidence),
    sortOrder: row.sortOrder,
    help: HELP_BY_KEY.get(row.key),
    children: (row.children ?? [])
      .map(toDTO)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    // stored newest-first; chart wants oldest-first
    history: (row.history ?? []).map(toEventDTO).reverse(),
  };
}

const HISTORY_INCLUDE = {
  orderBy: { createdAt: "desc" as const },
  take: 50,
};

// Seed the fixed preset dimensions for a project. Idempotent — safe to call on
// every first load (skipDuplicates + the @@unique([projectId, key])).
async function seedPresets(projectId: string): Promise<void> {
  await prisma.projectDimension.createMany({
    data: PRESET_DIMENSIONS.map((p, i) => ({
      projectId,
      key: p.key,
      label: p.label,
      group: p.group,
      kind: p.kind,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
}

// List the full progression tree for a project. Seeds presets on first access.
export async function listDimensions(projectId: string): Promise<DimensionDTO[]> {
  const count = await prisma.projectDimension.count({ where: { projectId } });
  if (count === 0) await seedPresets(projectId);

  const rows = await prisma.projectDimension.findMany({
    where: { projectId, parentId: null },
    orderBy: { sortOrder: "asc" },
    include: {
      history: HISTORY_INCLUDE,
      children: { include: { history: HISTORY_INCLUDE } },
    },
  });
  return rows.map((r) => toDTO(r as unknown as DimensionRow));
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${base || "dim"}_${randomUUID().slice(0, 6)}`;
}

export async function createDimension(
  projectId: string,
  input: {
    label: string;
    group?: string;
    kind?: DimensionKind;
    scoreMax?: number;
    parentId?: string;
  },
): Promise<DimensionDTO> {
  let group = input.group ?? "general";
  let isScenario = false;

  // A scenario must hang off a dimension owned by the same project.
  if (input.parentId) {
    const parent = await prisma.projectDimension.findFirst({
      where: { id: input.parentId, projectId, parentId: null },
    });
    if (!parent) throw new Error("parent not found");
    group = parent.group;
    isScenario = true;
  }

  const last = await prisma.projectDimension.findFirst({
    where: { projectId, parentId: input.parentId ?? null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.projectDimension.create({
    data: {
      projectId,
      parentId: input.parentId ?? null,
      key: slugify(input.label),
      label: input.label,
      group,
      kind: isScenario ? "score" : input.kind ?? "score",
      isCustom: true,
      isScenario,
      scoreMax: input.scoreMax ?? 100,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    include: { history: HISTORY_INCLUDE, children: { include: { history: HISTORY_INCLUDE } } },
  });
  return toDTO(created as unknown as DimensionRow);
}

type UpdatePatch = {
  label?: string;
  score?: number | null;
  scoreMax?: number;
  status?: DimensionStatus;
  notes?: string | null;
  eta?: string | null;
  moneySpent?: number | null;
  currency?: string;
  evidence?: EvidenceItem[];
  sortOrder?: number;
};

export async function updateDimension(
  projectId: string,
  dimensionId: string,
  patch: UpdatePatch,
): Promise<DimensionDTO> {
  const existing = await prisma.projectDimension.findFirst({
    where: { id: dimensionId, projectId },
  });
  if (!existing) throw new Error("not found");

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.score !== undefined) data.score = patch.score;
  if (patch.scoreMax !== undefined) data.scoreMax = patch.scoreMax;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.eta !== undefined) data.eta = patch.eta ? new Date(patch.eta) : null;
  if (patch.moneySpent !== undefined) data.moneySpent = patch.moneySpent;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.evidence !== undefined) data.evidence = patch.evidence;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

  // Snapshot history only when a tracked value actually changes.
  const scoreChanged = patch.score !== undefined && patch.score !== existing.score;
  const maxChanged = patch.scoreMax !== undefined && patch.scoreMax !== existing.scoreMax;
  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  const moneyChanged =
    patch.moneySpent !== undefined && patch.moneySpent !== existing.moneySpent;
  const shouldSnapshot = scoreChanged || maxChanged || statusChanged || moneyChanged;

  const [updated] = await prisma.$transaction([
    prisma.projectDimension.update({
      where: { id: dimensionId },
      data,
      include: { history: HISTORY_INCLUDE, children: { include: { history: HISTORY_INCLUDE } } },
    }),
    ...(shouldSnapshot
      ? [
          prisma.projectDimensionEvent.create({
            data: {
              dimensionId,
              score: patch.score !== undefined ? patch.score : existing.score,
              scoreMax: patch.scoreMax !== undefined ? patch.scoreMax : existing.scoreMax,
              status: patch.status !== undefined ? patch.status : existing.status,
              moneySpent:
                patch.moneySpent !== undefined ? patch.moneySpent : existing.moneySpent,
            },
          }),
        ]
      : []),
  ]);

  // The snapshot we just wrote isn't in `updated.history` (same transaction);
  // re-read so the returned DTO includes it. Cheap, and keeps the UI in sync.
  if (shouldSnapshot) {
    const fresh = await prisma.projectDimension.findUnique({
      where: { id: dimensionId },
      include: { history: HISTORY_INCLUDE, children: { include: { history: HISTORY_INCLUDE } } },
    });
    if (fresh) return toDTO(fresh as unknown as DimensionRow);
  }
  return toDTO(updated as unknown as DimensionRow);
}

// Delete a custom dimension or any scenario. Preset roots can't be deleted
// (they keep cross-project analytics consistent) — only reset.
export async function deleteDimension(
  projectId: string,
  dimensionId: string,
): Promise<void> {
  const existing = await prisma.projectDimension.findFirst({
    where: { id: dimensionId, projectId },
  });
  if (!existing) throw new Error("not found");
  if (PRESET_KEYS.has(existing.key) && !existing.isScenario) {
    throw new Error("preset dimensions cannot be deleted");
  }
  await prisma.projectDimension.delete({ where: { id: dimensionId } });
}

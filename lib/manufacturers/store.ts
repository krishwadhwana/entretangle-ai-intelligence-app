// Data access for the manufacturer sourcing table.

import { prisma } from "../db";
import type { ManufacturerDTO, ManufacturerStatus } from "./types";

type Row = {
  id: string;
  name: string;
  products: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  source: string;
  sourceUrl: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  moq: number | null;
  moqUnit: string;
  samplePrice: number | null;
  unitPrice: number | null;
  currency: string;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  status: string;
  verified: boolean;
  rating: number | null;
  notes: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function toDTO(r: Row): ManufacturerDTO {
  return {
    id: r.id,
    name: r.name,
    products: r.products,
    region: r.region,
    country: r.country,
    website: r.website,
    source: r.source,
    sourceUrl: r.sourceUrl,
    contactName: r.contactName,
    email: r.email,
    phone: r.phone,
    moq: r.moq,
    moqUnit: r.moqUnit,
    samplePrice: r.samplePrice,
    unitPrice: r.unitPrice,
    currency: r.currency,
    leadTimeDays: r.leadTimeDays,
    paymentTerms: r.paymentTerms,
    status: r.status as ManufacturerStatus,
    verified: r.verified,
    rating: r.rating,
    notes: r.notes,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listManufacturers(projectId: string): Promise<ManufacturerDTO[]> {
  const rows = await prisma.manufacturer.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => toDTO(r as unknown as Row));
}

type CreateInput = Partial<Omit<ManufacturerDTO, "id" | "createdAt" | "updatedAt" | "sortOrder">> & {
  name: string;
};

export async function createManufacturer(
  projectId: string,
  input: CreateInput,
): Promise<ManufacturerDTO> {
  const last = await prisma.manufacturer.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.manufacturer.create({
    data: {
      projectId,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      ...stripUndefined(input),
      name: input.name, // explicit (required) — survives the Partial spread above
    },
  });
  return toDTO(created as unknown as Row);
}

export async function updateManufacturer(
  projectId: string,
  manufacturerId: string,
  patch: Partial<ManufacturerDTO>,
): Promise<ManufacturerDTO> {
  // Scope the update to the project so one project can't edit another's rows.
  const result = await prisma.manufacturer.updateMany({
    where: { id: manufacturerId, projectId },
    data: stripUndefined(patch),
  });
  if (result.count === 0) throw new Error("not found");
  const fresh = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  return toDTO(fresh as unknown as Row);
}

export async function deleteManufacturer(
  projectId: string,
  manufacturerId: string,
): Promise<void> {
  const result = await prisma.manufacturer.deleteMany({
    where: { id: manufacturerId, projectId },
  });
  if (result.count === 0) throw new Error("not found");
}

// Drop keys not meant for the DB and undefined values (Prisma treats undefined
// as "leave unchanged", but id/timestamps must never be written).
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (k === "id" || k === "createdAt" || k === "updatedAt") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

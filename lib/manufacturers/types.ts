// Manufacturer sourcing — shapes shared by the store, API and UI. The DB model
// is Manufacturer in prisma/schema.prisma. Rows are added manually today and by
// a sourcing agent later (scraping/contacting directories).

import { z } from "zod";

// Sourcing pipeline stages.
export const MANUFACTURER_STATUSES = [
  "lead",
  "contacted",
  "quoted",
  "sampling",
  "approved",
  "rejected",
] as const;
export type ManufacturerStatus = (typeof MANUFACTURER_STATUSES)[number];

export const STATUS_LABELS: Record<ManufacturerStatus, string> = {
  lead: "Lead",
  contacted: "Contacted",
  quoted: "Quoted",
  sampling: "Sampling",
  approved: "Approved",
  rejected: "Rejected",
};

// Where a row came from. `manual` plus the directories the user listed — used
// to label rows and (later) to drive the scraping agent.
export const MANUFACTURER_SOURCES = [
  "manual",
  "alibaba",
  "aliexpress",
  "taobao",
  "indiamart",
  "thomasnet",
  "europages",
  "hktdc",
  "globalsources",
  "made_in_china",
  "kompass",
  "tradekey",
  "ec21",
  "importyeti",
  "panjiva",
  "volza",
  "zoominfo",
  "apollo",
  "other",
] as const;

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  alibaba: "Alibaba",
  aliexpress: "AliExpress",
  taobao: "Taobao",
  indiamart: "IndiaMART",
  thomasnet: "ThomasNet",
  europages: "Europages",
  hktdc: "HKTDC",
  globalsources: "Global Sources",
  made_in_china: "Made-in-China",
  kompass: "Kompass",
  tradekey: "TradeKey",
  ec21: "EC21",
  importyeti: "ImportYeti",
  panjiva: "Panjiva",
  volza: "Volza",
  zoominfo: "ZoomInfo",
  apollo: "Apollo.io",
  other: "Other",
};

export const REGIONS = [
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Africa",
  "Oceania",
] as const;

const optionalString = (max: number) =>
  z.string().max(max).nullable().optional();

export const CreateManufacturerSchema = z.object({
  name: z.string().min(1).max(200),
  products: optionalString(500),
  region: optionalString(80),
  country: optionalString(80),
  website: optionalString(2000),
  source: z.string().max(40).optional(),
  sourceUrl: optionalString(2000),
  contactName: optionalString(200),
  email: optionalString(320),
  phone: optionalString(60),
  moq: z.number().int().min(0).max(1e9).nullable().optional(),
  moqUnit: z.string().max(40).optional(),
  samplePrice: z.number().min(0).max(1e12).nullable().optional(),
  unitPrice: z.number().min(0).max(1e12).nullable().optional(),
  currency: z.string().max(8).optional(),
  leadTimeDays: z.number().int().min(0).max(100000).nullable().optional(),
  paymentTerms: optionalString(500),
  status: z.enum(MANUFACTURER_STATUSES).optional(),
  verified: z.boolean().optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  notes: optionalString(8000),
});

export const UpdateManufacturerSchema = CreateManufacturerSchema.partial()
  .extend({ sortOrder: z.number().int().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export type ManufacturerDTO = {
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
  status: ManufacturerStatus;
  verified: boolean;
  rating: number | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

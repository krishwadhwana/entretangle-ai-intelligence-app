import { z } from "zod";
import {
  BlockParamsSchema,
  type BlockParams,
  type CohortStats,
} from "./schema";

// Typed codecs for legacy JSON-in-text columns. These keep parsing/stringifying
// behavior consistent until the hot fields are migrated to native Json columns.

const StringArraySchema = z.array(z.string());
const UnknownRecordSchema = z.record(z.unknown());

function parseJson<T>(
  value: string | null | undefined,
  schema: z.ZodType<T>,
  fallback: T,
  label: string
): T {
  if (value == null || value === "") return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the uniform error below
  }
  throw new Error(`Invalid ${label} JSON field`);
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseStringArrayField(
  value: string | null | undefined,
  label: string
): string[] {
  return parseJson(value, StringArraySchema, [], label);
}

export function parseLowerStringArrayField(
  value: string | null | undefined,
  label: string
): string[] {
  return parseStringArrayField(value, label).map((item) => item.toLowerCase());
}

export function encodeStringArrayField(values: string[]): string {
  return encodeJson(values);
}

export function encodeLowerStringArrayField(values: string[]): string {
  return encodeJson(values.map((value) => value.toLowerCase()));
}

export function parseBlockParamsField(value: string): BlockParams {
  return parseJson(value, BlockParamsSchema, {}, "block params");
}

export function encodeBlockParamsField(value: BlockParams): string {
  return encodeJson(BlockParamsSchema.parse(value));
}

export function parseObjectField(
  value: string | null | undefined,
  label: string
): Record<string, unknown> {
  return parseJson(value, UnknownRecordSchema, {}, label);
}

export function parseCohortStatsField(
  value: string | null | undefined
): CohortStats | null {
  if (!value) return null;
  return JSON.parse(value) as CohortStats;
}

export function encodeCohortStatsField(stats: CohortStats): string {
  return encodeJson(stats);
}

// Sourcing source registry. The job layer resolves sources through here, so
// adding a source is a one-line registration. Today: ImportYeti (licensed
// trade-data feed). Next legally-clean sources to add: IndiaMART API, Alibaba
// Open Platform, Apollo/ZoomInfo for contact enrichment.
import type { SourcingSource } from "./types";
import { importYetiSource } from "./sources/importyeti";

const SOURCES: SourcingSource[] = [importYetiSource];

const BY_KEY = new Map<string, SourcingSource>(SOURCES.map((s) => [s.key, s]));

export function getSource(key: string): SourcingSource | undefined {
  return BY_KEY.get(key);
}

/** Sources that may run automatically — never `manual_only` (ToS-restricted). */
export function autoSources(): SourcingSource[] {
  return SOURCES.filter((s) => s.legalMode !== "manual_only");
}

export const SOURCE_KEYS = SOURCES.map((s) => s.key);

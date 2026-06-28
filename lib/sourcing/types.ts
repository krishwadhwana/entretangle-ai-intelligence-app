// Manufacturer sourcing — the connector contract for sources that find
// suppliers for a venture's product. Mirrors lib/integrations/types.ts: every
// source (a trade-data feed, a directory API, a contact-enrichment API)
// implements `SourcingSource`; the job layer only ever talks to this interface.
// Each source normalizes its results into provider-agnostic `RawManufacturer`
// rows that land in the Manufacturer table.
//
// LEGAL NOTE: only `api` and `licensed_feed` sources run automatically. Raw
// scraping of sites whose ToS forbid it (Alibaba/ZoomInfo/Apollo UIs, …) is
// `manual_only` and never auto-run. See docs/venture-platform-handoff.md §4.2.

import type { ManufacturerStatus } from "../manufacturers/types";

export type SourcingLegalMode = "api" | "licensed_feed" | "manual_only";

/** What we're looking for — derived from the venture profile (and, later, the
 *  lab-report spec). */
export type SourcingQuery = {
  product: string;
  category?: string;
  keywords: string[];
  /** Regions or countries to bias toward (e.g. "Asia", "India"). Empty = any. */
  regions: string[];
  /** Max rows to pull per source. */
  limit: number;
};

/** A supplier as a source returns it, before normalization into Manufacturer. */
export type RawManufacturer = {
  name: string;
  products?: string | null;
  country?: string | null;
  region?: string | null;
  website?: string | null;
  sourceUrl?: string | null;
  moq?: number | null;
  moqUnit?: string | null;
  samplePrice?: number | null;
  unitPrice?: number | null;
  currency?: string | null;
  leadTimeDays?: number | null;
  paymentTerms?: string | null;
  verified?: boolean;
  /** Optional pipeline hint; defaults to "lead" on insert. */
  status?: ManufacturerStatus;
};

export interface SourcingSource {
  /** Stable key — MUST match a value in MANUFACTURER_SOURCES so the row's
   *  `source` records true provenance. */
  key: string;
  label: string;
  legalMode: SourcingLegalMode;

  /** True when real credentials/feed access are configured (else mockSearch). */
  isConfigured(): boolean;

  /** Pull from the live API/feed and normalize. Only called when isConfigured()
   *  and the source is not manual_only. */
  search(query: SourcingQuery): Promise<RawManufacturer[]>;

  /** Deterministic, seeded fixtures used before credentials land / in MOCK_MODE,
   *  so the whole pipeline is exercised end-to-end without external calls. */
  mockSearch(query: SourcingQuery): RawManufacturer[];
}

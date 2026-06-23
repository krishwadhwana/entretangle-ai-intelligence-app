import { config } from "../config";
import { fetchAppliedTariffPct } from "./trade";

// ---------------------------------------------------------------------------
// Export landed-cost data (Phase 3). Constants are slow-moving rate cards +
// statutory fees encoded as overridable priors; the live bits (import duty, FX)
// are best-effort fetches that never throw (null/fallback ⇒ caller's default).
// All monetary constants are destination-currency (USD) unless noted.
//
// PROVENANCE: freight/3PL/marketplace figures are MODEL ESTIMATES (typical 2024–25
// India→US rates); US entry fees (MPF/HMF) are statutory rates; de-minimis and
// sales-tax are policy values that move — treat as priors, cite + verify per run.
// ---------------------------------------------------------------------------

// International freight + origin handling (USD).
export const FREIGHT = {
  airParcelBaseUsd: 4, // per-parcel pickup/last-mile baked into express carriers
  airParcelUsdPerKg: 7.5, // India→US express air, blended
  seaLclUsdPerKg: 1.6, // containerized ocean LCL, amortized per kg
  insurancePctOfCif: 0.01, // cargo insurance as a fraction of CIF value
};

// US Customs entry fees (statutory). MPF + HMF are charged on the shipment's
// declared value; brokerage is per entry. The engine amortizes per unit.
export const US_ENTRY = {
  mpfPct: 0.003464, // merchandise processing fee
  mpfMinUsd: 31.67,
  mpfMaxUsd: 614.35,
  hmfPct: 0.00125, // harbor maintenance fee — OCEAN imports only
  brokerageUsd: 125, // customs brokerage per entry
};

// US-side fulfillment from a 3PL (bulk_warehouse path), USD per unit.
export const US_3PL = {
  pickPackUsd: 3.0,
  lastMileUsd: 6.5,
  storagePerUnitUsd: 0.5,
};

// Marketplace (Amazon US) economics — replaces CAC + 3PL with platform fees.
export const MARKETPLACE = {
  referralPct: 0.15, // referral fee on sale price
  fbaBaseUsd: 3.5, // FBA fulfillment base
  fbaUsdPerKg: 4.0, // FBA size/weight component
};

// Destination policy/tax priors (verify per run — these move).
export const US_AVG_SALES_TAX_PCT = 7.5; // avg combined state+local
export const DE_MINIMIS_USD = 800; // Section 321 informal-entry threshold
export const DE_MINIMIS_NOTE =
  "US de-minimis (Section 321, <$800 duty-free for DTC parcels) has been in flux through 2025 — verify the current rule for this corridor before relying on it.";

// FX fallback if the live fetch fails. Live fetch remains authoritative; this
// prior was refreshed against open.er-api.com on 2026-06-23.
export const DEFAULT_FX: Record<string, number> = {
  "INR:USD": 0.01056,
  "USD:INR": 94.7,
};

/**
 * Live mid-market FX rate: 1 `from` unit = N `to` units. Best-effort against a
 * keyless public API with a short timeout; falls back to DEFAULT_FX (or 1 for an
 * unknown pair). Never throws. Returns the rate + a source tag for citation.
 */
export async function fetchFxRate(
  from: string,
  to: string
): Promise<{ rate: number; source: string }> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return { rate: 1, source: "identity" };
  const fallback = DEFAULT_FX[`${f}:${t}`] ?? 1;
  if (config.mockMode) return { rate: fallback, source: "mock" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://open.er-api.com/v6/latest/${f}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`${res.status}`);
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[t];
    if (typeof rate === "number" && rate > 0)
      return { rate, source: "https://open.er-api.com" };
  } catch {
    // fall through to the prior
  }
  return { rate: fallback, source: "prior (no live FX)" };
}

/**
 * Destination import duty % for an HS code (defaults to the US). Thin wrapper over
 * the WITS source so the export builder has one entry point. null ⇒ caller's default.
 */
export async function fetchImportDutyPct(
  hsCode: string,
  destIso2 = "US"
): Promise<{ pct: number; source: string } | null> {
  if (!hsCode) return null;
  const pct = await fetchAppliedTariffPct(destIso2, hsCode);
  return pct == null ? null : { pct, source: "https://wits.worldbank.org" };
}

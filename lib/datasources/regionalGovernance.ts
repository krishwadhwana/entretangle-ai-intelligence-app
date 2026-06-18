import { regionForLocality } from "./politicalGeography";

// ---------------------------------------------------------------------------
// Regional governance / business-environment signal (India). FACTUAL + NEUTRAL:
// the Govt of India DPIIT "Business Reform Action Plan" (BRAP) Ease-of-Doing-
// Business state categories. This is an operating-environment signal for the
// VENTURE (where it's easier/harder to set up + run), NOT partisan or electoral
// data — and deliberately not modelled as such.
//
// Source: DPIIT, Ministry of Commerce & Industry — Business Reform Action Plan
// (https://eodb.dpiit.gov.in/). Categories are the published 4-tier grouping
// (latest BRAP cycle). Treat as a coarse, dated prior — verify the current
// release before relying on it. Note: GST is a NATIONAL tax (no state-rate
// variation), so it is intentionally not represented as a per-state difference.
// ---------------------------------------------------------------------------

export type EodbBand = "Top Achiever" | "Achiever" | "Aspirer" | "Emerging";

// State → DPIIT BRAP Ease-of-Doing-Business category (latest published cycle).
const STATE_EODB: Record<string, EodbBand> = {
  // Top Achievers
  "Andhra Pradesh": "Top Achiever",
  Gujarat: "Top Achiever",
  Haryana: "Top Achiever",
  Karnataka: "Top Achiever",
  Punjab: "Top Achiever",
  "Tamil Nadu": "Top Achiever",
  Telangana: "Top Achiever",
  // Achievers
  "Himachal Pradesh": "Achiever",
  "Madhya Pradesh": "Achiever",
  Maharashtra: "Achiever",
  Odisha: "Achiever",
  Uttarakhand: "Achiever",
  "Uttar Pradesh": "Achiever",
  // Aspirers
  Assam: "Aspirer",
  Chhattisgarh: "Aspirer",
  Goa: "Aspirer",
  Jharkhand: "Aspirer",
  Kerala: "Aspirer",
  Rajasthan: "Aspirer",
  "West Bengal": "Aspirer",
  // Emerging Business Ecosystems
  Bihar: "Emerging",
  Chandigarh: "Emerging",
  Delhi: "Emerging",
  "Jammu & Kashmir": "Emerging",
  Puducherry: "Emerging",
};

export const EODB_SOURCE =
  "DPIIT Business Reform Action Plan (eodb.dpiit.gov.in), latest published cycle";

/** Ease-of-doing-business band for a state, or null if unclassified. */
export function eodbForState(state: string | null): EodbBand | null {
  return state ? (STATE_EODB[state] ?? null) : null;
}

/**
 * One-line regional business-environment summary for the venture's operating
 * localities, e.g. "Karnataka: Top Achiever, Maharashtra: Achiever". Empty when
 * no Indian localities resolve. Sourced + dated; flagged as a coarse prior.
 */
export function formatRegionalGovernance(
  localities: { name: string; country?: string }[]
): string {
  const byState = new Map<string, EodbBand>();
  for (const l of localities) {
    const state = regionForLocality(l.name, l.country)?.state ?? null;
    const band = eodbForState(state);
    if (state && band) byState.set(state, band);
  }
  if (byState.size === 0) return "";
  const entries = Array.from(byState.entries())
    .map(([s, b]) => `${s}: ${b}`)
    .join("; ");
  return `REGIONAL BUSINESS ENVIRONMENT (ease of doing business by state — operating
context for the venture, not consumer demand; factual/neutral): ${entries}.
Source: ${EODB_SOURCE} — coarse, dated prior; verify current release. GST is
national (no per-state rate difference).`;
}

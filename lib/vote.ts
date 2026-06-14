// ---------------------------------------------------------------------------
// Shared "vote" semantics. A persona's vote is derived purely from its intent
// score (0–1) so the API, CohortDrawer and InsightsView all agree on what
// "reject / mixed / approve" means. Keep these thresholds in one place.
// ---------------------------------------------------------------------------

export type Sentiment = "approve" | "mixed" | "reject";

// Approve at >=65%, reject at <=35%, mixed in between.
export const APPROVE_MIN = 0.65;
export const REJECT_MAX = 0.35;

// Anyone below the approve line is a "rejector" we can try to win back
// (reject + mixed — i.e. everyone who isn't already an approver).
export const REJECTOR_MAX = APPROVE_MIN;

export function classifySentiment(intent: number): Sentiment {
  if (intent >= APPROVE_MIN) return "approve";
  if (intent <= REJECT_MAX) return "reject";
  return "mixed";
}

export function isRejector(intent: number): boolean {
  return intent < REJECTOR_MAX;
}

export const SENTIMENT_META: Record<
  Sentiment,
  { label: string; color: string }
> = {
  approve: { label: "Approve", color: "#10b981" },
  mixed: { label: "Mixed", color: "#f59e0b" },
  reject: { label: "Reject", color: "#ef4444" },
};

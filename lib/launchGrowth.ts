import type { AssumptionUpdate } from "./schema";

const EXPLICIT_PERCENT_RE =
  /[+-]?\d+(?:\.\d+)?\s*(?:%|percent(?:age)?(?:\s*points?)?)/gi;

const MONTHLY_GROWTH_CONTEXT_RE =
  /\b(?:mom|m\/m|month[\s-]*(?:over|on)[\s-]*month|monthly\s+(?:growth|demand|acquisition|orders?|customers?|revenue)|(?:growth|grow(?:ing|s)?|demand|acquisition|orders?|customers?|revenue)\s*(?:\/|per|each)\s*(?:mo|month)|(?:per|each)\s+month)\b/i;

export function hasExplicitMonthlyGrowthPct(text: string): boolean {
  const normalized = text.toLowerCase();
  let match: RegExpExecArray | null;
  EXPLICIT_PERCENT_RE.lastIndex = 0;

  while ((match = EXPLICIT_PERCENT_RE.exec(normalized))) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(normalized.length, match.index + match[0].length + 80);
    const window = normalized.slice(start, end);
    if (MONTHLY_GROWTH_CONTEXT_RE.test(window)) return true;
  }

  return false;
}

export function removeImplicitMonthlyGrowthChanges(
  update: AssumptionUpdate,
  founderKnowledge: string
): AssumptionUpdate {
  if (hasExplicitMonthlyGrowthPct(founderKnowledge)) return update;

  const changes = update.changes.filter(
    (change) => change.field !== "monthlyGrowthPct"
  );
  if (changes.length === update.changes.length) return update;

  return {
    ...update,
    changes,
    caveats: [
      ...update.caveats,
      "MoM growth stayed on product-derived auto because no explicit monthly growth percentage was provided.",
    ],
  };
}

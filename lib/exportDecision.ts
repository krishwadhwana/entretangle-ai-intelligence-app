import type { ExportScenarioResult, ExportViabilityReport } from "./schema";

export type ExportDecision = {
  stance: "export" | "pilot" | "hold" | "unknown";
  label: string;
  title: string;
  rationale: string;
  scenario: ExportScenarioResult | null;
};

export function deriveExportDecision(report: ExportViabilityReport): ExportDecision {
  const best = report.recommended
    ? report.scenarios.find((s) => s.path === report.recommended?.path) ?? null
    : null;

  if (!best || best.wtpCoveragePct == null) {
    return {
      stance: "unknown",
      label: "No verdict yet",
      title: "Need destination WTP data before deciding",
      rationale:
        "The landed-cost prices are available, but the destination audience has not been scored for willingness to pay.",
      scenario: best,
    };
  }

  const launchNet = best.launch?.netProfit ?? null;
  const launchIsProfitable = launchNet == null || launchNet >= 0;

  if (best.verdict === "viable" && launchIsProfitable) {
    return {
      stance: "export",
      label: "Export",
      title: "Export this good",
      rationale:
        launchNet == null
          ? "The best path clears the viability threshold on willingness to pay."
          : "The best path clears the willingness-to-pay threshold and the 90-day launch model is profitable.",
      scenario: best,
    };
  }

  if (best.verdict === "viable") {
    return {
      stance: "pilot",
      label: "Pilot only",
      title: "Do not export at scale yet",
      rationale:
        "Demand can support the price, but the modeled 90-day launch is still negative. Validate with a small paid pilot before committing inventory.",
      scenario: best,
    };
  }

  if (best.verdict === "marginal") {
    return {
      stance: "pilot",
      label: "Pilot only",
      title: "Pilot only, not a full export",
      rationale:
        "The best path reaches some buyers, but not enough of the destination audience to justify a full export launch yet.",
      scenario: best,
    };
  }

  return {
    stance: "hold",
    label: "Do not export",
    title: "Do not export this good yet",
    rationale:
      "The required export price is above what most of the destination audience is willing to pay.",
    scenario: best,
  };
}

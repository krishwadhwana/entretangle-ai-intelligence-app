"use client";

import type {
  AudienceAggregate,
  Block,
  FinalReport,
  LaunchSimRecord,
  ExportViabilityReport,
} from "@/lib/schema";
import type { Dossier, DossierSection, KPI } from "./pdf";

// ---------------------------------------------------------------------------
// Assemble a comprehensive, graphical run dossier from everything the dashboard
// knows: the final report, the simulated audience, the launch trajectory, and
// (for export runs) the cross-border viability. Pure data → Dossier; the actual
// PDF drawing lives in pdf.ts.
// ---------------------------------------------------------------------------

const SEG_ORDER = ["budget", "middle", "affluent", "luxury"];
const SEG_COLOR: Record<string, [number, number, number]> = {
  budget: [148, 163, 184],
  middle: [99, 102, 241],
  affluent: [16, 185, 129],
  luxury: [245, 158, 11],
};

function sym(currency: string): string {
  // jsPDF's core fonts are Latin-1 — the ₹ glyph won't render, so use "Rs".
  if (currency === "INR") return "Rs ";
  if (currency === "USD") return "$";
  return `${currency} `;
}
function money(n: number, currency: string): string {
  const s = sym(currency);
  const a = Math.abs(n);
  const v =
    a >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr`
    : a >= 1e5 ? `${(n / 1e5).toFixed(2)}L`
    : Math.round(n).toLocaleString();
  return `${s}${v}`;
}

export type RunDossierInput = {
  brief: string;
  mode?: string;
  targetMarket?: string | null;
  currency: string;
  report: FinalReport | null;
  aggregate: AudienceAggregate | null;
  worldModel: { conclusionCount: number; blockCount: number } | null;
  blocks: Block[];
  launch?: LaunchSimRecord | null;
  exportReport?: ExportViabilityReport | null;
  generatedOn: string; // ISO/locale date (passed in to keep this pure)
};

export function buildRunDossier(inp: RunDossierInput): Dossier {
  const {
    brief, mode, targetMarket, currency, report, aggregate, worldModel,
    blocks, launch, exportReport, generatedOn,
  } = inp;
  const isExport = mode === "export";
  const sections: DossierSection[] = [];

  // --- audience headline numbers ---
  const segEntries = aggregate
    ? SEG_ORDER.filter((s) => aggregate.bySegment[s]).map((s) => ({ seg: s, ...aggregate.bySegment[s] }))
    : [];
  const nTot = segEntries.reduce((a, s) => a + s.n, 0) || 1;
  const blendedIntent = segEntries.reduce((a, s) => a + s.meanIntent * s.n, 0) / nTot;
  const blendedWtp = segEntries.reduce((a, s) => a + s.wtpP50 * s.n, 0) / nTot;

  // --- cover KPIs ---
  const coverKpis: KPI[] = [];
  if (aggregate) {
    coverKpis.push({ label: "Personas", value: aggregate.totalPersonas.toLocaleString() });
    coverKpis.push({ label: "Cohorts", value: String(aggregate.totalCohorts) });
    coverKpis.push({ label: "Avg intent", value: `${Math.round(blendedIntent * 100)}%` });
    coverKpis.push({ label: "Median WTP", value: money(blendedWtp, currency) });
  } else if (worldModel) {
    coverKpis.push({ label: "Findings", value: String(worldModel.conclusionCount) });
    coverKpis.push({ label: "Research desks", value: String(worldModel.blockCount) });
  }

  // --- executive summary ---
  if (report?.executiveSummary)
    sections.push({ heading: "Executive summary", body: report.executiveSummary });

  // --- audience analysis (charts) ---
  if (aggregate) {
    const aud: DossierSection = {
      heading: "Audience analysis",
      kpis: [
        { label: "Simulated buyers", value: aggregate.totalPersonas.toLocaleString() },
        { label: "Cohorts", value: String(aggregate.totalCohorts), sub: "locality × segment × role" },
        { label: "Avg purchase intent", value: `${Math.round(blendedIntent * 100)}%`,
          tone: blendedIntent >= 0.45 ? "good" : blendedIntent < 0.3 ? "bad" : "neutral" },
        { label: "Median willingness-to-pay", value: money(blendedWtp, currency) },
      ],
    };
    sections.push(aud);

    if (segEntries.length)
      sections.push({
        bars: {
          title: "Median willingness-to-pay by income segment",
          money: true,
          data: segEntries.map((s) => ({
            label: s.seg, value: Math.round(s.wtpP50), color: SEG_COLOR[s.seg],
          })),
        },
      });

    if (segEntries.length)
      sections.push({
        bars: {
          title: "Purchase intent by segment",
          unit: "%",
          data: segEntries.map((s) => ({
            label: s.seg, value: Math.round(s.meanIntent * 100), color: SEG_COLOR[s.seg],
          })),
        },
      });

    if (aggregate.channelShare?.length)
      sections.push({
        share: {
          title: "Discovery channel mix",
          data: aggregate.channelShare.slice(0, 7).map((c) => ({ label: c.name, value: c.share })),
        },
      });

    if (aggregate.topObjections?.length)
      sections.push({
        bars: {
          title: "Top purchase objections (mentions)",
          data: aggregate.topObjections.slice(0, 6).map((o) => ({ label: o.text, value: o.count })),
        },
      });

    const zones = Object.entries(aggregate.byZone ?? {});
    if (zones.length > 1)
      sections.push({
        bars: {
          title: "Audience by region",
          data: zones.map(([z, s]) => ({ label: z, value: s.n })),
        },
      });
  }

  // --- key findings (report sections, or raw conclusions as fallback) ---
  if (report?.sections?.length) {
    sections.push({ heading: "Key findings", pageBreak: true });
    for (const s of report.sections)
      sections.push({ heading: s.title, body: s.summary, bullets: s.bullets });
  } else {
    const concl = blocks
      .flatMap((b) => b.conclusions ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12)
      .map((c) => `${c.claim} — ${c.value} (${Math.round(c.confidence * 100)}% conf)`);
    if (concl.length)
      sections.push({ heading: "Key findings", bullets: concl, pageBreak: true });
  }

  // --- launch outlook ---
  if (launch?.result) {
    const r = launch.result;
    const sm = r.summary;
    const cur = launch.inputs.currency || currency;
    sections.push({
      heading: `Launch outlook — ${launch.name}`,
      pageBreak: true,
      kpis: [
        { label: "Net profit", value: money(sm.netProfit, cur),
          tone: sm.netProfit >= 0 ? "good" : "bad", sub: `${sm.netMarginPct}% margin` },
        { label: "Orders", value: sm.totalOrders.toLocaleString(),
          sub: `${sm.returningCustomerSharePct}% returning` },
        { label: "Blended CAC", value: money(sm.blendedCac, cur) },
        { label: "Refund rate", value: `${sm.refundRatePct}%`,
          tone: sm.refundRatePct > 15 ? "bad" : "neutral" },
        { label: "Break-even", value: sm.breakEvenLabel ?? "Not reached",
          tone: sm.breakEvenLabel ? "good" : "bad", sub: `peak capital ${money(sm.peakCapitalNeeded, cur)}` },
        { label: "Deadstock", value: `${Math.round(sm.deadstockUnits)} units`,
          sub: money(sm.deadstockValue, cur) },
      ],
    });
    const tl = r.timeline ?? [];
    if (tl.length > 1)
      sections.push({
        line: {
          title: "Cumulative profit & cash trajectory",
          money: true,
          xLabels: tl.map((s) => s.label),
          series: [
            { name: "Cumulative net profit", color: [16, 185, 129], points: tl.map((s) => s.cumulativeNetProfit) },
            { name: "Cumulative cash", color: [245, 158, 11], points: tl.map((s) => s.cumulativeCash) },
          ],
        },
      });
    const byCh = r.breakdowns?.byChannel ?? [];
    if (byCh.length)
      sections.push({
        bars: {
          title: "Orders by acquisition channel",
          data: byCh.slice(0, 6).map((c) => ({ label: c.name, value: c.orders })),
        },
      });
  }

  // --- export viability ---
  if (exportReport?.scenarios?.length) {
    const cur = exportReport.resolvedInputs.destCurrency;
    sections.push({
      heading: `Export viability → ${exportReport.resolvedInputs.destCountry}`,
      pageBreak: true,
      body: exportReport.recommended
        ? `Recommended path: ${exportReport.scenarios.find((s) => s.path === exportReport.recommended!.path)?.label}. ${exportReport.recommended.reason}`
        : undefined,
      table: {
        columns: ["Fulfillment path", "Verdict", "Landed", "Price", "WTP cov.", "90-day net"],
        rows: exportReport.scenarios.map((s) => [
          s.label,
          s.verdict,
          money(s.landedCostPerUnit, cur),
          money(s.requiredPrice, cur),
          s.wtpCoveragePct == null ? "—" : `${s.wtpCoveragePct}%`,
          s.launch ? money(s.launch.netProfit, cur) : "—",
        ]),
      },
    });
    const rec = exportReport.scenarios.find((s) => s.path === exportReport.recommended?.path)
      ?? exportReport.scenarios[0];
    if (rec?.waterfall?.length)
      sections.push({
        bars: {
          title: `Landed-cost build-up — ${rec.label} (${cur})`,
          money: true,
          data: rec.waterfall.map((w) => ({ label: w.label, value: w.amount })),
        },
      });
    const sens = exportReport.sensitivity;
    if (sens.basePath)
      sections.push({
        bars: {
          title: "Required-price sensitivity (recommended path)",
          money: true,
          data: [
            { label: "FX +10%", value: sens.fxPlus10Pct ?? 0 },
            { label: "FX -10%", value: sens.fxMinus10Pct ?? 0 },
            { label: "Duty-free", value: sens.dutyZero ?? 0 },
            { label: "Duty doubled", value: sens.dutyDoubled ?? 0 },
            { label: "De-minimis ends", value: sens.deMinimisOff ?? 0 },
          ].filter((d) => d.value > 0),
        },
      });
  }

  // --- next actions + risks ---
  if (report?.nextActions?.length)
    sections.push({ heading: "Next actions", bullets: report.nextActions, pageBreak: true });
  if (report?.risks?.length)
    sections.push({ heading: "Risks to validate", bullets: report.risks });

  const meta = [
    aggregate ? `${aggregate.totalPersonas.toLocaleString()} personas · ${aggregate.totalCohorts} cohorts` : null,
    worldModel ? `${worldModel.conclusionCount} findings · ${worldModel.blockCount} desks` : null,
    generatedOn,
  ].filter(Boolean) as string[];

  return {
    title: report?.title ?? brief.slice(0, 90),
    subtitle: isExport
      ? `Cross-border export viability → ${targetMarket ?? "destination market"}`
      : "Market simulation & launch intelligence",
    accent: isExport ? [79, 70, 229] : [79, 70, 229],
    meta,
    cover: { verdict: report?.verdict, kpis: coverKpis },
    sections,
  };
}

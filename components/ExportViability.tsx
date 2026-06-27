"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ship,
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileDown,
} from "lucide-react";
import type {
  ExportViabilityReport,
  ExportScenarioResult,
} from "@/lib/schema";
import {
  deriveExportDecision,
  type ExportDecision,
} from "@/lib/exportDecision";
import { providerErrorMessage } from "@/lib/providerErrors";
import type { Dossier, KPI } from "./pdf";

// ---------------------------------------------------------------------------
// Export Viability view (Phase 5). Runs the cross-border landed-cost engine for
// every fulfillment path over the destination audience, then shows: a cost
// waterfall per path, a comparison matrix (price vs WTP vs launch P&L), the
// recommended path, and the FX/duty/de-minimis sensitivity bands.
//
// The engine works in the DESTINATION currency (USD) — duties, FBA fees and US
// sales tax are USD-denominated — but the figures are DISPLAYED in the founder's
// home currency (INR) by default, converted at the run's FX rate. A toggle flips
// the display between home and destination currency.
// ---------------------------------------------------------------------------

type Props = {
  runId: string;
  targetMarket?: string | null;
};

const VERDICT_STYLE: Record<ExportScenarioResult["verdict"], string> = {
  viable: "bg-emerald-100 text-emerald-700 border-emerald-300",
  marginal: "bg-amber-100 text-amber-700 border-amber-300",
  unviable: "bg-rose-100 text-rose-700 border-rose-300",
  unknown: "bg-neutral-100 text-neutral-600 border-neutral-300",
};

const DECISION_STYLE: Record<
  ExportDecision["stance"],
  { card: string; badge: string; icon: typeof CheckCircle2 }
> = {
  export: {
    card: "border-emerald-200 bg-emerald-50 text-emerald-950",
    badge: "border-emerald-300 bg-emerald-100 text-emerald-800",
    icon: CheckCircle2,
  },
  pilot: {
    card: "border-amber-200 bg-amber-50 text-amber-950",
    badge: "border-amber-300 bg-amber-100 text-amber-800",
    icon: AlertTriangle,
  },
  hold: {
    card: "border-rose-200 bg-rose-50 text-rose-950",
    badge: "border-rose-300 bg-rose-100 text-rose-800",
    icon: Ban,
  },
  unknown: {
    card: "border-neutral-200 bg-white text-neutral-900",
    badge: "border-neutral-300 bg-neutral-100 text-neutral-700",
    icon: AlertTriangle,
  },
};

function symbolFor(currency: string): string {
  return currency === "USD" ? "$" : currency === "INR" ? "₹" : "";
}

function money(n: number, currency: string): string {
  const sym = symbolFor(currency);
  const rounded = Math.round(n);
  const v = Math.abs(rounded).toLocaleString();
  const sign = n < 0 ? "−" : "";
  return sym ? `${sign}${sym}${v}` : `${sign}${v} ${currency}`;
}

function decisionTone(stance: ExportDecision["stance"]): KPI["tone"] {
  if (stance === "export") return "good";
  if (stance === "hold") return "bad";
  return "neutral";
}

export default function ExportViability({ runId, targetMarket }: Props) {
  const [report, setReport] = useState<ExportViabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Display currency: true = home (INR), false = destination (USD).
  const [showHome, setShowHome] = useState(true);

  // Overridable inputs — the rest are live-sourced/auto-derived server-side.
  const [unitWeightKg, setUnitWeightKg] = useState<string>("0.5");
  const [targetMarginPct, setTargetMarginPct] = useState<string>("");
  const [deMinimisActive, setDeMinimisActive] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { deMinimisActive };
      const w = parseFloat(unitWeightKg);
      if (Number.isFinite(w) && w > 0) body.unitWeightKg = w;
      const m = parseFloat(targetMarginPct);
      if (Number.isFinite(m) && m > 0) body.targetMarginPct = m;
      const res = await fetch(`/api/runs/${runId}/export-sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, "export simulation failed")
        );
      }
      setReport(data.report as ExportViabilityReport);
    } catch (e) {
      setError(providerErrorMessage(e, "export simulation failed"));
    } finally {
      setLoading(false);
    }
  }, [runId, deMinimisActive, unitWeightKg, targetMarginPct]);

  // Run once on mount.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Currency conversion: engine amounts are in destCurrency. To show home
  // currency, divide by fxRate (1 home unit = fxRate dest units). homeCurrency
  // defaults to INR. wtpCoveragePct is a percentage — never converted.
  const homeCur = report?.resolvedInputs.homeCurrency ?? "INR";
  const destCur = report?.resolvedInputs.destCurrency ?? "USD";
  const fx = report?.resolvedInputs.fxRate ?? 1;
  const canConvert = homeCur !== destCur && fx > 0;
  const cur = showHome && canConvert ? homeCur : destCur;
  const toDisplay = useCallback(
    (n: number): number => (showHome && canConvert ? n / fx : n),
    [canConvert, fx, showHome]
  );
  const fmt = useCallback(
    (n: number): string => money(toDisplay(n), cur),
    [cur, toDisplay]
  );
  const decision = report ? deriveExportDecision(report) : null;
  const decisionStyle = decision ? DECISION_STYLE[decision.stance] : null;
  const DecisionIcon = decisionStyle?.icon ?? TrendingUp;

  const downloadVerdictPdf = useCallback(async () => {
    if (!report || !decision || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { downloadDossier, slug } = await import("./pdf");
      const best = decision.scenario;
      const decisionKpis: KPI[] = [
        {
          label: "Export decision",
          value: decision.label,
          tone: decisionTone(decision.stance),
        },
      ];
      if (best) {
        decisionKpis.push(
          { label: "Best path", value: best.label },
          {
            label: "Required price",
            value: fmt(best.requiredPrice),
            sub: `${best.marginPct}% target margin`,
          }
        );
        if (best.wtpCoveragePct != null)
          decisionKpis.push({
            label: "WTP coverage",
            value: `${best.wtpCoveragePct}%`,
            tone:
              best.wtpCoveragePct >= 50
                ? "good"
                : best.wtpCoveragePct < 20
                  ? "bad"
                  : "neutral",
          });
        if (best.launch)
          decisionKpis.push({
            label: "90-day net",
            value: fmt(best.launch.netProfit),
            tone: best.launch.netProfit >= 0 ? "good" : "bad",
            sub: best.launch.breakEvenLabel ?? "break-even not reached",
          });
      }

      const sections: Dossier["sections"] = [
        {
          heading: `Export verdict -> ${targetMarket ?? report.resolvedInputs.destCountry}`,
          body: best
            ? `${decision.title}. ${decision.rationale} Best path: ${best.label} at ${fmt(best.requiredPrice)} with ${
                best.wtpCoveragePct == null ? "unknown" : `${best.wtpCoveragePct}%`
              } WTP coverage${
                best.launch ? ` and ${fmt(best.launch.netProfit)} 90-day net.` : "."
              }`
            : `${decision.title}. ${decision.rationale}`,
          kpis: decisionKpis,
          table: {
            columns: ["Fulfillment path", "Verdict", "Landed", "Price", "WTP cov.", "90-day net"],
            rows: report.scenarios.map((s) => [
              s.label,
              s.verdict,
              fmt(s.landedCostPerUnit),
              fmt(s.requiredPrice),
              s.wtpCoveragePct == null ? "-" : `${s.wtpCoveragePct}%`,
              s.launch ? fmt(s.launch.netProfit) : "-",
            ]),
          },
        },
      ];

      if (best?.waterfall?.length) {
        sections.push({
          heading: `Landed-cost build-up - ${best.label}`,
          bars: {
            title: `Per-unit cost waterfall (${cur})`,
            money: true,
            data: best.waterfall.map((w) => ({
              label: w.label,
              value: toDisplay(w.amount),
            })),
          },
        });
      }

      if (report.sensitivity.basePath) {
        sections.push({
          heading: "Required-price sensitivity",
          bars: {
            title: `Recommended path (${cur})`,
            money: true,
            data: [
              { label: "FX +10%", value: report.sensitivity.fxPlus10Pct },
              { label: "FX -10%", value: report.sensitivity.fxMinus10Pct },
              { label: "Duty-free", value: report.sensitivity.dutyZero },
              { label: "Duty doubled", value: report.sensitivity.dutyDoubled },
              { label: "DTC de-minimis ends", value: report.sensitivity.deMinimisOff },
            ]
              .filter((d): d is { label: string; value: number } => d.value != null)
              .map((d) => ({ label: d.label, value: toDisplay(d.value) })),
          },
        });
      }

      if (report.sources.length || report.notes.length) {
        sections.push({
          heading: "Sources and notes",
          bullets: [
            ...report.sources.map((s) => `Source: ${s}`),
            ...report.notes.map((n) => `Note: ${n}`),
          ],
        });
      }

      const dossier: Dossier = {
        title: `Export verdict - ${targetMarket ?? report.resolvedInputs.destCountry}`,
        subtitle: "Cross-border landed-cost and audience viability",
        meta: [
          `Display currency: ${cur}`,
          `FX ${homeCur}->${destCur} ${fx}`,
          new Date().toLocaleDateString(),
        ],
        cover: {
          verdict: `${decision.title}. ${decision.rationale}`,
          kpis: decisionKpis,
        },
        sections,
      };
      downloadDossier(dossier, `${slug(dossier.title)}-dossier`);
    } finally {
      setPdfBusy(false);
    }
  }, [
    cur,
    decision,
    destCur,
    fmt,
    fx,
    homeCur,
    pdfBusy,
    report,
    targetMarket,
    toDisplay,
  ]);

  return (
    <div className="h-full overflow-auto bg-neutral-50 p-5">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header + controls */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-neutral-900">
              <Ship className="h-5 w-5 text-indigo-600" /> Export Viability
              {targetMarket ? (
                <span className="text-sm font-medium text-neutral-500">
                  → {targetMarket}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Home COGS built up to a destination shelf price across fulfillment
              paths, scored against the destination audience&apos;s willingness to pay.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {canConvert ? (
              <div className="flex overflow-hidden rounded-md border border-neutral-300 text-[11px] font-semibold">
                <button
                  onClick={() => setShowHome(true)}
                  className={`px-2 py-1 ${showHome ? "bg-indigo-600 text-white" : "bg-white text-neutral-600"}`}
                >
                  {symbolFor(homeCur) || homeCur}
                </button>
                <button
                  onClick={() => setShowHome(false)}
                  className={`px-2 py-1 ${!showHome ? "bg-indigo-600 text-white" : "bg-white text-neutral-600"}`}
                >
                  {symbolFor(destCur) || destCur}
                </button>
              </div>
            ) : null}
            <label className="text-[11px] font-medium text-neutral-600">
              Unit weight (kg)
              <input
                value={unitWeightKg}
                onChange={(e) => setUnitWeightKg(e.target.value)}
                className="mt-0.5 block w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] font-medium text-neutral-600">
              Target margin %
              <input
                value={targetMarginPct}
                onChange={(e) => setTargetMarginPct(e.target.value)}
                placeholder="auto"
                className="mt-0.5 block w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-1.5 text-[11px] font-medium text-neutral-600">
              <input
                type="checkbox"
                checked={deMinimisActive}
                onChange={(e) => setDeMinimisActive(e.target.checked)}
              />
              De-minimis active
            </label>
            <button
              onClick={() => void run()}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Recompute
            </button>
            <button
              onClick={() => void downloadVerdictPdf()}
              disabled={!report || pdfBusy}
              className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-indigo-500 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Download a focused PDF dossier for this export verdict"
            >
              {pdfBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              Verdict PDF
            </button>
          </div>
        </div>

        {canConvert && showHome ? (
          <p className="text-[10px] text-neutral-400">
            Shown in {homeCur} at FX {homeCur}→{destCur} {fx} (engine computes in{" "}
            {destCur}; toggle above for {destCur}).
          </p>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading && !report ? (
          <div className="flex items-center gap-2 py-12 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Sourcing FX + duty and
            building landed costs…
          </div>
        ) : null}

        {report ? (
          <>
            {/* Overall decision */}
            {decision && decisionStyle ? (
              <div className={`rounded-xl border p-4 ${decisionStyle.card}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <DecisionIcon className="h-4 w-4" />
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${decisionStyle.badge}`}
                  >
                    {decision.label}
                  </span>
                  <span className="text-sm font-semibold">{decision.title}</span>
                </div>
                <p className="mt-1 text-xs opacity-90">{decision.rationale}</p>
                <p className="mt-2 text-xs">
                  {decision.scenario ? (
                    <>
                      Best path:{" "}
                      <span className="font-semibold">{decision.scenario.label}</span> at{" "}
                      <span className="font-semibold">
                        {fmt(decision.scenario.requiredPrice)}
                      </span>
                      {decision.scenario.wtpCoveragePct == null ? null : (
                        <>
                          {" "}
                          with{" "}
                          <span className="font-semibold">
                            {decision.scenario.wtpCoveragePct}% WTP coverage
                          </span>
                        </>
                      )}
                      {decision.scenario.launch ? (
                        <>
                          {" "}
                          and{" "}
                          <span className="font-semibold">
                            {fmt(decision.scenario.launch.netProfit)}
                          </span>{" "}
                          90-day net.
                        </>
                      ) : (
                        "."
                      )}
                    </>
                  ) : (
                    "No fulfillment path could be scored."
                  )}
                </p>
              </div>
            ) : null}

            {/* Comparison matrix */}
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fulfillment path</th>
                    <th className="px-3 py-2 font-semibold">Verdict</th>
                    <th className="px-3 py-2 text-right font-semibold">Landed / unit</th>
                    <th className="px-3 py-2 text-right font-semibold">Required price</th>
                    <th className="px-3 py-2 text-right font-semibold">+ tax</th>
                    <th className="px-3 py-2 text-right font-semibold">WTP coverage</th>
                    <th className="px-3 py-2 text-right font-semibold">90-day net</th>
                    <th className="px-3 py-2 text-right font-semibold">Break-even</th>
                  </tr>
                </thead>
                <tbody>
                  {report.scenarios.map((s) => (
                    <tr key={s.path} className="border-b border-neutral-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-neutral-800">{s.label}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${VERDICT_STYLE[s.verdict]}`}
                        >
                          {s.verdict}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.landedCostPerUnit)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {fmt(s.requiredPrice)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                        {fmt(s.consumerPriceWithTax)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.wtpCoveragePct == null ? "—" : `${s.wtpCoveragePct}%`}
                        {s.wtpMedian != null ? (
                          <span className="ml-1 text-[10px] text-neutral-400">
                            (med {fmt(s.wtpMedian)})
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${s.launch && s.launch.netProfit < 0 ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {s.launch ? fmt(s.launch.netProfit) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                        {s.launch?.breakEvenLabel ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cost waterfalls */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {report.scenarios.map((s) => (
                <div key={s.path} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-neutral-800">{s.label}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${VERDICT_STYLE[s.verdict]}`}
                    >
                      {s.verdict}
                    </span>
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {s.waterfall.map((w, i) => {
                        const isTotal = i === s.waterfall.length - 1;
                        return (
                          <tr
                            key={w.label}
                            className={isTotal ? "border-t border-neutral-300 font-semibold" : ""}
                          >
                            <td className="py-1 pr-2 text-neutral-600">
                              {w.label}
                              {w.note ? (
                                <span className="ml-1 text-[10px] text-neutral-400">({w.note})</span>
                              ) : null}
                            </td>
                            <td className="py-1 text-right tabular-nums text-neutral-800">
                              {fmt(w.amount)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-neutral-200">
                        <td className="py-1 pr-2 text-neutral-600">
                          Required price ({s.marginPct}% margin)
                        </td>
                        <td className="py-1 text-right font-semibold tabular-nums text-indigo-700">
                          {fmt(s.requiredPrice)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {s.launch ? (
                    <p className="mt-2 border-t border-neutral-100 pt-2 text-[10px] text-neutral-500">
                      90-day launch: {s.launch.totalOrders.toLocaleString()} orders ·{" "}
                      {fmt(s.launch.netRevenue)} net rev · CAC {fmt(s.launch.blendedCac)} ·
                      peak capital {fmt(s.launch.peakCapitalNeeded)}
                    </p>
                  ) : null}
                  {s.notes.length ? (
                    <ul className="mt-2 space-y-0.5 text-[10px] text-neutral-400">
                      {s.notes.map((n, i) => (
                        <li key={i}>· {n}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Sensitivity */}
            {report.sensitivity.basePath ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Required-price sensitivity
                  <span className="text-xs font-normal text-amber-700">
                    (recommended path — live-sourced inputs move the answer)
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-amber-900 sm:grid-cols-3">
                  <Band label="FX +10% (₹ stronger)" v={report.sensitivity.fxPlus10Pct} fmt={fmt} />
                  <Band label="FX −10% (₹ weaker)" v={report.sensitivity.fxMinus10Pct} fmt={fmt} />
                  <Band label="Duty-free" v={report.sensitivity.dutyZero} fmt={fmt} />
                  <Band label="Duty doubled" v={report.sensitivity.dutyDoubled} fmt={fmt} />
                  <Band label="DTC de-minimis ends" v={report.sensitivity.deMinimisOff} fmt={fmt} />
                </div>
              </div>
            ) : null}

            {/* Sources + notes */}
            {(report.sources.length || report.notes.length) && (
              <div className="space-y-1 text-[10px] text-neutral-400">
                {report.sources.map((s, i) => (
                  <div key={`src-${i}`}>Source: {s}</div>
                ))}
                {report.notes.map((n, i) => (
                  <div key={`note-${i}`}>Note: {n}</div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Band({
  label,
  v,
  fmt,
}: {
  label: string;
  v: number | null;
  fmt: (n: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-amber-700">{label}</span>
      <span className="font-semibold tabular-nums">{v == null ? "—" : fmt(v)}</span>
    </div>
  );
}

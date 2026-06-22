"use client";

import { useCallback, useEffect, useState } from "react";
import { Ship, Loader2, RefreshCw, TrendingUp, AlertTriangle } from "lucide-react";
import type {
  ExportViabilityReport,
  ExportScenarioResult,
} from "@/lib/schema";

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

export default function ExportViability({ runId, targetMarket }: Props) {
  const [report, setReport] = useState<ExportViabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.toString() ?? "export simulation failed");
      setReport(data.report as ExportViabilityReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "export simulation failed");
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
  const fmt = (n: number): string =>
    money(showHome && canConvert ? n / fx : n, cur);

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
            {/* Recommended */}
            {report.recommended ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                  <TrendingUp className="h-4 w-4" /> Recommended:{" "}
                  {report.scenarios.find((s) => s.path === report.recommended!.path)?.label}
                </div>
                <p className="mt-1 text-xs text-indigo-800">
                  {report.scenarios.find((s) => s.path === report.recommended!.path)?.wtpCoveragePct == null
                    ? `Lowest required price (${fmt(report.recommended.requiredPrice)}); no destination audience to score coverage.`
                    : `${report.scenarios.find((s) => s.path === report.recommended!.path)?.wtpCoveragePct}% of the destination audience would pay the required ${fmt(report.recommended.requiredPrice)} — the best coverage of the modeled paths.`}
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { SEGMENT_COLORS, DOMAIN_COLORS } from "./segments";
import type { CanvasState } from "./useRunEvents";

// ---------------------------------------------------------------------------
// Insights view (v2.1): every chart derives purely from CanvasState — the
// same event-log-reduced state the map and network render from.
// ---------------------------------------------------------------------------

function Card({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-4 ${wide ? "col-span-2" : ""}`}
    >
      <h3 className="mb-3 text-xs font-semibold text-neutral-700">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="flex h-28 items-center justify-center text-[11px] text-neutral-400">
      {label}
    </p>
  );
}

function GroupBars({
  data,
  colorBy,
}: {
  data: { name: string; meanIntent: number; n: number }[];
  colorBy?: (name: string) => string;
}) {
  if (data.length === 0) return <Empty label="Waiting for audience…" />;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
        <YAxis
          tick={{ fontSize: 10 }}
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          formatter={(v, _k, item) => [
            `${Math.round(Number(v ?? 0) * 100)}% mean intent (n=${(item?.payload as { n?: number })?.n ?? "?"})`,
            "",
          ]}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="meanIntent" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={colorBy?.(d.name) ?? "#6366f1"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ShareBars({
  data,
  color = "#6366f1",
}: {
  data: { name: string; share: number }[];
  color?: string;
}) {
  if (data.length === 0) return <Empty label="No data yet" />;
  const max = Math.max(...data.map((d) => d.share), 1);
  return (
    <ul className="space-y-1.5">
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-2 text-[11px]">
          <span className="w-32 truncate text-neutral-600">{d.name}</span>
          <div className="h-3 flex-1 rounded bg-neutral-100">
            <div
              className="h-3 rounded"
              style={{ width: `${(d.share / max) * 100}%`, background: color }}
            />
          </div>
          <span className="w-10 text-right text-neutral-500">{d.share}%</span>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  state: CanvasState;
  maxCostUsd: number;
  maxTokens: number;
  onSelectCohort: (cohortId: string) => void;
};

export default function InsightsView({
  state,
  maxCostUsd,
  maxTokens,
  onSelectCohort,
}: Props) {
  const agg = state.aggregate;

  const toRows = (rec: Record<string, { n: number; meanIntent: number }>) =>
    Object.entries(rec)
      .map(([name, v]) => ({ name, meanIntent: v.meanIntent, n: v.n }))
      .sort((a, b) => b.meanIntent - a.meanIntent);

  // WTP P25–P75 ranges per segment, from cohort stats (consumer view).
  const wtpRanges = useMemo(() => {
    const by = new Map<string, { p25: number[]; p50: number[]; p75: number[]; cur: string }>();
    for (const id of state.cohortOrder) {
      const c = state.cohorts[id];
      if (!c?.stats) continue;
      const g = by.get(c.segment) ?? { p25: [], p50: [], p75: [], cur: c.stats.wtpCurrency };
      g.p25.push(c.stats.wtpP25);
      g.p50.push(c.stats.wtpP50);
      g.p75.push(c.stats.wtpP75);
      by.set(c.segment, g);
    }
    const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1] ?? 0;
    return ["budget", "middle", "affluent", "luxury"]
      .filter((s) => by.has(s))
      .map((s) => {
        const g = by.get(s)!;
        return { segment: s, p25: med(g.p25), p50: med(g.p50), p75: med(g.p75), cur: g.cur };
      });
  }, [state.cohorts, state.cohortOrder]);
  const wtpMax = Math.max(...wtpRanges.map((r) => r.p75), 1);

  // Opportunity map: each done cohort as a bubble.
  const opportunity = useMemo(
    () =>
      state.cohortOrder
        .map((id) => state.cohorts[id])
        .filter((c) => c?.stats)
        .map((c) => ({
          id: c.id,
          label: c.label,
          segment: c.segment,
          intent: c.stats!.meanIntent,
          wtp: c.stats!.wtpP50,
          n: c.stats!.n,
        })),
    [state.cohorts, state.cohortOrder]
  );

  // Desk timeline from event timestamps.
  const timeline = useMemo(() => {
    const rows = state.blockOrder
      .map((id) => {
        const b = state.blocks[id];
        const t = state.blockTimings[id];
        if (!b || !t) return null;
        return {
          id,
          name: b.name,
          domain: b.domain,
          state: b.state,
          start: t.start,
          end: t.end ?? Date.now(),
        };
      })
      .filter(Boolean) as {
      id: string; name: string; domain: string; state: string; start: number; end: number;
    }[];
    if (rows.length === 0) return { rows: [], t0: 0, t1: 1 };
    const t0 = Math.min(...rows.map((r) => r.start));
    const t1 = Math.max(...rows.map((r) => r.end));
    return { rows: rows.sort((a, b) => a.start - b.start), t0, t1: Math.max(t1, t0 + 1) };
  }, [state.blocks, state.blockOrder, state.blockTimings]);

  // Confidence histogram + top entities across all conclusions.
  const conclusions = useMemo(
    () => Object.values(state.blocks).flatMap((b) => b.conclusions),
    [state.blocks]
  );
  const confidence = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      name: `${i * 10}–${i * 10 + 10}`,
      count: 0,
    }));
    for (const c of conclusions) {
      bins[Math.min(9, Math.floor(c.confidence * 10))].count += 1;
    }
    return bins;
  }, [conclusions]);
  const entities = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of conclusions)
      for (const e of c.entities) m.set(e, (m.get(e) ?? 0) + 1);
    const total = Math.max(conclusions.length, 1);
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, n]) => ({ name, share: Math.round((n / total) * 100) }));
  }, [conclusions]);

  const costPct = Math.min(100, (state.costUsd / maxCostUsd) * 100);
  const tokPct = Math.min(100, (state.tokensUsed / maxTokens) * 100);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/60 p-4 pt-14">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2">
        {/* ---- Run telemetry ---- */}
        <Card title="Run spend vs caps">
          <div className="space-y-3 text-[11px]">
            <div>
              <div className="mb-1 flex justify-between text-neutral-600">
                <span>Cost</span>
                <span>
                  ${state.costUsd.toFixed(2)} / ${maxCostUsd.toFixed(2)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-neutral-100">
                <div
                  className={`h-3 rounded-full ${costPct > 85 ? "bg-red-500" : costPct > 60 ? "bg-amber-400" : "bg-emerald-500"}`}
                  style={{ width: `${costPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-neutral-600">
                <span>Tokens</span>
                <span>
                  {state.tokensUsed.toLocaleString()} /{" "}
                  {maxTokens.toLocaleString()}
                </span>
              </div>
              <div className="h-3 rounded-full bg-neutral-100">
                <div
                  className="h-3 rounded-full bg-indigo-500"
                  style={{ width: `${tokPct}%` }}
                />
              </div>
            </div>
            <div className="flex gap-4 pt-1 text-neutral-500">
              <span>
                <b className="text-neutral-800">{state.blockOrder.length}</b>{" "}
                desks
              </span>
              <span>
                <b className="text-neutral-800">{conclusions.length}</b>{" "}
                conclusions
              </span>
              <span>
                <b className="text-neutral-800">
                  {agg?.totalPersonas.toLocaleString() ?? 0}
                </b>{" "}
                personas
              </span>
              <span>
                <b className="text-neutral-800">{state.edges.length}</b> edges
              </span>
            </div>
          </div>
        </Card>

        <Card title="Conclusion confidence distribution">
          {conclusions.length === 0 ? (
            <Empty label="No conclusions yet" />
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={confidence} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Desk timeline (who ran when)" wide>
          {timeline.rows.length === 0 ? (
            <Empty label="No desks yet" />
          ) : (
            <ul className="space-y-1">
              {timeline.rows.map((r) => {
                const span = timeline.t1 - timeline.t0;
                const left = ((r.start - timeline.t0) / span) * 100;
                const width = Math.max(1.5, ((r.end - r.start) / span) * 100);
                return (
                  <li key={r.id} className="flex items-center gap-2 text-[10px]">
                    <span className="w-40 truncate text-neutral-600">{r.name}</span>
                    <div className="relative h-3.5 flex-1 rounded bg-neutral-100">
                      <div
                        className={`absolute h-3.5 rounded ${r.state === "failed" ? "opacity-40" : ""}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: DOMAIN_COLORS[r.domain] ?? "#6366f1",
                        }}
                        title={`${r.name}: ${((r.end - r.start) / 1000).toFixed(1)}s`}
                      />
                    </div>
                    <span className="w-12 text-right text-neutral-400">
                      {((r.end - r.start) / 1000).toFixed(1)}s
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---- Audience analytics ---- */}
        <Card title="Purchase intent by income segment">
          <GroupBars
            data={agg ? toRows(agg.bySegment) : []}
            colorBy={(n) => SEGMENT_COLORS[n] ?? "#6366f1"}
          />
        </Card>
        <Card title="Purchase intent by locality">
          <GroupBars data={agg ? toRows(agg.byLocality) : []} colorBy={() => "#0ea5e9"} />
        </Card>
        <Card title="Purchase intent by role">
          <GroupBars data={agg ? toRows(agg.byRole) : []} colorBy={() => "#10b981"} />
        </Card>

        <Card title="Willingness to pay — P25–P75 range by segment">
          {wtpRanges.length === 0 ? (
            <Empty label="Waiting for cohorts…" />
          ) : (
            <ul className="space-y-2.5 pt-1">
              {wtpRanges.map((r) => (
                <li key={r.segment} className="flex items-center gap-2 text-[11px]">
                  <span className="w-16 capitalize text-neutral-600">{r.segment}</span>
                  <div className="relative h-4 flex-1 rounded bg-neutral-100">
                    <div
                      className="absolute h-4 rounded opacity-40"
                      style={{
                        left: `${(r.p25 / wtpMax) * 100}%`,
                        width: `${Math.max(1, ((r.p75 - r.p25) / wtpMax) * 100)}%`,
                        background: SEGMENT_COLORS[r.segment],
                      }}
                    />
                    <div
                      className="absolute top-0 h-4 w-1 rounded"
                      style={{
                        left: `${(r.p50 / wtpMax) * 100}%`,
                        background: SEGMENT_COLORS[r.segment],
                      }}
                      title={`P50 ${r.cur} ${r.p50.toLocaleString()}`}
                    />
                  </div>
                  <span className="w-24 text-right text-neutral-500">
                    {r.cur} {Math.round(r.p50 / 1000)}k
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Channel preference (all roles)">
          <ShareBars data={agg?.channelShare ?? []} color="#10b981" />
        </Card>
        <Card title="Top objections to defuse">
          {agg?.topObjections.length ? (
            <ShareBars
              data={agg.topObjections.map((o) => ({
                name: o.text,
                share: Math.round((o.count / (agg.totalPersonas || 1)) * 100),
              }))}
              color="#ef4444"
            />
          ) : (
            <Empty label="Waiting for audience…" />
          )}
        </Card>

        {/* ---- Social heatmap ---- */}
        <Card title="Social map — platform × segment affinity (%)" wide>
          {agg && Object.keys(agg.platformMatrix).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th className="pb-1 text-left font-medium text-neutral-500">
                      platform
                    </th>
                    {["budget", "middle", "affluent", "luxury"].map((s) => (
                      <th key={s} className="pb-1 text-center font-medium capitalize" style={{ color: SEGMENT_COLORS[s] }}>
                        {s}
                      </th>
                    ))}
                    <th className="pb-1 text-right font-medium text-neutral-500">overall</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.platformShare.map((p) => {
                    const row = agg.platformMatrix[p.name] ?? {};
                    return (
                      <tr key={p.name}>
                        <td className="py-0.5 pr-2 text-neutral-700">{p.name}</td>
                        {["budget", "middle", "affluent", "luxury"].map((s) => {
                          const v = row[s] ?? 0;
                          return (
                            <td key={s} className="px-1 py-0.5">
                              <div
                                className="rounded py-1 text-center"
                                style={{
                                  background: `rgba(99,102,241,${Math.min(0.9, v / 100 + 0.04)})`,
                                  color: v > 45 ? "white" : "#404040",
                                }}
                              >
                                {Math.round(v)}
                              </div>
                            </td>
                          );
                        })}
                        <td className="py-0.5 text-right text-neutral-500">{p.share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty label="Waiting for audience…" />
          )}
        </Card>

        {/* ---- Opportunity map ---- */}
        <Card title="Opportunity map — intent × WTP per cohort (click a bubble)" wide>
          {opportunity.length === 0 ? (
            <Empty label="Waiting for cohorts…" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="intent"
                  type="number"
                  domain={[0, "auto"]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  name="mean intent"
                />
                <YAxis
                  dataKey="wtp"
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  name="WTP P50"
                  width={44}
                />
                <ZAxis dataKey="n" range={[40, 260]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as (typeof opportunity)[number] | undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border border-neutral-200 bg-white p-2 text-[11px] shadow-sm">
                        <p className="font-semibold">{p.label}</p>
                        <p className="text-neutral-500">
                          intent {Math.round(p.intent * 100)}% · WTP P50{" "}
                          {p.wtp.toLocaleString()} · {p.n} personas
                        </p>
                      </div>
                    );
                  }}
                />
                {(["budget", "middle", "affluent", "luxury"] as const).map((seg) => (
                  <Scatter
                    key={seg}
                    data={opportunity.filter((o) => o.segment === seg)}
                    fill={SEGMENT_COLORS[seg]}
                    fillOpacity={0.65}
                    onClick={(d) => {
                      const id = (d as unknown as { id?: string })?.id;
                      if (id) onSelectCohort(id);
                    }}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ---- Entities ---- */}
        <Card title="What the run talked about — top entities" wide>
          {entities.length === 0 ? (
            <Empty label="No conclusions yet" />
          ) : (
            <ShareBars data={entities} color="#171717" />
          )}
        </Card>
      </div>
    </div>
  );
}

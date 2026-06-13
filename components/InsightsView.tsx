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
import { SEGMENT_COLORS } from "./segments";
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

function OpinionBars({
  data,
  color = "#ef4444",
  total,
}: {
  data: { name: string; count: number; examples?: string[] }[];
  color?: string;
  total: number;
}) {
  if (data.length === 0) return <Empty label="Waiting for audience…" />;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const share = total > 0 ? Math.round((d.count / total) * 100) : 0;
        return (
          <li key={d.name} className="text-[11px]">
            <div className="mb-1 flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 leading-snug text-neutral-700">
                {d.name}
              </p>
              <span className="shrink-0 tabular-nums text-neutral-500">
                {d.count} · {share}%
              </span>
            </div>
            {d.examples && d.examples.length > 0 && (
              <p className="mb-1.5 line-clamp-2 text-[10px] leading-snug text-neutral-400">
                {d.examples.join(" / ")}
              </p>
            )}
            <div className="h-2 rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full"
                style={{ width: `${(d.count / max) * 100}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TextList({
  items,
  empty,
}: {
  items: { text: string; meta?: string }[];
  empty: string;
}) {
  if (items.length === 0) return <Empty label={empty} />;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={`${item.text}-${i}`}
          className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
        >
          <p className="text-[11px] leading-relaxed text-neutral-800">
            {item.text}
          </p>
          {item.meta && (
            <p className="mt-1 text-[10px] text-neutral-400">{item.meta}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function normalizeOpinion(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "").toLowerCase();
}

function classifySentiment(intent: number): "approve" | "mixed" | "reject" {
  if (intent >= 0.65) return "approve";
  if (intent <= 0.35) return "reject";
  return "mixed";
}

const SENTIMENT_META = {
  approve: { label: "Approve", color: "#10b981" },
  mixed: { label: "Mixed", color: "#f59e0b" },
  reject: { label: "Reject", color: "#ef4444" },
};

function SentimentSummary({
  counts,
}: {
  counts: { approve: number; mixed: number; reject: number; total: number };
}) {
  if (counts.total === 0) return <Empty label="Waiting for audience…" />;
  const pct = (n: number) => Math.round((n / counts.total) * 100);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {(["approve", "mixed", "reject"] as const).map((key) => (
          <div key={key} className="rounded-lg border border-neutral-200 p-2">
            <p
              className="text-lg font-semibold tabular-nums"
              style={{ color: SENTIMENT_META[key].color }}
            >
              {pct(counts[key])}%
            </p>
            <p className="text-[10px] font-medium text-neutral-500">
              {SENTIMENT_META[key].label}
            </p>
            <p className="mt-0.5 text-[10px] text-neutral-400">
              {counts[key].toLocaleString()} personas
            </p>
          </div>
        ))}
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
        {(["approve", "mixed", "reject"] as const).map((key) => (
          <div
            key={key}
            style={{
              width: `${pct(counts[key])}%`,
              background: SENTIMENT_META[key].color,
            }}
          />
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-neutral-400">
        Sentiment is inferred from each simulated persona's intent score:
        approve &gt;=65%, mixed 36-64%, reject &lt;=35%.
      </p>
    </div>
  );
}

function SentimentBreakdown({
  rows,
}: {
  rows: {
    name: string;
    approve: number;
    mixed: number;
    reject: number;
    total: number;
  }[];
}) {
  if (rows.length === 0) return <Empty label="Waiting for audience…" />;
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const pct = (n: number) => (row.total > 0 ? (n / row.total) * 100 : 0);
        return (
          <li key={row.name} className="text-[11px]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-neutral-700">{row.name}</span>
              <span className="shrink-0 text-neutral-400">
                {Math.round(pct(row.approve))}% approve · n={row.total}
              </span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
              {(["approve", "mixed", "reject"] as const).map((key) => (
                <div
                  key={key}
                  style={{
                    width: `${pct(row[key])}%`,
                    background: SENTIMENT_META[key].color,
                  }}
                />
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const OBJECTION_THEMES = [
  {
    name: "Margin, discount and pricing risk",
    words: ["margin", "discount", "pricing", "commission", "referral cut"],
  },
  {
    name: "Fraud, fake referrals and abuse",
    words: ["fraud", "fake", "abuse", "misuse", "scam", "gaming"],
  },
  {
    name: "Trust, relationship and offline buying habits",
    words: [
      "trust",
      "handshake",
      "face-to-face",
      "neighbourhood",
      "regular",
      "touch",
      "fabric",
    ],
  },
  {
    name: "Operational complexity and integration",
    words: [
      "integration",
      "ops",
      "returns",
      "settlement",
      "logistics",
      "fulfilment",
      "fulfillment",
      "workflow",
    ],
  },
  {
    name: "Digital adoption friction",
    words: ["whatsapp", "app", "digital", "technology", "code", "qr"],
  },
  {
    name: "Demand uncertainty and shelf movement",
    words: ["demand", "move", "shelf", "customers come", "not for my"],
  },
  {
    name: "Supplier reliability and support",
    words: ["supplier", "supply", "warranty", "support", "frequency"],
  },
  {
    name: "Regulatory, compliance or claims risk",
    words: ["regulation", "regulatory", "compliance", "clearance", "claims"],
  },
] as const;

function objectionTheme(text: string): string {
  const normalized = normalizeOpinion(text);
  return (
    OBJECTION_THEMES.find((theme) =>
      theme.words.some((word) => normalized.includes(word))
    )?.name ?? "Other specific concerns"
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

  const personaRows = useMemo(
    () =>
      state.cohortOrder.flatMap((id) => {
        const c = state.cohorts[id];
        if (!c) return [];
        return c.personas.map((p) => ({ ...p, cohort: c }));
      }),
    [state.cohorts, state.cohortOrder]
  );

  const objectionThemes = useMemo(() => {
    const m = new Map<string, { count: number; examples: Set<string> }>();
    for (const p of personaRows) {
      if (!p.objection.trim()) continue;
      const key = objectionTheme(p.objection);
      const existing = m.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.examples.size < 2) existing.examples.add(p.objection.trim());
      } else {
        m.set(key, { count: 1, examples: new Set([p.objection.trim()]) });
      }
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({
        name,
        count: v.count,
        examples: Array.from(v.examples),
      }))
      .sort((a, b) => b.count - a.count);
  }, [personaRows]);

  const valueDrivers = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const p of personaRows) {
      for (const value of p.values) {
        if (!value.trim()) continue;
        const key = normalizeOpinion(value);
        const existing = m.get(key);
        if (existing) existing.count += 1;
        else m.set(key, { label: value.trim(), count: 1 });
      }
    }
    return Array.from(m.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((o) => ({ name: o.label, count: o.count }));
  }, [personaRows]);

  const sentiment = useMemo(() => {
    const counts = { approve: 0, mixed: 0, reject: 0, total: personaRows.length };
    for (const p of personaRows) counts[classifySentiment(p.intent)] += 1;
    return counts;
  }, [personaRows]);

  const sentimentByRole = useMemo(() => {
    const m = new Map<
      string,
      { approve: number; mixed: number; reject: number; total: number }
    >();
    for (const p of personaRows) {
      const key = p.cohort.role.replace("_", " ");
      const row = m.get(key) ?? { approve: 0, mixed: 0, reject: 0, total: 0 };
      row[classifySentiment(p.intent)] += 1;
      row.total += 1;
      m.set(key, row);
    }
    return Array.from(m.entries())
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.total - a.total);
  }, [personaRows]);

  const sentimentBySegment = useMemo(() => {
    const m = new Map<
      string,
      { approve: number; mixed: number; reject: number; total: number }
    >();
    for (const p of personaRows) {
      const key = p.cohort.segment;
      const row = m.get(key) ?? { approve: 0, mixed: 0, reject: 0, total: 0 };
      row[classifySentiment(p.intent)] += 1;
      row.total += 1;
      m.set(key, row);
    }
    return Array.from(m.entries())
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.approve / b.total - a.approve / a.total);
  }, [personaRows]);

  const sentimentByLocality = useMemo(() => {
    const m = new Map<
      string,
      { approve: number; mixed: number; reject: number; total: number }
    >();
    for (const p of personaRows) {
      const key = p.cohort.locality;
      const row = m.get(key) ?? { approve: 0, mixed: 0, reject: 0, total: 0 };
      row[classifySentiment(p.intent)] += 1;
      row.total += 1;
      m.set(key, row);
    }
    return Array.from(m.entries())
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [personaRows]);

  const roleResistance = useMemo(() => {
    const byRole = new Map<string, Map<string, number>>();
    for (const p of personaRows) {
      if (!p.objection.trim()) continue;
      const role = p.cohort.role;
      const roleMap = byRole.get(role) ?? new Map<string, number>();
      const key = objectionTheme(p.objection);
      roleMap.set(key, (roleMap.get(key) ?? 0) + 1);
      byRole.set(role, roleMap);
    }
    return Array.from(byRole.entries())
      .map(([role, objections]) => {
        const top = Array.from(objections.entries()).sort((a, b) => b[1] - a[1])[0];
        return top ? { role, text: top[0], count: top[1] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.count - a!.count)
      .map((r) => ({
        text: r!.text,
        meta: `${r!.role.replace("_", " ")} · ${r!.count} similar responses`,
      }));
  }, [personaRows]);

  const supportiveQuotes = useMemo(
    () =>
      personaRows
        .filter((p) => p.quote.trim())
        .filter((p) => p.intent >= 0.65)
        .sort((a, b) => b.intent - a.intent)
        .slice(0, 5)
        .map((p) => ({
          text: `“${p.quote.trim()}”`,
          meta: `${p.name} · ${p.cohort.label} · intent ${Math.round(p.intent * 100)}%`,
        })),
    [personaRows]
  );

  const skepticalQuotes = useMemo(
    () =>
      personaRows
        .filter((p) => p.quote.trim())
        .filter((p) => p.intent <= 0.35)
        .sort((a, b) => a.intent - b.intent)
        .slice(0, 5)
        .map((p) => ({
          text: `“${p.quote.trim()}”`,
          meta: `${p.name} · ${p.cohort.label} · intent ${Math.round(p.intent * 100)}%`,
        })),
    [personaRows]
  );

  const conditionalQuotes = useMemo(
    () =>
      personaRows
        .filter((p) => p.quote.trim())
        .filter((p) => p.intent > 0.35 && p.intent < 0.65)
        .sort((a, b) => Math.abs(0.5 - a.intent) - Math.abs(0.5 - b.intent))
        .slice(0, 4)
        .map((p) => ({
          text: `“${p.quote.trim()}”`,
          meta: `${p.name} · ${p.cohort.label} · intent ${Math.round(p.intent * 100)}%`,
        })),
    [personaRows]
  );

  const reasoningSnippets = useMemo(
    () =>
      personaRows
        .filter((p) => p.reasoning.trim())
        .sort((a, b) => b.priceSensitivity - a.priceSensitivity)
        .slice(0, 6)
        .map((p) => ({
          text: p.reasoning.trim(),
          meta: `${p.cohort.segment} ${p.cohort.role.replace("_", " ")} · ${p.channelPref} · price sensitivity ${Math.round(p.priceSensitivity * 100)}%`,
        })),
    [personaRows]
  );

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

        <Card title="Opinion sentiment" wide>
          <SentimentSummary counts={sentiment} />
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
        <Card title="Approval by buyer role">
          <SentimentBreakdown rows={sentimentByRole} />
        </Card>

        <Card title="Approval by income segment">
          <SentimentBreakdown rows={sentimentBySegment} />
        </Card>

        <Card title="Approval by locality" wide>
          <SentimentBreakdown rows={sentimentByLocality} />
        </Card>

        <Card title="Top objections to defuse" wide>
          <OpinionBars
            data={objectionThemes}
            color="#ef4444"
            total={personaRows.length || agg?.totalPersonas || 0}
          />
        </Card>

        <Card title="Repeated value drivers">
          <OpinionBars
            data={valueDrivers}
            color="#10b981"
            total={personaRows.length}
          />
        </Card>

        <Card title="Resistance by buyer role">
          <TextList
            items={roleResistance}
            empty="Waiting for audience opinions…"
          />
        </Card>

        <Card title="Supportive customer language" wide>
          <TextList
            items={supportiveQuotes}
            empty="No high-intent quotes yet…"
          />
        </Card>

        <Card title="Skeptical customer language" wide>
          <TextList
            items={skepticalQuotes}
            empty="No low-intent quotes yet…"
          />
        </Card>

        <Card title="Conditional customer language" wide>
          <TextList
            items={conditionalQuotes}
            empty="No mixed-intent quotes yet…"
          />
        </Card>

        <Card title="Why they hesitate or convert" wide>
          <TextList
            items={reasoningSnippets}
            empty="Waiting for persona reasoning…"
          />
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

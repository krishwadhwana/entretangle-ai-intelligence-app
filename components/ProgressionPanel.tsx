"use client";

// Owner Dashboard → Progression. The founder-facing record of how solid each
// part of a venture is, scored over time. Backed by ProjectDimension rows and
// the /api/projects/:id/dimensions endpoints. Fixed preset dimensions are
// seeded server-side; founders add custom dimensions and nested scenarios.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Link2,
  X,
  Loader2,
  CalendarClock,
  Wallet,
  GitBranch,
  TrendingUp,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import {
  STATUS_LABELS,
  GROUP_LABELS,
  DIMENSION_STATUSES,
  meterBand,
  overallProgress,
  effectiveScore,
  type DimensionDTO,
  type DimensionStatus,
  type EvidenceItem,
} from "@/lib/progression/presets";

// ── small helpers ─────────────────────────────────────────────────────────
function scoreTone(pct: number | null): { text: string; bar: string; ring: string } {
  if (pct === null) return { text: "text-slate-400", bar: "bg-slate-300", ring: "#cbd5e1" };
  if (pct < 40) return { text: "text-rose-600", bar: "bg-rose-500", ring: "#f43f5e" };
  if (pct < 70) return { text: "text-amber-600", bar: "bg-amber-500", ring: "#f59e0b" };
  return { text: "text-emerald-600", bar: "bg-emerald-500", ring: "#10b981" };
}

const STATUS_PILL: Record<DimensionStatus, string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-rose-100 text-rose-700",
  done: "bg-emerald-100 text-emerald-700",
};

function fmtMoney(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function ProgressRing({ pct }: { pct: number | null }) {
  const value = pct ?? 0;
  const tone = scoreTone(pct);
  return (
    <div
      className="relative flex h-20 w-20 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${tone.ring} ${value * 3.6}deg, #e2e8f0 0deg)` }}
    >
      <div className="flex h-[60px] w-[60px] flex-col items-center justify-center rounded-full bg-white">
        <span className={`text-lg font-semibold ${tone.text}`}>{pct === null ? "—" : pct}</span>
        <span className="text-[9px] uppercase tracking-wide text-slate-400">/100</span>
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────
type Props = { projectId: string; projectName?: string };

export default function ProgressionPanel({ projectId, projectName }: Props) {
  const [dims, setDims] = useState<DimensionDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);

  const base = `/api/projects/${projectId}/dimensions`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setDims(data.dimensions as DimensionDTO[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load progression");
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const mark = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // replace a dimension (top-level or nested scenario) by id
  const replaceDim = useCallback((updated: DimensionDTO) => {
    setDims((prev) => {
      if (!prev) return prev;
      return prev.map((d) => {
        if (d.id === updated.id) return { ...updated };
        if (d.children.some((c) => c.id === updated.id)) {
          return { ...d, children: d.children.map((c) => (c.id === updated.id ? updated : c)) };
        }
        return d;
      });
    });
  }, []);

  const patch = useCallback(
    async (dimId: string, body: Record<string, unknown>) => {
      mark(dimId, true);
      try {
        const res = await fetch(`${base}/${dimId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        const data = await res.json();
        replaceDim(data.dimension as DimensionDTO);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        mark(dimId, false);
      }
    },
    [base, replaceDim],
  );

  const createDim = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Create failed (${res.status})`);
        await load();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Create failed");
        return false;
      }
    },
    [base, load],
  );

  const removeDim = useCallback(
    async (dimId: string) => {
      mark(dimId, true);
      try {
        const res = await fetch(`${base}/${dimId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        mark(dimId, false);
      }
    },
    [base, load],
  );

  const overall = useMemo(() => (dims ? overallProgress(dims) : null), [dims]);

  const totalSpent = useMemo(() => {
    if (!dims) return new Map<string, number>();
    const byCurrency = new Map<string, number>();
    const walk = (d: DimensionDTO) => {
      if (d.moneySpent) byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + d.moneySpent);
      d.children.forEach(walk);
    };
    dims.forEach(walk);
    return byCurrency;
  }, [dims]);

  const groups = useMemo(() => {
    if (!dims) return [] as { group: string; items: DimensionDTO[] }[];
    const order = ["venture", "company", "supply", "sourcing", "general"];
    const map = new Map<string, DimensionDTO[]>();
    for (const d of dims) {
      if (!map.has(d.group)) map.set(d.group, []);
      map.get(d.group)!.push(d);
    }
    return [...map.entries()]
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
      .map(([group, items]) => ({ group, items }));
  }, [dims]);

  if (error && !dims) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error} ·{" "}
        <button className="underline" onClick={load}>
          retry
        </button>
      </div>
    );
  }

  if (!dims) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading progression…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={overall} />
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {projectName ? `${projectName} — Progression` : "Venture Progression"}
            </h2>
            <p className="text-sm text-slate-500">
              {overall === null
                ? "Score each dimension to see overall progress."
                : `Overall venture solidity across ${dims.filter((d) => d.kind === "score").length} dimensions.`}
            </p>
            {totalSpent.size > 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <Wallet className="h-3 w-3" /> Invested:{" "}
                {[...totalSpent.entries()].map(([c, a]) => fmtMoney(a, c)).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" /> Add dimension
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {showAdd && <AddDimensionForm onCreate={createDim} onClose={() => setShowAdd(false)} />}

      {/* groups */}
      {groups.map(({ group, items }) => (
        <section key={group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {GROUP_LABELS[group] ?? group}
          </h3>
          <div className="space-y-3">
            {items.map((d) => (
              <DimensionCard
                key={d.id}
                dim={d}
                busy={busy.has(d.id)}
                childBusy={busy}
                onPatch={patch}
                onCreateScenario={(label) =>
                  createDim({ label, parentId: d.id })
                }
                onDelete={removeDim}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── dimension card ────────────────────────────────────────────────────────
function DimensionCard({
  dim,
  busy,
  childBusy,
  onPatch,
  onCreateScenario,
  onDelete,
}: {
  dim: DimensionDTO;
  busy: boolean;
  childBusy: Set<string>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onCreateScenario: (label: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const isMeter = dim.kind === "meter";
  const effective = effectiveScore(dim);
  const deletable = dim.isCustom && !dim.isScenario;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-slate-800">{dim.label}</h4>
            {dim.isCustom && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                custom
              </span>
            )}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>
          {dim.help && <p className="mt-0.5 text-xs text-slate-500">{dim.help}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusSelect value={dim.status} onChange={(s) => onPatch(dim.id, { status: s })} />
          {deletable && (
            <button
              onClick={() => onDelete(dim.id)}
              title="Delete dimension"
              className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* score / meter */}
      {dim.children.length === 0 && (
        <div className="mt-3">
          {isMeter ? (
            <MeterEditor dim={dim} onPatch={onPatch} />
          ) : (
            <ScoreEditor dim={dim} onPatch={onPatch} />
          )}
        </div>
      )}

      {/* scenarios */}
      {(dim.children.length > 0 || (!isMeter && !dim.isScenario)) && (
        <ScenarioList
          parent={dim}
          childBusy={childBusy}
          onPatch={onPatch}
          onCreate={onCreateScenario}
          onDelete={onDelete}
          effective={effective}
        />
      )}

      {/* meta row: ETA + money + notes + evidence + history */}
      <DimensionMeta dim={dim} onPatch={onPatch} />
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: DimensionStatus;
  onChange: (s: DimensionStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DimensionStatus)}
      className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium focus:ring-2 focus:ring-blue-300 ${STATUS_PILL[value]}`}
    >
      {DIMENSION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function ScoreEditor({
  dim,
  onPatch,
}: {
  dim: DimensionDTO;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [val, setVal] = useState<number>(dim.score ?? 0);
  const [max, setMax] = useState<number>(dim.scoreMax);
  useEffect(() => setVal(dim.score ?? 0), [dim.score]);
  useEffect(() => setMax(dim.scoreMax), [dim.scoreMax]);
  const pct = dim.scoreMax ? Math.round((val / Math.max(1, max)) * 100) : 0;
  const tone = scoreTone(pct);

  const commit = () => {
    if (val !== (dim.score ?? 0) || max !== dim.scoreMax)
      onPatch(dim.id, { score: val, scoreMax: max });
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-current"
          style={{ color: tone.ring }}
        />
        <div className="flex items-center gap-1 text-sm">
          <input
            type="number"
            min={0}
            value={val}
            onChange={(e) => setVal(Number(e.target.value))}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className={`w-16 rounded border border-slate-200 px-1.5 py-1 text-right font-semibold ${tone.text}`}
          />
          <span className="text-slate-400">/</span>
          <input
            type="number"
            min={1}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="w-16 rounded border border-slate-200 px-1.5 py-1 text-slate-500"
            title="Max score (e.g. 100, or 200 for a combined scenario)"
          />
        </div>
      </div>
    </div>
  );
}

function MeterEditor({
  dim,
  onPatch,
}: {
  dim: DimensionDTO;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [val, setVal] = useState<number>(dim.score ?? 0);
  useEffect(() => setVal(dim.score ?? 0), [dim.score]);
  const band = meterBand(val);
  const toneByBand: Record<string, string> = {
    low: "bg-rose-500",
    mid: "bg-amber-500",
    good: "bg-emerald-500",
    high: "bg-emerald-600",
  };
  const commit = () => {
    if (val !== (dim.score ?? 0)) onPatch(dim.id, { score: val, scoreMax: 100 });
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{val}%</span>
        <span className="text-xs text-slate-500">{band.label}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${toneByBand[band.tone]}`}
          style={{ width: `${val}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500"
      />
    </div>
  );
}

// ── nested scenarios (e.g. company-registration variants) ───────────────────
function ScenarioList({
  parent,
  childBusy,
  onPatch,
  onCreate,
  onDelete,
  effective,
}: {
  parent: DimensionDTO;
  childBusy: Set<string>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onCreate: (label: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  effective: number | null;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const submit = async () => {
    if (!label.trim()) return;
    const ok = await onCreate(label.trim());
    if (ok) {
      setLabel("");
      setAdding(false);
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <GitBranch className="h-3.5 w-3.5" /> Scenarios
          {parent.children.length > 0 && effective !== null && (
            <span className="text-slate-400">· best {effective}/100</span>
          )}
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          <Plus className="h-3.5 w-3.5" /> Scenario
        </button>
      </div>

      {parent.children.length === 0 && !adding && (
        <p className="text-xs text-slate-400">
          Add a scenario per path — e.g. &ldquo;Registered in SF for investment&rdquo;,
          &ldquo;India for the Indian market&rdquo;, &ldquo;SF parent + Indian subsidiary&rdquo;.
        </p>
      )}

      <div className="space-y-2">
        {parent.children.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{c.label}</span>
            {childBusy.has(c.id) && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            <CompactScore dim={c} onPatch={onPatch} />
            <button
              onClick={() => onDelete(c.id)}
              className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
              title="Delete scenario"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Scenario name"
            className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
          />
          <button
            onClick={submit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function CompactScore({
  dim,
  onPatch,
}: {
  dim: DimensionDTO;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [val, setVal] = useState<number>(dim.score ?? 0);
  const [max, setMax] = useState<number>(dim.scoreMax);
  useEffect(() => setVal(dim.score ?? 0), [dim.score]);
  useEffect(() => setMax(dim.scoreMax), [dim.scoreMax]);
  const pct = Math.round((val / Math.max(1, max)) * 100);
  const tone = scoreTone(pct);
  const commit = () => {
    if (val !== (dim.score ?? 0) || max !== dim.scoreMax)
      onPatch(dim.id, { score: val, scoreMax: max });
  };
  return (
    <div className="flex items-center gap-1 text-xs">
      <input
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={`w-14 rounded border border-slate-200 px-1 py-0.5 text-right font-semibold ${tone.text}`}
      />
      <span className="text-slate-400">/</span>
      <input
        type="number"
        min={1}
        value={max}
        onChange={(e) => setMax(Number(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-slate-500"
      />
    </div>
  );
}

// ── per-dimension meta: ETA, money, notes, evidence, history ─────────────────
function DimensionMeta({
  dim,
  onPatch,
}: {
  dim: DimensionDTO;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [notes, setNotes] = useState(dim.notes ?? "");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setNotes(dim.notes ?? ""), [dim.notes]);

  const onNotes = (v: string) => {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => onPatch(dim.id, { notes: v || null }), 700);
  };

  const chartData = dim.history
    .filter((h) => h.score !== null)
    .map((h) => ({
      t: new Date(h.createdAt).getTime(),
      pct: h.scoreMax ? Math.round((h.score! / Math.max(1, h.scoreMax)) * 100) : h.score!,
    }));

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {/* ETA */}
        <label className="flex items-center gap-1.5 text-slate-500">
          <CalendarClock className="h-4 w-4" />
          <span className="text-xs">ETA</span>
          <input
            type="date"
            value={dim.eta ? dim.eta.slice(0, 10) : ""}
            onChange={(e) =>
              onPatch(dim.id, {
                eta: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
            className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
          />
        </label>

        {/* money spent */}
        <label className="flex items-center gap-1.5 text-slate-500">
          <Wallet className="h-4 w-4" />
          <span className="text-xs">Spent</span>
          <input
            type="text"
            defaultValue={dim.currency}
            onBlur={(e) =>
              e.target.value !== dim.currency && onPatch(dim.id, { currency: e.target.value || "USD" })
            }
            className="w-12 rounded border border-slate-200 px-1.5 py-0.5 text-xs uppercase text-slate-600"
          />
          <input
            type="number"
            min={0}
            defaultValue={dim.moneySpent ?? ""}
            placeholder="0"
            onBlur={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              if (v !== dim.moneySpent) onPatch(dim.id, { moneySpent: v });
            }}
            className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-right text-xs text-slate-700"
          />
        </label>

        {/* history sparkline */}
        {chartData.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
            <div className="h-8 w-28">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip
                    formatter={(v) => [`${v}/100`, "score"]}
                    labelFormatter={() => ""}
                    contentStyle={{ fontSize: 11, padding: "2px 6px" }}
                  />
                  <Line type="monotone" dataKey="pct" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <EvidenceRow dim={dim} onPatch={onPatch} />

      <textarea
        value={notes}
        onChange={(e) => onNotes(e.target.value)}
        placeholder="Notes — what this score is based on, next steps, what unlocks the next level…"
        rows={2}
        className="w-full resize-y rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400"
      />
    </div>
  );
}

function EvidenceRow({
  dim,
  onPatch,
}: {
  dim: DimensionDTO;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const add = () => {
    if (!label.trim() || !url.trim()) return;
    const next: EvidenceItem[] = [...dim.evidence, { label: label.trim(), url: url.trim() }];
    onPatch(dim.id, { evidence: next });
    setLabel("");
    setUrl("");
    setAdding(false);
  };
  const remove = (i: number) =>
    onPatch(dim.id, { evidence: dim.evidence.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dim.evidence.map((ev, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
        >
          <Link2 className="h-3 w-3" />
          <a href={ev.url} target="_blank" rel="noreferrer" className="hover:underline">
            {ev.label}
          </a>
          <button onClick={() => remove(i)} className="text-slate-400 hover:text-rose-600">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label"
            className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="https://…"
            className="w-40 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
          />
          <button onClick={add} className="text-xs font-medium text-blue-600">
            add
          </button>
          <button onClick={() => setAdding(false)} className="text-slate-400">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600"
        >
          <Plus className="h-3 w-3" /> evidence
        </button>
      )}
    </div>
  );
}

// ── add custom dimension ─────────────────────────────────────────────────────
function AddDimensionForm({
  onCreate,
  onClose,
}: {
  onCreate: (body: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("venture");
  const [kind, setKind] = useState("score");
  const [scoreMax, setScoreMax] = useState(100);

  const submit = async () => {
    if (!label.trim()) return;
    const ok = await onCreate({ label: label.trim(), group, kind, scoreMax });
    if (ok) onClose();
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Dimension</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Manufacturer sourcing"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-500">Group</span>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            {Object.entries(GROUP_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            <option value="score">Score</option>
            <option value="meter">Meter (%)</option>
          </select>
        </label>
        {kind === "score" && (
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Max</span>
            <input
              type="number"
              min={1}
              value={scoreMax}
              onChange={(e) => setScoreMax(Number(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        )}
        <button
          onClick={submit}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add
        </button>
        <button onClick={onClose} className="rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}

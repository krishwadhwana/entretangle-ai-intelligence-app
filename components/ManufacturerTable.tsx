"use client";

// Owner Dashboard → Manufacturers. The sourcing table: candidate suppliers for
// the venture's product with MOQ, sample/unit price, lead time and payment
// terms, tracked through a sourcing pipeline. Rows are added manually here and
// (later) by a sourcing agent that scrapes/contacts directories. Backed by the
// /api/projects/:id/manufacturers endpoints.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
  Star,
  BadgeCheck,
  ExternalLink,
  Factory,
  Search,
} from "lucide-react";
import {
  MANUFACTURER_STATUSES,
  MANUFACTURER_SOURCES,
  STATUS_LABELS,
  SOURCE_LABELS,
  REGIONS,
  type ManufacturerDTO,
  type ManufacturerStatus,
} from "@/lib/manufacturers/types";

const STATUS_PILL: Record<ManufacturerStatus, string> = {
  lead: "bg-slate-100 text-slate-600",
  contacted: "bg-blue-100 text-blue-700",
  quoted: "bg-violet-100 text-violet-700",
  sampling: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

type Props = { projectId: string; projectName?: string };

export default function ManufacturerTable({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<ManufacturerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ManufacturerStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [sourcing, setSourcing] = useState(false);
  const [sourceMsg, setSourceMsg] = useState<string | null>(null);
  const [sourceProgress, setSourceProgress] = useState<{ label: string; detail?: string }[]>([]);

  const base = `/api/projects/${projectId}/manufacturers`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setRows(data.manufacturers as ManufacturerDTO[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const mark = (id: string, on: boolean) =>
    setBusy((p) => {
      const n = new Set(p);
      on ? n.add(id) : n.delete(id);
      return n;
    });

  const patch = useCallback(
    async (id: string, body: Partial<ManufacturerDTO>) => {
      mark(id, true);
      // optimistic
      setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...body } : r)) ?? prev);
      try {
        const res = await fetch(`${base}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        const data = await res.json();
        setRows((prev) => prev?.map((r) => (r.id === id ? (data.manufacturer as ManufacturerDTO) : r)) ?? prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        load();
      } finally {
        mark(id, false);
      }
    },
    [base, load],
  );

  const addRow = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      setNewName("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }, [base, newName, load]);

  // Enqueue a sourcing run (durable worker job) and poll it until it settles,
  // streaming the job's progress and reloading the table on success.
  const startSourcing = useCallback(async () => {
    if (sourcing) return;
    setSourcing(true);
    setSourceMsg("Starting sourcing run…");
    setSourceProgress([]);
    setError(null);
    try {
      const res = await fetch(`${base}/source`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 12, phase: "discover" }),
      });
      if (!res.ok) throw new Error(`Failed to start (${res.status})`);
      const { jobId } = (await res.json()) as { jobId: string };

      const deadline = Date.now() + 120_000;
      let settled = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const jr = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!jr.ok) continue;
        const { job } = await jr.json();
        const prog = Array.isArray(job?.result?.progress) ? job.result.progress : [];
        setSourceProgress(prog.map((x: { label: string; detail?: string }) => ({ label: x.label, detail: x.detail })));
        if (job.status === "succeeded") {
          const r = job.result ?? {};
          setSourceMsg(`Added ${r.inserted ?? 0} manufacturers · ${r.skipped ?? 0} duplicates skipped.`);
          await load();
          settled = true;
          break;
        }
        if (job.status === "failed") {
          setSourceMsg(null);
          setError(job.error || "Sourcing failed");
          settled = true;
          break;
        }
        if (job.status === "cancelled") {
          setSourceMsg("Sourcing cancelled.");
          settled = true;
          break;
        }
      }
      if (!settled) {
        setSourceMsg("Still working — make sure the worker process is running (npm run worker).");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sourcing failed");
      setSourceMsg(null);
    } finally {
      setSourcing(false);
    }
  }, [base, load, sourcing]);

  const removeRow = useCallback(
    async (id: string) => {
      mark(id, true);
      try {
        const res = await fetch(`${base}/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        mark(id, false);
      }
    },
    [base],
  );

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    rows?.forEach((r) => c.set(r.status, (c.get(r.status) ?? 0) + 1));
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === "all" || r.status === filter),
    [rows, filter],
  );

  if (!rows) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading manufacturers…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Factory className="h-5 w-5 text-slate-500" />
          <h2 className="text-base font-semibold text-slate-800">
            {projectName ? `${projectName} — Manufacturers` : "Manufacturer Sourcing"}
          </h2>
          <span className="text-sm text-slate-400">({rows.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startSourcing}
            disabled={sourcing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            title="Find manufacturers from sourcing sources"
          >
            {sourcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
            manufacturers
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> Add manufacturer
          </button>
        </div>
      </div>

      {(sourcing || sourceMsg) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            {sourcing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {sourcing ? "Sourcing manufacturers…" : sourceMsg}
          </div>
          {sourceProgress.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {sourceProgress.map((p, i) => (
                <li key={i}>
                  • {p.label}
                  {p.detail ? ` — ${p.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* status filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All ${rows.length}`} />
        {MANUFACTURER_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={`${STATUS_LABELS[s]} ${counts.get(s) ?? 0}`}
          />
        ))}
      </div>

      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRow()}
            placeholder="Manufacturer / supplier name"
            className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <button onClick={addRow} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Add
          </button>
          <button onClick={() => setAdding(false)} className="px-2 py-1.5 text-sm text-slate-500">
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          No manufacturers yet. Add one manually, or let the sourcing agent populate this table.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">MOQ</th>
                <th className="px-3 py-2 text-right">Sample</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Lead (d)</th>
                <th className="px-3 py-2">Payment terms</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rating</th>
                <th className="w-8 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  busy={busy.has(r.id)}
                  expanded={expanded.has(r.id)}
                  onToggle={() =>
                    setExpanded((p) => {
                      const n = new Set(p);
                      n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                      return n;
                    })
                  }
                  onPatch={patch}
                  onDelete={removeRow}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

// ── row ──────────────────────────────────────────────────────────────────
function Row({
  row,
  busy,
  expanded,
  onToggle,
  onPatch,
  onDelete,
}: {
  row: ManufacturerDTO;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (id: string, body: Partial<ManufacturerDTO>) => void;
  onDelete: (id: string) => void;
}) {
  const set = (body: Partial<ManufacturerDTO>) => onPatch(row.id, body);
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/60">
        <td className="px-2 py-1.5 align-top">
          <button onClick={onToggle} className="rounded p-0.5 text-slate-400 hover:bg-slate-200">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <TextCell value={row.name} onCommit={(v) => set({ name: v || row.name })} className="min-w-[140px] font-medium" />
            {row.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Verified" />}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />}
          </div>
        </td>
        <td className="px-3 py-1.5">
          <TextCell value={row.products} onCommit={(v) => set({ products: v || null })} className="min-w-[140px]" placeholder="—" />
        </td>
        <td className="px-3 py-1.5">
          <TextCell value={row.country} onCommit={(v) => set({ country: v || null })} className="w-28" placeholder="—" />
        </td>
        <td className="px-3 py-1.5">
          <SelectCell
            value={row.source}
            options={MANUFACTURER_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] ?? s }))}
            onCommit={(v) => set({ source: v })}
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <NumberCell value={row.moq} onCommit={(v) => set({ moq: v })} suffix={row.moqUnit} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <NumberCell value={row.samplePrice} onCommit={(v) => set({ samplePrice: v })} prefix={row.currency} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <NumberCell value={row.unitPrice} onCommit={(v) => set({ unitPrice: v })} prefix={row.currency} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <NumberCell value={row.leadTimeDays} onCommit={(v) => set({ leadTimeDays: v })} />
        </td>
        <td className="px-3 py-1.5">
          <TextCell value={row.paymentTerms} onCommit={(v) => set({ paymentTerms: v || null })} className="min-w-[140px]" placeholder="—" />
        </td>
        <td className="px-3 py-1.5">
          <select
            value={row.status}
            onChange={(e) => set({ status: e.target.value as ManufacturerStatus })}
            className={`rounded-full border-0 px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-blue-300 ${STATUS_PILL[row.status]}`}
          >
            {MANUFACTURER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <RatingStars value={row.rating} onChange={(v) => set({ rating: v })} />
        </td>
        <td className="px-2 py-1.5">
          <button
            onClick={() => onDelete(row.id)}
            className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td></td>
          <td colSpan={12} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Region">
                <SelectCell
                  value={row.region ?? ""}
                  options={[{ value: "", label: "—" }, ...REGIONS.map((r) => ({ value: r, label: r }))]}
                  onCommit={(v) => set({ region: v || null })}
                />
              </Field>
              <Field label="Currency">
                <TextCell value={row.currency} onCommit={(v) => set({ currency: (v || "USD").toUpperCase() })} className="w-20 uppercase" />
              </Field>
              <Field label="MOQ unit">
                <TextCell value={row.moqUnit} onCommit={(v) => set({ moqUnit: v || "units" })} className="w-28" />
              </Field>
              <Field label="Website">
                <LinkText value={row.website} onCommit={(v) => set({ website: v || null })} />
              </Field>
              <Field label="Source listing">
                <LinkText value={row.sourceUrl} onCommit={(v) => set({ sourceUrl: v || null })} />
              </Field>
              <Field label="Contact name">
                <TextCell value={row.contactName} onCommit={(v) => set({ contactName: v || null })} placeholder="—" />
              </Field>
              <Field label="Email">
                <TextCell value={row.email} onCommit={(v) => set({ email: v || null })} placeholder="—" />
              </Field>
              <Field label="Phone">
                <TextCell value={row.phone} onCommit={(v) => set({ phone: v || null })} placeholder="—" />
              </Field>
              <Field label="Verified supplier">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={row.verified}
                    onChange={(e) => set({ verified: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  e.g. Alibaba Verified
                </label>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <NotesArea value={row.notes} onCommit={(v) => set({ notes: v || null })} />
              </Field>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

// ── editable cells ─────────────────────────────────────────────────────────
function TextCell({
  value,
  onCommit,
  className = "",
  placeholder,
}: {
  value: string | null;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value ?? "") && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`rounded border border-transparent bg-transparent px-1.5 py-0.5 hover:border-slate-200 focus:border-blue-300 focus:bg-white focus:outline-none ${className}`}
    />
  );
}

function NumberCell({
  value,
  onCommit,
  prefix,
  suffix,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const next = v.trim() === "" ? null : Number(v);
    if (next !== value && !(next !== null && Number.isNaN(next))) onCommit(next);
  };
  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      {prefix && v !== "" && <span className="text-[10px] text-slate-400">{prefix}</span>}
      <input
        value={v}
        inputMode="decimal"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="—"
        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-slate-200 focus:border-blue-300 focus:bg-white focus:outline-none"
      />
      {suffix && v !== "" && <span className="text-[10px] text-slate-400">{suffix}</span>}
    </span>
  );
}

function SelectCell({
  value,
  options,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-blue-300 focus:bg-white focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RatingStars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const v = value ?? 0;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n === v ? null : n)}
          className="text-slate-300 hover:text-amber-400"
          title={`${n} / 5`}
        >
          <Star className={`h-4 w-4 ${n <= v ? "fill-amber-400 text-amber-400" : ""}`} />
        </button>
      ))}
    </div>
  );
}

function LinkText({ value, onCommit }: { value: string | null; onCommit: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <TextCell value={value} onCommit={onCommit} className="min-w-[180px] flex-1" placeholder="https://…" />
      {value && (
        <a href={value} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function NotesArea({ value, onCommit }: { value: string | null; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value ?? "") && onCommit(v)}
      rows={2}
      placeholder="Quote details, MOQ negotiation, sample feedback, red flags…"
      className="w-full resize-y rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
    />
  );
}

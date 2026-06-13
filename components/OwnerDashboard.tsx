"use client";

import { useEffect, useState } from "react";
import { LayoutDashboard, Share2, TrendingUp, Loader2 } from "lucide-react";
import type {
  BrandSocialSection as BrandSocialState,
  FinancialsSection as FinancialsState,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import BrandSocialSection from "./BrandSocialSection";
import FinancialsSection from "./FinancialsSection";

// The Owner Dashboard is an extensible home for owner-facing tools. The left
// rail is data-driven so new sections (suppliers, launch checklist) slot in.
type SectionId = "brandSocial" | "financials";

const SECTIONS: { id: SectionId; label: string; icon: typeof Share2 }[] = [
  { id: "financials", label: "Financials", icon: TrendingUp },
  { id: "brandSocial", label: "Brand & Social", icon: Share2 },
];

export default function OwnerDashboard({
  runId,
  projectId,
  state,
}: {
  runId: string;
  projectId: string | null;
  state: CanvasState;
}) {
  const [section, setSection] = useState<SectionId>("financials");
  const [brandSocial, setBrandSocial] = useState<BrandSocialState | null>(null);
  const [financials, setFinancials] = useState<FinancialsState | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate saved Owner Dashboard state (generated kit + checkbox progress)
  // from the project. Kept here so all sections share one fetch.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const { project } = await res.json();
          if (!cancelled) {
            setBrandSocial(project?.ownerDashboard?.brandSocial ?? null);
            setFinancials(project?.ownerDashboard?.financials ?? null);
          }
        }
      } catch {
        /* best-effort hydration */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="absolute inset-0 flex bg-white pt-12">
      {/* Section rail */}
      <nav className="w-48 shrink-0 border-r border-neutral-200 bg-neutral-50/60 p-3">
        <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <LayoutDashboard className="h-3.5 w-3.5" /> Owner Dashboard
        </div>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          );
        })}
        <p className="mt-3 px-1 text-[10px] leading-relaxed text-neutral-400">
          More owner tools coming here.
        </p>
      </nav>

      {/* Section body */}
      <div className="relative flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : section === "financials" ? (
          <FinancialsSection
            runId={runId}
            projectId={projectId}
            state={state}
            initial={financials}
            onSaved={setFinancials}
          />
        ) : section === "brandSocial" ? (
          <BrandSocialSection
            runId={runId}
            projectId={projectId}
            state={state}
            initial={brandSocial}
            onChange={setBrandSocial}
          />
        ) : null}
      </div>
    </div>
  );
}

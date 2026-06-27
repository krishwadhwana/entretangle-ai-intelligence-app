"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Share2,
  TrendingUp,
  Sparkles,
  Loader2,
  UserRound,
  ShieldCheck,
  Palette,
} from "lucide-react";
import type {
  BrandSocialSection as BrandSocialState,
  FinancialsSection as FinancialsState,
  FounderStorySection as FounderStoryState,
  InspirationSection as InspirationState,
} from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";
import BrandSocialSection from "./BrandSocialSection";
import CollapsibleSidebar, {
  SidebarCollapseButton,
} from "./CollapsibleSidebar";
import DesignStudioSection from "./DesignStudioSection";
import FinancialsSection from "./FinancialsSection";
import FounderStorySection from "./FounderStorySection";
import InspirationSection from "./InspirationSection";
import InvestorOSSection from "./InvestorOSSection";

// The Owner Dashboard is an extensible home for owner-facing tools. The left
// rail is data-driven so new sections (suppliers, launch checklist) slot in.
type SectionId =
  | "investor"
  | "founderStory"
  | "brandSocial"
  | "designStudio"
  | "financials"
  | "inspiration";
type OwnerDashboardRunSlice = {
  founderStory: FounderStoryState | null;
  brandSocial: BrandSocialState | null;
  financials: FinancialsState | null;
  inspiration: InspirationState | null;
};

const SECTIONS: { id: SectionId; label: string; icon: typeof Share2 }[] = [
  { id: "investor", label: "0 to 100", icon: ShieldCheck },
  { id: "financials", label: "Financials", icon: TrendingUp },
  { id: "founderStory", label: "Founder Story", icon: UserRound },
  { id: "brandSocial", label: "Brand & Social", icon: Share2 },
  { id: "designStudio", label: "Design Studio", icon: Palette },
  { id: "inspiration", label: "Inspiration", icon: Sparkles },
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
  const [section, setSection] = useState<SectionId>("investor");
  const [founderStory, setFounderStory] = useState<FounderStoryState | null>(
    null
  );
  const [brandSocial, setBrandSocial] = useState<BrandSocialState | null>(null);
  const [financials, setFinancials] = useState<FinancialsState | null>(null);
  const [inspiration, setInspiration] = useState<InspirationState | null>(null);
  const [investorRefreshKey, setInvestorRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const refreshInvestor = () => setInvestorRefreshKey((key) => key + 1);

  // Hydrate saved Owner Dashboard state (generated kit + checkbox progress)
  // from the project. Kept here so all sections share one fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFounderStory(null);
    setBrandSocial(null);
    setFinancials(null);
    setInspiration(null);
    if (!projectId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        // Run-scoped endpoint: just this run's owner sections, not every saved
        // owner artifact from sibling runs.
        const res = await fetch(
          `/api/projects/${projectId}/owner-dashboard?runId=${encodeURIComponent(runId)}`
        );
        if (res.ok) {
          const { ownerDashboard } = (await res.json().catch(() => ({}))) as {
            ownerDashboard: OwnerDashboardRunSlice | null;
          };
          if (!cancelled) {
            setFounderStory(ownerDashboard?.founderStory ?? null);
            setBrandSocial(ownerDashboard?.brandSocial ?? null);
            setFinancials(ownerDashboard?.financials ?? null);
            setInspiration(ownerDashboard?.inspiration ?? null);
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
  }, [projectId, runId]);

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row bg-white pt-12">
      {/* Section rail */}
      <CollapsibleSidebar
        as="nav"
        title="owner dashboard sidebar"
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((collapsed) => !collapsed)}
        expandedClassName="w-full md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-neutral-200 bg-neutral-50/60 p-3"
        collapsedClassName="w-full md:w-14 shrink-0 border-b md:border-b-0 md:border-r border-neutral-200 bg-neutral-50/60"
        collapsedChildren={
          <div className="flex w-full flex-col items-center gap-1">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  title={s.label}
                  aria-label={s.label}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        }
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Owner Dashboard</span>
          </div>
          <SidebarCollapseButton
            collapsed={railCollapsed}
            onToggle={() => setRailCollapsed((collapsed) => !collapsed)}
            title="owner dashboard sidebar"
          />
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
      </CollapsibleSidebar>

      {/* Section body */}
      <div className="relative flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className={section === "investor" ? "" : "hidden"}>
              <InvestorOSSection
                projectId={projectId}
                refreshKey={investorRefreshKey}
              />
            </div>
            <div className={section === "financials" ? "" : "hidden"}>
              <FinancialsSection
                runId={runId}
                projectId={projectId}
                state={state}
                initial={financials}
                onSaved={(next) => {
                  setFinancials(next);
                  refreshInvestor();
                }}
              />
            </div>
            <div className={section === "founderStory" ? "" : "hidden"}>
              <FounderStorySection
                projectId={projectId}
                initial={founderStory}
                onSaved={(next) => {
                  setFounderStory(next);
                  refreshInvestor();
                }}
              />
            </div>
            <div className={section === "brandSocial" ? "" : "hidden"}>
              <BrandSocialSection
                runId={runId}
                projectId={projectId}
                state={state}
                initial={brandSocial}
                onChange={(next) => {
                  setBrandSocial(next);
                  refreshInvestor();
                }}
              />
            </div>
            <div className={section === "designStudio" ? "" : "hidden"}>
              <DesignStudioSection
                projectId={projectId}
                sourceRunId={runId}
              />
            </div>
            <div className={section === "inspiration" ? "" : "hidden"}>
              <InspirationSection
                runId={runId}
                state={state}
                initial={inspiration}
                onSaved={(next) => {
                  setInspiration(next);
                  refreshInvestor();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

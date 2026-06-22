// Shared palette — income segments and domains. Kept leaflet-free so it can
// be imported by SSR-rendered components without dragging the map in.

export const SEGMENT_COLORS: Record<string, string> = {
  budget: "#f59e0b",
  middle: "#10b981",
  affluent: "#6366f1",
  luxury: "#a855f7",
};

// Region colours for the political-geography map + region chart. Covers both
// India GoI zones and US Census regions (Midwest is US-only; Northeast/South/
// West are shared labels).
export const ZONE_COLORS: Record<string, string> = {
  North: "#6366f1",
  South: "#10b981",
  East: "#f59e0b",
  West: "#ef4444",
  Central: "#8b5cf6",
  Northeast: "#14b8a6",
  Midwest: "#0ea5e9",
  Other: "#94a3b8",
};

export const DOMAIN_COLORS: Record<string, string> = {
  market: "#0ea5e9",
  competitor: "#ef4444",
  product: "#c026d3",
  supply: "#0d9488",
  operations: "#475569",
  channel: "#10b981",
  regulation: "#f59e0b",
  pricing: "#8b5cf6",
  finance: "#65a30d",
  social: "#ec4899",
  audience: "#6366f1",
  synthesis: "#171717",
};

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Crosshair,
  FileDown,
  Loader2,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import { providerErrorMessage } from "@/lib/providerErrors";
import type {
  AudienceAggregate,
  Cohort,
  Persona,
  Role,
  Segment,
} from "@/lib/schema";
import type { CohortWithPersonas } from "./useRunEvents";
import { SEGMENT_COLORS, ZONE_COLORS } from "./segments";
import { regionForLocality } from "@/lib/datasources/politicalGeography";
import {
  cohortAreaRadiusMeters,
  searchKnownLocalities,
} from "@/lib/localityAnchors";
import { ValueTooltip } from "./ValueTooltip";
import { downloadDossier, type DossierSection } from "./pdf";
import { classifySentiment, SENTIMENT_META } from "@/lib/vote";

type AudienceBatchResult = {
  cohort: Cohort;
  personas: Persona[];
  aggregate: AudienceAggregate | null;
  tokensUsed?: number;
  costUsd?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse a response body that MIGHT not be JSON (e.g. a serverless timeout/crash
// page) without throwing the cryptic "Unexpected token … is not valid JSON".
async function readBody(
  res: Response
): Promise<{ error?: string; [k: string]: unknown }> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return { error: text.slice(0, 160) };
  }
}

type Props = {
  runId: string;
  cohorts: CohortWithPersonas[];
  selectedCohortId: string | null;
  canAddAudience: boolean;
  onSelectCohort: (id: string) => void;
  onAudienceBatchAdded: (result: AudienceBatchResult) => void;
};

type SearchResult = {
  label: string;
  country: string;
  lat: number;
  lng: number;
  source: "known" | "geocoder";
  segments?: Segment[];
};

type Pin = {
  label: string;
  country: string;
  lat: number;
  lng: number;
};

type ColorMode = "segment" | "zone";

const SEGMENTS: Segment[] = ["budget", "middle", "affluent", "luxury"];
const SEGMENT_ORDER: Record<string, number> = {
  budget: 0,
  middle: 1,
  affluent: 2,
  luxury: 3,
};
const REGION_ORDER = [
  "North",
  "West",
  "South",
  "East",
  "Central",
  "Northeast",
  "Midwest",
  "Other",
];
const ROLES: Role[] = [
  "consumer",
  "retail_exec",
  "institutional",
  "distributor",
  "influencer",
];

function roleLabel(role: Role) {
  return role.replace("_", " ");
}

function cohortLegendKey(c: CohortWithPersonas, colorMode: ColorMode): string {
  if (colorMode === "zone") {
    return regionForLocality(c.locality, c.country)?.zone ?? "Other";
  }
  return c.segment;
}

function FitToCohorts({ cohorts }: { cohorts: CohortWithPersonas[] }) {
  const map = useMap();
  const signature = cohorts.map((c) => `${c.id}:${c.lat}:${c.lng}`).join("|");

  useEffect(() => {
    if (cohorts.length === 0) return;
    const bounds = cohorts.map((c) => [c.lat, c.lng] as [number, number]);
    map.fitBounds(bounds, { padding: [72, 72], maxZoom: 11 });
  }, [cohorts.length, map, signature]);

  return null;
}

function FlyToPin({ pin }: { pin: Pin | null }) {
  const map = useMap();
  useEffect(() => {
    if (!pin) return;
    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 12), {
      duration: 0.45,
    });
  }, [map, pin]);
  return null;
}

function DropPinLayer({
  enabled,
  onDrop,
}: {
  enabled: boolean;
  onDrop: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onDrop(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Geography layer: one area circle per cohort at a real locality/neighborhood.
 * Existing broad city cohorts are already converted server-side into segment-
 * appropriate sublocalities; manual pins append new simulated cohorts.
 */
export default function MapView({
  runId,
  cohorts,
  selectedCohortId,
  canAddAudience,
  onSelectCohort,
  onAudienceBatchAdded,
}: Props) {
  const center = useMemo<[number, number]>(() => {
    if (cohorts.length === 0) return [20.5937, 78.9629];
    const lat = cohorts.reduce((s, c) => s + c.lat, 0) / cohorts.length;
    const lng = cohorts.reduce((s, c) => s + c.lng, 0) / cohorts.length;
    return [lat, lng];
  }, [cohorts]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("segment");
  const [hoveredLegendKey, setHoveredLegendKey] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("middle");
  const [role, setRole] = useState<Role>("consumer");
  const [size, setSize] = useState(30);
  // Text buffer so the persona-count field can be emptied/typed freely while the
  // parent keeps a number. Without it, clearing snaps back to the floor and that
  // number acts like un-deletable text instead of a placeholder.
  const [sizeText, setSizeText] = useState("30");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportablePersonaCount = useMemo(
    () => cohorts.reduce((sum, c) => sum + c.personas.length, 0),
    [cohorts]
  );

  function exportPersonaDossier() {
    downloadDossier(
      buildPersonaDossier(cohorts),
      "persona-dossier"
    );
  }

  function setPinFromLatLng(lat: number, lng: number) {
    setError(null);
    setResults([]);
    setPin({
      label: `Pinned locality ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      country: "India",
      lat,
      lng,
    });
  }

  function selectResult(result: SearchResult) {
    setError(null);
    setResults([]);
    setQuery(result.label);
    setPin({
      label: result.label,
      country: result.country || "India",
      lat: result.lat,
      lng: result.lng,
    });
    if (result.segments?.length && !result.segments.includes(segment)) {
      setSegment(result.segments[0]);
    }
    setPinMode(false);
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const known: SearchResult[] = searchKnownLocalities(q, 8).map((r) => ({
        ...r,
        source: "known",
      }));
      let remote: SearchResult[] = [];
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = (await res.json()) as {
            results?: Array<{
              label: string;
              country: string;
              lat: number;
              lng: number;
            }>;
          };
          remote = (data.results ?? []).map((r) => ({
            ...r,
            source: "geocoder" as const,
          }));
        }
      } catch {
        // Known locality hits are still useful when geocoding is unavailable.
      }
      const seen = new Set<string>();
      const merged = [...known, ...remote].filter((r) => {
        const key = `${r.label}:${r.lat.toFixed(3)}:${r.lng.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setResults(merged.slice(0, 8));
      if (merged.length === 0) setError("No locality found");
    } finally {
      setSearching(false);
    }
  }

  async function addAudienceBatch() {
    if (!pin || adding || !canAddAudience) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/audience-locality`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locality: pin.label,
          country: pin.country || "India",
          lat: pin.lat,
          lng: pin.lng,
          segment,
          role,
          size,
          weightPct: Math.max(0.5, Math.min(8, size / 20)),
        }),
      });
      const data = await readBody(res);
      if (!res.ok) {
        throw new Error(
          providerErrorMessage(data?.error ?? data, `batch failed (${res.status})`)
        );
      }

      // The cohort is simulated on the worker (no serverless timeout); poll the
      // cohort until it lands, then fold it into the canvas.
      const cohortId = (data.cohort as Cohort).id;
      let result: AudienceBatchResult | null = null;
      for (let i = 0; i < 150; i++) {
        await sleep(2500);
        const pollRes = await fetch(
          `/api/runs/${runId}/audience-locality?cohortId=${cohortId}`
        );
        const poll = await readBody(pollRes);
        if (!pollRes.ok) continue; // transient — keep polling
        if (poll.state === "failed") {
          throw new Error("audience batch failed to simulate");
        }
        if (poll.state === "done") {
          result = poll as unknown as AudienceBatchResult;
          break;
        }
      }
      if (!result) throw new Error("still simulating — check back in a moment");

      onAudienceBatchAdded(result);
      onSelectCohort(cohortId);
      setPin(null);
      setPinMode(false);
      setResults([]);
    } catch (e) {
      setError(providerErrorMessage(e, "Audience batch failed"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={5}
        className="h-full w-full"
        scrollWheelZoom
        attributionControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        <FitToCohorts cohorts={cohorts} />
        <FlyToPin pin={pin} />
        <DropPinLayer enabled={pinMode} onDrop={setPinFromLatLng} />
        {cohorts.map((c) => {
          const selected = c.id === selectedCohortId;
          const legendKey = cohortLegendKey(c, colorMode);
          const legendHovered = hoveredLegendKey !== null;
          const highlighted = hoveredLegendKey === legendKey;
          const color =
            colorMode === "zone"
              ? (ZONE_COLORS[legendKey] ?? ZONE_COLORS.Other)
              : (SEGMENT_COLORS[c.segment] ?? "#6366f1");
          const baseFillOpacity =
            c.state === "done" ? 0.24 : c.state === "failed" ? 0.08 : 0.14;
          const fillOpacity = legendHovered
            ? highlighted
              ? c.state === "failed"
                ? 0.18
                : 0.5
              : 0.04
            : baseFillOpacity;
          return (
            <Circle
              key={c.id}
              center={[c.lat, c.lng]}
              radius={cohortAreaRadiusMeters(c)}
              pathOptions={{
                color: selected ? "#171717" : color,
                weight: selected ? 2.5 : highlighted ? 3 : 1.5,
                fillColor: color,
                fillOpacity,
                opacity: legendHovered && !highlighted ? 0.28 : 1,
                dashArray: c.state === "done" ? undefined : "5 4",
              }}
              eventHandlers={{
                click: (e) => {
                  if (pinMode) {
                    setPinFromLatLng(e.latlng.lat, e.latlng.lng);
                    return;
                  }
                  onSelectCohort(c.id);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div className="text-xs">
                  <div className="font-semibold">{c.label}</div>
                  <div>
                    {c.state === "done" && c.stats
                      ? `${c.stats.n} personas · intent ${c.stats.meanIntent} · WTP P50 ${c.stats.wtpCurrency} ${c.stats.wtpP50.toLocaleString()}`
                      : c.state === "failed"
                        ? "simulation failed"
                        : "simulating..."}
                  </div>
                </div>
              </Tooltip>
            </Circle>
          );
        })}
        {pin && (
          <CircleMarker
            center={[pin.lat, pin.lng]}
            radius={7}
            pathOptions={{
              color: "#171717",
              weight: 2,
              fillColor: SEGMENT_COLORS[segment] ?? "#6366f1",
              fillOpacity: 0.9,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent>
              <span className="text-[11px] font-semibold">{pin.label}</span>
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      {/* Colour-mode toggle + legend: by income segment or by GoI region (zone). */}
      <div className="absolute right-3 top-16 sm:top-3 z-[1000] max-w-[calc(100%-24px)] rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Colour:</span>
            {(["segment", "zone"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setColorMode(m);
                  setHoveredLegendKey(null);
                }}
                className={`rounded px-1.5 py-0.5 capitalize ${
                  colorMode === m
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {m === "zone" ? "region" : m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportPersonaDossier}
            disabled={exportablePersonaCount === 0}
            className="ml-1 flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-0.5 font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
            title="Download the Persona Dossier PDF"
          >
            <FileDown className="h-3 w-3" />
            Persona Dossier
          </button>
        </div>
        <div className="mt-1.5 flex max-w-[200px] flex-wrap gap-x-2 gap-y-1">
          {Object.entries(
            colorMode === "zone" ? ZONE_COLORS : SEGMENT_COLORS,
          ).map(([k, v]) => {
            const active = hoveredLegendKey === k;
            return (
              <button
                key={k}
                type="button"
                onMouseEnter={() => setHoveredLegendKey(k)}
                onMouseLeave={() => setHoveredLegendKey(null)}
                onFocus={() => setHoveredLegendKey(k)}
                onBlur={() => setHoveredLegendKey(null)}
                className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] capitalize transition ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
                title={`Highlight ${k}`}
              >
                <ValueTooltip
                  content={`${colorMode === "zone" ? "Region" : "Segment"}: ${k}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${active ? "ring-1 ring-white/80" : ""}`}
                    style={{ background: v }}
                  />
                </ValueTooltip>
                {k}
              </button>
            );
          })}
        </div>
      </div>

      <div className="absolute left-3 top-3 z-[1000] w-[min(360px,calc(100%-24px))] rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur">
        <form onSubmit={onSearch} className="flex items-center gap-2 border-b border-neutral-100 p-2">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
            placeholder="Search locality"
          />
          <button
            type="submit"
            disabled={query.trim().length < 2 || searching}
            className="grid h-8 w-8 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
            title="Search"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPinMode((v) => !v);
              setResults([]);
            }}
            className={`grid h-8 w-8 place-items-center rounded-md ${
              pinMode
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-100"
            }`}
            title="Drop pin"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </form>

        {results.length > 0 && (
          <div className="max-h-64 overflow-y-auto border-b border-neutral-100 py-1">
            {results.map((result) => (
              <button
                key={`${result.source}:${result.label}:${result.lat}:${result.lng}`}
                type="button"
                onClick={() => selectResult(result)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-neutral-50"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-neutral-800">
                    {result.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    {result.source === "known" ? "locality anchor" : "geocoder"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {pin && (
          <div className="space-y-3 p-3">
            <div className="flex items-start gap-2">
              <MapPin className="mt-2 h-4 w-4 shrink-0 text-neutral-500" />
              <div className="min-w-0 flex-1">
                <input
                  value={pin.label}
                  onChange={(e) => setPin({ ...pin, label: e.target.value })}
                  className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-900 outline-none focus:border-indigo-400"
                />
                <div className="mt-1 flex gap-2 text-[10px] text-neutral-400">
                  <span>{pin.lat.toFixed(5)}</span>
                  <span>{pin.lng.toFixed(5)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPin(null)}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title="Clear pin"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1">
              {SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSegment(s)}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-medium capitalize ${
                    segment === s
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-[1fr_92px] gap-2">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="rounded-md border border-neutral-200 px-2 py-1.5 text-xs capitalize text-neutral-800 outline-none focus:border-indigo-400"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="numeric"
                min={5}
                max={120}
                value={sizeText}
                placeholder="30"
                onChange={(e) => {
                  const raw = e.target.value;
                  setSizeText(raw);
                  // Commit a valid number to the parent while typing; leave the
                  // raw text alone so partial/empty input keeps the caret.
                  const n = Number(raw);
                  if (raw !== "" && Number.isFinite(n)) {
                    setSize(Math.max(5, Math.min(120, Math.round(n))));
                  }
                }}
                onBlur={() => {
                  // Normalise display to the clamped value (default 30 if empty).
                  const n = Number(sizeText);
                  const v =
                    sizeText === "" || !Number.isFinite(n)
                      ? 30
                      : Math.max(5, Math.min(120, Math.round(n)));
                  setSize(v);
                  setSizeText(String(v));
                }}
                className="w-20 rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 outline-none focus:border-indigo-400"
                title="Persona count"
              />
            </div>

            <button
              type="button"
              onClick={addAudienceBatch}
              disabled={!pin.label.trim() || !canAddAudience || adding}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {adding ? "Running batch..." : "Add audience"}
            </button>
          </div>
        )}

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

type RegionBundle = {
  name: string;
  cohorts: CohortWithPersonas[];
  personas: Array<{ cohort: CohortWithPersonas; persona: Persona }>;
};

function buildPersonaDossier(cohorts: CohortWithPersonas[]) {
  const regions = groupCohortsByRegion(cohorts);
  const allPersonas = regions.flatMap((r) => r.personas);
  const verdicts = verdictCounts(allPersonas.map((p) => p.persona));
  const dominantRegion = [...regions].sort(
    (a, b) => b.personas.length - a.personas.length
  )[0];
  const sections: DossierSection[] = [];

  sections.push({
    heading: "Region index",
    body: "Start here. This front index intentionally lists regions only; every persona is linked in the back index.",
    linkList: {
      items: regions.map((region) => ({
        text: `${region.name} region`,
        sub: `${region.personas.length.toLocaleString()} personas across ${region.cohorts.length.toLocaleString()} placed group${region.cohorts.length === 1 ? "" : "s"} in ${localityCount(region).toLocaleString()} location${localityCount(region) === 1 ? "" : "s"}.`,
        targetId: regionAnchor(region.name),
      })),
    },
  });

  for (const region of regions) {
    sections.push(regionSection(region));
    for (const cohort of region.cohorts) {
      sections.push(cohortSection(cohort));
      for (const persona of cohort.personas) {
        sections.push(personaSection(persona));
      }
    }
  }

  sections.push({
    heading: "Back index - Personas",
    pageBreak: true,
    body: "Every persona is listed in the same headline format used on the Geography drawer. Each linked name jumps back to that persona's detailed card inside its region.",
  });
  for (const region of regions) {
    sections.push({
      heading: `${region.name} region`,
      linkList: {
        items: region.personas.map(({ cohort, persona }) => ({
          text: personaDisplayLabel(persona),
          sub: `${cohort.label} - Verdict: ${personaVerdict(persona)} (${pct(persona.intent)} intent); WTP ${persona.wtpCurrency} ${persona.wtp.toLocaleString()}; Objection: ${persona.objection}`,
          targetId: personaAnchor(persona.id),
        })),
      },
    });
  }

  return {
    title: "Persona Dossier",
    subtitle: "Geography page - regions, placed groups, and persona index",
    meta: [
      `${allPersonas.length.toLocaleString()} personas`,
      `${cohorts.length.toLocaleString()} placed groups`,
      `${regions.length.toLocaleString()} regions`,
      new Date().toLocaleDateString(),
    ],
    cover: {
      verdict: allPersonas.length
        ? `${verdicts.approve} approve, ${verdicts.mixed} mixed, ${verdicts.reject} reject. ${
            dominantRegion
              ? `${dominantRegion.name} is the largest region by persona count.`
              : ""
          }`
        : "No completed personas are available yet.",
      kpis: [
        { label: "Personas", value: allPersonas.length.toLocaleString() },
        { label: "Groups", value: cohorts.length.toLocaleString(), sub: "placed cohorts" },
        { label: "Regions", value: regions.length.toLocaleString() },
        {
          label: "Mean intent",
          value: allPersonas.length
            ? pct(mean(allPersonas.map(({ persona }) => persona.intent)))
            : "0%",
        },
      ],
    },
    sections,
  };
}

function regionSection(region: RegionBundle): DossierSection {
  const personas = region.personas.map((p) => p.persona);
  const verdicts = verdictCounts(personas);
  const objections = topObjections(personas);
  return {
    heading: `${region.name} region`,
    anchorId: regionAnchor(region.name),
    pageBreak: true,
    body: `${region.personas.length.toLocaleString()} personas across ${region.cohorts.length.toLocaleString()} placed group${region.cohorts.length === 1 ? "" : "s"} and ${localityCount(region).toLocaleString()} location${localityCount(region) === 1 ? "" : "s"}. Verdict mix: ${verdicts.approve} approve, ${verdicts.mixed} mixed, ${verdicts.reject} reject.`,
    kpis: [
      { label: "Personas", value: region.personas.length.toLocaleString() },
      { label: "Groups", value: region.cohorts.length.toLocaleString() },
      { label: "Mean intent", value: personas.length ? pct(mean(personas.map((p) => p.intent))) : "0%" },
      { label: "Locations", value: localityCount(region).toLocaleString() },
    ],
    table: {
      columns: ["Placed group", "Personas", "Intent", "WTP P50", "Key objections"],
      rows: region.cohorts.map((cohort) => [
        `${cohort.locality} - ${cohort.segment} ${roleLabel(cohort.role)}`,
        cohort.personas.length,
        cohort.stats ? pct(cohort.stats.meanIntent) : cohort.state,
        cohort.stats
          ? `${cohort.stats.wtpCurrency} ${cohort.stats.wtpP50.toLocaleString()}`
          : "-",
        cohort.stats?.topObjections.slice(0, 2).join("; ") ||
          topObjections(cohort.personas).slice(0, 2).join("; ") ||
          "-",
      ]),
    },
    bullets: objections.length
      ? [`Key objections: ${objections.join("; ")}`]
      : undefined,
  };
}

function cohortSection(cohort: CohortWithPersonas): DossierSection {
  const s = cohort.stats;
  return {
    heading: cohort.label,
    anchorId: cohortAnchor(cohort.id),
    body: cohort.summary ?? undefined,
    kpis: [
      { label: "Personas", value: cohort.personas.length.toLocaleString() },
      {
        label: "Mean intent",
        value: s ? pct(s.meanIntent) : cohort.state,
      },
      {
        label: "WTP P50",
        value: s ? `${s.wtpCurrency} ${s.wtpP50.toLocaleString()}` : "-",
      },
      { label: "Audience weight", value: `${cohort.weightPct}%` },
    ],
    bullets: [
      `${cohort.locality}, ${cohort.country} - ${cohort.segment} segment, ${roleLabel(cohort.role)} role.`,
      s?.topChannels.length
        ? `Channels: ${s.topChannels.map((c) => `${c.name} ${c.share}%`).join(" - ")}`
        : "Channels: no completed channel mix yet.",
      s?.topPlatforms.length
        ? `Platforms: ${s.topPlatforms.map((p) => `${p.name} ${p.share}%`).join(" - ")}`
        : "Platforms: mostly offline or unavailable.",
      `Key objections: ${
        s?.topObjections.length
          ? s.topObjections.join("; ")
          : topObjections(cohort.personas).join("; ") || "No objections captured yet."
      }`,
    ],
  };
}

function personaSection(persona: Persona): DossierSection {
  const verdict = personaVerdict(persona);
  const prior =
    typeof persona.intentOriginal === "number" && persona.intentOriginal !== persona.intent
      ? `; was ${pct(persona.intentOriginal)}`
      : "";
  return {
    heading: personaDisplayLabel(persona),
    anchorId: personaAnchor(persona.id),
    body: persona.quote ? `"${persona.quote}"` : undefined,
    bullets: [
      `Verdict: ${verdict} (${pct(persona.intent)} intent${prior}).`,
      persona.personality ? `Personality: ${persona.personality}` : "",
      persona.personalityTraits.length
        ? `Traits: ${persona.personalityTraits.join(", ")}`
        : "",
      persona.lifestyle ? `Lifestyle: ${persona.lifestyle}` : "",
      persona.reasoning ? `Why: ${persona.reasoning}` : "",
      persona.values.length ? `Values: ${persona.values.join(", ")}` : "",
      `WTP ${persona.wtpCurrency} ${persona.wtp.toLocaleString()} - ${pct(persona.priceSensitivity)} price-sensitive - buys via ${persona.channelPref} - ${persona.platforms.length ? persona.platforms.join(", ") : "offline"}.`,
      persona.shoppingHabits ? `Shopping habits: ${persona.shoppingHabits}` : "",
      `Objection: ${persona.objection}`,
    ].filter(Boolean),
  };
}

function groupCohortsByRegion(cohorts: CohortWithPersonas[]): RegionBundle[] {
  const byRegion = new Map<string, CohortWithPersonas[]>();
  for (const cohort of cohorts) {
    const region = regionForLocality(cohort.locality, cohort.country)?.zone ?? "Other";
    byRegion.set(region, [...(byRegion.get(region) ?? []), cohort]);
  }
  return [...byRegion.entries()]
    .map(([name, regionCohorts]) => {
      const sorted = [...regionCohorts].sort(compareCohorts);
      return {
        name,
        cohorts: sorted,
        personas: sorted.flatMap((cohort) =>
          cohort.personas.map((persona) => ({ cohort, persona }))
        ),
      };
    })
    .sort((a, b) => {
      const ai = REGION_ORDER.indexOf(a.name);
      const bi = REGION_ORDER.indexOf(b.name);
      const ao = ai === -1 ? REGION_ORDER.length : ai;
      const bo = bi === -1 ? REGION_ORDER.length : bi;
      return ao - bo || a.name.localeCompare(b.name);
    });
}

function compareCohorts(a: CohortWithPersonas, b: CohortWithPersonas): number {
  return (
    a.locality.localeCompare(b.locality) ||
    (SEGMENT_ORDER[a.segment] ?? 99) - (SEGMENT_ORDER[b.segment] ?? 99) ||
    a.role.localeCompare(b.role) ||
    a.label.localeCompare(b.label)
  );
}

function personaDisplayLabel(persona: Persona): string {
  return `${persona.name} ${persona.age} · ${persona.occupation}${
    persona.lifeStage ? ` · ${persona.lifeStage}` : ""
  }`;
}

function personaVerdict(persona: Persona): string {
  return SENTIMENT_META[classifySentiment(persona.intent)].label;
}

function verdictCounts(personas: Persona[]) {
  return personas.reduce(
    (acc, persona) => {
      acc[classifySentiment(persona.intent)] += 1;
      return acc;
    },
    { approve: 0, mixed: 0, reject: 0 }
  );
}

function topObjections(personas: Persona[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const persona of personas) {
    const objection = persona.objection.trim();
    if (!objection) continue;
    counts.set(objection, (counts.get(objection) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, count]) => `${text} (${count})`);
}

function localityCount(region: RegionBundle): number {
  return new Set(region.cohorts.map((c) => `${c.locality}|${c.country}`)).size;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function anchorSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function regionAnchor(region: string): string {
  return `region-${anchorSafe(region)}`;
}

function cohortAnchor(id: string): string {
  return `cohort-${anchorSafe(id)}`;
}

function personaAnchor(id: string): string {
  return `persona-${anchorSafe(id)}`;
}

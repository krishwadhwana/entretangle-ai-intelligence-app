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
  Loader2,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
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

const SEGMENTS: Segment[] = ["budget", "middle", "affluent", "luxury"];
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
  const [colorMode, setColorMode] = useState<"segment" | "zone">("segment");
  const [segment, setSegment] = useState<Segment>("middle");
  const [role, setRole] = useState<Role>("consumer");
  const [size, setSize] = useState(30);
  // Text buffer so the persona-count field can be emptied/typed freely while the
  // parent keeps a number. Without it, clearing snaps back to the floor and that
  // number acts like un-deletable text instead of a placeholder.
  const [sizeText, setSizeText] = useState("30");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) throw new Error(data?.error ?? `batch failed (${res.status})`);

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
      setError(e instanceof Error ? e.message : "Audience batch failed");
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
          const color =
            colorMode === "zone"
              ? ZONE_COLORS[
                  regionForLocality(c.locality, c.country)?.zone ?? "Other"
                ] ?? ZONE_COLORS.Other
              : SEGMENT_COLORS[c.segment] ?? "#6366f1";
          return (
            <Circle
              key={c.id}
              center={[c.lat, c.lng]}
              radius={cohortAreaRadiusMeters(c)}
              pathOptions={{
                color: selected ? "#171717" : color,
                weight: selected ? 2.5 : 1.5,
                fillColor: color,
                fillOpacity:
                  c.state === "done" ? 0.24 : c.state === "failed" ? 0.08 : 0.14,
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
      <div className="absolute right-3 top-3 z-[1000] rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-neutral-400">Colour:</span>
          {(["segment", "zone"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setColorMode(m)}
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
        <div className="mt-1.5 flex max-w-[200px] flex-wrap gap-x-2 gap-y-1">
          {Object.entries(colorMode === "zone" ? ZONE_COLORS : SEGMENT_COLORS).map(
            ([k, v]) => (
              <span
                key={k}
                className="flex items-center gap-1 text-[10px] capitalize text-neutral-600"
              >
                <ValueTooltip
                  content={`${colorMode === "zone" ? "Region" : "Segment"}: ${k}`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: v }}
                  />
                </ValueTooltip>
                {k}
              </span>
            )
          )}
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

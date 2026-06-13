"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { CohortWithPersonas } from "./useRunEvents";
import { SEGMENT_COLORS } from "./segments";

type Props = {
  cohorts: CohortWithPersonas[];
  selectedCohortId: string | null;
  onSelectCohort: (id: string) => void;
};

/**
 * The Geography layer (SPEC-V2 §5): one bubble per cohort at its real
 * lat/lng. Size = audience weight, color = income segment, pulse while
 * simulating. Click → cohort drawer with persona cards.
 */
export default function MapView({
  cohorts,
  selectedCohortId,
  onSelectCohort,
}: Props) {
  const center = useMemo<[number, number]>(() => {
    if (cohorts.length === 0) return [20, 30];
    const lat = cohorts.reduce((s, c) => s + c.lat, 0) / cohorts.length;
    const lng = cohorts.reduce((s, c) => s + c.lng, 0) / cohorts.length;
    return [lat, lng];
  }, [cohorts]);

  return (
    <MapContainer
      center={center}
      zoom={4}
      className="h-full w-full"
      scrollWheelZoom
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
      {cohorts.map((c) => {
        const selected = c.id === selectedCohortId;
        const color = SEGMENT_COLORS[c.segment] ?? "#6366f1";
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={Math.max(6, Math.min(22, 5 + c.weightPct * 1.6))}
            pathOptions={{
              color: selected ? "#171717" : color,
              weight: selected ? 2.5 : 1.5,
              fillColor: color,
              fillOpacity:
                c.state === "done" ? 0.55 : c.state === "failed" ? 0.15 : 0.3,
              dashArray: c.state === "done" ? undefined : "4 3",
            }}
            eventHandlers={{ click: () => onSelectCohort(c.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <div className="text-xs">
                <div className="font-semibold">{c.label}</div>
                <div>
                  {c.state === "done" && c.stats
                    ? `${c.stats.n} personas · intent ${c.stats.meanIntent} · WTP P50 ${c.stats.wtpCurrency} ${c.stats.wtpP50.toLocaleString()}`
                    : c.state === "failed"
                      ? "simulation failed"
                      : "simulating…"}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

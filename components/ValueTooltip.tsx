"use client";

import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Point = { x: number; y: number };

/**
 * Lightweight hover tooltip for visually-encoded data (bars, heatmap cells,
 * color swatches, map/network nodes) so a cursor hover always reveals the exact
 * underlying number/label. Matches the dark styling of the recharts/leaflet
 * tooltips already in the app.
 *
 * The wrapper is `display:contents` — it adds NO box of its own, so it never
 * perturbs the layout of whatever it wraps. The tooltip itself renders through
 * a portal to <body> and follows the cursor, so it can't be clipped by the
 * `overflow-hidden`/scroll containers these charts live inside.
 */
export function ValueTooltip({
  content,
  children,
  className,
}: {
  // Pass null/undefined to render children with no tooltip (e.g. no data yet).
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<Point | null>(null);

  const place = useCallback((e: { clientX: number; clientY: number }) => {
    // Offset from the cursor, clamped so the tip stays on-screen near edges.
    const PAD = 14;
    const W = 260; // matches max-w below; used only for edge flipping
    let x = e.clientX + PAD;
    let y = e.clientY + PAD;
    if (typeof window !== "undefined") {
      if (x + W > window.innerWidth) x = e.clientX - PAD - W;
      if (y + 80 > window.innerHeight) y = e.clientY - PAD - 28;
    }
    setPos({ x, y });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  const show = content !== null && content !== undefined && content !== "";

  return (
    <span
      className={className}
      style={{ display: "contents" }}
      onMouseMove={show ? place : undefined}
      onMouseLeave={hide}
    >
      {children}
      {show && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: "fixed",
                left: pos.x,
                top: pos.y,
                zIndex: 10000,
                pointerEvents: "none",
                maxWidth: 260,
              }}
              className="rounded-md bg-neutral-900/95 px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-lg ring-1 ring-white/10"
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// A dropdown whose panel is portaled to <body> and positioned `fixed` at the
// trigger button. This lets it escape `overflow-x-auto`/`overflow-hidden`
// ancestors — the exact situation in our horizontal scroll-strip toolbars,
// where a normally-positioned `absolute` menu would be clipped.
//
// `children` is a render function receiving `close()` so menu items can dismiss
// the panel when chosen.
export default function PortalMenu({
  button,
  buttonClassName = "",
  buttonTitle,
  align = "left",
  panelClassName = "",
  children,
  disabled = false,
}: {
  button: ReactNode;
  buttonClassName?: string;
  buttonTitle?: string;
  align?: "left" | "right";
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  }>({ top: 0, left: 0 });

  useEffect(() => setMounted(true), []);

  const reposition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 6;
    if (align === "right") {
      setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
    } else {
      // Keep the panel on-screen: clamp the left edge so it never overflows.
      setPos({ top, left: Math.min(r.left, window.innerWidth - 8) });
    }
  };

  useLayoutEffect(() => {
    if (open) reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      )
        return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll() {
      reposition();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Capture scrolls from any ancestor so the panel tracks (or use to close).
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={buttonTitle}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {button}
      </button>
      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              right: pos.right,
              maxHeight: "min(70vh, 28rem)",
            }}
            className={`z-[1300] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-1 shadow-lg ${panelClassName}`}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

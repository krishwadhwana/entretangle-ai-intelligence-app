"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import { tokenizeGlossary, type GlossaryEntry } from "@/lib/glossary";

// Renders a string of report prose, underlining any recognised jargon and
// surfacing its plain-English definition on hover/focus. Terms with an external
// explainer (e.g. "size curves") render as a real link too. The tooltip is
// portalled to <body> so it never gets clipped by an overflow-auto container.

function GlossaryTerm({ text, entry }: { text: string; entry: GlossaryEntry }) {
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const isLink = Boolean(entry.href);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Clamp horizontally so a wide tooltip never spills off-screen.
    const left = Math.min(
      Math.max(r.left + r.width / 2, 150),
      window.innerWidth - 150
    );
    setPos({ top: r.top, left });
  }
  const hide = () => setPos(null);

  const shared = {
    ref: ref as React.Ref<never>,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    tabIndex: 0,
    "aria-label": `${text}: ${entry.definition}`,
  };

  const tooltip =
    pos &&
    createPortal(
      <span
        style={{ position: "fixed", top: pos.top - 10, left: pos.left }}
        className="pointer-events-none z-[3000] block w-64 max-w-[80vw] -translate-x-1/2 -translate-y-full rounded-lg border border-neutral-200 bg-white p-3 text-left text-[12px] font-normal leading-snug text-neutral-700 shadow-xl"
      >
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
          {entry.term}
        </span>
        {entry.definition}
        {isLink && (
          <span className="mt-1.5 flex items-center gap-0.5 text-[11px] font-medium text-indigo-600">
            Learn more <ArrowUpRight className="h-3 w-3" />
          </span>
        )}
      </span>,
      document.body
    );

  if (isLink) {
    return (
      <a
        {...shared}
        href={entry.href}
        target="_blank"
        rel="noreferrer"
        className="cursor-help text-indigo-600 underline decoration-indigo-400 decoration-dotted underline-offset-2 hover:text-indigo-700 hover:decoration-indigo-600"
      >
        {text}
        {tooltip}
      </a>
    );
  }

  return (
    <span
      {...shared}
      className="cursor-help underline decoration-neutral-400 decoration-dotted underline-offset-2 hover:decoration-neutral-600"
    >
      {text}
      {tooltip}
    </span>
  );
}

export default function GlossaryText({ children }: { children: string }) {
  const tokens = useMemo(() => tokenizeGlossary(children), [children]);
  return (
    <>
      {tokens.map((t, i) =>
        t.entry ? (
          <GlossaryTerm key={i} text={t.text} entry={t.entry} />
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </>
  );
}

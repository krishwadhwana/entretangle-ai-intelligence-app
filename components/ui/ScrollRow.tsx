"use client";

import type { ReactNode } from "react";

// A single-row horizontal scroll strip for toolbars. On mobile the children
// stay on one swipeable line (no wrap); from `lg` up the bar wraps normally so
// nothing is hidden on the desktop layout it was designed for.
//
// Direct children should carry `shrink-0` so they keep their natural width
// inside the scroll area. Pass `wrapAt={false}` to keep it scrolling at every
// width (e.g. a pure tab strip).
export default function ScrollRow({
  children,
  className = "",
  wrap = true,
}: {
  children: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const wrapClasses = wrap
    ? "flex-nowrap overflow-x-auto no-scrollbar lg:flex-wrap lg:overflow-visible"
    : "flex-nowrap overflow-x-auto no-scrollbar";
  return (
    <div className={`flex items-center ${wrapClasses} ${className}`}>
      {children}
    </div>
  );
}

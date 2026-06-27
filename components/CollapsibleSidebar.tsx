"use client";

import type { ReactNode } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

type SidebarSide = "left" | "right";

export function SidebarCollapseButton({
  collapsed,
  onToggle,
  title,
  side = "left",
  className = "",
}: {
  collapsed: boolean;
  onToggle: () => void;
  title: string;
  side?: SidebarSide;
  className?: string;
}) {
  const Icon = collapsed
    ? side === "right"
      ? PanelRightOpen
      : PanelLeftOpen
    : side === "right"
      ? PanelRightClose
      : PanelLeftClose;
  const action = collapsed ? "Expand" : "Collapse";

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-400 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 ${className}`}
      title={`${action} ${title}`}
      aria-label={`${action} ${title}`}
      aria-expanded={!collapsed}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export default function CollapsibleSidebar({
  as = "aside",
  collapsed,
  onToggle,
  title,
  side = "left",
  expandedClassName,
  collapsedClassName,
  collapsedChildren,
  children,
}: {
  as?: "aside" | "nav";
  collapsed: boolean;
  onToggle: () => void;
  title: string;
  side?: SidebarSide;
  expandedClassName: string;
  collapsedClassName: string;
  collapsedChildren?: ReactNode;
  children: ReactNode;
}) {
  const Component = as;

  return (
    <Component
      className={collapsed ? collapsedClassName : expandedClassName}
      data-collapsed={collapsed}
    >
      {collapsed ? (
        <div className="flex h-full min-h-0 w-full flex-col items-center gap-2 p-2">
          <SidebarCollapseButton
            collapsed={collapsed}
            onToggle={onToggle}
            title={title}
            side={side}
          />
          {collapsedChildren}
        </div>
      ) : (
        children
      )}
    </Component>
  );
}

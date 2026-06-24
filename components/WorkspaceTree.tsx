"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FileText,
  FolderOpen,
  LayoutDashboard,
  PackageOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { WorkspaceNodeWire } from "@/lib/schema";

type Props = {
  nodes: WorkspaceNodeWire[];
  selectedFolderId: "all" | "unfiled" | string;
  selectedCount?: number;
  rootLabel?: string;
  unfiledLabel?: string;
  showItems?: boolean;
  allowDashboard?: boolean;
  onSelectFolder: (id: "all" | "unfiled" | string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateDashboard?: (parentId: string | null) => void;
  onMoveSelected?: (parentId: string | null) => void;
  onOpenDashboard?: (node: WorkspaceNodeWire) => void;
  onOpenProject?: (projectId: string) => void;
  onOpenExport?: (node: WorkspaceNodeWire) => void;
  onNote: (node: WorkspaceNodeWire) => void;
  onRename: (node: WorkspaceNodeWire) => void;
  onDelete: (node: WorkspaceNodeWire) => void;
};

function itemIcon(node: WorkspaceNodeWire) {
  if (node.kind === "dashboard") return LayoutDashboard;
  if (node.kind === "project") return PackageOpen;
  if (node.kind === "export") return ArrowDownToLine;
  return FolderOpen;
}

export function workspaceChildrenByParent(nodes: WorkspaceNodeWire[]) {
  const map = new Map<string | null, WorkspaceNodeWire[]>();
  for (const node of nodes) {
    const parent = node.parentId ?? null;
    map.set(parent, [...(map.get(parent) ?? []), node]);
  }
  for (const [parent, children] of map) {
    map.set(
      parent,
      [...children].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      ),
    );
  }
  return map;
}

export function workspaceDescendantIds(
  nodes: WorkspaceNodeWire[],
  folderId: string,
) {
  const byParent = workspaceChildrenByParent(nodes);
  const ids = new Set<string>();
  const stack = [...(byParent.get(folderId) ?? [])];
  while (stack.length) {
    const next = stack.pop();
    if (!next || ids.has(next.id)) continue;
    ids.add(next.id);
    stack.push(...(byParent.get(next.id) ?? []));
  }
  return ids;
}

export function workspacePathLabel(nodes: WorkspaceNodeWire[], nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parts: string[] = [];
  let cursor = byId.get(nodeId) ?? null;
  while (cursor) {
    parts.unshift(cursor.title);
    cursor = cursor.parentId ? byId.get(cursor.parentId) ?? null : null;
  }
  return parts.join(" / ");
}

export default function WorkspaceTree({
  nodes,
  selectedFolderId,
  selectedCount = 0,
  rootLabel = "All",
  unfiledLabel = "Unfiled",
  showItems = true,
  allowDashboard = false,
  onSelectFolder,
  onCreateFolder,
  onCreateDashboard,
  onMoveSelected,
  onOpenDashboard,
  onOpenProject,
  onOpenExport,
  onNote,
  onRename,
  onDelete,
}: Props) {
  const byParent = useMemo(() => workspaceChildrenByParent(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const itemCounts = useMemo(() => {
    const counts = new Map<string | null, number>();
    function countUnder(parentId: string | null): number {
      const children = byParent.get(parentId) ?? [];
      let total = 0;
      for (const child of children) {
        const isItem = child.kind === "project" || child.kind === "export";
        total += (isItem ? 1 : 0) + countUnder(child.id);
      }
      counts.set(parentId, total);
      return total;
    }
    countUnder(null);
    return counts;
  }, [byParent]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: WorkspaceNodeWire, depth: number) {
    if (!showItems && (node.kind === "project" || node.kind === "export")) {
      return null;
    }
    const children = byParent.get(node.id) ?? [];
    const hasChildren = children.length > 0;
    const isFolder = node.kind === "folder";
    const active = isFolder && selectedFolderId === node.id;
    const Icon = itemIcon(node);
    const hidden = collapsed.has(node.id);
    const itemCount = itemCounts.get(node.id) ?? 0;
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs ${
            active
              ? "bg-neutral-950 text-white"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                active ? "text-white/80" : "text-neutral-400 hover:bg-white"
              }`}
              title={hidden ? "Expand" : "Collapse"}
            >
              <ArrowRight
                className={`h-3.5 w-3.5 transition-transform ${
                  hidden ? "" : "rotate-90"
                }`}
              />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => {
              if (node.kind === "folder") onSelectFolder(node.id);
              else if (node.kind === "dashboard") onOpenDashboard?.(node);
              else if (node.kind === "project" && node.refProjectId) {
                onOpenProject?.(node.refProjectId);
              } else if (node.kind === "export") onOpenExport?.(node);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={node.title}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium">{node.title}</span>
            {isFolder ? (
              <span
                className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? "bg-white/15" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {itemCount}
              </span>
            ) : null}
          </button>
          {node.note ? (
            <button
              type="button"
              onClick={() => onNote(node)}
              className={`rounded p-1 ${
                active ? "text-amber-200" : "text-amber-600 hover:bg-amber-50"
              }`}
              title="Open note"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNote(node)}
              className={`rounded p-1 opacity-0 transition group-hover:opacity-100 ${
                active ? "text-white/70" : "text-neutral-400 hover:bg-white"
              }`}
              title="Add note"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          )}
          {isFolder && selectedCount > 0 && onMoveSelected ? (
            <button
              type="button"
              onClick={() => onMoveSelected(node.id)}
              className={`rounded p-1 opacity-0 transition group-hover:opacity-100 ${
                active ? "text-white/80" : "text-neutral-400 hover:bg-white"
              }`}
              title="Move selected here"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isFolder ? (
            <button
              type="button"
              onClick={() => onCreateFolder(node.id)}
              className={`rounded p-1 opacity-0 transition group-hover:opacity-100 ${
                active ? "text-white/80" : "text-neutral-400 hover:bg-white"
              }`}
              title="New subfolder"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {node.kind !== "project" ? (
            <>
              <button
                type="button"
                onClick={() => onRename(node)}
                className={`rounded p-1 opacity-0 transition group-hover:opacity-100 ${
                  active ? "text-white/80" : "text-neutral-400 hover:bg-white"
                }`}
                title="Rename"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(node)}
                className={`rounded p-1 opacity-0 transition group-hover:opacity-100 ${
                  active ? "text-red-200" : "text-neutral-400 hover:bg-red-50 hover:text-red-600"
                }`}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
        {!hidden && hasChildren ? (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  }

  const rootChildren = byParent.get(null) ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSelectFolder("all")}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold ${
            selectedFolderId === "all"
              ? "bg-neutral-950 text-white"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="truncate">{rootLabel}</span>
          <span className="ml-auto rounded-full bg-current/10 px-1.5 py-0.5 text-[10px]">
            {itemCounts.get(null) ?? 0}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onCreateFolder(null)}
          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
          title="New root folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {allowDashboard && onCreateDashboard ? (
          <button
            type="button"
            onClick={() => onCreateDashboard(null)}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
            title="Save dashboard view"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSelectFolder("unfiled")}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium ${
            selectedFolderId === "unfiled"
              ? "bg-neutral-950 text-white"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="truncate">{unfiledLabel}</span>
        </button>
        {selectedCount > 0 && onMoveSelected ? (
          <button
            type="button"
            onClick={() => onMoveSelected(null)}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
            title="Move selected to root"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {rootChildren.length > 0 ? (
          rootChildren.map((node) => renderNode(node, 0))
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-500">
            No folders or saved dashboards yet.
          </p>
        )}
      </div>
    </div>
  );
}

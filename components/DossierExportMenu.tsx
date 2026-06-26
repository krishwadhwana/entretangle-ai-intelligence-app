"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileDown, FolderOpen, Loader2, Plus } from "lucide-react";
import type { Dossier } from "./pdf";
import { downloadDossier } from "./pdf";
import type { WorkspaceNodeWire } from "@/lib/schema";
import { workspacePathLabel } from "./WorkspaceTree";

type Props = {
  projectId: string | null;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  className?: string;
  filename: string;
  title: string;
  sourceType: string;
  sourceId?: string | null;
  onBuildDossier: () => Promise<Dossier>;
};

export default function DossierExportMenu({
  projectId,
  disabled = false,
  busy = false,
  label = "Dossier",
  className,
  filename,
  title,
  sourceType,
  sourceId,
  onBuildDossier,
}: Props) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<WorkspaceNodeWire[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadFolders = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(
      `/api/workspace/nodes?scope=project&projectId=${encodeURIComponent(projectId)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) setNodes((data.nodes ?? []) as WorkspaceNodeWire[]);
  }, [projectId]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (open) void loadFolders();
  }, [loadFolders, open]);

  async function createFolder() {
    if (!projectId) return;
    const name = window.prompt("Folder name:");
    if (!name?.trim()) return;
    setWorking("folder");
    setMessage(null);
    try {
      const res = await fetch("/api/workspace/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "project",
          projectId,
          parentId: folderId || null,
          kind: "folder",
          title: name.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.node) {
        throw new Error(data.error?.toString?.() ?? `Folder failed (${res.status})`);
      }
      await loadFolders();
      setFolderId((data.node as WorkspaceNodeWire).id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Folder failed");
    } finally {
      setWorking(null);
    }
  }

  async function saveSnapshot(dossier: Dossier) {
    if (!projectId) {
      throw new Error("Open this from a project to save into its folders.");
    }
    const res = await fetch(`/api/projects/${projectId}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: folderId || null,
        title,
        filename,
        sourceType,
        sourceId: sourceId ?? null,
        dossier,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.node) {
      throw new Error(data.error?.toString?.() ?? `Save failed (${res.status})`);
    }
  }

  async function act(mode: "download" | "save" | "save-download") {
    setWorking(mode);
    setMessage(null);
    try {
      const dossier = await onBuildDossier();
      if (mode === "save" || mode === "save-download") {
        await saveSnapshot(dossier);
      }
      if (mode === "download" || mode === "save-download") {
        downloadDossier(dossier, filename);
      }
      setMessage(
        mode === "download"
          ? "Downloaded"
          : mode === "save"
            ? "Saved"
            : "Saved and downloaded",
      );
      if (mode !== "save") setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setWorking(null);
    }
  }

  const folders = nodes.filter((node) => node.kind === "folder");
  const unavailable = disabled || busy || Boolean(working);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={unavailable}
        className={className}
        title="Export this dossier"
      >
        {busy || working ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FileDown className="h-3 w-3" />
        )}
        {label}
      </button>
      {open ? (
        <div className="absolute right-0 z-[1300] mt-2 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-neutral-900">PDF export</p>
              <p className="mt-0.5 text-[11px] leading-5 text-neutral-500">
                Download now, save a snapshot into a project folder, or do both.
              </p>
            </div>
            {message ? (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">
                {message}
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => void act("download")}
              disabled={Boolean(working)}
              className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" />
              Download now
            </button>
            <div className="rounded-lg border border-neutral-200 p-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Save location
              </label>
              <div className="mt-1 flex gap-1.5">
                <select
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                  disabled={!projectId}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500 disabled:opacity-50"
                >
                  <option value="">Project root</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {workspacePathLabel(nodes, folder.id)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void createFolder()}
                  disabled={!projectId || working === "folder"}
                  className="rounded-lg border border-neutral-300 px-2 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                  title="New folder or subfolder"
                >
                  {working === "folder" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-neutral-400">
                This saves to the in-app project folder. The browser will still
                ask where to put downloaded files.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void act("save")}
                disabled={!projectId || Boolean(working)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                type="button"
                onClick={() => void act("save-download")}
                disabled={!projectId || Boolean(working)}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-950 px-3 py-2 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {working === "save-download" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Save + download
              </button>
            </div>
          </div>
          {!projectId ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
              Folder saving needs a project context.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

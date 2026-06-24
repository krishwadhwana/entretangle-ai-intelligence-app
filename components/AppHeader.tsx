"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";

// Global header: switch / create / rename / delete projects. Selection is
// carried in the URL (/?project=<id>) so the intake page restores the right
// project on any navigation or reload.

type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export function ProjectSelector({
  selectedProjectId,
  menuAlign = "right",
}: {
  selectedProjectId?: string | null;
  menuAlign?: "left" | "right";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("project");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setProjects((await res.json()).projects);
    } catch {
      // header list is best-effort; the page itself surfaces real errors
    }
  }

  useEffect(() => {
    void refresh();
    setLocalSelectedId(selectedParam);
  }, [pathname, selectedParam]);

  useEffect(() => {
    function onProjectSelected(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setLocalSelectedId(id);
    }
    function onProjectCreated(event: Event) {
      const id = (event as CustomEvent<{ project?: { id?: string } }>).detail
        ?.project?.id;
      if (id) setLocalSelectedId(id);
      void refresh();
    }
    function onProjectDeleted(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (localSelectedId === id) setLocalSelectedId(null);
      void refresh();
    }
    window.addEventListener("et:project-selected", onProjectSelected);
    window.addEventListener("et:project-created", onProjectCreated);
    window.addEventListener("et:project-deleted", onProjectDeleted);
    return () => {
      window.removeEventListener("et:project-selected", onProjectSelected);
      window.removeEventListener("et:project-created", onProjectCreated);
      window.removeEventListener("et:project-deleted", onProjectDeleted);
    };
  }, [localSelectedId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // On the intake page the selected project is the URL param or (the page's
  // own fallback) the most recently updated one — mirror that here.
  const current =
    projects.find((p) => p.id === selectedProjectId) ??
    projects.find((p) => p.id === localSelectedId) ??
    projects.find((p) => p.id === selectedParam);

  function openCreateProjectModal() {
    setOpen(false);
    if (pathname === "/") {
      window.dispatchEvent(new CustomEvent("et:open-create-project"));
    } else {
      router.push("/?newProject=1");
    }
  }

  async function renameProject(p: ProjectSummary) {
    const name = window.prompt("Rename project:", p.name);
    if (name === null || !name.trim() || name.trim() === p.name) return;
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    void refresh();
  }

  async function deleteProject(p: ProjectSummary) {
    if (
      !window.confirm(
        `Delete "${p.name}"? Its interview, profile and simulation history will be removed.`,
      )
    )
      return;
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setOpen(false);
    if (pathname === "/") {
      window.dispatchEvent(
        new CustomEvent("et:project-deleted", { detail: { id: p.id } }),
      );
    } else if (selectedParam === p.id) {
      router.push("/");
    }
    void refresh();
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-indigo-400 hover:bg-indigo-50"
      >
        <FolderOpen className="h-3.5 w-3.5 text-neutral-400" />
        {current ? current.name : "Projects"}
        <ChevronDown className="h-3 w-3 text-neutral-400" />
      </button>

      {open && (
        <div
          className={`absolute z-[1100] mt-1.5 w-72 rounded-xl border border-neutral-200 bg-white py-1 shadow-lg ${
            menuAlign === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="max-h-72 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-neutral-400">
                No projects yet.
              </p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-1 px-2 py-1 ${
                  current?.id === p.id ? "bg-indigo-50" : "hover:bg-neutral-50"
                }`}
              >
                <button
                  onClick={() => {
                    setOpen(false);
                    if (pathname === "/") {
                      setLocalSelectedId(p.id);
                      window.dispatchEvent(
                        new CustomEvent("et:switch-project", {
                          detail: { id: p.id },
                        }),
                      );
                    } else {
                      router.push(`/?project=${p.id}`);
                    }
                  }}
                  className="flex-1 truncate px-1 py-1 text-left text-xs text-neutral-700"
                  title={p.name}
                >
                  {p.name}
                  <span className="ml-1.5 text-[10px] text-neutral-400">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  onClick={() => void renameProject(p)}
                  className="rounded p-1 text-neutral-300 hover:text-indigo-600 group-hover:text-neutral-400"
                  title="Rename"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => void deleteProject(p)}
                  className="rounded p-1 text-neutral-300 hover:text-red-500 group-hover:text-neutral-400"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-neutral-100 pt-1">
            <button
              onClick={openCreateProjectModal}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5" /> New project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname.startsWith("/runs/")) {
    return null;
  }

  function openCreateProjectModal() {
    if (pathname === "/") {
      window.dispatchEvent(new CustomEvent("et:open-create-project"));
    } else {
      router.push("/?newProject=1");
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4">
      <a href="/" className="text-sm font-semibold tracking-tight">
        EntreTangle
      </a>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCreateProjectModal}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
        <ProjectSelector />
      </div>
    </header>
  );
}

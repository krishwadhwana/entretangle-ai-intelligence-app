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
}: {
  selectedProjectId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("project");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
  }, [pathname, selectedParam]);

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
    projects.find((p) => p.id === selectedParam) ??
    (pathname === "/" ? projects[0] : undefined);

  async function createProject() {
    if (busy) return;
    setBusy(true);
    try {
      const name = window.prompt("Name the new project:", "Untitled venture");
      if (name === null) return;
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled venture" }),
      });
      if (!res.ok) return;
      const { project } = await res.json();
      setOpen(false);
      router.push(`/?project=${project.id}`);
    } finally {
      setBusy(false);
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
        `Delete "${p.name}"? Its interview, profile and simulation history will be removed.`
      )
    )
      return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    setOpen(false);
    if (selectedParam === p.id || pathname === "/") {
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
        <div className="absolute right-0 z-[1100] mt-1.5 w-72 rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
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
                    router.push(`/?project=${p.id}`);
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
              onClick={() => void createProject()}
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

  if (pathname.startsWith("/runs/")) {
    return null;
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4">
      <a href="/" className="text-sm font-semibold tracking-tight">
        EntreTangle
      </a>
      <ProjectSelector />
    </header>
  );
}

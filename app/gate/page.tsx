"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";

function GateInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Wrong code." : "Something went wrong.");
        return;
      }
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-indigo-600" />
          <h1 className="text-lg font-semibold tracking-tight">EntreTangle</h1>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          This instance is private. Enter the access code to continue.
        </p>
        <form onSubmit={submit} className="mt-4">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Access code"
            autoFocus
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-indigo-500"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={!code.trim() || busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enter
          </button>
        </form>
      </div>
    </main>
  );
}

export default function GatePage() {
  return (
    <Suspense fallback={null}>
      <GateInner />
    </Suspense>
  );
}

"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-full items-center justify-center bg-neutral-50 px-6">
      <section className="max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
          Application error
        </p>
        <h1 className="mt-2 text-lg font-semibold text-neutral-900">
          This view could not load.
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Try again. If it keeps failing, check the terminal for the server
          error.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
        >
          Retry
        </button>
      </section>
    </main>
  );
}

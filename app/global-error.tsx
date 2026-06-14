"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 font-sans text-neutral-900">
          <section className="max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
              Critical error
            </p>
            <h1 className="mt-2 text-lg font-semibold">
              EntreTangle needs to reload this view.
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              The server is running, but this route hit an unrecoverable render
              error.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-4 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
            >
              Reload view
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

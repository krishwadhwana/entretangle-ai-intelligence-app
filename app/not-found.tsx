import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex h-full items-center justify-center bg-neutral-50 px-6">
      <section className="max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Not found
        </p>
        <h1 className="mt-2 text-lg font-semibold text-neutral-900">
          This page does not exist.
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Return to the project workspace and choose an available run or
          project.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
        >
          Go to workspace
        </Link>
      </section>
    </main>
  );
}

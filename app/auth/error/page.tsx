import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
          EntreTangle
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950">
          Sign-in failed
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          The login attempt could not be completed. Try again with email, Google, or Facebook.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

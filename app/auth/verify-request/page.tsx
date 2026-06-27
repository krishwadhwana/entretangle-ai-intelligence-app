export default function VerifyRequestPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
          EntreTangle
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Your verification link is on the way. Open it on this device to finish signing in.
        </p>
      </div>
    </main>
  );
}

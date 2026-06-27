"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail } from "lucide-react";

type LoginProvider = {
  id: string;
  name: string;
  type: string;
};

const errorCopy: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already linked to another sign-in method. Use the original method once, then connect the new one.",
  EmailSignin: "The verification email could not be sent. Check mail settings and try again.",
  Verification: "That verification link is invalid or expired. Request a new one.",
  AccessDenied: "Access was denied for this sign-in attempt.",
};

export default function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const error = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [providers, setProviders] = useState<Record<string, LoginProvider>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getProviders().then((next) => {
      setProviders((next ?? {}) as Record<string, LoginProvider>);
    });
  }, []);

  const socialProviders = useMemo(
    () =>
      ["google", "facebook"]
        .map((id) => providers[id])
        .filter(Boolean) as LoginProvider[],
    [providers],
  );

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy("email");
    await signIn("email", { email: email.trim(), callbackUrl });
    setBusy(null);
  }

  async function submitProvider(providerId: string) {
    setBusy(providerId);
    await signIn(providerId, { callbackUrl });
    setBusy(null);
  }

  return (
    <div className="min-h-full bg-neutral-50">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
            EntreTangle
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Use a verified email link, Google, or Facebook.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorCopy[error] ?? "Sign-in failed. Try again."}
          </div>
        )}

        <form
          onSubmit={submitEmail}
          className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
        >
          <label
            htmlFor="email"
            className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500"
          >
            Email
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 focus-within:border-neutral-900">
            <Mail className="h-4 w-4 shrink-0 text-neutral-400" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <button
            type="submit"
            disabled={busy === "email"}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-wait disabled:bg-neutral-400"
          >
            {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send verification link
          </button>
        </form>

        {socialProviders.length > 0 && (
          <div className="mt-4 grid gap-2">
            {socialProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => void submitProvider(provider.id)}
                disabled={busy === provider.id}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 shadow-sm hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-wait disabled:text-neutral-400"
              >
                {busy === provider.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950 text-[11px] font-semibold text-white">
                    {provider.id === "google" ? "G" : "f"}
                  </span>
                )}
                Continue with {provider.name}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

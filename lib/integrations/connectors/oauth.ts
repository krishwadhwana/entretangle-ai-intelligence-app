// Shared OAuth2 authorization-code helpers. Each provider's endpoints differ,
// so connectors pass their URLs in; this centralizes the request shapes and the
// expires_in → expiresAt conversion.
import type { TokenSet } from "../types";

export function buildAuthorizeUrl(
  endpoint: string,
  params: Record<string, string>,
): string {
  const u = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function toExpiry(expiresIn?: number | string): Date | null {
  const n = typeof expiresIn === "string" ? parseInt(expiresIn, 10) : expiresIn;
  if (!n || !Number.isFinite(n)) return null;
  return new Date(Date.now() + n * 1000);
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/** POST an x-www-form-urlencoded token request (Google, Stripe, QuickBooks). */
export async function postTokenForm(
  tokenEndpoint: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<TokenSet> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    throw new Error(
      `token exchange failed (HTTP ${res.status}): ${
        body.error_description || body.error || "unknown"
      }`,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: toExpiry(body.expires_in),
    scope: body.scope ?? null,
  };
}

/** GET a token endpoint that returns JSON (Meta/Facebook Graph). */
export async function getTokenJson(url: string): Promise<TokenSet> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    scope?: string;
    // Graph returns either a string error or a structured { message } error.
    error?: string | { message?: string };
  };
  const errMsg =
    typeof body.error === "object" ? body.error?.message : body.error;
  if (!res.ok || errMsg || !body.access_token) {
    throw new Error(
      `token exchange failed (HTTP ${res.status}): ${errMsg || "unknown"}`,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: toExpiry(body.expires_in),
    scope: body.scope ?? null,
  };
}

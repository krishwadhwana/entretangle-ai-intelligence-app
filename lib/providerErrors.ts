export type ProviderErrorCode =
  | "openai_quota_exceeded"
  | "openai_rate_limited"
  | "openai_auth_failed"
  | "provider_timeout"
  | "provider_error";

export type ProviderErrorPayload = {
  error: string;
  code: ProviderErrorCode;
  detail?: string;
  providerStatus?: number;
  retryable?: boolean;
};

function errorFields(e: unknown): {
  message: string;
  status: number | null;
  code: string;
  type: string;
} {
  const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const errorObj =
    obj.error && typeof obj.error === "object"
      ? (obj.error as Record<string, unknown>)
      : {};
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof obj.error === "string"
          ? obj.error
          : String(obj.message ?? errorObj.message ?? "");
  const statusRaw = obj.status ?? obj.statusCode ?? errorObj.status;
  const status =
    typeof statusRaw === "number"
      ? statusRaw
      : typeof statusRaw === "string" && /^\d+$/.test(statusRaw)
        ? Number(statusRaw)
        : null;
  return {
    message,
    status,
    code: String(obj.code ?? errorObj.code ?? ""),
    type: String(obj.type ?? errorObj.type ?? ""),
  };
}

export function isProviderQuotaError(e: unknown): boolean {
  const f = errorFields(e);
  const haystack = `${f.message} ${f.code} ${f.type}`.toLowerCase();
  return (
    haystack.includes("insufficient_quota") ||
    haystack.includes("exceeded your current quota") ||
    haystack.includes("check your plan and billing") ||
    (f.status === 429 && haystack.includes("quota"))
  );
}

export function isProviderTimeoutError(e: unknown): boolean {
  const f = errorFields(e);
  const haystack = `${f.message} ${f.code} ${f.type}`.toLowerCase();
  return (
    haystack.includes("timeout") ||
    haystack.includes("timed out") ||
    haystack.includes("aborterror") ||
    haystack.includes("aborted")
  );
}

export function toProviderErrorPayload(
  e: unknown,
  fallback = "AI request failed"
): { payload: ProviderErrorPayload; status: number } {
  const f = errorFields(e);
  const haystack = `${f.message} ${f.code} ${f.type}`.toLowerCase();

  if (isProviderQuotaError(e)) {
    return {
      status: 429,
      payload: {
        code: "openai_quota_exceeded",
        error:
          "OpenAI rejected the configured API key/project for insufficient quota. Use a key from the funded OpenAI project, then retry.",
        detail:
          "The app reached OpenAI, but OpenAI rejected the request before generation because this key's project has no available API quota.",
        providerStatus: f.status ?? 429,
        retryable: false,
      },
    };
  }

  if (f.status === 401 || f.status === 403 || haystack.includes("invalid api key")) {
    return {
      status: 401,
      payload: {
        code: "openai_auth_failed",
        error:
          "OpenAI rejected the configured API key. Check OPENAI_API_KEY in Vercel and redeploy.",
        providerStatus: f.status ?? 401,
        retryable: false,
      },
    };
  }

  if (f.status === 429 || haystack.includes("rate limit")) {
    return {
      status: 429,
      payload: {
        code: "openai_rate_limited",
        error: "OpenAI rate-limited this request. Wait a moment and retry.",
        providerStatus: f.status ?? 429,
        retryable: true,
      },
    };
  }

  if (isProviderTimeoutError(e)) {
    return {
      status: 504,
      payload: {
        code: "provider_timeout",
        error: "The AI request timed out. Retry with the same inputs.",
        providerStatus: f.status ?? undefined,
        retryable: true,
      },
    };
  }

  return {
    status: f.status && f.status >= 400 && f.status < 600 ? f.status : 502,
    payload: {
      code: "provider_error",
      error: f.message || fallback,
      providerStatus: f.status ?? undefined,
      retryable: true,
    },
  };
}

export function providerErrorMessage(
  e: unknown,
  fallback = "AI request failed"
): string {
  return toProviderErrorPayload(e, fallback).payload.error;
}

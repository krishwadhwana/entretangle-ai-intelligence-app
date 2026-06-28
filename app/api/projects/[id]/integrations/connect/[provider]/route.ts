import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { requireProjectForApi } from "@/lib/apiAuth";
import { getConnector } from "@/lib/integrations/registry";
import {
  signState,
  redirectUriFor,
  upsertIntegration,
} from "@/lib/integrations/service";
import { enqueueBackfill } from "@/lib/integrations/connect";

// GET — start an OAuth connection: redirect to the provider's consent screen.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; provider: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const connector = getConnector(params.provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  // Bounce back to wherever the founder clicked Connect (the dashboard).
  const referer = req.headers.get("referer");
  const backTo =
    referer && referer.startsWith(req.nextUrl.origin)
      ? referer
      : `${req.nextUrl.origin}/?integration_connected=${params.provider}`;
  const fail = (reason: string) => {
    const u = new URL(backTo);
    u.searchParams.set("integration_error", reason);
    return NextResponse.redirect(u.toString());
  };

  if (connector.authType === "apiKey") {
    return NextResponse.json({ error: "connect this provider via POST" }, { status: 400 });
  }
  // Real OAuth only — no credentials means the operator hasn't set this provider
  // up yet (we never fabricate a connection).
  if (!connector.isConfigured()) {
    return fail("not_configured");
  }

  // Shopify's authorize endpoint is per-shop, so we need the shop domain first.
  const shopDomain = req.nextUrl.searchParams.get("shop") ?? undefined;
  if (params.provider === "shopify" && !shopDomain) {
    return NextResponse.json(
      { error: "shop domain required (pass ?shop=your-store.myshopify.com)" },
      { status: 400 },
    );
  }

  const state = signState({
    projectId: params.id,
    provider: params.provider,
    nonce: crypto.randomBytes(8).toString("hex"),
    shopDomain,
  });
  const url = connector.authorizeUrl!({
    state,
    redirectUri: redirectUriFor(params.provider),
    shopDomain,
  });
  return NextResponse.redirect(url);
}

// POST — apiKey connect (Faire, Klaviyo): the merchant pastes a key we validate.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; provider: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const connector = getConnector(params.provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (connector.authType !== "apiKey" || !connector.connectWithKey) {
    return NextResponse.json(
      { error: "this provider connects via OAuth (use GET)" },
      { status: 400 },
    );
  }

  const input = (await req.json().catch(() => ({}))) as Record<string, string>;
  try {
    const connected = await connector.connectWithKey(input);
    const res = await upsertIntegration({
      projectId: params.id,
      provider: params.provider,
      token: connected.token,
      externalAccountId: connected.externalAccountId,
      displayName: connected.displayName,
      metadata: connected.metadata,
    });
    await enqueueBackfill(params.id, res.id);
    return NextResponse.json({ id: res.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "connect failed" },
      { status: 400 },
    );
  }
}

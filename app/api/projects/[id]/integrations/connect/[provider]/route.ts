import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { requireProjectForApi } from "@/lib/apiAuth";
import { getConnector } from "@/lib/integrations/registry";
import {
  signState,
  redirectUriFor,
  upsertIntegration,
} from "@/lib/integrations/service";
import { shouldMock, connectMock, enqueueBackfill } from "@/lib/integrations/connect";

// GET — start a connection. OAuth providers redirect to the provider's consent
// screen; in MOCK_MODE / before credentials exist, we create a demo integration
// immediately and bounce back to the dashboard so the flow is always testable.
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

  // apiKey providers (Shopify) are connected via POST with a token — unless
  // we're mocking, in which case GET one-click connects a demo account.
  if (connector.authType === "apiKey" && !shouldMock(params.provider)) {
    return NextResponse.json(
      { error: "POST shop credentials to connect this provider" },
      { status: 400 },
    );
  }

  if (shouldMock(params.provider)) {
    await connectMock(params.id, params.provider);
    return NextResponse.redirect(backTo);
  }

  const state = signState({
    projectId: params.id,
    provider: params.provider,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const url = connector.authorizeUrl!({
    state,
    redirectUri: redirectUriFor(params.provider),
  });
  return NextResponse.redirect(url);
}

// POST — apiKey connect (e.g. Shopify shop domain + Admin API token).
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

  if (shouldMock(params.provider)) {
    const res = await connectMock(params.id, params.provider);
    return NextResponse.json({ id: res.id, mock: true });
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

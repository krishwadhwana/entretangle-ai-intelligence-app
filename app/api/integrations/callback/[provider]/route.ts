import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, ensureProjectAccess } from "@/lib/auth";
import { getConnector } from "@/lib/integrations/registry";
import {
  verifyState,
  redirectUriFor,
  upsertIntegration,
} from "@/lib/integrations/service";
import { enqueueBackfill } from "@/lib/integrations/connect";
import { log } from "@/lib/log";

// OAuth callback (global path so the redirect URI is stable per provider). The
// signed `state` carries the projectId; we re-check the logged-in user owns it
// before persisting tokens, exchange the code, pick a default sub-account, and
// bounce back into the app.
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const url = req.nextUrl;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId"); // QuickBooks passes this

  const fail = (msg: string) =>
    NextResponse.redirect(`${url.origin}/?integration_error=${encodeURIComponent(msg)}`);

  if (error) return fail(error);
  if (!code || !state) return fail("missing code/state");

  const parsed = verifyState(state);
  if (!parsed || parsed.provider !== params.provider) {
    return fail("invalid state");
  }

  // Re-authorize: the browser must still be the project's owner.
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${url.origin}/login`);
  const project = await ensureProjectAccess(parsed.projectId, user.id);
  if (!project) return fail("not authorized for project");

  const connector = getConnector(params.provider);
  if (!connector?.exchangeCode) return fail("unknown provider");

  // Shopify is per-shop: the shop comes from the signed state (or the `shop`
  // query Shopify appends), and is needed for the token exchange.
  const shopDomain = parsed.shopDomain ?? url.searchParams.get("shop") ?? undefined;

  try {
    const token = await connector.exchangeCode(
      code,
      redirectUriFor(params.provider),
      { shopDomain },
    );

    // Pick the default external account (ad account / GA4 property / realm).
    let externalAccountId = realmId ?? params.provider;
    let displayName = connector.label;
    let metadata: Record<string, unknown> = realmId ? { realmId } : {};
    if (params.provider === "shopify" && shopDomain) {
      externalAccountId = shopDomain;
      displayName = shopDomain;
      metadata = { shopDomain };
    } else if (!realmId && connector.listExternalAccounts) {
      const accounts = await connector.listExternalAccounts(token).catch(() => []);
      if (accounts.length) {
        externalAccountId = accounts[0].id;
        displayName = accounts[0].name;
      }
    }

    const res = await upsertIntegration({
      projectId: parsed.projectId,
      provider: params.provider,
      token,
      externalAccountId,
      displayName,
      metadata,
    });
    await enqueueBackfill(parsed.projectId, res.id);
  } catch (e) {
    log.warn("integration callback failed", {
      provider: params.provider,
      error: String(e),
    });
    return fail(e instanceof Error ? e.message : "connect failed");
  }

  // Land on the project's latest run (the Owner Dashboard lives there).
  const latestRun = await prisma.run.findFirst({
    where: { projectId: parsed.projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const dest = latestRun
    ? `${url.origin}/runs/${latestRun.id}?integration_connected=${params.provider}`
    : `${url.origin}/?integration_connected=${params.provider}`;
  return NextResponse.redirect(dest);
}

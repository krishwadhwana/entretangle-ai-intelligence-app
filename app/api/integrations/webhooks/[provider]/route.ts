import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { enqueueProjectJob } from "@/lib/jobs";
import { log } from "@/lib/log";

// Real-time ingest. Providers POST here on order/charge events; we verify the
// signature, find the matching integration, and enqueue an incremental sync
// (cheap + idempotent thanks to the MetricSnapshot upsert). Currently wired for
// Shopify (HMAC); other providers return 202 without action until implemented.
export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const raw = await req.text();

  if (params.provider === "shopify") {
    const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
    const secret = config.integrations.shopify.apiSecret;
    if (!secret) return NextResponse.json({ ok: true, skipped: "no secret" });
    const digest = crypto
      .createHmac("sha256", secret)
      .update(raw, "utf8")
      .digest("base64");
    if (
      digest.length !== hmac.length ||
      !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))
    ) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
    const integration = await prisma.integration.findFirst({
      where: { provider: "shopify", externalAccountId: shopDomain },
      select: { id: true, projectId: true },
    });
    if (integration) {
      await enqueueProjectJob(
        integration.projectId,
        "integration_sync",
        { integrationId: integration.id, type: "incremental", days: 2 },
        { dedupe: true },
      );
    }
    return NextResponse.json({ ok: true });
  }

  log.debug("unhandled webhook", { provider: params.provider });
  return NextResponse.json({ ok: true, unhandled: params.provider }, { status: 202 });
}

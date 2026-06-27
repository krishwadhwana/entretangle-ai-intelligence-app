import { NextRequest, NextResponse } from "next/server";
import { getDesignStudio } from "@/lib/store";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves a Design Studio asset's generated hero image. The bytes live in object
// storage under asset.visualImageKey; this route streams them so the stored
// owner_dashboard JSONB only carries a small URL, not a base64 blob.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; assetId: string } }
) {
  const studio = await getDesignStudio(params.id);
  const asset = studio?.assets.find((a) => a.id === params.assetId);
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  // Legacy assets stored the image inline as a base64 data URL. Decode and
  // serve those directly so old rows keep working.
  if (!asset.visualImageKey && asset.visualImageDataUrl?.startsWith("data:")) {
    const match = asset.visualImageDataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "image not found" }, { status: 404 });
    }
    const body = Buffer.from(match[2], "base64");
    return new NextResponse(body as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": match[1],
        "Content-Length": String(body.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  if (!asset.visualImageKey) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  const stored = await getObject(asset.visualImageKey);
  if (!stored) {
    return NextResponse.json({ error: "image file missing" }, { status: 404 });
  }
  return new NextResponse(stored.body as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": stored.contentType,
      "Content-Length": String(stored.body.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}

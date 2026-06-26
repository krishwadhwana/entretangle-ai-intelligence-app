import { NextRequest, NextResponse } from "next/server";
import { getDesignStudio } from "@/lib/store";
import { resolveAssetSvg } from "@/lib/design/assetStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves a collateral asset's rendered, self-contained SVG. The bytes live in
// object storage under asset.svgKey (legacy rows keep it inline); serving it
// here keeps the owner_dashboard JSONB free of the heavy SVG string while the
// SVG itself stays self-contained for <img> preview / PNG rasterization.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; assetId: string } }
) {
  const studio = await getDesignStudio(params.id);
  const asset = studio?.assets.find((a) => a.id === params.assetId);
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }
  const svg = await resolveAssetSvg(asset);
  if (!svg) {
    return NextResponse.json({ error: "svg not found" }, { status: 404 });
  }
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

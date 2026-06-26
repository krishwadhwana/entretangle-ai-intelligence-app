import { NextRequest, NextResponse } from "next/server";
import { getDesignStudio } from "@/lib/store";
import { resolveFont } from "@/lib/design/assetStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves an uploaded custom font. Bytes live in object storage under font.key
// (legacy rows keep them as a base64 dataUrl); referenced from @font-face so
// the owner_dashboard JSONB no longer carries the (large) font binary.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; fontId: string } }
) {
  const studio = await getDesignStudio(params.id);
  const font = studio?.tokens?.typography.customFonts?.find(
    (f) => f.id === params.fontId
  );
  if (!font) {
    return NextResponse.json({ error: "font not found" }, { status: 404 });
  }
  const resolved = await resolveFont(font);
  if (!resolved) {
    return NextResponse.json({ error: "font file missing" }, { status: 404 });
  }
  return new NextResponse(resolved.buffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": resolved.contentType || "font/woff2",
      "Content-Length": String(resolved.buffer.length),
      "Cache-Control": "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

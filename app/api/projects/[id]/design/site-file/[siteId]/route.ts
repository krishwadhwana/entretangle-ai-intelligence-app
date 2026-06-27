import { NextRequest, NextResponse } from "next/server";
import { getDesignStudio } from "@/lib/store";
import { resolveSiteFile } from "@/lib/design/assetStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves a generated site's file (index.html by default, or ?path=<file>). The
// bytes live in object storage (site.htmlKey / file.contentKey); legacy rows
// keep them inline. Used as the iframe preview src and for file downloads.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; siteId: string } }
) {
  const studio = await getDesignStudio(params.id);
  const site = studio?.sites.find((s) => s.id === params.siteId);
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }
  const path = req.nextUrl.searchParams.get("path") || "index.html";
  const resolved = await resolveSiteFile(site, path);
  if (!resolved) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
  return new NextResponse(resolved.content, {
    headers: {
      "Content-Type": `${resolved.contentType}; charset=utf-8`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

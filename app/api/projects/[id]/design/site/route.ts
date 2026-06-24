import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeSiteHtml, looksLikeHtmlDoc } from "@/lib/design/site";
import { deployStaticSite, vercelDeployEnabled } from "@/lib/deploy/vercel";
import { callSiteGenerator } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { SiteAssetSchema } from "@/lib/schema";
import {
  deleteSiteAsset,
  getDesignStudio,
  getProject,
  saveSiteAsset,
  setSiteDeployUrl,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner Dashboard › Design Studio › Website. POST generates a one-page site from
// the design tokens, or (action:"deploy") publishes a saved site to Vercel.
const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    brief: z.string().trim().max(2000).default(""),
    sourceRunId: z.string().trim().min(1).max(120).nullable().default(null),
  }),
  z.object({
    action: z.literal("deploy"),
    siteId: z.string().trim().min(1).max(120),
  }),
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const studio = await getDesignStudio(params.id);
    return NextResponse.json({
      sites: studio?.sites ?? [],
      deployEnabled: vercelDeployEnabled(),
    });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const body = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  // --- Publish an existing site to Vercel ---
  if (body.data.action === "deploy") {
    const { siteId } = body.data;
    const studio = await getDesignStudio(params.id);
    const site = studio?.sites.find((s) => s.id === siteId);
    if (!site) {
      return NextResponse.json({ error: "site not found" }, { status: 404 });
    }
    try {
      const { url } = await deployStaticSite(
        `${project.name}-${site.brandName}`,
        site.html
      );
      const updated = await setSiteDeployUrl(params.id, site.id, url);
      return NextResponse.json({ site: updated });
    } catch (error) {
      const { payload, status } = toProviderErrorPayload(error, "deploy failed");
      return NextResponse.json(payload, { status });
    }
  }

  // --- Generate a new site ---
  if (!project.ventureProfile) {
    return NextResponse.json(
      { error: "Finish the venture intake first." },
      { status: 409 }
    );
  }
  const tokens = project.ownerDashboard?.designStudio?.tokens ?? null;
  if (!tokens) {
    return NextResponse.json(
      { error: "Generate design tokens before creating a website." },
      { status: 409 }
    );
  }
  const brandKit = project.ownerDashboard?.brandSocial?.kit ?? null;

  try {
    const out = await callSiteGenerator(
      body.data.sourceRunId,
      project.ventureProfile,
      tokens,
      brandKit,
      body.data.brief
    );
    const html = sanitizeSiteHtml(out.html);
    if (!looksLikeHtmlDoc(html)) {
      return NextResponse.json(
        { error: "The generated site was malformed. Try again." },
        { status: 502 }
      );
    }
    const site = SiteAssetSchema.parse({
      id: `site-${Date.now().toString(36)}`,
      title: out.title,
      brandName: project.ventureProfile.product || project.name,
      html,
      deployUrl: null,
      createdAt: new Date().toISOString(),
    });
    const studio = await saveSiteAsset(params.id, site);
    return NextResponse.json({ site, sites: studio.sites });
  } catch (error) {
    const { payload, status } = toProviderErrorPayload(
      error,
      "website generation failed"
    );
    return NextResponse.json(payload, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const siteId = new URL(req.url).searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }
  try {
    const studio = await deleteSiteAsset(params.id, siteId);
    return NextResponse.json({ sites: studio.sites });
  } catch {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
}

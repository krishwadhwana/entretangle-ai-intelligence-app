import { NextResponse } from "next/server";
import { getProject, saveVentureProfile } from "@/lib/store";
import {
  createProductImageId,
  fetchScrapedProductImage,
  MAX_PRODUCT_IMAGES,
  productImageUrl,
  saveProductImageFile,
  scrapedProductImageCandidates,
} from "@/lib/productImages";
import type { ProductImageRef } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const profile = project.ventureProfile;
  if (!profile) {
    return NextResponse.json(
      { error: "finish the venture profile before adding product images" },
      { status: 409 }
    );
  }

  const existing = profile.productImages ?? [];
  const remainingSlots = Math.max(0, MAX_PRODUCT_IMAGES - existing.length);
  if (remainingSlots === 0) {
    return NextResponse.json(
      {
        error: `product image limit reached (${MAX_PRODUCT_IMAGES})`,
        productImages: existing,
      },
      { status: 400 }
    );
  }

  const existingSources = new Set(
    existing.flatMap((image) =>
      [image.url, image.sourceUrl].filter((value): value is string =>
        Boolean(value)
      )
    )
  );
  const candidates = scrapedProductImageCandidates(project.websiteAnalysis).filter(
    (candidate) => !existingSources.has(candidate.url)
  );

  const imported: ProductImageRef[] = [];
  let failed = 0;

  for (const candidate of candidates.slice(0, remainingSlots)) {
    const fetched = await fetchScrapedProductImage(candidate);
    if (!fetched) {
      failed += 1;
      continue;
    }

    const id = createProductImageId();
    await saveProductImageFile(params.id, id, fetched.mimeType, fetched.buffer);
    imported.push({
      id,
      name: candidate.name,
      url: productImageUrl(params.id, id),
      mimeType: fetched.mimeType,
      size: fetched.buffer.length,
      uploadedAt: new Date().toISOString(),
      visualSummary: candidate.visualSummary,
      tags: candidate.tags,
      sourceUrl: candidate.url,
      sourcePageUrl: candidate.sourcePageUrl,
      sourceKind: "scraped",
    });
  }

  const productImages = [...existing, ...imported];
  if (imported.length > 0) {
    await saveVentureProfile(params.id, { ...profile, productImages });
  }

  return NextResponse.json({
    ok: true,
    imported: imported.length,
    skipped: Math.max(0, candidates.length - imported.length - failed),
    failed,
    productImages,
  });
}

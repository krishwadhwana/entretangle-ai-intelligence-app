import { NextRequest, NextResponse } from "next/server";
import { getProject, saveVentureProfile } from "@/lib/store";
import { callProductImageAnalysis } from "@/lib/llm";
import {
  createProductImageId,
  isSupportedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  productImageUrl,
  safeProductImageName,
  saveProductImageFile,
} from "@/lib/productImages";
import type { ProductImageRef } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!project.ventureProfile) {
    return NextResponse.json(
      { error: "finish the venture profile before adding product images" },
      { status: 409 }
    );
  }

  const existing = project.ventureProfile.productImages ?? [];
  if (existing.length >= MAX_PRODUCT_IMAGES) {
    return NextResponse.json(
      { error: `product image limit reached (${MAX_PRODUCT_IMAGES})` },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const mimeType = image.type;
  if (!isSupportedProductImageMime(mimeType)) {
    return NextResponse.json(
      { error: "supported image types: JPEG, PNG, WebP, GIF" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await image.arrayBuffer());
  if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "image must be 8MB or smaller" },
      { status: 400 }
    );
  }

  const id = createProductImageId();
  const name = safeProductImageName(image.name || "product image");
  await saveProductImageFile(params.id, id, mimeType, buffer);

  let visualSummary: string | undefined;
  let tags: string[] = [];
  try {
    const analysis = await callProductImageAnalysis({
      fileName: name,
      product: project.ventureProfile.product,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    });
    visualSummary = analysis.visualSummary;
    tags = analysis.tags;
  } catch (error) {
    console.warn("[product-images] visual analysis failed", error);
  }

  const ref: ProductImageRef = {
    id,
    name,
    url: productImageUrl(params.id, id),
    mimeType,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
    ...(visualSummary ? { visualSummary } : {}),
    tags,
  };
  const productImages = [...existing, ref];
  await saveVentureProfile(params.id, {
    ...project.ventureProfile,
    productImages,
  });

  return NextResponse.json({ image: ref, productImages }, { status: 201 });
}

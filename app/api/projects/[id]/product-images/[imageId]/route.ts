import { NextRequest, NextResponse } from "next/server";
import { getProject, saveVentureProfile } from "@/lib/store";
import {
  deleteProductImageFile,
  readProductImageFile,
} from "@/lib/productImages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  const project = await getProject(params.id);
  const image = project?.ventureProfile?.productImages?.find(
    (item) => item.id === params.imageId
  );
  if (!project || !image) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  try {
    const file = await readProductImageFile(params.id, image);
    const body = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;
    const fileName = image.name.replace(/"/g, "");
    return new NextResponse(body, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(file.length),
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "image file missing" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  const project = await getProject(params.id);
  const profile = project?.ventureProfile;
  const image = profile?.productImages?.find(
    (item) => item.id === params.imageId
  );
  if (!project || !profile || !image) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  await deleteProductImageFile(params.id, image);
  const productImages = (profile.productImages ?? []).filter(
    (item) => item.id !== params.imageId
  );
  await saveVentureProfile(params.id, { ...profile, productImages });

  return NextResponse.json({ ok: true, productImages });
}

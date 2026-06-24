import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveProjectExportNode } from "@/lib/store";

export const dynamic = "force-dynamic";

const ExportSchema = z.object({
  folderId: z.string().nullable().optional(),
  title: z.string().min(1).max(180),
  filename: z.string().min(1).max(220),
  sourceType: z.string().min(1).max(80),
  sourceId: z.string().max(160).nullable().optional(),
  dossier: z.custom<unknown>((value) => value !== undefined, {
    message: "dossier is required",
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const parsed = ExportSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { dossier } = parsed.data;
  if (dossier === undefined) {
    return NextResponse.json(
      { error: "dossier is required" },
      { status: 400 },
    );
  }
  try {
    const node = await saveProjectExportNode(params.id, {
      folderId: parsed.data.folderId,
      title: parsed.data.title,
      filename: parsed.data.filename,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      dossier,
    });
    return NextResponse.json({ node });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "export save failed" },
      { status: 400 },
    );
  }
}

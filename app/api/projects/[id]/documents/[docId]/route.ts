import { NextRequest, NextResponse } from "next/server";
import { deleteDocument } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  await deleteDocument(params.id, params.docId);
  return NextResponse.json({ ok: true });
}

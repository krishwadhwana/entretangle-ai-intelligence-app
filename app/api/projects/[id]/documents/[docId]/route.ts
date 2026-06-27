import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { deleteDocument } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  await deleteDocument(params.id, params.docId);
  return NextResponse.json({ ok: true });
}

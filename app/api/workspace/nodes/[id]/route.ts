import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteWorkspaceNode,
  updateWorkspaceNode,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  note: z.string().max(6000).optional(),
  parentId: z.string().nullable().optional(),
  moduleId: z.string().max(120).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const node = await updateWorkspaceNode(params.id, parsed.data);
    return NextResponse.json({ node });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await deleteWorkspaceNode(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "delete failed" },
      { status: 400 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { withDbRetry } from "@/lib/db";
import { deleteManufacturer, updateManufacturer } from "@/lib/manufacturers/store";
import { UpdateManufacturerSchema } from "@/lib/manufacturers/types";

export const dynamic = "force-dynamic";

// PATCH → update any subset of a manufacturer row.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; mId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = UpdateManufacturerSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const manufacturer = await withDbRetry(() =>
      updateManufacturer(params.id, params.mId, body.data),
    );
    return NextResponse.json({ manufacturer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json(
      { error: msg },
      { status: msg === "not found" ? 404 : 500 },
    );
  }
}

// DELETE → remove a manufacturer row.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; mId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    await withDbRetry(() => deleteManufacturer(params.id, params.mId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json(
      { error: msg },
      { status: msg === "not found" ? 404 : 500 },
    );
  }
}

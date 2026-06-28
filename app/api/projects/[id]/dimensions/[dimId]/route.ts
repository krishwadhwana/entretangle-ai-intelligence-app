import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { withDbRetry } from "@/lib/db";
import { deleteDimension, updateDimension } from "@/lib/progression/store";
import { UpdateDimensionSchema } from "@/lib/progression/presets";

export const dynamic = "force-dynamic";

// PATCH → update any subset of a dimension's fields. Score/status/spend changes
// are snapshotted to history so progression can be charted over time.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dimId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = UpdateDimensionSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const dimension = await withDbRetry(() =>
      updateDimension(params.id, params.dimId, body.data),
    );
    return NextResponse.json({ dimension });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json(
      { error: msg },
      { status: msg === "not found" ? 404 : 500 },
    );
  }
}

// DELETE → remove a custom dimension or scenario (preset roots are protected).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; dimId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    await withDbRetry(() => deleteDimension(params.id, params.dimId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    const status = msg === "not found" ? 404 : msg.includes("cannot be deleted") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

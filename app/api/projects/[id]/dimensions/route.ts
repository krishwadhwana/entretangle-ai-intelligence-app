import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { withDbRetry } from "@/lib/db";
import { createDimension, listDimensions } from "@/lib/progression/store";
import { CreateDimensionSchema } from "@/lib/progression/presets";

export const dynamic = "force-dynamic";

// GET → the project's full progression tree (seeds presets on first access).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const dimensions = await withDbRetry(() => listDimensions(params.id));
    return NextResponse.json({ dimensions });
  } catch (e) {
    console.error("[projects/:id/dimensions] GET failed", e);
    return NextResponse.json(
      { error: "Failed to load progression" },
      { status: 503 },
    );
  }
}

// POST → add a custom dimension, or a scenario (when `parentId` is present).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = CreateDimensionSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const dimension = await withDbRetry(() =>
      createDimension(params.id, body.data),
    );
    return NextResponse.json({ dimension }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    const status = msg === "parent not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

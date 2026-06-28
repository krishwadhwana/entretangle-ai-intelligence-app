import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { withDbRetry } from "@/lib/db";
import { createManufacturer, listManufacturers } from "@/lib/manufacturers/store";
import { CreateManufacturerSchema } from "@/lib/manufacturers/types";

export const dynamic = "force-dynamic";

// GET → the project's manufacturer sourcing table.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const manufacturers = await withDbRetry(() => listManufacturers(params.id));
    return NextResponse.json({ manufacturers });
  } catch (e) {
    console.error("[projects/:id/manufacturers] GET failed", e);
    return NextResponse.json(
      { error: "Failed to load manufacturers" },
      { status: 503 },
    );
  }
}

// POST → add a manufacturer (manual entry, or agent-fed later).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const body = CreateManufacturerSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const manufacturer = await withDbRetry(() =>
      createManufacturer(params.id, body.data),
    );
    return NextResponse.json({ manufacturer }, { status: 201 });
  } catch (e) {
    console.error("[projects/:id/manufacturers] POST failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}

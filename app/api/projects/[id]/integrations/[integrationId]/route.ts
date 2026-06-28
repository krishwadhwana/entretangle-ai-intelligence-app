import { NextResponse, type NextRequest } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { disconnectIntegration } from "@/lib/integrations/service";

// DELETE — disconnect an integration (cascades its metrics + sync history).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; integrationId: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const ok = await disconnectIntegration(params.id, params.integrationId);
  if (!ok) {
    return NextResponse.json({ error: "integration not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

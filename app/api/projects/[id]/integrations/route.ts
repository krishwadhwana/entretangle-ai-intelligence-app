import { NextResponse, type NextRequest } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { listIntegrations } from "@/lib/integrations/service";
import { CATALOG } from "@/lib/integrations/registry";

// GET — the project's connected integrations + the provider catalog the UI
// renders connect cards from.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const integrations = await listIntegrations(params.id);
  return NextResponse.json({ integrations, catalog: CATALOG });
}

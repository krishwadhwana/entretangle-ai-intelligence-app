import { NextRequest, NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { getOwnerDashboard, getOwnerDashboardRunSlice } from "@/lib/store";

export const dynamic = "force-dynamic";

// Lean read for the Owner Dashboard: returns ONLY the owner_dashboard JSON.
// Fetching the full project (with its embedded simulation_runs snapshot) just to
// read this small blob was timing the Owner tab out on large projects.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const runId = req.nextUrl.searchParams.get("runId");
  if (runId) {
    const ownerDashboard = await getOwnerDashboardRunSlice(params.id, runId);
    return NextResponse.json({ ownerDashboard });
  }

  const ownerDashboard = await getOwnerDashboard(params.id);
  return NextResponse.json({ ownerDashboard });
}

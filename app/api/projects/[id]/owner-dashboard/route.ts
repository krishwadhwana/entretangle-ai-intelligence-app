import { NextRequest, NextResponse } from "next/server";
import { getOwnerDashboard } from "@/lib/store";

export const dynamic = "force-dynamic";

// Lean read for the Owner Dashboard: returns ONLY the owner_dashboard JSON.
// Fetching the full project (with its embedded simulation_runs snapshot) just to
// read this small blob was timing the Owner tab out on large projects.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ownerDashboard = await getOwnerDashboard(params.id);
  return NextResponse.json({ ownerDashboard });
}

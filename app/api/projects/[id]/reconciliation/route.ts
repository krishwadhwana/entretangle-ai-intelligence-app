import { NextResponse, type NextRequest } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { buildReconciliation } from "@/lib/reconciliation";

// GET — the Plan vs Actual report: simulation predictions overlaid against the
// canonical metrics aggregated from connected integrations.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const days = Number.parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);
  const report = await buildReconciliation(
    params.id,
    Number.isFinite(days) ? days : 90,
  );
  return NextResponse.json({ report });
}

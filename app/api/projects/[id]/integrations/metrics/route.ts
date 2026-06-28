import { NextResponse, type NextRequest } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { buildOverview } from "@/lib/integrations/metrics";

// GET — the business overview built from every synced data point: headline
// KPIs (with period-over-period deltas), time series, channel breakdowns and
// auto-generated insights.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  const days = Number.parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);
  const overview = await buildOverview(params.id, Number.isFinite(days) ? days : 90);
  return NextResponse.json({ overview });
}

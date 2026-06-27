import { NextResponse } from "next/server";
import { requireProjectForApi } from "@/lib/apiAuth";
import { buildInvestorSnapshot, syncInvestorRoadmap } from "@/lib/investor";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({
      readiness: snapshot.readiness,
      roadmap: snapshot.roadmap,
      latestKit: snapshot.latestKit,
      kitEdits: snapshot.kitEdits,
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireProjectForApi(params.id);
  if (auth.response) return auth.response;
  try {
    const roadmap = await syncInvestorRoadmap(params.id);
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({
      readiness: snapshot.readiness,
      roadmap,
      latestKit: snapshot.latestKit,
      kitEdits: snapshot.kitEdits,
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

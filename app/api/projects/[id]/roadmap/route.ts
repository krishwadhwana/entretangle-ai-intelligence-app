import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildInvestorSnapshot, syncInvestorRoadmap } from "@/lib/investor";
import { getInvestorOS, saveInvestorRoadmap } from "@/lib/store";
import { RoadmapItemSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  roadmap: z.array(RoadmapItemSchema).optional(),
  patch: z
    .object({
      id: z.string(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      evidenceIds: z.array(z.string()).optional(),
    })
    .optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const roadmap = await syncInvestorRoadmap(params.id);
    return NextResponse.json({ roadmap });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  try {
    if (body.data.roadmap) {
      const section = await saveInvestorRoadmap(params.id, body.data.roadmap);
      return NextResponse.json({ roadmap: section.roadmap });
    }

    if (body.data.patch) {
      const snapshot = await buildInvestorSnapshot(params.id);
      const current = snapshot.roadmap;
      const patch = body.data.patch;
      const next = current.map((item) =>
        item.id === patch.id
          ? {
              ...item,
              status: patch.status ?? item.status,
              evidenceIds: patch.evidenceIds ?? item.evidenceIds,
              updatedAt: new Date().toISOString(),
            }
          : item
      );
      const section = await saveInvestorRoadmap(params.id, next);
      return NextResponse.json({ roadmap: section.roadmap });
    }

    const os = await getInvestorOS(params.id);
    return NextResponse.json({ roadmap: os.roadmap });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

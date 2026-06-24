import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { moveWorkspaceProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

const MoveSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1),
  parentId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = MoveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const nodes = await moveWorkspaceProjects(parsed.data);
    return NextResponse.json({ nodes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "move failed" },
      { status: 400 },
    );
  }
}

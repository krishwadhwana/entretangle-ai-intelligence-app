import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiUser,
  requireProjectForApi,
  requireWorkspaceNodeForApi,
} from "@/lib/apiAuth";
import { moveWorkspaceProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

const MoveSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1),
  parentId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const parsed = MoveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  for (const projectId of parsed.data.projectIds) {
    const projectAuth = await requireProjectForApi(projectId);
    if (projectAuth.response) return projectAuth.response;
  }
  if (parsed.data.parentId) {
    const parentAuth = await requireWorkspaceNodeForApi(parsed.data.parentId);
    if (parentAuth.response) return parentAuth.response;
  }
  try {
    const nodes = await moveWorkspaceProjects({
      ...parsed.data,
      ownerId: auth.user.id,
    });
    return NextResponse.json({ nodes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "move failed" },
      { status: 400 },
    );
  }
}

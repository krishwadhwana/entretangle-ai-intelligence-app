import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createWorkspaceNode,
  listWorkspaceNodes,
} from "@/lib/store";
import {
  WorkspaceNodeScopeSchema,
} from "@/lib/schema";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  scope: WorkspaceNodeScopeSchema,
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  kind: z.enum(["folder", "dashboard"]),
  title: z.string().min(1).max(160),
  note: z.string().max(6000).optional(),
  moduleId: z.string().max(120).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = z
    .object({
      scope: WorkspaceNodeScopeSchema,
      projectId: z.string().nullable().optional(),
    })
    .safeParse({
      scope: url.searchParams.get("scope") ?? "global",
      projectId: url.searchParams.get("projectId"),
    });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const nodes = await listWorkspaceNodes(parsed.data);
    return NextResponse.json({ nodes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load failed" },
      { status: 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const node = await createWorkspaceNode(parsed.data);
    return NextResponse.json({ node });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create failed" },
      { status: 400 },
    );
  }
}

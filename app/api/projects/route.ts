import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createProject,
  getLatestProjectLean,
  listProjectPreviews,
  listProjects,
} from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/projects            -> list, most recently updated first
// GET /api/projects?latest=1   -> the most-recently-updated project (lean:
//   persona arrays stripped — the list UI only needs counts; full agent
//   output stays saved in the DB).
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("previews")) {
    return NextResponse.json({ projects: await listProjectPreviews() });
  }
  if (req.nextUrl.searchParams.get("latest")) {
    return NextResponse.json({ project: await getLatestProjectLean() });
  }
  return NextResponse.json({ projects: await listProjects() });
}

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120).default("Untitled venture"),
});

export async function POST(req: NextRequest) {
  const body = CreateProjectSchema.safeParse(
    await req.json().catch(() => ({}))
  );
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const project = await createProject(body.data.name);
  return NextResponse.json({ project }, { status: 201 });
}

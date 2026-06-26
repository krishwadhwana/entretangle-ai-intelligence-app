import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbRetry } from "@/lib/db";
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
  try {
    if (req.nextUrl.searchParams.get("previews")) {
      return NextResponse.json({
        projects: await withDbRetry(() => listProjectPreviews()),
      });
    }
    if (req.nextUrl.searchParams.get("latest")) {
      return NextResponse.json({
        project: await withDbRetry(() => getLatestProjectLean()),
      });
    }
    return NextResponse.json({
      projects: await withDbRetry(() => listProjects()),
    });
  } catch (e) {
    // A cold serverless instance whose first DB connection failed even after
    // retries. Log it (so it's visible in Vercel logs) and return a clean
    // error the dashboard can surface instead of an opaque framework 500.
    console.error("[projects] GET failed", e);
    return NextResponse.json(
      { error: "Failed to load projects", projects: [] },
      { status: 503 }
    );
  }
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteProject,
  getProjectLean,
  renameProject,
  saveInterviewTranscript,
  saveOwnerChecks,
  saveVentureProfile,
} from "@/lib/store";
import { ClientProfileSchema, InterviewTranscriptSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

// Lean read: persona arrays stripped from the snapshot (the UI needs counts,
// not 6000 agents per run). Full agent output stays saved in the DB.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await getProjectLean(params.id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

// PATCH accepts any subset; each present field is saved immediately.
// simulation_runs is deliberately NOT writable here — it is append-only and
// written server-side by the orchestrator.
const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  interviewTranscript: InterviewTranscriptSchema.optional(),
  ventureProfile: ClientProfileSchema.optional(),
  // Owner Dashboard › Brand & Social checklist: { itemId: done } toggles,
  // merged into the active run's owner_dashboard.brandSocialByRun entry.
  ownerDashboardChecks: z.record(z.boolean()).optional(),
  ownerDashboardRunId: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = PatchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    if (body.data.name !== undefined) {
      await renameProject(params.id, body.data.name);
    }
    if (body.data.interviewTranscript !== undefined) {
      await saveInterviewTranscript(params.id, body.data.interviewTranscript);
    }
    if (body.data.ventureProfile !== undefined) {
      await saveVentureProfile(params.id, body.data.ventureProfile);
    }
    if (body.data.ownerDashboardChecks !== undefined) {
      await saveOwnerChecks(
        params.id,
        body.data.ownerDashboardChecks,
        body.data.ownerDashboardRunId
      );
    }
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deleteProject(params.id);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

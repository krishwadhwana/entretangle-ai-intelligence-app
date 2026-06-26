import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbRetry } from "@/lib/db";
import {
  deleteProjectWorkspaceItem,
  deleteProject,
  getProjectLean,
  renameProject,
  saveDashboardOrganizer,
  saveInterviewTranscript,
  saveOwnerChecks,
  saveProjectCampaign,
  saveProjectAssetRating,
  saveProjectFolder,
  saveProjectGenerationPreference,
  saveProjectMetaPixel,
  saveProjectModuleIntent,
  saveProjectPrintSpec,
  saveVentureProfile,
} from "@/lib/store";
import {
  ClientProfileSchema,
  DashboardProjectOrganizerSchema,
  GenerationCountSchema,
  InterviewTranscriptSchema,
  MetaPixelStatusSchema,
  PrintColorSourceSchema,
  ProjectCampaignStatusSchema,
} from "@/lib/schema";
import { AssetLibraryStatusSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

// Lean read: persona arrays stripped from the snapshot (the UI needs counts,
// not 6000 agents per run). Full agent output stays saved in the DB.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const project = await withDbRetry(() => getProjectLean(params.id));
    if (!project) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (e) {
    // Same cold-start transient connection failure the list endpoint guards
    // against — retried above, and surfaced as a clean 503 (not an opaque 500)
    // when even the retries can't reach the Railway proxy.
    console.error("[projects/:id] GET failed", e);
    return NextResponse.json(
      { error: "Failed to open project" },
      { status: 503 },
    );
  }
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
  projectModuleIntent: z
    .object({
      moduleId: z.string().min(1).max(80),
      label: z.string().min(1).max(120),
      intent: z.string().min(1).max(2000),
      reason: z.string().max(1000).optional(),
    })
    .optional(),
  projectAssetRating: z
    .object({
      assetId: z.string().min(1).max(200),
      type: z.string().min(1).max(80),
      title: z.string().min(1).max(200),
      status: AssetLibraryStatusSchema,
    })
    .optional(),
  projectFolder: z
    .object({
      id: z.string().min(1).max(120).optional(),
      moduleId: z.string().min(1).max(80),
      name: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
    })
    .optional(),
  dashboardOrganizer: DashboardProjectOrganizerSchema.pick({
    folderId: true,
    folderName: true,
    folderColor: true,
    folderNote: true,
    projectNote: true,
  })
    .partial()
    .optional(),
  projectCampaign: z
    .object({
      id: z.string().min(1).max(120).optional(),
      moduleId: z.string().min(1).max(80),
      folderId: z.string().min(1).max(120).nullable().optional(),
      name: z.string().min(1).max(120),
      description: z.string().max(3000).optional(),
      status: ProjectCampaignStatusSchema.optional(),
    })
    .optional(),
  generationPreference: z
    .object({
      moduleId: z.string().min(1).max(80),
      count: GenerationCountSchema,
    })
    .optional(),
  printSpec: z
    .object({
      cmyk: z
        .object({
          primary: z.string().max(80).optional(),
          secondary: z.string().max(80).optional(),
          accent: z.string().max(80).optional(),
        })
        .optional(),
      pantone: z
        .object({
          primary: z.string().max(80).optional(),
          secondary: z.string().max(80).optional(),
          accent: z.string().max(80).optional(),
        })
        .optional(),
      exactPantoneSource: PrintColorSourceSchema.optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional(),
  metaPixel: z
    .object({
      status: MetaPixelStatusSchema.optional(),
      pixelId: z.string().max(120).optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional(),
  deleteProjectWorkspaceItem: z
    .object({
      type: z.enum(["folder", "campaign"]),
      itemId: z.string().min(1).max(120),
    })
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const body = PatchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  let moduleIntent = null;
  let assetRating = null;
  let folder = null;
  let dashboardOrganizer = null;
  let campaign = null;
  let generationPreference = null;
  let printSpec = null;
  let metaPixel = null;
  let projectWorkspace = null;
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
        body.data.ownerDashboardRunId,
      );
    }
    if (body.data.projectModuleIntent !== undefined) {
      moduleIntent = await saveProjectModuleIntent(
        params.id,
        body.data.projectModuleIntent,
      );
    }
    if (body.data.projectAssetRating !== undefined) {
      assetRating = await saveProjectAssetRating(
        params.id,
        body.data.projectAssetRating,
      );
    }
    if (body.data.projectFolder !== undefined) {
      folder = await saveProjectFolder(params.id, body.data.projectFolder);
    }
    if (body.data.dashboardOrganizer !== undefined) {
      dashboardOrganizer = await saveDashboardOrganizer(
        params.id,
        body.data.dashboardOrganizer,
      );
    }
    if (body.data.projectCampaign !== undefined) {
      campaign = await saveProjectCampaign(
        params.id,
        body.data.projectCampaign,
      );
    }
    if (body.data.generationPreference !== undefined) {
      generationPreference = await saveProjectGenerationPreference(
        params.id,
        body.data.generationPreference,
      );
    }
    if (body.data.printSpec !== undefined) {
      printSpec = await saveProjectPrintSpec(params.id, body.data.printSpec);
    }
    if (body.data.metaPixel !== undefined) {
      metaPixel = await saveProjectMetaPixel(params.id, body.data.metaPixel);
    }
    if (body.data.deleteProjectWorkspaceItem !== undefined) {
      projectWorkspace = await deleteProjectWorkspaceItem(
        params.id,
        body.data.deleteProjectWorkspaceItem,
      );
    }
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    moduleIntent,
    assetRating,
    folder,
    dashboardOrganizer,
    campaign,
    generationPreference,
    printSpec,
    metaPixel,
    projectWorkspace,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await deleteProject(params.id);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProject, listDocuments } from "@/lib/store";
import { ingestDocument } from "@/lib/rag";
import { toProviderErrorPayload } from "@/lib/providerErrors";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json({ documents: await listDocuments(params.id) });
}

const IngestSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1),
});

// Ingest founder reference data: chunk + embed + store for RAG grounding.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const body = IngestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    const result = await ingestDocument(
      params.id,
      body.data.name,
      body.data.content
    );
    return NextResponse.json({ document: result }, { status: 201 });
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "ingest failed");
    return NextResponse.json(payload, {
      status: status === 502 ? 422 : status,
    });
  }
}

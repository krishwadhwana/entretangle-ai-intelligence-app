import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { callAudienceChat } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  AudienceChatHistoryItemSchema,
  AudienceChatModeSchema,
  ClientProfileSchema,
  type Persona,
} from "@/lib/schema";
import { cohortToWire, personaToWire } from "@/lib/wire";

export const dynamic = "force-dynamic";

const AudienceChatRequestSchema = z.object({
  mode: AudienceChatModeSchema,
  cohortId: z.string().min(1),
  personaId: z.string().min(1).nullable().optional(),
  question: z.string().min(1).max(4000),
  history: z.array(AudienceChatHistoryItemSchema).max(20).default([]),
});

function representativeGroup(personas: Persona[]): Persona[] {
  if (personas.length <= 8) return personas;
  const sorted = [...personas].sort((a, b) => a.intent - b.intent);
  const indexes = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    Math.round((i * (sorted.length - 1)) / 7)
  );
  return Array.from(new Set(indexes)).map((i) => sorted[i]);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const body = AudienceChatRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cohortRow = await prisma.cohort.findFirst({
    where: { id: body.data.cohortId, runId: run.id },
    include: { personas: { orderBy: { id: "asc" } } },
  });
  if (!cohortRow) {
    return NextResponse.json({ error: "cohort not found" }, { status: 404 });
  }

  const allPersonas = cohortRow.personas.map(personaToWire);
  if (allPersonas.length === 0) {
    return NextResponse.json(
      { error: "this cohort has no simulated personas yet" },
      { status: 409 }
    );
  }

  const personas =
    body.data.mode === "customer"
      ? [
          allPersonas.find((p) => p.id === body.data.personaId) ??
            allPersonas[0],
        ]
      : representativeGroup(allPersonas);

  if (body.data.mode === "customer" && body.data.personaId) {
    const exists = personas[0]?.id === body.data.personaId;
    if (!exists) {
      return NextResponse.json({ error: "persona not found" }, { status: 404 });
    }
  }

  try {
    const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    const result = await callAudienceChat(
      run.id,
      profile,
      cohortToWire(cohortRow),
      personas,
      body.data.mode,
      body.data.question,
      body.data.history
    );
    return NextResponse.json(result);
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "audience chat failed");
    return NextResponse.json(payload, { status });
  }
}

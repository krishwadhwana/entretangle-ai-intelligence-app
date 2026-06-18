import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Loads the persisted conversations for the Win Back tab: every 1:1 win-back
// transcript (from persona.chatLog) and every two-persona interaction
// (PersonaConversation), scoped to a cohort's personas. Powers the "categorised
// in their Win Back tab" view so conversations survive drawer close / reload.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cohortId = req.nextUrl.searchParams.get("cohortId");
  if (!cohortId) {
    return NextResponse.json({ error: "cohortId required" }, { status: 400 });
  }

  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, runId: params.id },
    select: { id: true },
  });
  if (!cohort) {
    return NextResponse.json({ error: "cohort not found" }, { status: 404 });
  }

  const personas = await prisma.persona.findMany({
    where: { cohortId },
    select: {
      id: true,
      name: true,
      intent: true,
      intentOriginal: true,
      chatLog: true,
    },
  });
  const personaIds = personas.map((p) => p.id);

  // 1:1 win-back transcripts — only personas that actually have one.
  const winback = personas
    .map((p) => ({
      personaId: p.id,
      name: p.name,
      intent: p.intent,
      intentOriginal: p.intentOriginal,
      turns: safeParse(p.chatLog),
    }))
    .filter((p) => p.turns.length > 0);

  // Two-persona interactions started by a persona in this cohort.
  const rows = await prisma.personaConversation.findMany({
    where: { runId: params.id, personaAId: { in: personaIds } },
    orderBy: { updatedAt: "desc" },
  });
  const interactions = rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    personaAId: r.personaAId,
    personaBId: r.personaBId,
    topic: r.topic,
    messages: safeParse(r.messages),
    conclusion: r.conclusion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return NextResponse.json({ winback, interactions });
}

function safeParse(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

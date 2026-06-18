import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callPersonaReply, callPersonaConclusion } from "@/lib/llm";
import { RunEmitter } from "@/lib/events";
import { ClientProfileSchema } from "@/lib/schema";
import type { PersonaConversationMessage } from "@/lib/schema";
import { cohortToWire, personaToWire } from "@/lib/wire";

export const dynamic = "force-dynamic";

// Persona Interaction: 2-4 personas discuss a topic. Every action mutates one
// persisted PersonaConversation. Replies are generated ONE message per call —
// the user clicks "reply from X" to advance each turn — so a runaway discussion
// can't quietly rack up cost.
const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    participantIds: z.array(z.string()).min(2).max(4),
    topic: z.string().max(2000).default(""),
  }),
  z.object({
    action: z.literal("reply"),
    conversationId: z.string(),
    personaId: z.string(),
  }),
  z.object({
    action: z.literal("inject"),
    conversationId: z.string(),
    note: z.string().min(1).max(2000),
  }),
  z.object({ action: z.literal("conclude"), conversationId: z.string() }),
]);

function nowIso() {
  return new Date().toISOString();
}

function parseMessages(raw: string): PersonaConversationMessage[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersonaConversationMessage[]) : [];
  } catch {
    return [];
  }
}

function parseParticipantIds(row: {
  participantIds: string;
  personaAId: string;
  personaBId: string;
}): string[] {
  try {
    const parsed = JSON.parse(row.participantIds);
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed as string[];
  } catch {
    // fall through to legacy columns
  }
  return [row.personaAId, row.personaBId];
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = RequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  // Bind to a local const so TS narrows the discriminated union reliably across
  // the awaits below (property-access narrowing on body.data gets dropped).
  const data = body.data;

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  // --- start: create a fresh conversation between 2-4 personas --------------
  if (data.action === "start") {
    const ids = Array.from(new Set(data.participantIds));
    if (ids.length < 2) {
      return NextResponse.json(
        { error: "pick at least two different personas" },
        { status: 400 }
      );
    }
    if (ids.length > 4) {
      return NextResponse.json(
        { error: "a discussion can have at most four personas" },
        { status: 400 }
      );
    }
    const loaded = await Promise.all(ids.map((id) => loadPersona(params.id, id)));
    if (loaded.some((p) => !p)) {
      return NextResponse.json({ error: "persona not found" }, { status: 404 });
    }
    const convo = await prisma.personaConversation.create({
      data: {
        runId: params.id,
        participantIds: JSON.stringify(ids),
        personaAId: ids[0],
        personaBId: ids[1],
        topic: data.topic,
        messages: "[]",
      },
    });
    return NextResponse.json(wire(convo));
  }

  // All other actions operate on an existing conversation.
  const convo = await prisma.personaConversation.findFirst({
    where: { id: data.conversationId, runId: params.id },
  });
  if (!convo) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const messages = parseMessages(convo.messages);

  // --- inject: founder knowledge every persona then reasons over ------------
  if (data.action === "inject") {
    messages.push({
      role: "founder",
      speaker: "You (founder)",
      personaId: null,
      content: data.note,
      intentAfter: null,
      ts: nowIso(),
    });
    const updated = await prisma.personaConversation.update({
      where: { id: convo.id },
      data: { messages: JSON.stringify(messages) },
    });
    return NextResponse.json(wire(updated));
  }

  const participantIds = parseParticipantIds(convo);
  const loaded = await Promise.all(
    participantIds.map((id) => loadPersona(params.id, id))
  );
  const participants = loaded.filter(
    (p): p is NonNullable<typeof p> => p !== null
  );
  if (participants.length < 2) {
    return NextResponse.json(
      { error: "a participant persona is missing" },
      { status: 404 }
    );
  }

  // --- conclude: synthesize the discussion into a founder takeaway ----------
  if (data.action === "conclude") {
    if (messages.length === 0) {
      return NextResponse.json(
        { error: "nothing to conclude yet" },
        { status: 400 }
      );
    }
    let conclusion: string;
    try {
      const out = await callPersonaConclusion(
        run.id,
        profile,
        participants.map((p) => ({
          persona: personaToWire(p.row),
          cohort: cohortToWire(p.cohort),
        })),
        convo.topic,
        messages
      );
      conclusion = out.conclusion;
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "conclusion failed" },
        { status: 502 }
      );
    }
    const updated = await prisma.personaConversation.update({
      where: { id: convo.id },
      data: { conclusion },
    });
    return NextResponse.json(wire(updated));
  }

  // --- reply: generate ONE in-character message from the chosen persona -----
  if (data.action !== "reply") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const speaker = participants.find((p) => p.id === data.personaId);
  if (!speaker) {
    return NextResponse.json(
      { error: "that persona isn't in this discussion" },
      { status: 400 }
    );
  }
  const others = participants.filter((p) => p.id !== speaker.id);

  let reply;
  try {
    reply = await callPersonaReply(
      run.id,
      profile,
      { persona: personaToWire(speaker.row), cohort: cohortToWire(speaker.cohort) },
      others.map((p) => ({
        persona: personaToWire(p.row),
        cohort: cohortToWire(p.cohort),
      })),
      convo.topic,
      messages
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reply failed" },
      { status: 502 }
    );
  }

  messages.push({
    role: "persona",
    speaker: speaker.row.name,
    personaId: speaker.id,
    content: reply.content,
    intentAfter: reply.intentAfter,
    ts: nowIso(),
  });
  const updated = await prisma.personaConversation.update({
    where: { id: convo.id },
    data: { messages: JSON.stringify(messages) },
  });

  // If the exchange genuinely moved the speaker's intent, persist it to the
  // persona and emit so sentiment/charts re-derive (same as 1:1 win-back).
  if (reply.intentAfter !== null && reply.intentAfter !== speaker.row.intent) {
    const intentOriginal = speaker.row.intentOriginal ?? speaker.row.intent;
    const changedAt = new Date();
    await prisma.persona.update({
      where: { id: speaker.id },
      data: {
        intent: reply.intentAfter,
        intentOriginal,
        voteChangedAt: changedAt,
      },
    });
    const emitter = await RunEmitter.create(run.id);
    await emitter.emit({
      type: "persona_updated",
      cohortId: speaker.row.cohortId,
      personaId: speaker.id,
      intent: reply.intentAfter,
      intentOriginal,
      objection: speaker.row.objection,
      voteChangedAt: changedAt.toISOString(),
    });
  }

  return NextResponse.json(wire(updated));
}

async function loadPersona(runId: string, personaId: string) {
  const row = await prisma.persona.findUnique({
    where: { id: personaId },
    include: { cohort: true },
  });
  if (!row || row.cohort.runId !== runId) return null;
  return { id: row.id, row, cohort: row.cohort };
}

function wire(c: {
  id: string;
  runId: string;
  participantIds: string;
  personaAId: string;
  personaBId: string;
  topic: string;
  messages: string;
  conclusion: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    runId: c.runId,
    participantIds: parseParticipantIds(c),
    topic: c.topic,
    messages: parseMessages(c.messages),
    conclusion: c.conclusion,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

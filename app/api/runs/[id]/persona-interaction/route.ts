import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callPersonaReply, callPersonaConclusion } from "@/lib/llm";
import { RunEmitter } from "@/lib/events";
import { ClientProfileSchema } from "@/lib/schema";
import type { PersonaConversationMessage } from "@/lib/schema";
import { cohortToWire, personaToWire } from "@/lib/wire";

export const dynamic = "force-dynamic";

// Persona Interaction: two personas discuss a topic. Every action mutates one
// persisted PersonaConversation. Replies are generated ONE message per call —
// the user clicks "generate reply from X" to advance each turn — so a runaway
// discussion can't quietly rack up cost.
const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    personaAId: z.string(),
    personaBId: z.string(),
    topic: z.string().max(2000).default(""),
  }),
  z.object({
    action: z.literal("reply"),
    conversationId: z.string(),
    speaker: z.enum(["A", "B"]),
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = RequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  // --- start: create a fresh conversation between two personas --------------
  if (body.data.action === "start") {
    const [a, b] = await Promise.all([
      loadPersona(params.id, body.data.personaAId),
      loadPersona(params.id, body.data.personaBId),
    ]);
    if (!a || !b) {
      return NextResponse.json({ error: "persona not found" }, { status: 404 });
    }
    if (a.id === b.id) {
      return NextResponse.json(
        { error: "pick two different personas" },
        { status: 400 }
      );
    }
    const convo = await prisma.personaConversation.create({
      data: {
        runId: params.id,
        personaAId: a.id,
        personaBId: b.id,
        topic: body.data.topic,
        messages: "[]",
      },
    });
    return NextResponse.json(wire(convo));
  }

  // All other actions operate on an existing conversation.
  const convo = await prisma.personaConversation.findFirst({
    where: { id: body.data.conversationId, runId: params.id },
  });
  if (!convo) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const messages = parseMessages(convo.messages);

  // --- inject: founder knowledge both personas then reason over -------------
  if (body.data.action === "inject") {
    messages.push({
      role: "founder",
      speaker: "You (founder)",
      personaId: null,
      content: body.data.note,
      intentAfter: null,
      ts: nowIso(),
    });
    const updated = await prisma.personaConversation.update({
      where: { id: convo.id },
      data: { messages: JSON.stringify(messages) },
    });
    return NextResponse.json(wire(updated));
  }

  const [personaA, personaB] = await Promise.all([
    loadPersona(params.id, convo.personaAId),
    loadPersona(params.id, convo.personaBId),
  ]);
  if (!personaA || !personaB) {
    return NextResponse.json(
      { error: "a participant persona is missing" },
      { status: 404 }
    );
  }

  // --- conclude: synthesize the discussion into a founder takeaway ----------
  if (body.data.action === "conclude") {
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
        personaToWire(personaA.row),
        personaToWire(personaB.row),
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
  const speakerIsA = body.data.speaker === "A";
  const speaker = speakerIsA ? personaA : personaB;
  const other = speakerIsA ? personaB : personaA;

  let reply;
  try {
    reply = await callPersonaReply(
      run.id,
      profile,
      cohortToWire(speaker.cohort),
      personaToWire(speaker.row),
      personaToWire(other.row),
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
    role: speakerIsA ? "personaA" : "personaB",
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
  if (
    reply.intentAfter !== null &&
    reply.intentAfter !== speaker.row.intent
  ) {
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
    personaAId: c.personaAId,
    personaBId: c.personaBId,
    topic: c.topic,
    messages: parseMessages(c.messages),
    conclusion: c.conclusion,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

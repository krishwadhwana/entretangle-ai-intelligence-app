import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callAudienceChat } from "@/lib/llm";
import { RunEmitter } from "@/lib/events";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  AudienceChatHistoryItemSchema,
  ClientProfileSchema,
} from "@/lib/schema";
import { cohortToWire, personaToWire } from "@/lib/wire";
import { classifySentiment } from "@/lib/vote";

export const dynamic = "force-dynamic";

// 1:1 "win-back" chat: talk to a single persona who didn't approve, and if the
// pitch genuinely moves them, persist the new intent + emit a persona_updated
// event so sentiment/charts re-derive across the run (canvas = f(event log)).
const PersonaChatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  history: z.array(AudienceChatHistoryItemSchema).max(20).default([]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; personaId: string } }
) {
  const body = PersonaChatRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const personaRow = await prisma.persona.findUnique({
    where: { id: params.personaId },
    include: { cohort: true },
  });
  if (!personaRow || personaRow.cohort.runId !== run.id) {
    return NextResponse.json({ error: "persona not found" }, { status: 404 });
  }

  const persona = personaToWire(personaRow);
  const intentBefore = persona.intent;

  let result;
  try {
    const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    result = await callAudienceChat(
      run.id,
      profile,
      cohortToWire(personaRow.cohort),
      [persona],
      "customer",
      body.data.question,
      body.data.history
    );
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "persona chat failed");
    return NextResponse.json(payload, { status });
  }

  // Last reply that carries a fresh intent reading is the persona's new stance.
  const withIntent = [...result.messages]
    .reverse()
    .find((m) => typeof m.intentAfter === "number");
  const intentAfter = withIntent?.intentAfter ?? null;
  const newObjection = withIntent?.objection ?? null;

  // ALWAYS persist the exchange to the transcript — not only when the vote
  // moves — so the Win Back tab can replay every conversation after the drawer
  // is closed/reopened (previously a non-moving chat vanished on close).
  const now = new Date();
  const turn = {
    question: body.data.question,
    messages: result.messages,
    intentBefore,
    intentAfter,
    ts: now.toISOString(),
  };
  const chatLog = [...safeParseLog(personaRow.chatLog), turn];

  const voteChanged = intentAfter !== null && intentAfter !== intentBefore;
  if (voteChanged) {
    const intentOriginal = personaRow.intentOriginal ?? intentBefore;
    const objection = newObjection ?? personaRow.objection;
    await prisma.persona.update({
      where: { id: personaRow.id },
      data: {
        intent: intentAfter as number,
        intentOriginal,
        objection,
        voteChangedAt: now,
        chatLog: JSON.stringify(chatLog),
      },
    });

    const emitter = await RunEmitter.create(run.id);
    await emitter.emit({
      type: "persona_updated",
      cohortId: personaRow.cohortId,
      personaId: personaRow.id,
      intent: intentAfter as number,
      intentOriginal,
      objection,
      voteChangedAt: now.toISOString(),
    });
  } else {
    // No vote change — still append the transcript so it persists.
    await prisma.persona.update({
      where: { id: personaRow.id },
      data: { chatLog: JSON.stringify(chatLog) },
    });
  }

  return NextResponse.json({
    ...result,
    intentBefore,
    intentAfter,
    voteBefore: classifySentiment(intentBefore),
    voteAfter: classifySentiment(intentAfter ?? intentBefore),
    voteChanged,
    chatLog,
  });
}

function safeParseLog(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callDataQuestion } from "@/lib/llm";
import { getOwnerDashboard, saveFinancials } from "@/lib/store";
import {
  ClientProfileSchema,
  FinancialsSectionSchema,
  type FollowUpTurn,
} from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

// "Ask about these financials": answer grounded in the saved financial model,
// and persist the exchange in the financials section's follow-up.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (!run.projectId) {
    return NextResponse.json({ error: "run has no project" }, { status: 409 });
  }

  const owner = (await getOwnerDashboard(run.projectId)) as
    | { financials?: unknown }
    | null;
  const fin = FinancialsSectionSchema.safeParse(owner?.financials);
  if (!fin.success || !fin.data.model) {
    return NextResponse.json(
      { error: "build the financial model first" },
      { status: 409 }
    );
  }

  const profile = ClientProfileSchema.safeParse(
    JSON.parse(run.clientProfile || "{}")
  );
  const context = JSON.stringify({
    profile: profile.success
      ? {
          product: profile.data.product,
          category: profile.data.category,
          geography: profile.data.geography,
        }
      : null,
    currency: fin.data.model.currency,
    model: fin.data.model,
  });
  const history = fin.data.followUp;

  let answer: string;
  try {
    answer = await callDataQuestion(
      params.id,
      "a financial model",
      context,
      body.data.question,
      history
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ask failed" },
      { status: 502 }
    );
  }

  const turn: FollowUpTurn = {
    question: body.data.question,
    answer,
    ts: new Date().toISOString(),
  };
  const followUp = [...history, turn];
  await saveFinancials(run.projectId, { ...fin.data, followUp });

  return NextResponse.json({ answer, followUp });
}

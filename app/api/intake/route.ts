import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callIntake } from "@/lib/llm";
import { ChatMessageSchema, IntakePrefillSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const IntakeRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  // Optional website-analysis pre-fill: the interview then asks only the gaps.
  prefill: IntakePrefillSchema.nullable().optional(),
});

// Conversational intake (Shot 8): returns the next interview question or
// the finished ClientProfile, which the client hands to POST /api/runs.
export async function POST(req: NextRequest) {
  const body = IntakeRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await callIntake(body.data.messages, body.data.prefill ?? null)
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "intake failed" },
      { status: 502 }
    );
  }
}

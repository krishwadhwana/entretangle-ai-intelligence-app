import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callQuery } from "@/lib/llm";
import { conclusionToWire } from "@/lib/orchestrator";
import { RunEmitter } from "@/lib/events";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

const QueryRequestSchema = z.object({
  question: z.string().min(1),
  answerInstructions: z.string().max(4000).optional(),
  // Optional: restrict reasoning to specific business-module domains (the
  // Playbook's per-module ask box). Omit to query the whole world model.
  domains: z.array(z.string()).optional(),
});

// Query the converged world model (SPEC Shot 5). Answers cite the
// conclusion ids they relied on — the canvas highlights those blocks.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = QueryRequestSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not queryable yet` },
      { status: 409 }
    );
  }

  const domains = body.data.domains?.length ? body.data.domains : null;
  const conclusions = (
    await prisma.conclusion.findMany({
      where: {
        block: {
          runId: run.id,
          state: "concluded",
          ...(domains ? { domain: { in: domains } } : {}),
        },
      },
    })
  ).map(conclusionToWire);

  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  // The audience aggregate (if any) rides along — query answers can cite
  // simulated-audience numbers, not just desk conclusions (SPEC-V2 §1A).
  const aggEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  const aggregate = aggEvent
    ? (JSON.parse(aggEvent.payload).aggregate ?? null)
    : null;

  try {
    const result = await callQuery(
      run.id,
      profile,
      conclusions,
      aggregate,
      body.data.question,
      body.data.answerInstructions ?? null
    );
    // Only cite ids that actually exist in this run's world model.
    const valid = new Set(conclusions.map((c) => c.id));
    const citedConclusionIds = result.citedConclusionIds.filter((id) =>
      valid.has(id)
    );

    // Persist the Q&A as an event so the Conclusion panel's conversation is
    // reconstructable on reload (canvas state = f(event log)). Best-effort —
    // a persistence hiccup must not fail the answer the user just got.
    try {
      const emitter = await RunEmitter.create(run.id);
      await emitter.emit({
        type: "conclusion_query",
        question: body.data.question,
        answer: result.answer,
        citedConclusionIds,
        domains: domains ?? [],
      });
    } catch (e) {
      console.error(`[query] failed to persist conclusion_query:`, e);
    }

    return NextResponse.json({
      answer: result.answer,
      citedConclusionIds,
    });
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "query failed");
    return NextResponse.json(payload, { status });
  }
}

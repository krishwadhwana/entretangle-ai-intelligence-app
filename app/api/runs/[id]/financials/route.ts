import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callFinancialInputs } from "@/lib/llm";
import { conclusionToWire } from "@/lib/wire";
import { saveFinancials } from "@/lib/store";
import { computeFinancials, type PersonaPoint } from "@/lib/financials";
import {
  ClientProfileSchema,
  FinancialInputsSchema,
  type FinancialsSection,
} from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Owner Dashboard › Financials. Two modes, one route:
//   • POST {}                      → generate a fresh model (LLM emits the
//                                    assumptions, computeFinancials does the math)
//   • POST { inputs, editedKeys }  → recompute from founder-overridden inputs
//                                    against the SAME simulated audience (no LLM)
// Either way the deterministic engine owns the arithmetic; the persona
// wtp×intent audience is the demand curve.
const FIN_DOMAINS = [
  "finance",
  "pricing",
  "market",
  "competitor",
  "supply",
  "operations",
  "channel",
  "synthesis",
];

const BodySchema = z.object({
  inputs: FinancialInputsSchema.optional(),
  editedKeys: z.array(z.string()).default([]),
  projectId: z.string().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for financials yet` },
      { status: 409 }
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const override = body.data.inputs ?? null;
  const editedKeys = body.data.editedKeys;
  const targetProjectId = run.projectId ?? body.data.projectId ?? null;

  const profile = ClientProfileSchema.parse(JSON.parse(run.clientProfile));

  // Persona demand curve: wtp × intent × segment. The conversion shape comes
  // from the real simulated buyers; we only need three fields each.
  const personaRows = await prisma.persona.findMany({
    where: { cohort: { runId: run.id } },
    select: { wtp: true, intent: true, wtpCurrency: true, cohort: { select: { segment: true } } },
  });
  const personas: PersonaPoint[] = personaRows.map((p) => ({
    wtp: p.wtp,
    intent: p.intent,
    segment: p.cohort.segment as PersonaPoint["segment"],
  }));

  // Currency the personas quoted wtp in — the model must use the same one so
  // wtp ≥ price comparisons are valid. Fall back to the override / INR.
  const currency =
    override?.currency ?? dominantCurrency(personaRows.map((p) => p.wtpCurrency)) ?? "INR";

  const aggEvent = await prisma.runEvent.findFirst({
    where: { runId: run.id, type: "audience_aggregated" },
    orderBy: { seq: "desc" },
  });
  const aggregate = aggEvent
    ? (JSON.parse(aggEvent.payload).aggregate ?? null)
    : null;

  // Capital: the only numeric capital we hold is the legacy INR field. Treat a
  // present value as founder-entered ground truth.
  const capital = {
    capitalAvailable: profile.capitalInr ?? 0,
    source: (profile.capitalInr != null ? "founder_entered" : "ai_estimated") as
      | "founder_entered"
      | "ai_estimated",
    basis: profile.funding?.capitalAvailable
      ? `stated at intake: ${profile.funding.capitalAvailable}`
      : "",
  };

  try {
    // Override mode skips the LLM entirely — pure recompute.
    const inputs =
      override ??
      (await (async () => {
        const conclusions = (
          await prisma.conclusion.findMany({
            where: {
              block: {
                runId: run.id,
                state: "concluded",
                domain: { in: FIN_DOMAINS },
              },
            },
          })
        ).map(conclusionToWire);
        return callFinancialInputs(run.id, profile, conclusions, aggregate, currency);
      })());

    const generatedAt = new Date().toISOString();
    const model = computeFinancials(
      inputs,
      { personas, aggregate },
      capital,
      { generatedAt, sourceRunId: run.id, editedKeys }
    );

    const section: FinancialsSection = {
      model,
      inputs,
      editedKeys,
      generatedAt,
      sourceRunId: run.id,
    };

    // Persist onto the project (survives reload + sibling runs). Runs without a
    // project still get a usable model back.
    if (targetProjectId) {
      const saved = await saveFinancials(targetProjectId, section);
      return NextResponse.json(saved);
    }
    return NextResponse.json(section);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "financials generation failed" },
      { status: 502 }
    );
  }
}

// Most common wtpCurrency across the simulated personas (they should all agree,
// but be defensive).
function dominantCurrency(codes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) ((best = c), (bestN = n));
  return best;
}

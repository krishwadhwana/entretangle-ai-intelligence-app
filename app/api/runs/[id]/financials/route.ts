import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { callFinancialInputs } from "@/lib/llm";
import { conclusionToWire } from "@/lib/wire";
import { getFinancialsSection, getMarketData, saveFinancials } from "@/lib/store";
import {
  computeFinancials,
  type CapitalInput,
  type PersonaPoint,
} from "@/lib/financials";
import {
  benchmarksForProfile,
  type BenchmarkPriors,
  type Range,
} from "@/lib/datasources/benchmarks";
import { fetchFxRate } from "@/lib/datasources/exportCosts";
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

  // Capital: the numeric intake field is INR. Convert it into the model currency
  // so a US/USD financial run does not interpret rupees as dollars.
  const capital = await capitalForCurrency(profile, currency);

  try {
    // Override mode skips the LLM entirely — pure recompute.
    const rawInputs =
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
    const priors = await financialBenchmarkPriors(profile, targetProjectId);
    const inputs = applyMarketCacPrior(rawInputs, priors);

    const generatedAt = new Date().toISOString();
    const model = computeFinancials(
      inputs,
      { personas, aggregate },
      capital,
      { generatedAt, sourceRunId: run.id, editedKeys }
    );

    // Preserve any "ask about these financials" Q&A across a regenerate.
    const priorFinancials = run.projectId
      ? await getFinancialsSection(run.projectId, run.id)
      : null;
    const section: FinancialsSection = {
      model,
      inputs,
      editedKeys,
      generatedAt,
      sourceRunId: run.id,
      followUp: priorFinancials?.followUp ?? [],
    };

    // Persist onto the project (survives reload + sibling runs). Runs without a
    // project still get a usable model back.
    if (targetProjectId) {
      const saved = await saveFinancials(targetProjectId, section, run.id);
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

async function capitalForCurrency(
  profile: z.infer<typeof ClientProfileSchema>,
  currency: string
): Promise<CapitalInput> {
  const capitalInr = profile.capitalInr ?? 0;
  const source = profile.capitalInr != null ? "founder_entered" : "ai_estimated";
  const stated = profile.funding?.capitalAvailable
    ? `stated at intake: ${profile.funding.capitalAvailable}`
    : "";
  const target = normalizeCurrency(currency || "INR");
  if (target === "INR" || capitalInr <= 0) {
    return {
      capitalAvailable: capitalInr,
      source,
      basis: stated,
    };
  }

  const fx = await fetchFxRate("INR", target);
  const basis = [
    stated,
    `converted from INR with FX INR->${target} ${fx.rate} (${fx.source})`,
  ].filter(Boolean).join("; ");
  return {
    capitalAvailable: roundMoney(capitalInr * fx.rate),
    source,
    basis,
  };
}

async function financialBenchmarkPriors(
  profile: z.infer<typeof ClientProfileSchema>,
  projectId: string | null
): Promise<BenchmarkPriors> {
  const { priors } = benchmarksForProfile(profile);
  if (!projectId) return priors;
  try {
    const datum = (await getMarketData(projectId))[
      `${priors.market}:${priors.category}`
    ];
    if (!datum?.cac) return priors;
    return {
      ...priors,
      cacInr: datum.cac,
      sources: [...priors.sources, ...(datum.sources ?? [])],
      notes: [
        ...priors.notes,
        `Financial CAC prior refreshed from live market-data sourcing as of ${datum.asOf || "unknown date"}.`,
      ],
    };
  } catch {
    return priors;
  }
}

function applyMarketCacPrior(
  inputs: z.infer<typeof FinancialInputsSchema>,
  priors: BenchmarkPriors
): z.infer<typeof FinancialInputsSchema> {
  if (normalizeCurrency(inputs.currency) !== normalizeCurrency(priors.currency)) {
    return inputs;
  }

  const next = structuredClone(inputs);
  const range = priors.cacInr;
  const channels =
    next.cacByChannel.length >= 2
      ? next.cacByChannel
      : [
          { channel: "Meta / paid social", cac: range.mid * 0.9 },
          { channel: "Search / high-intent", cac: range.mid * 1.1 },
          { channel: "Creator / affiliate", cac: range.mid },
        ];
  const mean =
    channels.reduce(
      (s, c) => s + (Number.isFinite(c.cac) && c.cac > 0 ? c.cac : range.mid),
      0
    ) / channels.length;
  const target = range.mid;
  const scale = mean > 0 ? target / mean : 1;

  next.cacByChannel = channels.map((c) => ({
    channel: c.channel || "Acquisition",
    cac: roundMoney(clampToRange((Number.isFinite(c.cac) && c.cac > 0 ? c.cac : target) * scale, range)),
  }));

  const note = `CAC anchored to ${priors.market === "US" ? "US" : "India"} ${priors.category} benchmark prior: ${inputs.currency} ${range.low}-${range.high} (mid ${range.mid}) per new customer.`;
  if (!next.assumptions.some((a) => a.includes("CAC anchored to"))) {
    next.assumptions = [...next.assumptions, note];
  }
  return next;
}

function clampToRange(v: number, range: Range): number {
  if (!Number.isFinite(v)) return range.mid;
  return Math.max(range.low, Math.min(range.high, v));
}

function roundMoney(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(Math.abs(v) >= 1000 ? 0 : 2));
}

function normalizeCurrency(c?: string | null): string {
  return (c || "").trim().toUpperCase();
}

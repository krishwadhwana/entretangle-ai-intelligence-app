import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getFinancialModel } from "@/lib/store";
import { simulateLaunch, type LaunchPersona } from "@/lib/launchSim";
import {
  LaunchSimInputsSchema,
  type LaunchSimInputs,
  type LaunchSimRecord,
} from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Launch Simulation — a deterministic, persona-driven launch trajectory.
//   • GET                       → saved scenarios + form defaults (from financials)
//   • POST { inputs, name }     → run the engine over the frozen personas, save
//                                 the scenario, return it. No LLM; pure compute.
// The engine is a pure function of its inputs, so rerunning identical inputs
// reproduces an identical result — that is the predictiveness contract.

const BodySchema = z.object({
  inputs: LaunchSimInputsSchema,
  name: z.string().max(80).default("Scenario"),
  projectId: z.string().nullable().optional(),
});

// Load the run's frozen personas in the shape the engine needs.
async function loadPersonas(runId: string): Promise<{
  personas: LaunchPersona[];
  currency: string;
}> {
  const rows = await prisma.persona.findMany({
    where: { cohort: { runId } },
    select: {
      intent: true,
      wtp: true,
      wtpCurrency: true,
      priceSensitivity: true,
      channelPref: true,
      platforms: true,
      objection: true,
      age: true,
      gender: true,
      cohort: { select: { segment: true, locality: true, country: true } },
    },
  });
  const personas: LaunchPersona[] = rows.map((p) => ({
    intent: p.intent,
    wtp: p.wtp,
    priceSensitivity: p.priceSensitivity,
    segment: p.cohort.segment,
    channelPref: p.channelPref,
    platforms: safeJsonArray(p.platforms),
    objection: p.objection,
    age: p.age,
    gender: p.gender,
    locality: p.cohort.locality,
    country: p.cohort.country,
  }));
  return { personas, currency: dominantCurrency(rows.map((p) => p.wtpCurrency)) ?? "INR" };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [rows, personaData] = await Promise.all([
    prisma.launchSimulation.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
    }),
    loadPersonas(run.id),
  ]);
  const { personas, currency } = personaData;

  // Prefill suggestions from the saved financial model, if the founder built one.
  const model = run.projectId ? await getFinancialModel(run.projectId) : null;
  const baseTier =
    model?.priceTiers.find((t) => t.label) ?? model?.priceTiers[0] ?? null;
  const reachableProspectsPerMonth =
    model?.marketSizing.reachableProspectsPerMonth.value ?? null;
  const blendedCac = model?.unitEconomics.blendedCac.value ?? null;
  const defaults = {
    currency: model?.currency ?? currency,
    suggestedCostPrice: model
      ? model.costStructure.reduce((s, c) => s + c.amount.value, 0)
      : null,
    suggestedSalePrice: baseTier?.price.value ?? null,
    suggestedAdSpendPerMonth: suggestAdSpendPerMonth(
      blendedCac,
      reachableProspectsPerMonth,
      model?.breakEven.fixedCostsPerMonth.value ?? null,
      baseTier?.price.value ?? null
    ),
    reachableProspectsPerMonth,
    fixedCostsPerMonth: model?.breakEven.fixedCostsPerMonth.value ?? null,
  };

  const scenarios: LaunchSimRecord[] = rows.map((r) => {
    const inputs = applyLegacyAcquisitionDefault(
      LaunchSimInputsSchema.parse(r.inputs),
      defaults.suggestedAdSpendPerMonth
    );
    return {
      id: r.id,
      runId: r.runId,
      name: r.name,
      inputs,
      result:
        personas.length > 0
          ? simulateLaunch(personas, inputs, {
              reachableProspectsPerMonth,
              blendedCac,
            })
          : (r.result as unknown as LaunchSimRecord["result"]),
      createdAt: r.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ scenarios, defaults });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["complete", "capped"].includes(run.status)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not ready for a launch simulation yet` },
      { status: 409 }
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }

  const { personas } = await loadPersonas(run.id);
  if (personas.length === 0) {
    return NextResponse.json(
      { error: "no simulated personas to run a launch against" },
      { status: 409 }
    );
  }

  // Reach ceiling default comes from the founder's financial model when present.
  const model = run.projectId ? await getFinancialModel(run.projectId) : null;
  const reachableProspectsPerMonth =
    model?.marketSizing.reachableProspectsPerMonth.value ?? null;
  const blendedCac = model?.unitEconomics.blendedCac.value ?? null;

  try {
    const result = simulateLaunch(personas, body.data.inputs, {
      reachableProspectsPerMonth,
      blendedCac,
    });

    const row = await prisma.launchSimulation.create({
      data: {
        runId: run.id,
        projectId: run.projectId ?? body.data.projectId ?? null,
        name: body.data.name,
        inputs: body.data.inputs as unknown as object,
        result: result as unknown as object,
      },
    });

    const record: LaunchSimRecord = {
      id: row.id,
      runId: row.runId,
      name: row.name,
      inputs: body.data.inputs,
      result,
      createdAt: row.createdAt.toISOString(),
    };
    return NextResponse.json(record);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "launch simulation failed" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const scenarioId = new URL(req.url).searchParams.get("scenarioId");
  if (!scenarioId) {
    return NextResponse.json({ error: "scenarioId required" }, { status: 400 });
  }
  await prisma.launchSimulation.deleteMany({
    where: { id: scenarioId, runId: params.id },
  });
  return NextResponse.json({ ok: true });
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function dominantCurrency(codes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) ((best = c), (bestN = n));
  return best;
}

function suggestAdSpendPerMonth(
  blendedCac: number | null,
  reachableProspectsPerMonth: number | null,
  fixedCostsPerMonth: number | null,
  salePrice: number | null
): number | null {
  const candidates: number[] = [];
  if (
    blendedCac != null &&
    blendedCac > 0 &&
    reachableProspectsPerMonth != null &&
    reachableProspectsPerMonth > 0
  ) {
    const targetCustomers = Math.min(
      250,
      Math.max(20, reachableProspectsPerMonth * 0.01)
    );
    candidates.push(blendedCac * targetCustomers);
  }
  if (fixedCostsPerMonth != null && fixedCostsPerMonth > 0) {
    candidates.push(fixedCostsPerMonth * 0.15);
  }
  if (salePrice != null && salePrice > 0) {
    candidates.push(salePrice * 20);
  }
  const suggested = candidates.find((n) => Number.isFinite(n) && n > 0);
  return suggested == null ? null : Math.round(suggested);
}

function applyLegacyAcquisitionDefault(
  inputs: LaunchSimInputs,
  suggestedAdSpendPerMonth: number | null
): LaunchSimInputs {
  if (
    inputs.adSpendPerMonth === 0 &&
    inputs.organicReachPerStep === 0 &&
    inputs.initialInventoryUnits == null &&
    suggestedAdSpendPerMonth != null &&
    suggestedAdSpendPerMonth > 0
  ) {
    return { ...inputs, adSpendPerMonth: suggestedAdSpendPerMonth };
  }
  return inputs;
}

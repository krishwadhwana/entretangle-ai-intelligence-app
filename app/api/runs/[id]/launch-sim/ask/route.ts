import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRunForApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { callDataQuestion } from "@/lib/llm";
import { toProviderErrorPayload } from "@/lib/providerErrors";
import {
  ClientProfileSchema,
  FollowUpTurnSchema,
  type FollowUpTurn,
} from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  scenarioId: z.string(),
  question: z.string().trim().min(1).max(2000),
});

// How the deterministic engine (lib/launchSim.ts) produces each figure — passed
// to the Q&A so it explains numbers from the ACTUAL rules + trajectory instead of
// saying "the JSON doesn't expose the rule".
const LAUNCH_SIM_MECHANICS = `This launch simulation is a DETERMINISTIC engine — no AI in the numbers; identical inputs reproduce identical results. How figures are produced:
- FUNNEL (per step): ad spend buys impressions (spend ÷ CPM) → reach (capped by frequency) → engaged → product visits → checkouts → a fraction decide to buy, gated by each persona's buy probability, price vs their willingness-to-pay, trust, and decisionSpeed. Repeat orders come only from previously-acquired customers.
- CAC CAP + GROWTH: paid-attributed first-time orders each step cannot exceed (ad spend ÷ benchmark CAC). monthlyGrowthPct is either founder-entered or derived from the simulated audience's WTP fit, intent depth, objections, channel fit, repeat potential, word of mouth, and reach runway; it can be positive, flat, or negative and compounds demand/acquisition each month. Organic / owned / word-of-mouth demand is not capped away by paid CAC; it is limited by its own reach → checkout funnel.
- INVENTORY & REORDER: opening inventory ≈ 1.5× the checkout/CAC-capped first-month demand. With reorder on, each step the engine targets ~(reorder lead time + buffer) of recent (EMA) demand on hand and orders the gap — but ONLY if that order can arrive before the horizon ends. DEADSTOCK = units still ON HAND at the final step (unsold finished goods). 'unitsPurchased' = everything paid for; 'unitsInTransitEnd' = paid but undelivered at the horizon. A demand-tracking reorder keeps leftover LOW by design, so a small deadstock alongside some stockouts is the EXPECTED healthy outcome, not an error — reconcile it as purchased ≈ sold + deadstock + in-transit (refund restocks add a little back).
- REFUNDS: calibrated so the realized refund rate matches the 'targetRefundRatePct' input.
- P&L: net profit is ACCRUAL on units SOLD (COGS counts only sold units); peak capital is the worst cumulative CASH trough and includes inventory purchases — that is why net profit and peak capital differ.
Answer from these mechanics plus the timeline/summary numbers; cite the actual figures and never claim the data doesn't expose a rule.`;

function parseFollowUp(raw: unknown): FollowUpTurn[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((t) => FollowUpTurnSchema.safeParse(t))
    .filter((r): r is { success: true; data: FollowUpTurn } => r.success)
    .map((r) => r.data);
}

// "Ask about this launch scenario": answer a founder's question grounded in the
// scenario's summary + diagnostics, and persist the exchange on the scenario.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRunForApi(params.id);
  if (auth.response) return auth.response;
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 });
  }
  const run = await prisma.run.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const scenario = await prisma.launchSimulation.findFirst({
    where: { id: body.data.scenarioId, runId: params.id },
  });
  if (!scenario) {
    return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  }

  const profile = ClientProfileSchema.safeParse(
    JSON.parse(run.clientProfile || "{}")
  );
  const result = scenario.result as {
    summary?: unknown;
    diagnostics?: unknown;
    assumptions?: unknown;
    resolvedInputs?: unknown;
    timeline?: Array<Record<string, number | string>>;
  };
  const inputs = scenario.inputs as Record<string, unknown>;

  // Downsample the actual day/month-by-day trajectory to ~16 points so the model
  // can reason over the REAL sim run (orders, inventory, stockouts, cash) instead
  // of guessing. Keep only the decision-relevant fields to bound tokens.
  const tl = Array.isArray(result.timeline) ? result.timeline : [];
  const stride = Math.max(1, Math.floor(tl.length / 16));
  const timeline = tl
    .filter((_, i) => i % stride === 0 || i === tl.length - 1)
    .map((s) => ({
      label: s.label,
      newOrders: s.newOrders,
      repeatOrders: s.repeatOrders,
      unitsFulfilled: s.unitsFulfilled,
      unitsStockedOut: s.unitsStockedOut,
      inventoryOnHand: s.inventoryOnHand,
      cumulativeNetProfit: s.cumulativeNetProfit,
      cumulativeCash: s.cumulativeCash,
    }));

  const context = JSON.stringify({
    profile: profile.success
      ? {
          product: profile.data.product,
          category: profile.data.category,
          geography: profile.data.geography,
        }
      : null,
    scenario: scenario.name,
    // resolvedInputs = inputs after defaults/derivation (what the engine actually ran).
    inputs: result.resolvedInputs ?? inputs,
    summary: result.summary,
    diagnostics: result.diagnostics,
    assumptions: result.assumptions, // per-knob value + source + confidence
    timeline, // the actual simulated trajectory (downsampled)
    modelMechanics: LAUNCH_SIM_MECHANICS,
  });
  const history = parseFollowUp(scenario.followUp);

  let answer: string;
  try {
    answer = await callDataQuestion(
      params.id,
      "a launch-simulation scenario",
      context,
      body.data.question,
      history
    );
  } catch (e) {
    const { payload, status } = toProviderErrorPayload(e, "ask failed");
    return NextResponse.json(payload, { status });
  }

  const turn: FollowUpTurn = {
    question: body.data.question,
    answer,
    ts: new Date().toISOString(),
  };
  const followUp = [...history, turn];
  await prisma.launchSimulation.update({
    where: { id: scenario.id },
    data: { followUp: followUp as unknown as object },
  });

  return NextResponse.json({ answer, followUp });
}

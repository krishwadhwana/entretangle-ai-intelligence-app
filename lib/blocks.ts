import { prisma } from "./db";
import { config } from "./config";
import { callExecutor } from "./llm";
import { getCostUsd, getTokensUsed } from "./usage";
import type { RunEmitter } from "./events";
import type { ClientProfile, Conclusion, ExecutorOutput } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logDelay(): number {
  // 400–700ms artificial pacing between log emissions (SPEC §4.3).
  return 400 + Math.floor(Math.random() * 300);
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Block timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Execute one block end-to-end (SPEC §4.3). Returns true if the block
 * concluded, false if it failed. Failures never throw — the orchestrator
 * decides whether the run survives.
 */
export async function executeBlock(
  emitter: RunEmitter,
  blockId: string,
  profile: ClientProfile,
  inputConclusions: Conclusion[],
  // Alternate producer (e.g. audience synthesis over aggregate stats);
  // when set, it replaces the standard executor call.
  produce?: () => Promise<ExecutorOutput>,
  // Founder-uploaded ground truth (RAG) relevant to this block, injected
  // into the desk prompt as fact.
  groundTruth?: string
): Promise<boolean> {
  const block = await prisma.block.findUniqueOrThrow({ where: { id: blockId } });
  try {
    await prisma.block.update({
      where: { id: blockId },
      data: { state: "working" },
    });
    await emitter.emit({ type: "block_working", blockId });

    // Real mode streams log lines live (Shot 7); mock mode and web-grounded
    // desks replay logs with 400–700ms artificial pacing (SPEC §4.3).
    const params = JSON.parse(block.params) as Record<string, number | string>;
    const webGrounded = params.webSearch === 1 || params.webSearch === "true";
    let streamedCount = 0;
    const producer = produce
      ? produce()
      : callExecutor(
        emitter.runId,
        {
          name: block.name,
          mission: block.mission,
          domain: block.domain as never,
        },
        profile,
        inputConclusions,
        async (line) => {
          streamedCount += 1;
          await emitter.emit({ type: "block_log", blockId, line });
        },
        webGrounded,
        groundTruth
      );
    const output = await timeout(producer, config.blockTimeoutMs);

    for (const line of output.logs.slice(streamedCount)) {
      await emitter.emit({ type: "block_log", blockId, line });
      await sleep(logDelay());
    }

    const conclusions: Conclusion[] = [];
    for (const c of output.conclusions) {
      const row = await prisma.conclusion.create({
        data: {
          blockId,
          claim: c.claim,
          value: c.value,
          confidence: c.confidence,
          entities: JSON.stringify(c.entities.map((e) => e.toLowerCase())),
          sources: JSON.stringify(c.sources),
        },
      });
      conclusions.push({
        id: row.id,
        blockId,
        claim: c.claim,
        value: c.value,
        confidence: c.confidence,
        entities: c.entities.map((e) => e.toLowerCase()),
        sources: c.sources,
      });
    }

    await prisma.block.update({
      where: { id: blockId },
      data: { state: "concluded", logs: JSON.stringify(output.logs) },
    });
    await emitter.emit({ type: "block_concluded", blockId, conclusions });
    // Live token + cost counters for the top bar (SPEC §10, SPEC-V2 §2).
    await emitter.emit({
      type: "tokens_used",
      tokensUsed: await getTokensUsed(emitter.runId),
    });
    await emitter.emit({
      type: "cost_used",
      costUsd: await getCostUsd(emitter.runId),
    });
    return true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.block.update({
      where: { id: blockId },
      data: { state: "failed" },
    });
    await emitter.emit({ type: "block_failed", blockId, error });
    return false;
  }
}

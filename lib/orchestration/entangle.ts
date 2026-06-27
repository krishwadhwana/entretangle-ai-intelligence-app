import { prisma } from "../db";
import { config } from "../config";
import { executeBlock } from "../blocks";
import { callEntangler } from "../llm";
import { isOverTokenCap } from "../usage";
import { throwIfRunCancelled } from "../jobs";
import {
  addEdge,
  blockCount,
  concludedBlocks,
  setStatus,
  spawnBlock,
} from "../engine/graph";
import { converge } from "./converge";
import type { ClientProfile, Conclusion } from "../schema";
import type { RunEmitter } from "../events";

/** Mechanical verification of a shared_entity edge (SPEC §4.4). */
export function sharesEntity(
  a: { conclusions: Conclusion[] },
  b: { conclusions: Conclusion[] }
): boolean {
  const tagsA = new Set(a.conclusions.flatMap((c) => c.entities));
  return b.conclusions.some((c) => c.entities.some((e) => tagsA.has(e)));
}

/**
 * Entangle -> synthesize -> repeat until caps, then converge (SPEC §4.4-4.6).
 * Shared by fresh runs (fromLayer = 1) and forks (fromLayer = fork layer).
 */
export async function entangleAndConverge(
  emitter: RunEmitter,
  profile: ClientProfile,
  fromLayer: number
): Promise<void> {
  const runId = emitter.runId;
  let layer = fromLayer;
  let round = 1;

  while (true) {
    await throwIfRunCancelled(runId);
    if (await isOverTokenCap(runId)) {
      console.log(`[orchestrator] run ${runId}: token cap reached, converging`);
      await converge(emitter, true, profile);
      return;
    }
    const count = await blockCount(runId);
    if (layer >= config.maxLayers || count >= config.maxBlocksPerRun) break;

    await throwIfRunCancelled(runId);
    await setStatus(emitter, "running", `Entangling — round ${round}`);
    const concluded = await concludedBlocks(runId);
    if (concluded.length === 0) throw new Error("No blocks concluded");

    const byId = new Map(concluded.map((b) => [b.id, b]));
    let ent;
    try {
      ent = await callEntangler(runId, concluded, round);
    } catch (e) {
      // Entangler failure is non-fatal: converge with what we have.
      console.log(`[orchestrator] entangler failed, converging: ${e}`);
      break;
    }

    // Mechanical edge verification (SPEC §4.4). shared_entity edges must
    // actually share >=1 entity tag; contradiction/dependency accepted on the
    // entangler's word in v0, logged with reason.
    const existing = await prisma.edge.findMany({
      where: { runId, kind: "entangle" },
    });
    const seenPairs = new Set(
      existing.map((e) => [e.fromBlockId, e.toBlockId].sort().join("|"))
    );
    for (const edge of ent.edges) {
      const from = byId.get(edge.fromBlockId);
      const to = byId.get(edge.toBlockId);
      if (!from || !to || from === to) {
        console.log(
          `[orchestrator] DROPPED edge (unknown block): ${edge.fromBlockId} -> ${edge.toBlockId} ("${edge.reason}")`
        );
        continue;
      }
      const pair = [from.id, to.id].sort().join("|");
      if (seenPairs.has(pair)) {
        console.log(
          `[orchestrator] DROPPED edge (duplicate pair): ${from.name} -> ${to.name}`
        );
        continue;
      }
      if (edge.trigger === "shared_entity" && !sharesEntity(from, to)) {
        console.log(
          `[orchestrator] DROPPED hallucinated shared_entity edge: ${from.name} -> ${to.name} ("${edge.reason}") — no shared entity tag`
        );
        continue;
      }
      console.log(
        `[orchestrator] edge accepted (${edge.trigger}): ${from.name} -> ${to.name}`
      );
      seenPairs.add(pair);
      await addEdge(emitter, {
        fromBlockId: from.id,
        toBlockId: to.id,
        kind: "entangle",
        reason: edge.reason,
      });
    }

    // Synthesis blocks: only with valid inputs, clamped to remaining budget.
    const budget = config.maxBlocksPerRun - (await blockCount(runId));
    const synth = ent.synthesisBlocks
      .filter((s) => s.inputBlockIds.every((id) => byId.has(id)))
      .slice(0, Math.max(0, budget));
    if (synth.length < ent.synthesisBlocks.length) {
      console.log(
        `[orchestrator] clamped synthesis blocks ${ent.synthesisBlocks.length} -> ${synth.length} (cap/invalid inputs)`
      );
    }
    if (synth.length === 0) break;

    if (await isOverTokenCap(runId)) {
      await converge(emitter, true, profile);
      return;
    }

    const nextLayer = layer + 1;
    await setStatus(emitter, "running", `Synthesizing — layer ${nextLayer}`);
    const spawned: { id: string; inputBlockIds: string[] }[] = [];
    for (const s of synth) {
      await throwIfRunCancelled(runId);
      const id = await spawnBlock(emitter, {
        name: s.name,
        mission: s.mission,
        layer: nextLayer,
        kind: "synthesis",
        domain: s.domain ?? "synthesis",
        inputBlockIds: s.inputBlockIds,
        params: {},
      });
      for (const inputId of s.inputBlockIds) {
        await addEdge(emitter, {
          fromBlockId: inputId,
          toBlockId: id,
          kind: "feeds",
          reason: "conclusions feed synthesis",
        });
      }
      spawned.push({ id, inputBlockIds: s.inputBlockIds });
    }

    await Promise.allSettled(
      spawned.map((s) => {
        const inputConclusions = s.inputBlockIds.flatMap(
          (id) => byId.get(id)?.conclusions ?? []
        );
        return executeBlock(emitter, s.id, profile, inputConclusions);
      })
    );

    layer = nextLayer;
    round += 1;
  }

  await converge(emitter, false, profile);
}

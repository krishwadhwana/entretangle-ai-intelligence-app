import { prisma } from "./db";
import { RunEmitter } from "./events";
import { blockToWire, conclusionToWire } from "./orchestrator";
import { aggregateAudience, copyAudienceFrom } from "./audience";
import {
  encodeBlockParamsField,
  encodeStringArrayField,
  parseStringArrayField,
} from "./dbJson";
import type { BlockParams } from "./schema";

/**
 * Copy-on-write fork (SPEC Shot 6, invariant §0.3).
 *
 * Copies every block EXCEPT the fork point and everything downstream of it
 * (transitively via inputBlockIds) into a new run as already-concluded —
 * their spawn/conclude events are replayed instantly so the canvas shows
 * them immediately. The fork-point block is recreated in "spawning" state
 * with the new params; the orchestrator then re-executes only it and
 * everything downstream.
 */
export async function forkRun(
  parentRunId: string,
  forkBlockId: string,
  newParams: BlockParams
): Promise<string> {
  const parent = await prisma.run.findUniqueOrThrow({
    where: { id: parentRunId },
    include: {
      blocks: { include: { conclusions: true } },
      edges: true,
      cohorts: { include: { personas: true } },
    },
  });
  const forkBlock = parent.blocks.find((b) => b.id === forkBlockId);
  if (!forkBlock) throw new Error("fork block not found in run");

  // Downstream closure: blocks that (transitively) take the fork point as input.
  const downstream = new Set<string>([forkBlock.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of parent.blocks) {
      if (downstream.has(b.id)) continue;
      const inputs = parseStringArrayField(b.inputBlockIds, "block input ids");
      if (inputs.some((id) => downstream.has(id))) {
        downstream.add(b.id);
        grew = true;
      }
    }
  }
  const toCopy = parent.blocks.filter(
    (b) => !downstream.has(b.id) && b.state === "concluded"
  );

  const run = await prisma.run.create({
    data: {
      brief: parent.brief,
      clientProfile: parent.clientProfile,
      status: "running",
      parentRunId: parent.id,
      projectId: parent.projectId, // fork results land in the same project
    },
  });
  const emitter = await RunEmitter.create(run.id);
  await emitter.emit({
    type: "run_status",
    status: "running",
    phaseLabel: "Fork — copying upstream blocks",
  });

  // Copy blocks (and conclusions byte-identically) with fresh ids.
  const idMap = new Map<string, string>(); // old block id -> new block id
  for (const b of toCopy) {
    const inputs = parseStringArrayField(b.inputBlockIds, "block input ids");
    const row = await prisma.block.create({
      data: {
        runId: run.id,
        name: b.name,
        mission: b.mission,
        layer: b.layer,
        kind: b.kind,
        domain: b.domain,
        state: "concluded",
        inputBlockIds: encodeStringArrayField(
          inputs.map((id) => idMap.get(id) ?? id)
        ),
        params: b.params,
        logs: b.logs,
      },
    });
    idMap.set(b.id, row.id);
    const copied = [];
    for (const c of b.conclusions) {
      copied.push(
        await prisma.conclusion.create({
          data: {
            blockId: row.id,
            claim: c.claim,
            value: c.value,
            confidence: c.confidence,
            entities: c.entities,
            sources: c.sources,
          },
        })
      );
    }
    // Replay instantly: spawn + conclude in one breath.
    await emitter.emit({
      type: "block_spawned",
      block: { ...blockToWire(row), state: "spawning" },
    });
    await emitter.emit({
      type: "block_concluded",
      blockId: row.id,
      conclusions: copied.map(conclusionToWire),
    });
  }

  // Copy the simulated audience verbatim — it is upstream of every desk
  // (fork points are desks; cohorts are not forkable in v2).
  const { doneCohorts } = await copyAudienceFrom(emitter, parent.id);
  if (doneCohorts > 0) {
    await aggregateAudience(emitter);
  }

  // Recreate the fork-point block in "spawning" state with the new params.
  const forked = await prisma.block.create({
    data: {
      runId: run.id,
      name: forkBlock.name,
      mission: forkBlock.mission,
      layer: forkBlock.layer,
      kind: forkBlock.kind,
      domain: forkBlock.domain,
      state: "spawning",
      inputBlockIds: encodeStringArrayField(
        parseStringArrayField(forkBlock.inputBlockIds, "block input ids").map(
          (id) => idMap.get(id) ?? id
        )
      ),
      params: encodeBlockParamsField(newParams),
      logs: encodeStringArrayField([]),
    },
  });
  idMap.set(forkBlock.id, forked.id);
  await emitter.emit({ type: "block_spawned", block: blockToWire(forked) });

  // Copy edges whose endpoints both survived (incl. feeds into the fork
  // point) — but NOT entangle edges touching the fork point: with new params
  // that relationship may no longer hold, so re-entangle must re-derive it.
  for (const e of parent.edges) {
    const from = idMap.get(e.fromBlockId);
    const to = idMap.get(e.toBlockId);
    if (!from || !to) continue;
    if (e.kind === "entangle" && (from === forked.id || to === forked.id))
      continue;
    const row = await prisma.edge.create({
      data: {
        runId: run.id,
        fromBlockId: from,
        toBlockId: to,
        kind: e.kind,
        reason: e.reason,
      },
    });
    await emitter.emit({
      type: "edge_added",
      edge: {
        id: row.id,
        runId: run.id,
        fromBlockId: from,
        toBlockId: to,
        kind: e.kind as "entangle" | "feeds",
        reason: e.reason,
      },
    });
  }

  await prisma.run.update({
    where: { id: run.id },
    data: { forkPointBlockId: forked.id },
  });
  return run.id;
}

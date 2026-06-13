import { prisma } from "../db";
import { throwIfRunCancelled } from "../jobs";
import { blockToWire, conclusionToWire } from "../wire";
import type { RunEmitter } from "../events";
import type { Block, Edge, RunStatus } from "../schema";

export async function spawnBlock(
  emitter: RunEmitter,
  data: {
    name: string;
    mission: string;
    layer: number;
    kind: Block["kind"];
    domain: Block["domain"];
    inputBlockIds: string[];
    params: Record<string, number | string>;
  }
): Promise<string> {
  await throwIfRunCancelled(emitter.runId);
  const row = await prisma.block.create({
    data: {
      runId: emitter.runId,
      name: data.name,
      mission: data.mission,
      layer: data.layer,
      kind: data.kind,
      domain: data.domain,
      state: "spawning",
      inputBlockIds: JSON.stringify(data.inputBlockIds),
      params: JSON.stringify(data.params),
      logs: JSON.stringify([]),
    },
  });
  await emitter.emit({ type: "block_spawned", block: blockToWire(row) });
  return row.id;
}

export async function addEdge(
  emitter: RunEmitter,
  data: Omit<Edge, "id" | "runId">
): Promise<void> {
  const row = await prisma.edge.create({
    data: { runId: emitter.runId, ...data },
  });
  await emitter.emit({
    type: "edge_added",
    edge: { id: row.id, runId: emitter.runId, ...data },
  });
}

export async function setStatus(
  emitter: RunEmitter,
  status: RunStatus,
  phaseLabel: string
): Promise<void> {
  await prisma.run.update({
    where: { id: emitter.runId },
    data: { status },
  });
  await emitter.emit({ type: "run_status", status, phaseLabel });
}

export async function concludedBlocks(runId: string) {
  const rows = await prisma.block.findMany({
    where: { runId, state: "concluded" },
    include: { conclusions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    layer: r.layer,
    conclusions: r.conclusions.map(conclusionToWire),
  }));
}

export async function blockCount(runId: string): Promise<number> {
  return prisma.block.count({ where: { runId } });
}

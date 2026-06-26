"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge as FlowEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RotateCcw, Coins } from "lucide-react";
import { useRunEvents } from "./useRunEvents";
import { AgentBlockNode, type AgentBlockNodeData } from "./AgentBlockNode";
import { WorldModelNode, type WorldModelNodeData } from "./WorldModelNode";
import type { Block } from "@/lib/schema";

const nodeTypes = {
  agentBlock: AgentBlockNode,
  worldModel: WorldModelNode,
};

const ROW_HEIGHT = 280;
const COL_WIDTH = 360;
const TERMINAL_ID = "__world_model__";

type Props = {
  runId: string;
  brief: string;
  parentRunId: string | null;
  childRunIds: string[];
};

export default function RunCanvas({
  runId,
  brief,
  parentRunId,
  childRunIds,
}: Props) {
  const router = useRouter();
  const { state, replay, replaying } = useRunEvents(runId);
  const [highlightedBlocks, setHighlightedBlocks] = useState<Set<string>>(
    new Set()
  );

  const onQuery = useCallback(
    async (question: string): Promise<string> => {
      const res = await fetch(`/api/runs/${runId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(`query failed (${res.status})`);
      const { answer, citedConclusionIds } = await res.json();
      // Highlight the blocks whose conclusions the answer cites (Shot 5).
      const cited = new Set<string>(citedConclusionIds);
      const blockIds = new Set<string>();
      for (const block of Object.values(state.blocks)) {
        if (block.conclusions.some((c) => cited.has(c.id))) {
          blockIds.add(block.id);
        }
      }
      setHighlightedBlocks(blockIds);
      return answer;
    },
    [runId, state.blocks]
  );

  const onForkParam = useCallback(
    async (blockId: string, key: string, value: number | string) => {
      const block = state.blocks[blockId];
      if (!block || block.params[key] === value) return;
      if (!window.confirm(`Fork run from "${block.name}" with ${key}=${value}?`))
        return;
      const res = await fetch(`/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          params: { ...block.params, [key]: value },
        }),
      });
      if (res.ok) {
        const { runId: newRunId } = await res.json();
        router.push(`/runs/${newRunId}`);
      }
    },
    [runId, state.blocks, router]
  );

  const { nodes, edges } = useMemo(() => {
    const blocks = state.blockOrder
      .map((id) => state.blocks[id])
      .filter(Boolean) as Block[];

    // Layered layout (SPEC §7): layer = row, index within layer = column,
    // centered. Terminal node pinned bottom-center.
    const byLayer = new Map<number, Block[]>();
    for (const b of blocks) {
      byLayer.set(b.layer, [...(byLayer.get(b.layer) ?? []), b]);
    }
    const maxLayer = Math.max(1, ...Array.from(byLayer.keys()));

    const nodes: Node[] = blocks.map((block) => {
      const row = byLayer.get(block.layer)!;
      const idx = row.findIndex((b) => b.id === block.id);
      const x = (idx - (row.length - 1) / 2) * COL_WIDTH - 160;
      const y = (block.layer - 1) * ROW_HEIGHT;
      return {
        id: block.id,
        type: "agentBlock",
        position: { x, y },
        data: {
          block,
          highlighted: highlightedBlocks.has(block.id),
          forkable: block.state === "concluded",
          onForkParam,
          expanded: true,
        } satisfies AgentBlockNodeData,
      };
    });

    nodes.push({
      id: TERMINAL_ID,
      type: "worldModel",
      position: { x: -192, y: maxLayer * ROW_HEIGHT + 60 },
      data: {
        status: state.status,
        phaseLabel: state.phaseLabel,
        conclusionCount: state.worldModel?.conclusionCount ?? 0,
        blockCount: state.worldModel?.blockCount ?? 0,
        parentRunId,
        childRunIds,
        onQuery,
      } satisfies WorldModelNodeData,
    });

    const flowEdges: FlowEdge[] = state.edges.map((e) => ({
      id: e.id,
      source: e.fromBlockId,
      target: e.toBlockId,
      animated: e.kind === "entangle",
      label: e.kind === "entangle" ? e.reason : undefined,
      labelStyle: { fontSize: 10, fill: "#6366f1" },
      style:
        e.kind === "entangle"
          ? { strokeDasharray: "6 4", stroke: "#6366f1" }
          : { stroke: "#a3a3a3" },
      markerEnd:
        e.kind === "feeds"
          ? { type: MarkerType.ArrowClosed, color: "#a3a3a3" }
          : undefined,
    }));

    // Leaf blocks (no outgoing feeds edge) drain into the terminal node.
    const hasOutgoingFeed = new Set(
      state.edges.filter((e) => e.kind === "feeds").map((e) => e.fromBlockId)
    );
    for (const block of blocks) {
      if (block.state === "concluded" && !hasOutgoingFeed.has(block.id)) {
        flowEdges.push({
          id: `terminal-${block.id}`,
          source: block.id,
          target: TERMINAL_ID,
          style: { stroke: "#e5e5e5" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#e5e5e5" },
        });
      }
    }

    return { nodes, edges: flowEdges };
  }, [
    state,
    highlightedBlocks,
    onForkParam,
    onQuery,
    parentRunId,
    childRunIds,
  ]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-neutral-200 px-4 py-2.5">
        <a href="/" className="text-sm font-semibold tracking-tight">
          Agent Canvas
        </a>
        <p
          className="min-w-0 max-w-xl flex-1 truncate text-xs text-neutral-500"
          title={brief}
        >
          {brief}
        </p>
        <span className="rounded-full border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
          {replaying ? "Replaying…" : state.phaseLabel}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          <Coins className="h-3.5 w-3.5" />
          {state.tokensUsed.toLocaleString()} tok
        </span>
        <button
          onClick={replay}
          disabled={replaying}
          className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-indigo-400 disabled:opacity-40"
          title="Replay the run from the event log"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </header>

      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background color="#f5f5f5" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

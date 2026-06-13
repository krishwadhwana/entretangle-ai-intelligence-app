"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge as FlowEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AgentBlockNode, type AgentBlockNodeData } from "./AgentBlockNode";
import { WorldModelNode, type WorldModelNodeData } from "./WorldModelNode";
import { SEGMENT_COLORS } from "./segments";
import type { Block } from "@/lib/schema";
import type { CanvasState } from "./useRunEvents";

const nodeTypes = {
  agentBlock: AgentBlockNode,
  worldModel: WorldModelNode,
};

const ROW_HEIGHT = 280;
const COL_WIDTH = 360;
const TERMINAL_ID = "__world_model__";

type Props = {
  state: CanvasState;
  highlightedBlocks: Set<string>;
  parentRunId: string | null;
  childRunIds: string[];
  onQuery: (q: string) => Promise<string>;
  onForkParam: (blockId: string, key: string, value: number | string) => void;
  onSelectCohort: (cohortId: string) => void;
};

/**
 * The Network layer (SPEC-V2 §5): the audience (locality clusters +
 * platforms) feeding the desk graph by layers, draining into the world
 * model. Desks keep the v1 AgentBlockNode (incl. fork sliders).
 */
export default function NetworkView({
  state,
  highlightedBlocks,
  parentRunId,
  childRunIds,
  onQuery,
  onForkParam,
  onSelectCohort,
}: Props) {
  const { nodes, edges } = useMemo(() => {
    const blocks = state.blockOrder
      .map((id) => state.blocks[id])
      .filter(Boolean) as Block[];

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
          forkable: block.state === "concluded" && block.kind === "research",
          onForkParam,
        } satisfies AgentBlockNodeData,
      };
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

    // --- Audience network row above layer 1: locality clusters + platforms ---
    const cohorts = state.cohortOrder
      .map((id) => state.cohorts[id])
      .filter(Boolean);
    const byLocality = new Map<string, typeof cohorts>();
    for (const c of cohorts) {
      byLocality.set(c.locality, [...(byLocality.get(c.locality) ?? []), c]);
    }
    const audienceBlock = blocks.find((b) => b.kind === "audience");
    const localities = Array.from(byLocality.entries());
    localities.forEach(([name, cs], i) => {
      const personaCount = cs.reduce((s, c) => s + c.personas.length, 0);
      const id = `loc:${name}`;
      const segs = Array.from(new Set(cs.map((c) => c.segment)));
      nodes.push({
        id,
        position: {
          x: (i - (localities.length - 1) / 2) * 230 - 80,
          y: -ROW_HEIGHT,
        },
        data: {
          label: `${name} — ${personaCount.toLocaleString()} personas (${cs.length} cohorts)`,
        },
        style: {
          fontSize: 11,
          borderRadius: 12,
          border: `2px solid ${SEGMENT_COLORS[segs[0]] ?? "#6366f1"}`,
          padding: 8,
          width: 200,
          cursor: "pointer",
        },
      });
      if (audienceBlock) {
        flowEdges.push({
          id: `loc-edge:${name}`,
          source: id,
          target: audienceBlock.id,
          style: { stroke: "#c7d2fe", strokeDasharray: "3 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#c7d2fe" },
        });
      }
    });

    const platforms = (state.aggregate?.platformShare ?? []).slice(0, 6);
    platforms.forEach((p, i) => {
      const id = `plat:${p.name}`;
      nodes.push({
        id,
        position: {
          x: (i - (platforms.length - 1) / 2) * 170 - 60,
          y: -ROW_HEIGHT * 1.7,
        },
        data: { label: `${p.name} ${p.share}%` },
        style: {
          fontSize: 10,
          borderRadius: 999,
          border: "1px solid #d4d4d4",
          background: "#fafafa",
          padding: 6,
          width: 140,
        },
      });
      // connect platforms to the locality clusters (audience uses them)
      localities.forEach(([name]) => {
        flowEdges.push({
          id: `plat-edge:${p.name}:${name}`,
          source: id,
          target: `loc:${name}`,
          style: { stroke: "#ececec" },
        });
      });
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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        if (node.id.startsWith("loc:")) {
          const locality = node.id.slice(4);
          const cohort = Object.values(state.cohorts).find(
            (c) => c.locality === locality && c.state === "done"
          );
          if (cohort) onSelectCohort(cohort.id);
        }
      }}
    >
      <Background color="#f5f5f5" gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

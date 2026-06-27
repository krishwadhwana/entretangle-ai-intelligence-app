"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge as FlowEdge,
  type NodeChange,
  type NodeMouseHandler,
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

// Minimum gap kept between node bounding boxes by the overlap resolver.
const NODE_GAP = 28;

type Props = {
  state: CanvasState;
  highlightedBlocks: Set<string>;
  parentRunId: string | null;
  childRunIds: string[];
  onQuery: (q: string) => Promise<string>;
  onForkParam: (blockId: string, key: string, value: number | string) => void;
  onSelectCohort: (cohortId: string) => void;
};

/** Estimated bounding box for a node, used by the overlap resolver. */
function sizeOf(node: Node): { w: number; h: number } {
  if (node.type === "worldModel") return { w: 384, h: 220 };
  if (node.type === "agentBlock") {
    return (node.data as AgentBlockNodeData)?.expanded
      ? { w: 320, h: 380 }
      : { w: 320, h: 76 };
  }
  if (node.id.startsWith("plat:")) return { w: 140, h: 48 };
  if (node.id.startsWith("loc:")) return { w: 200, h: 60 };
  return { w: 200, h: 60 };
}

/**
 * Iteratively nudge nodes apart so their (estimated) bounding boxes never
 * overlap and always keep at least NODE_GAP between them. Pushes along the
 * axis of least penetration; converges in a few passes for our node counts.
 */
function resolveOverlaps(input: Node[]): Node[] {
  const items = input.map((n) => ({ n, pos: { ...n.position }, s: sizeOf(n) }));
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const overlapX =
          Math.min(a.pos.x + a.s.w, b.pos.x + b.s.w) -
          Math.max(a.pos.x, b.pos.x) +
          NODE_GAP;
        const overlapY =
          Math.min(a.pos.y + a.s.h, b.pos.y + b.s.h) -
          Math.max(a.pos.y, b.pos.y) +
          NODE_GAP;
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const push = overlapX / 2;
          const dir = a.pos.x <= b.pos.x ? 1 : -1;
          a.pos.x -= dir * push;
          b.pos.x += dir * push;
        } else {
          const push = overlapY / 2;
          const dir = a.pos.y <= b.pos.y ? 1 : -1;
          a.pos.y -= dir * push;
          b.pos.y += dir * push;
        }
      }
    }
    if (!moved) break;
  }
  return items.map(({ n, pos }) =>
    pos.x === n.position.x && pos.y === n.position.y ? n : { ...n, position: pos }
  );
}

/**
 * The Network layer (SPEC-V2 §5): the audience (locality clusters +
 * platforms) feeding the desk graph by layers, draining into the world
 * model. Desks keep the v1 AgentBlockNode (incl. fork sliders).
 *
 * Desk nodes start collapsed and expand on click; clicking the empty canvas
 * collapses them all. Every node can be dragged freely, and the overlap
 * resolver keeps nodes from sitting on top of one another (including when
 * one expands).
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // On phones the full graph (every locality + platform fan-out) can be heavy
  // enough to exhaust the mobile browser and reload the tab. Render a lighter
  // graph there: cap locality nodes and drop the platform fan-out entirely.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // User-dragged positions, keyed by node id; survive layout recomputes.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<FlowEdge>([]);

  // Pure layout: base positions + edges, recomputed from run state.
  const layout = useMemo(() => {
    const blocks = state.blockOrder
      .map((id) => state.blocks[id])
      .filter(Boolean) as Block[];

    const byLayer = new Map<number, Block[]>();
    for (const b of blocks) {
      byLayer.set(b.layer, [...(byLayer.get(b.layer) ?? []), b]);
    }
    const maxLayer = Math.max(1, ...Array.from(byLayer.keys()));

    const layoutNodes: Node[] = blocks.map((block) => {
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
          expanded: false,
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
    let localities = Array.from(byLocality.entries());
    // On narrow screens keep only the largest localities so the graph stays
    // light enough to render on mobile.
    if (isNarrow && localities.length > 20) {
      localities = [...localities]
        .sort(
          (a, b) =>
            b[1].reduce((s, c) => s + c.personas.length, 0) -
            a[1].reduce((s, c) => s + c.personas.length, 0),
        )
        .slice(0, 20);
    }
    localities.forEach(([name, cs], i) => {
      const personaCount = cs.reduce((s, c) => s + c.personas.length, 0);
      const id = `loc:${name}`;
      const segs = Array.from(new Set(cs.map((c) => c.segment)));
      layoutNodes.push({
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

    // The platform fan-out adds platforms×localities faint edges — the biggest
    // contributor to graph weight. Skip it on mobile.
    const platforms = isNarrow
      ? []
      : (state.aggregate?.platformShare ?? []).slice(0, 6);
    platforms.forEach((p, i) => {
      const id = `plat:${p.name}`;
      layoutNodes.push({
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

    layoutNodes.push({
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

    return { nodes: layoutNodes, edges: flowEdges };
  }, [
    state,
    highlightedBlocks,
    onForkParam,
    onQuery,
    parentRunId,
    childRunIds,
    isNarrow,
  ]);

  // Merge layout with user-dragged positions + expansion state, then keep
  // nodes from overlapping. Re-runs when the run streams or expansion changes,
  // but not during an active drag (drag is handled by onNodesChange).
  useEffect(() => {
    const built = layout.nodes.map((n) => {
      const pos = positionsRef.current.get(n.id) ?? n.position;
      if (n.type !== "agentBlock") return { ...n, position: pos };
      return {
        ...n,
        position: pos,
        data: { ...(n.data as AgentBlockNodeData), expanded: expandedIds.has(n.id) },
      };
    });
    setNodes(resolveOverlaps(built));
    setEdges(layout.edges);
  }, [layout, expandedIds, setNodes, setEdges]);

  // Record drag positions so they survive the layout effect above.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          positionsRef.current.set(c.id, c.position);
        }
      }
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase]
  );

  // After a drop, separate any nodes the user dragged on top of each other.
  const onNodeDragStop = useCallback(() => {
    setNodes((nds) => resolveOverlaps(nds));
  }, [setNodes]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.id.startsWith("loc:")) {
        const locality = node.id.slice(4);
        const cohort = Object.values(state.cohorts).find(
          (c) => c.locality === locality && c.state === "done"
        );
        if (cohort) onSelectCohort(cohort.id);
        return;
      }
      if (node.type === "agentBlock") {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      }
    },
    [state.cohorts, onSelectCohort]
  );

  // Click on empty canvas collapses every expanded node.
  const onPaneClick = useCallback(() => setExpandedIds(new Set()), []);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
      >
        <Background color="#f5f5f5" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  Search,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import type { Block, Conclusion } from "@/lib/schema";
import { ValueTooltip } from "./ValueTooltip";

export type AgentBlockNodeData = {
  block: Block;
  highlighted: boolean;
  forkable: boolean;
  onForkParam: (blockId: string, key: string, value: number | string) => void;
  /** When false the node renders a compact header; click toggles it. */
  expanded: boolean;
};

export type AgentBlockNodeType = Node<AgentBlockNodeData, "agentBlock">;

function StateIndicator({ state }: { state: Block["state"] }) {
  if (state === "working")
    return (
      <span className="pulse-amber inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
    );
  if (state === "concluded")
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (state === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
  return <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />;
}

function ConclusionChip({ conclusion }: { conclusion: Conclusion }) {
  const [open, setOpen] = useState(false);
  const label = `${conclusion.claim}: ${conclusion.value}`;
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="nodrag max-w-full truncate rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-left text-[11px] leading-tight text-neutral-700 hover:border-indigo-400"
        title={label}
      >
        <span className="font-medium">{conclusion.claim}</span>
        {": "}
        {conclusion.value.length > 48
          ? conclusion.value.slice(0, 48) + "…"
          : conclusion.value}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-neutral-300 bg-white p-3 text-xs shadow-none">
          <div className="font-semibold">{conclusion.claim}</div>
          <p className="mt-1 text-neutral-700">{conclusion.value}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-neutral-500">confidence</span>
            <ValueTooltip
              content={`Confidence: ${Math.round(conclusion.confidence * 100)}%`}
            >
              <div className="h-1.5 w-24 rounded-full bg-neutral-200">
                <div
                  className="h-1.5 rounded-full bg-indigo-500"
                  style={{ width: `${Math.round(conclusion.confidence * 100)}%` }}
                />
              </div>
            </ValueTooltip>
            <span className="font-medium">
              {Math.round(conclusion.confidence * 100)}%
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {conclusion.entities.map((e) => (
              <span
                key={e}
                className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700"
              >
                {e}
              </span>
            ))}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="nodrag mt-2 text-[10px] text-neutral-400 hover:text-neutral-600"
          >
            close
          </button>
        </div>
      )}
    </div>
  );
}

function ParamsStrip({
  block,
  forkable,
  onForkParam,
}: {
  block: Block;
  forkable: boolean;
  onForkParam: AgentBlockNodeData["onForkParam"];
}) {
  const entries = Object.entries(block.params);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 border-t border-neutral-200 pt-2">
      {entries.map(([key, value]) =>
        typeof value === "number" ? (
          <label
            key={key}
            className="flex items-center gap-2 text-[10px] text-neutral-500"
          >
            <span className="w-20 truncate">{key}</span>
            <input
              type="range"
              min={0}
              max={Math.max(value * 2, 1)}
              step={value >= 1 ? 1 : 0.05}
              defaultValue={value}
              disabled={!forkable}
              onClick={(e) => e.stopPropagation()}
              onMouseUp={(e) =>
                onForkParam(block.id, key, Number(e.currentTarget.value))
              }
              className="nodrag h-1 flex-1 accent-indigo-600 disabled:opacity-40"
            />
            <span className="w-8 text-right font-medium">{value}</span>
          </label>
        ) : (
          <div
            key={key}
            className="flex items-center gap-2 text-[10px] text-neutral-500"
          >
            <span className="w-20 truncate">{key}</span>
            <span className="truncate font-medium">{value}</span>
          </div>
        )
      )}
    </div>
  );
}

function collapsedSummary(block: Block): string {
  if (block.state === "concluded") {
    const n = block.conclusions.length;
    return `${n} conclusion${n === 1 ? "" : "s"} · click to expand`;
  }
  if (block.state === "spawning") return block.mission;
  if (block.logs.length > 0) return block.logs[block.logs.length - 1];
  return block.state;
}

function AgentBlockNodeImpl({ data }: NodeProps<AgentBlockNodeType>) {
  const { block, highlighted, forkable, onForkParam, expanded } = data;
  const isSynthesis = block.layer > 1;

  const border =
    block.state === "working"
      ? "border-l-4 border-l-amber-400 border-neutral-300"
      : block.state === "failed"
        ? "border-l-4 border-l-red-500 border-neutral-300"
        : isSynthesis
          ? "border-indigo-300"
          : "border-neutral-300";

  return (
    <div
      className={`w-80 rounded-xl border bg-white p-3 ${border} ${
        highlighted ? "ring-2 ring-indigo-500" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2">
        {isSynthesis ? (
          <Sparkles className="h-4 w-4 text-indigo-600" />
        ) : (
          <Search className="h-4 w-4 text-neutral-500" />
        )}
        <span className="flex-1 truncate text-sm font-semibold">
          {block.name}
        </span>
        <StateIndicator state={block.state} />
      </div>

      {!expanded && (
        <p className="mt-1 truncate text-[11px] text-neutral-400">
          {collapsedSummary(block)}
        </p>
      )}

      {expanded && block.state !== "concluded" && block.logs.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {block.logs.slice(-3).map((line, i) => (
            <p
              key={`${block.logs.length}-${i}`}
              className="log-line truncate font-mono text-[11px] text-neutral-500"
            >
              {line}
            </p>
          ))}
        </div>
      )}

      {expanded && block.state === "spawning" && block.logs.length === 0 && (
        <p className="mt-2 truncate text-[11px] italic text-neutral-400">
          {block.mission}
        </p>
      )}

      {expanded && block.conclusions.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {block.conclusions.map((c) => (
            <ConclusionChip key={c.id} conclusion={c} />
          ))}
        </div>
      )}

      {expanded && block.state === "concluded" && (
        <ParamsStrip
          block={block}
          forkable={forkable}
          onForkParam={onForkParam}
        />
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-400"
      />
    </div>
  );
}

export const AgentBlockNode = memo(AgentBlockNodeImpl);

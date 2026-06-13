"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Globe, CornerDownLeft, GitBranch, Loader2 } from "lucide-react";
import type { RunStatus } from "@/lib/schema";

export type WorldModelNodeData = {
  status: RunStatus | "connecting";
  phaseLabel: string;
  conclusionCount: number;
  blockCount: number;
  parentRunId: string | null;
  childRunIds: string[];
  onQuery: (question: string) => Promise<string>;
};

export type WorldModelNodeType = Node<WorldModelNodeData, "worldModel">;

function WorldModelNodeImpl({ data }: NodeProps<WorldModelNodeType>) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = data.status === "complete" || data.status === "capped";

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await data.onQuery(question));
    } catch (err) {
      setAnswer(
        `Query failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-96 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-white">
      <Handle type="target" position={Position.Top} className="!bg-neutral-500" />
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-indigo-400" />
        <span className="flex-1 text-sm font-semibold">World model</span>
        {data.status === "capped" && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            capped
          </span>
        )}
        {data.status === "failed" && (
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-300">
            failed
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-neutral-400">
        {ready
          ? `${data.conclusionCount} conclusions across ${data.blockCount} blocks`
          : data.phaseLabel}
      </p>

      {(data.parentRunId || data.childRunIds.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <GitBranch className="h-3 w-3 text-neutral-500" />
          {data.parentRunId && (
            <a
              href={`/runs/${data.parentRunId}`}
              className="text-indigo-400 underline-offset-2 hover:underline"
            >
              parent run
            </a>
          )}
          {data.childRunIds.map((id, i) => (
            <a
              key={id}
              href={`/runs/${id}`}
              className="text-indigo-400 underline-offset-2 hover:underline"
            >
              fork {i + 1}
            </a>
          ))}
        </div>
      )}

      {ready && (
        <form onSubmit={ask} className="mt-3">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask the world model — why that channel first?"
              className="flex-1 bg-transparent text-xs text-white placeholder-neutral-500 outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="text-neutral-400 hover:text-white disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          {answer && (
            <p className="mt-2 rounded-lg bg-neutral-800 p-2 text-xs leading-relaxed text-neutral-200">
              {answer}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export const WorldModelNode = memo(WorldModelNodeImpl);

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import RunDashboard from "@/components/RunDashboard";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: { id: string };
}) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: { id: true, brief: true, parentRunId: true, projectId: true },
  });
  if (!run) notFound();

  const children = await prisma.run.findMany({
    where: { parentRunId: run.id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  // Sibling runs in the same project — lets you hop between follow-up
  // simulations (each labelled by the focus question that drove it).
  const siblings = run.projectId
    ? await prisma.run.findMany({
        where: { projectId: run.projectId },
        select: {
          id: true,
          focusQuestion: true,
          mode: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <RunDashboard
      runId={run.id}
      projectId={run.projectId}
      brief={run.brief}
      parentRunId={run.parentRunId}
      childRunIds={children.map((c) => c.id)}
      maxCostUsd={config.maxCostUsd}
      maxTokens={config.maxTokensPerRun}
      siblingRuns={siblings.map((s) => ({
        id: s.id,
        focusQuestion: s.focusQuestion,
        mode: s.mode,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { ensureRunAccess, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import RunDashboard from "@/components/RunDashboard";
import { ClientProfileSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await ensureRunAccess(params.id, user.id);
  if (!access) notFound();

  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      brief: true,
      parentRunId: true,
      projectId: true,
      mode: true,
      targetMarket: true,
      clientProfile: true,
    },
  });
  if (!run) notFound();

  // The editable subset of this run's profile — prefills the "Test in another
  // market" form so a founder can tweak it for the destination before branching.
  const profile = (() => {
    try {
      return ClientProfileSchema.parse(JSON.parse(run.clientProfile));
    } catch {
      return null;
    }
  })();
  const exportProfileDefaults = {
    targetAudience: profile?.targetAudience ?? "",
    priceBand: profile?.priceBand ?? "",
    priceMin: profile?.priceMin ?? null,
    priceMax: profile?.priceMax ?? null,
    targetMarginPct: profile?.targetMarginPct ?? null,
  };

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
          brief: true,
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
      mode={run.mode}
      targetMarket={run.targetMarket}
      exportProfileDefaults={exportProfileDefaults}
      childRunIds={children.map((c) => c.id)}
      maxCostUsd={config.maxCostUsd}
      maxTokens={config.maxTokensPerRun}
      siblingRuns={siblings.map((s) => ({
        id: s.id,
        brief: s.brief,
        focusQuestion: s.focusQuestion,
        mode: s.mode,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  );
}

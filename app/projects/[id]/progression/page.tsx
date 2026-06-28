import { notFound, redirect } from "next/navigation";
import { ensureProjectAccess, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ProgressionPanel from "@/components/ProgressionPanel";

export const dynamic = "force-dynamic";

export default async function ProgressionPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await ensureProjectAccess(params.id, user.id);
  if (!access) notFound();

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { name: true },
  });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <ProgressionPanel projectId={params.id} projectName={project.name} />
    </main>
  );
}

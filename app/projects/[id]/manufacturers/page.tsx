import { notFound, redirect } from "next/navigation";
import { ensureProjectAccess, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ManufacturerTable from "@/components/ManufacturerTable";

export const dynamic = "force-dynamic";

export default async function ManufacturersPage({
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
    <main className="mx-auto max-w-6xl px-4 py-8">
      <ManufacturerTable projectId={params.id} projectName={project.name} />
    </main>
  );
}

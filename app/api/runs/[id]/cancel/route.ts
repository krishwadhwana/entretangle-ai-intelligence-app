import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestRunCancellation } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = await prisma.run.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const result = await requestRunCancellation(params.id);
  return NextResponse.json({ ok: true, ...result }, { status: 202 });
}

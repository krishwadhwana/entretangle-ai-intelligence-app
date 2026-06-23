import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ companies: [] });

  try {
    const companies = await prisma.company.findMany({
      where: {
        OR: [
          { canonicalName: { contains: q, mode: "insensitive" } },
          { legalName: { contains: q, mode: "insensitive" } },
          { website: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        canonicalName: true,
        country: true,
        website: true,
        sector: true,
        description: true,
        sourceRecords: {
          orderBy: { retrievedAt: "desc" },
          take: 2,
          select: { source: true, sourceType: true, url: true },
        },
      },
      take: 10,
    });

    return NextResponse.json({
      companies: companies.map((company) => ({
        id: company.id,
        name: company.canonicalName,
        country: company.country,
        website: company.website,
        sector: company.sector,
        description: company.description,
        sources: company.sourceRecords,
      })),
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2021"
    ) {
      return NextResponse.json({ companies: [] });
    }
    throw error;
  }
}

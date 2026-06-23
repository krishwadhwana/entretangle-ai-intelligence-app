import { prisma } from "./db";
import type { FounderStoryPromptEvidence } from "./founderStory";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 7000);
}

function founderNames(story: Record<string, unknown>): string[] {
  return Array.isArray(story.founders)
    ? story.founders
        .map((item) => {
          const obj = asObject(item);
          return stringValue(obj.name) || stringValue(item);
        })
        .filter(Boolean)
    : [];
}

export async function companyIntelEvidence(opts: {
  companyIds?: string[];
  companyNames?: string[];
}): Promise<FounderStoryPromptEvidence[]> {
  const ids = (opts.companyIds ?? []).map((id) => id.trim()).filter(Boolean);
  const names = (opts.companyNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  if (!ids.length && !names.length) return [];

  const companies = await prisma.company
    .findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...names.map((name) => ({
            canonicalName: { contains: name, mode: "insensitive" as const },
          })),
        ],
      },
      include: {
        profiles: { orderBy: { asOf: "desc" }, take: 3 },
        sourceRecords: { orderBy: { retrievedAt: "desc" }, take: 5 },
      },
      take: 12,
    })
    .catch((error) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2021"
      ) {
        return [];
      }
      throw error;
    });

  return companies.flatMap((company) => {
    const story = asObject(company.story);
    const founders = founderNames(story);
    const categories = stringArray(story.categories);
    const sources = Array.from(
      new Set([
        ...company.profiles.flatMap((profile) => stringArray(profile.sources)),
        ...company.sourceRecords.map((record) => record.url).filter(Boolean),
      ])
    );
    const text = compactText([
      `Company: ${company.canonicalName}`,
      company.legalName ? `Legal name: ${company.legalName}` : "",
      company.website ? `Website: ${company.website}` : "",
      company.country ? `Country: ${company.country}` : "",
      company.sector ? `Sector/category: ${company.sector}` : "",
      company.description ? `Description: ${company.description}` : "",
      founders.length ? `Founders: ${founders.join(", ")}` : "",
      categories.length ? `Categories: ${categories.join(", ")}` : "",
      stringValue(story.foundedOn)
        ? `Founded on: ${stringValue(story.foundedOn)}`
        : "",
      stringValue(story.operatingStatus)
        ? `Operating status: ${stringValue(story.operatingStatus)}`
        : "",
      stringValue(story.employeeRange)
        ? `Employee range: ${stringValue(story.employeeRange)}`
        : "",
      ...company.profiles.map((profile) =>
        compactText([
          profile.title ?? "",
          profile.summary ? `Profile summary: ${profile.summary}` : "",
        ])
      ),
    ]);
    if (text.length < 30) return [];
    return [
      {
        id: `company-intel-${company.id}`,
        sourceType: "other" as const,
        title: `Company intel: ${company.canonicalName}`,
        url: sources[0] ?? null,
        text,
      },
    ];
  });
}

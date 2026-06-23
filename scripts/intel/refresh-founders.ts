import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import {
  collectCrunchbaseOrganization,
  hasCrunchbaseKey,
  type CrunchbaseOrganizationPayload,
} from "./crunchbase";

type Args = {
  dryRun: boolean;
  companies: string[];
};

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const prefix = `${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function parseArgs(argv: string[]): Args {
  const companies =
    argValue(argv, "--companies")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return {
    dryRun: argv.includes("--dry-run"),
    companies,
  };
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function persistOrganization(
  payload: CrunchbaseOrganizationPayload
): Promise<{ companyId: string; founders: number; stories: number }> {
  const company = await prisma.company.upsert({
    where: { crunchbasePermalink: payload.organization.permalink },
    update: compact({
      canonicalName: payload.organization.name,
      website: payload.organization.website,
      crunchbaseUuid: payload.organization.uuid,
      description: payload.organization.shortDescription ?? "",
      story: json({
        foundedOn: payload.organization.foundedOn,
        categories: payload.organization.categories,
        shortDescription: payload.organization.shortDescription,
      }),
    }),
    create: compact({
      canonicalName: payload.organization.name,
      legalName: payload.organization.name,
      website: payload.organization.website,
      crunchbaseUuid: payload.organization.uuid,
      crunchbasePermalink: payload.organization.permalink,
      description: payload.organization.shortDescription ?? "",
      story: json({
        foundedOn: payload.organization.foundedOn,
        categories: payload.organization.categories,
        shortDescription: payload.organization.shortDescription,
      }),
    }),
  });

  await prisma.companyProfileSnapshot.upsert({
    where: {
      fingerprint: `crunchbase-org:${payload.organization.permalink}`,
    },
    update: compact({
      companyId: company.id,
      title: `${payload.organization.name} Crunchbase profile`,
      summary: payload.organization.shortDescription ?? "",
      raw: json(payload.organization.raw),
      sources: json(payload.sourceRecords.map((s) => s.url)),
    }),
    create: {
      companyId: company.id,
      source: "crunchbase-api",
      fingerprint: `crunchbase-org:${payload.organization.permalink}`,
      title: `${payload.organization.name} Crunchbase profile`,
      summary: payload.organization.shortDescription ?? "",
      raw: json(payload.organization.raw),
      sources: json(payload.sourceRecords.map((s) => s.url)),
    },
  });

  for (const source of payload.sourceRecords) {
    await prisma.sourceRecord.upsert({
      where: { fingerprint: source.fingerprint },
      update: compact({
        companyId: company.id,
        retrievedAt: new Date(),
        rawMeta: source.rawMeta ? json(source.rawMeta) : undefined,
      }),
      create: compact({
        companyId: company.id,
        source: source.source,
        sourceType: source.sourceType,
        url: source.url,
        fingerprint: source.fingerprint,
        rawMeta: source.rawMeta ? json(source.rawMeta) : undefined,
      }),
    });
  }

  const founderByPermalink = new Map<string, string>();
  for (const founder of payload.founders) {
    const where = founder.permalink
      ? { crunchbasePermalink: founder.permalink }
      : founder.uuid
        ? { crunchbaseUuid: founder.uuid }
        : undefined;
    const saved = where
      ? await prisma.founder.upsert({
          where,
          update: compact({
            fullName: founder.name,
            linkedin: founder.linkedin,
            website: founder.website,
            bio: founder.bio ?? "",
          }),
          create: compact({
            fullName: founder.name,
            crunchbaseUuid: founder.uuid,
            crunchbasePermalink: founder.permalink,
            linkedin: founder.linkedin,
            website: founder.website,
            bio: founder.bio ?? "",
          }),
        })
      : await prisma.founder.create({
          data: compact({
            fullName: founder.name,
            linkedin: founder.linkedin,
            website: founder.website,
            bio: founder.bio ?? "",
          }),
        });

    founderByPermalink.set(founder.permalink ?? founder.uuid ?? founder.name, saved.id);
    await prisma.founderCompanyRole.upsert({
      where: {
        founderId_companyId_role_source: {
          founderId: saved.id,
          companyId: company.id,
          role: "founder",
          source: "crunchbase-api",
        },
      },
      update: {
        raw: json(founder.raw),
      },
      create: {
        founderId: saved.id,
        companyId: company.id,
        role: "founder",
        source: "crunchbase-api",
        raw: json(founder.raw),
      },
    });
  }

  let stories = 0;
  for (const story of payload.storySnapshots) {
    const founderId = story.founderPermalink
      ? founderByPermalink.get(story.founderPermalink)
      : undefined;
    await prisma.founderStorySnapshot.upsert({
      where: { fingerprint: story.fingerprint },
      update: compact({
        founderId,
        companyId: company.id,
        title: story.title,
        narrative: story.narrative,
        raw: json(story.raw),
        sources: json(story.sources),
      }),
      create: compact({
        founderId,
        companyId: company.id,
        source: story.source,
        sourceType: story.sourceType,
        url: story.url,
        title: story.title,
        narrative: story.narrative,
        raw: json(story.raw),
        sources: json(story.sources),
        fingerprint: story.fingerprint,
      }),
    });
    stories++;
  }

  return {
    companyId: company.id,
    founders: payload.founders.length,
    stories,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.companies.length) {
    console.log(
      "Pass Crunchbase organization permalinks or UUIDs with --companies openai,zerodha"
    );
    return;
  }
  if (!hasCrunchbaseKey()) {
    console.log(
      "CRUNCHBASE_API_KEY is not set. Crunchbase page scraping is intentionally disabled; add the official API key to use this connector."
    );
    return;
  }

  console.log(
    `${args.dryRun ? "Dry run: " : ""}refreshing founder stories for ${args.companies.length} Crunchbase organizations`
  );
  for (const entityId of args.companies) {
    const payload = await collectCrunchbaseOrganization(entityId);
    console.log(
      `• ${payload.organization.name}: ${payload.founders.length} founders, ${payload.storySnapshots.length} story snapshots`
    );
    if (!args.dryRun) {
      const saved = await persistOrganization(payload);
      console.log(
        `  saved company=${saved.companyId} founders=${saved.founders} stories=${saved.stories}`
      );
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

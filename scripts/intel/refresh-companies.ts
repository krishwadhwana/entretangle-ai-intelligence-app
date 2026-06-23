import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import {
  collectSecCompanyIntelligence,
  resolveSecTickers,
  type CompanyIntelligencePayload,
} from "./sec";
import {
  collectCrunchbaseOrganization,
  readCrunchbaseCsvFile,
  readCrunchbaseJsonFile,
  type CrunchbaseCompanyPayload,
} from "./crunchbase";

type Args = {
  dryRun: boolean;
  tickers: string[];
  exchange?: string;
  limit: number;
  maxFilings: number;
  maxMetrics: number;
  crunchbaseOrgs: string[];
  crunchbaseJson?: string;
  crunchbaseCsv?: string;
};

type CompanyPersistencePayload = {
  company: {
    canonicalName: string;
    legalName?: string;
    country?: string;
    website?: string;
    investorWebsite?: string;
    cik?: string;
    lei?: string;
    crunchbaseUuid?: string;
    crunchbasePermalink?: string;
    sic?: string;
    sicDescription?: string;
    sector?: string;
    description?: string;
    story?: Record<string, unknown>;
  };
  listings: Array<{
    exchange: string;
    ticker: string;
    mic?: string;
    currency?: string;
    isin?: string;
  }>;
  profileSnapshot: {
    source: string;
    fingerprint: string;
    title?: string;
    summary: string;
    raw: Record<string, unknown>;
    sources: string[];
  };
  filings?: CompanyIntelligencePayload["filings"];
  metrics?: CompanyIntelligencePayload["metrics"];
  sourceRecords: Array<{
    source: string;
    sourceType: string;
    url: string;
    fingerprint: string;
    rawMeta?: Record<string, unknown>;
  }>;
};

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const prefix = `${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function parseArgs(argv: string[]): Args {
  const tickers =
    argValue(argv, "--tickers")
      ?.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) ?? [];
  return {
    dryRun: argv.includes("--dry-run"),
    tickers,
    exchange: argValue(argv, "--exchange"),
    limit: Number(argValue(argv, "--limit") ?? (tickers.length ? tickers.length : 10)),
    maxFilings: Number(argValue(argv, "--max-filings") ?? 20),
    maxMetrics: Number(argValue(argv, "--max-metrics") ?? 4),
    crunchbaseOrgs:
      argValue(argv, "--crunchbase-orgs")
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [],
    crunchbaseJson: argValue(argv, "--crunchbase-json"),
    crunchbaseCsv: argValue(argv, "--crunchbase-csv"),
  };
}

function parseDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function findExistingCompany(payload: CompanyPersistencePayload) {
  for (const source of payload.sourceRecords) {
    const record = await prisma.sourceRecord.findUnique({
      where: { fingerprint: source.fingerprint },
      select: { companyId: true },
    });
    if (record?.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: record.companyId },
        select: { id: true },
      });
      if (company) return company;
    }
  }
  if (payload.company.cik) {
    const company = await prisma.company.findUnique({
      where: { cik: payload.company.cik },
      select: { id: true },
    });
    if (company) return company;
  }
  if (payload.company.website) {
    const company = await prisma.company.findFirst({
      where: { website: payload.company.website },
      select: { id: true },
    });
    if (company) return company;
  }
  return prisma.company.findFirst({
    where: compact({
      canonicalName: payload.company.canonicalName,
      country: payload.company.country,
    }),
    select: { id: true },
  });
}

async function persistCompany(payload: CompanyPersistencePayload): Promise<{
  companyId: string;
  listings: number;
  filings: number;
  metrics: number;
}> {
  const data = compact({
    canonicalName: payload.company.canonicalName,
    legalName: payload.company.legalName,
    country: payload.company.country,
    website: payload.company.website,
    investorWebsite: payload.company.investorWebsite,
    cik: payload.company.cik,
    lei: payload.company.lei,
    crunchbaseUuid: payload.company.crunchbaseUuid,
    crunchbasePermalink: payload.company.crunchbasePermalink,
    sic: payload.company.sic,
    sicDescription: payload.company.sicDescription,
    sector: payload.company.sector,
    description: payload.company.description ?? "",
    story: payload.company.story ? json(payload.company.story) : undefined,
  });
  const existing = await findExistingCompany(payload);
  const company = existing
    ? await prisma.company.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.company.create({ data });

  const listingIds: string[] = [];
  for (const listing of payload.listings) {
    const row = await prisma.exchangeListing.upsert({
      where: {
        exchange_ticker: {
          exchange: listing.exchange,
          ticker: listing.ticker,
        },
      },
      update: compact({
        companyId: company.id,
        mic: listing.mic,
        currency: listing.currency,
        active: true,
        lastSeenAt: new Date(),
      }),
      create: compact({
        companyId: company.id,
        exchange: listing.exchange,
        ticker: listing.ticker,
        mic: listing.mic,
        currency: listing.currency,
        active: true,
      }),
    });
    listingIds.push(row.id);
  }
  const primaryListingId = listingIds[0];

  await prisma.companyProfileSnapshot.upsert({
    where: { fingerprint: payload.profileSnapshot.fingerprint },
    update: {},
    create: {
      companyId: company.id,
      source: payload.profileSnapshot.source,
      fingerprint: payload.profileSnapshot.fingerprint,
      title: payload.profileSnapshot.title,
      summary: payload.profileSnapshot.summary,
      raw: json(payload.profileSnapshot.raw),
      sources: json(payload.profileSnapshot.sources),
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

  let filings = 0;
  for (const filing of payload.filings ?? []) {
    await prisma.corporateFiling.upsert({
      where: {
        regulator_accessionNo: {
          regulator: filing.regulator,
          accessionNo: filing.accessionNo,
        },
      },
      update: compact({
        companyId: company.id,
        listingId: primaryListingId,
        formType: filing.formType,
        filingDate: parseDate(filing.filingDate) ?? new Date(),
        reportDate: parseDate(filing.reportDate),
        title: filing.title,
        url: filing.url,
        primaryDocument: filing.primaryDocument,
        raw: json(filing.raw),
      }),
      create: compact({
        companyId: company.id,
        listingId: primaryListingId,
        regulator: filing.regulator,
        formType: filing.formType,
        accessionNo: filing.accessionNo,
        filingDate: parseDate(filing.filingDate) ?? new Date(),
        reportDate: parseDate(filing.reportDate),
        title: filing.title,
        url: filing.url,
        primaryDocument: filing.primaryDocument,
        raw: json(filing.raw),
      }),
    });
    filings++;
  }

  let metrics = 0;
  for (const metric of payload.metrics ?? []) {
    await prisma.financialMetric.upsert({
      where: { fingerprint: metric.fingerprint },
      update: compact({
        companyId: company.id,
        label: metric.label,
        value: metric.value,
        filedDate: parseDate(metric.filedDate),
        endDate: parseDate(metric.endDate),
        raw: json(metric.raw),
      }),
      create: compact({
        companyId: company.id,
        source: metric.source,
        taxonomy: metric.taxonomy,
        metric: metric.metric,
        label: metric.label,
        unit: metric.unit,
        value: metric.value,
        fiscalYear: metric.fiscalYear,
        fiscalPeriod: metric.fiscalPeriod,
        form: metric.form,
        filedDate: parseDate(metric.filedDate),
        endDate: parseDate(metric.endDate),
        accessionNo: metric.accessionNo,
        frame: metric.frame,
        fingerprint: metric.fingerprint,
        raw: json(metric.raw),
      }),
    });
    metrics++;
  }

  return {
    companyId: company.id,
    listings: listingIds.length,
    filings,
    metrics,
  };
}

async function loadCrunchbasePayloads(
  args: Args
): Promise<CrunchbaseCompanyPayload[]> {
  const payloads: CrunchbaseCompanyPayload[] = [];
  for (const org of args.crunchbaseOrgs) {
    payloads.push(await collectCrunchbaseOrganization(org));
  }
  if (args.crunchbaseJson) {
    payloads.push(...(await readCrunchbaseJsonFile(args.crunchbaseJson)));
  }
  if (args.crunchbaseCsv) {
    payloads.push(...(await readCrunchbaseCsvFile(args.crunchbaseCsv)));
  }
  return payloads;
}

async function processPayload(
  payload: CompanyPersistencePayload,
  dryRun: boolean
): Promise<void> {
  console.log(
    `• ${payload.profileSnapshot.source} ${payload.company.canonicalName}: ${payload.profileSnapshot.summary || "profile snapshot"}`
  );
  if (!dryRun) {
    const saved = await persistCompany(payload);
    console.log(
      `  saved company=${saved.companyId} listings=${saved.listings} filings=${saved.filings} metrics=${saved.metrics}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hasCrunchbaseInput = Boolean(
    args.crunchbaseOrgs.length || args.crunchbaseJson || args.crunchbaseCsv
  );
  const shouldRunSec = args.tickers.length > 0 || args.exchange || !hasCrunchbaseInput;
  if (shouldRunSec && !process.env.SEC_USER_AGENT) {
    console.warn(
      "SEC_USER_AGENT is not set; using a placeholder user agent. Set SEC_USER_AGENT=\"your app name your@email\" for regular SEC use."
    );
  }

  let processed = 0;
  if (hasCrunchbaseInput) {
    const crunchbasePayloads = await loadCrunchbasePayloads(args);
    console.log(
      `${args.dryRun ? "Dry run: " : ""}refreshing ${crunchbasePayloads.length} companies from Crunchbase import/API`
    );
    for (const payload of crunchbasePayloads) {
      await processPayload(payload, args.dryRun);
      processed++;
    }
  }

  if (shouldRunSec) {
    const rows = await resolveSecTickers({
      tickers: args.tickers,
      exchange: args.tickers.length ? undefined : args.exchange,
      limit: args.limit,
    });
    if (!rows.length) {
      console.log("No SEC company rows matched the request.");
    } else {
      console.log(
        `${args.dryRun ? "Dry run: " : ""}refreshing ${rows.length} companies from SEC`
      );
      for (const row of rows) {
        const payload = await collectSecCompanyIntelligence(row, {
          maxFilings: args.maxFilings,
          maxMetricsPerMetric: args.maxMetrics,
        });
        await processPayload(payload, args.dryRun);
        processed++;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  if (processed === 0) {
    console.log("No company intelligence payloads were processed.");
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

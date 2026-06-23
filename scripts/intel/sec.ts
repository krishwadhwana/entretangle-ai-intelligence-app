import { createHash } from "node:crypto";

const SEC_COMPANY_TICKERS_EXCHANGE =
  "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions";
const SEC_COMPANY_FACTS = "https://data.sec.gov/api/xbrl/companyfacts";

type JsonObject = Record<string, unknown>;

export type SecTickerRow = {
  cik: number;
  cikPadded: string;
  name: string;
  ticker: string;
  exchange: string;
};

export type CompanyIntelligencePayload = {
  company: {
    canonicalName: string;
    legalName?: string;
    country?: string;
    website?: string;
    investorWebsite?: string;
    cik: string;
    lei?: string;
    sic?: string;
    sicDescription?: string;
    sector?: string;
    description?: string;
  };
  listings: Array<{
    exchange: string;
    ticker: string;
    mic?: string;
    currency?: string;
  }>;
  profileSnapshot: {
    source: "sec-submissions";
    fingerprint: string;
    title: string;
    summary: string;
    raw: JsonObject;
    sources: string[];
  };
  filings: Array<{
    regulator: "SEC";
    formType: string;
    accessionNo: string;
    filingDate: string;
    reportDate?: string;
    title: string;
    url: string;
    primaryDocument?: string;
    raw: JsonObject;
  }>;
  metrics: Array<{
    source: "sec-companyfacts";
    taxonomy: string;
    metric: string;
    label: string;
    unit: string;
    value: number;
    fiscalYear?: number;
    fiscalPeriod?: string;
    form?: string;
    filedDate?: string;
    endDate?: string;
    accessionNo?: string;
    frame?: string;
    fingerprint: string;
    raw: JsonObject;
  }>;
  sourceRecords: Array<{
    source: string;
    sourceType: "official_api";
    url: string;
    fingerprint: string;
    rawMeta?: JsonObject;
  }>;
};

const METRIC_TAGS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
  "CostOfRevenue",
  "CostOfGoodsAndServicesSold",
  "GrossProfit",
  "OperatingIncomeLoss",
  "NetIncomeLoss",
  "Assets",
  "Liabilities",
  "StockholdersEquity",
  "CashAndCashEquivalentsAtCarryingValue",
  "EntityCommonStockSharesOutstanding",
] as const;

function secUserAgent(): string {
  return (
    process.env.SEC_USER_AGENT?.trim() ||
    "entretangle-ai-intelligence/0.1 contact@example.com"
  );
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function padCik(cik: number | string): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

function cikNoLeadingZeros(cik: string): string {
  return String(parseInt(cik, 10));
}

async function fetchSecJson<T>(url: string, ms = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": secUserAgent(),
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function stringValue(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function numberValue(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function dateValue(v: unknown): string | undefined {
  const s = stringValue(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

export async function fetchSecExchangeUniverse(): Promise<SecTickerRow[]> {
  const data = await fetchSecJson<{
    fields?: string[];
    data?: unknown[][];
  }>(SEC_COMPANY_TICKERS_EXCHANGE);
  const fields = data.fields ?? [];
  const rows = data.data ?? [];
  const idx = (name: string) => fields.indexOf(name);
  const cikIdx = idx("cik");
  const nameIdx = idx("name");
  const tickerIdx = idx("ticker");
  const exchangeIdx = idx("exchange");

  return rows
    .map((row) => {
      const cik = numberValue(row[cikIdx]);
      const name = stringValue(row[nameIdx]);
      const ticker = stringValue(row[tickerIdx]);
      const exchange = stringValue(row[exchangeIdx]);
      if (cik == null || !name || !ticker || !exchange) return null;
      return {
        cik,
        cikPadded: padCik(cik),
        name,
        ticker,
        exchange,
      };
    })
    .filter((r): r is SecTickerRow => r != null);
}

export async function resolveSecTickers(opts: {
  tickers?: string[];
  exchange?: string;
  limit?: number;
}): Promise<SecTickerRow[]> {
  const rows = await fetchSecExchangeUniverse();
  const wanted = new Set((opts.tickers ?? []).map((t) => t.toUpperCase()));
  const exchange = opts.exchange?.toLowerCase();
  const filtered = rows.filter((row) => {
    if (wanted.size && !wanted.has(row.ticker.toUpperCase())) return false;
    if (exchange && row.exchange.toLowerCase() !== exchange) return false;
    return true;
  });
  return filtered.slice(0, opts.limit ?? filtered.length);
}

function secArchiveUrl(
  cik: string,
  accessionNo: string,
  primaryDocument?: string
): string {
  const accession = accessionNo.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros(
    cik
  )}/${accession}`;
  return primaryDocument ? `${base}/${primaryDocument}` : base;
}

function recentFilings(
  submissions: JsonObject,
  cik: string,
  maxFilings: number
): CompanyIntelligencePayload["filings"] {
  const recent = (submissions.filings as JsonObject | undefined)
    ?.recent as JsonObject | undefined;
  if (!recent) return [];
  const accessionNumbers = Array.isArray(recent.accessionNumber)
    ? recent.accessionNumber
    : [];
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : [];
  const primaryDocuments = Array.isArray(recent.primaryDocument)
    ? recent.primaryDocument
    : [];
  const descriptions = Array.isArray(recent.primaryDocDescription)
    ? recent.primaryDocDescription
    : [];

  return accessionNumbers.slice(0, maxFilings).flatMap((accn, i) => {
    const accessionNo = stringValue(accn);
    const formType = stringValue(forms[i]);
    const filingDate = dateValue(filingDates[i]);
    if (!accessionNo || !formType || !filingDate) return [];
    const primaryDocument = stringValue(primaryDocuments[i]);
    const desc = stringValue(descriptions[i]);
    return [
      {
        regulator: "SEC" as const,
        formType,
        accessionNo,
        filingDate,
        reportDate: dateValue(reportDates[i]),
        title: desc ? `${formType}: ${desc}` : formType,
        url: secArchiveUrl(cik, accessionNo, primaryDocument),
        primaryDocument,
        raw: {
          accessionNo,
          formType,
          filingDate,
          reportDate: dateValue(reportDates[i]),
          primaryDocument,
          primaryDocDescription: desc,
        },
      },
    ];
  });
}

function countryFromSubmissions(submissions: JsonObject): string | undefined {
  const addresses = submissions.addresses as JsonObject | undefined;
  const business = addresses?.business as JsonObject | undefined;
  if (business?.isForeignLocation === 1) {
    return (
      stringValue(business.country) ||
      stringValue(business.stateOrCountryDescription)
    );
  }
  return "United States";
}

function buildSummary(submissions: JsonObject): string {
  const bits = [
    stringValue(submissions.name),
    stringValue(submissions.sicDescription),
    stringValue(submissions.category),
    stringValue(submissions.fiscalYearEnd)
      ? `FY end ${stringValue(submissions.fiscalYearEnd)}`
      : undefined,
  ].filter(Boolean);
  return bits.join(" | ");
}

type CompanyFacts = {
  facts?: Record<
    string,
    Record<
      string,
      {
        label?: string;
        units?: Record<string, Array<JsonObject>>;
      }
    >
  >;
};

function metricFingerprint(cik: string, payload: {
  taxonomy: string;
  metric: string;
  unit: string;
  endDate?: string;
  fiscalYear?: number;
  fiscalPeriod?: string;
  form?: string;
  accessionNo?: string;
  value: number;
}): string {
  return hash({ cik, ...payload });
}

function extractFinancialMetrics(
  cik: string,
  facts: CompanyFacts,
  maxPerMetric: number
): CompanyIntelligencePayload["metrics"] {
  const out: CompanyIntelligencePayload["metrics"] = [];
  const factGroups = facts.facts ?? {};
  for (const [taxonomy, concepts] of Object.entries(factGroups)) {
    for (const metric of METRIC_TAGS) {
      const concept = concepts[metric];
      if (!concept?.units) continue;
      const unitEntries = Object.entries(concept.units);
      const preferred =
        unitEntries.find(([unit]) => unit === "USD") ??
        unitEntries.find(([unit]) => unit === "shares") ??
        unitEntries[0];
      if (!preferred) continue;
      const [unit, rows] = preferred;
      const cleanRows = rows
        .filter((row) => numberValue(row.val) != null)
        .sort((a, b) =>
          String(b.filed ?? "").localeCompare(String(a.filed ?? ""))
        )
        .slice(0, maxPerMetric);
      for (const row of cleanRows) {
        const value = numberValue(row.val);
        if (value == null) continue;
        const payload = {
          taxonomy,
          metric,
          label: concept.label ?? metric,
          unit,
          value,
          fiscalYear: numberValue(row.fy),
          fiscalPeriod: stringValue(row.fp),
          form: stringValue(row.form),
          filedDate: dateValue(row.filed),
          endDate: dateValue(row.end),
          accessionNo: stringValue(row.accn),
          frame: stringValue(row.frame),
        };
        out.push({
          source: "sec-companyfacts",
          ...payload,
          fingerprint: metricFingerprint(cik, payload),
          raw: row,
        });
      }
    }
  }
  return out;
}

export async function collectSecCompanyIntelligence(
  row: SecTickerRow,
  opts: { maxFilings?: number; maxMetricsPerMetric?: number } = {}
): Promise<CompanyIntelligencePayload> {
  const cik = row.cikPadded;
  const submissionsUrl = `${SEC_SUBMISSIONS}/CIK${cik}.json`;
  const factsUrl = `${SEC_COMPANY_FACTS}/CIK${cik}.json`;
  const [submissions, facts] = await Promise.all([
    fetchSecJson<JsonObject>(submissionsUrl),
    fetchSecJson<CompanyFacts>(factsUrl).catch(() => ({ facts: {} })),
  ]);
  const tickers = Array.isArray(submissions.tickers)
    ? submissions.tickers.flatMap((t) => (stringValue(t) ? [stringValue(t)!] : []))
    : [row.ticker];
  const exchanges = Array.isArray(submissions.exchanges)
    ? submissions.exchanges.flatMap((e) =>
        stringValue(e) ? [stringValue(e)!] : []
      )
    : [row.exchange];
  const latestAccession = (
    (submissions.filings as JsonObject | undefined)?.recent as
      | JsonObject
      | undefined
  )?.accessionNumber;
  const latest =
    Array.isArray(latestAccession) && latestAccession.length
      ? stringValue(latestAccession[0])
      : undefined;
  const profileRaw = {
    cik,
    entityType: submissions.entityType,
    sic: submissions.sic,
    sicDescription: submissions.sicDescription,
    ownerOrg: submissions.ownerOrg,
    category: submissions.category,
    fiscalYearEnd: submissions.fiscalYearEnd,
    stateOfIncorporation: submissions.stateOfIncorporation,
    stateOfIncorporationDescription: submissions.stateOfIncorporationDescription,
    addresses: submissions.addresses,
    formerNames: submissions.formerNames,
    tickers,
    exchanges,
    latestAccession: latest,
  };

  return {
    company: {
      canonicalName: stringValue(submissions.name) ?? row.name,
      legalName: stringValue(submissions.name) ?? row.name,
      country: countryFromSubmissions(submissions),
      website: stringValue(submissions.website),
      investorWebsite: stringValue(submissions.investorWebsite),
      cik,
      lei: stringValue(submissions.lei),
      sic: stringValue(submissions.sic),
      sicDescription: stringValue(submissions.sicDescription),
      sector: stringValue(submissions.ownerOrg),
      description: stringValue(submissions.description) ?? "",
    },
    listings: tickers.map((ticker, i) => ({
      exchange: exchanges[i] ?? row.exchange,
      ticker,
      currency: "USD",
    })),
    profileSnapshot: {
      source: "sec-submissions",
      fingerprint: hash({ source: "sec-submissions", cik, latest, profileRaw }),
      title: `${stringValue(submissions.name) ?? row.name} SEC profile`,
      summary: buildSummary(submissions),
      raw: profileRaw,
      sources: [submissionsUrl],
    },
    filings: recentFilings(submissions, cik, opts.maxFilings ?? 20),
    metrics: extractFinancialMetrics(
      cik,
      facts,
      opts.maxMetricsPerMetric ?? 4
    ),
    sourceRecords: [
      {
        source: "SEC submissions",
        sourceType: "official_api",
        url: submissionsUrl,
        fingerprint: hash({ source: "SEC submissions", cik, latest }),
        rawMeta: { cik, latestAccession: latest },
      },
      {
        source: "SEC companyfacts",
        sourceType: "official_api",
        url: factsUrl,
        fingerprint: hash({ source: "SEC companyfacts", cik }),
        rawMeta: { cik, metricTags: METRIC_TAGS },
      },
    ],
  };
}

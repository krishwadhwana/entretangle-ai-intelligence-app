import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const CRUNCHBASE_BASE = "https://api.crunchbase.com/v4/data";

type JsonObject = Record<string, unknown>;

export type CrunchbaseFounder = {
  name: string;
  uuid?: string;
  permalink?: string;
  linkedin?: string;
  website?: string;
  bio?: string;
  raw: JsonObject;
};

export type CrunchbaseOrganizationPayload = {
  company: {
    canonicalName: string;
    legalName?: string;
    website?: string;
    crunchbaseUuid?: string;
    crunchbasePermalink: string;
    description?: string;
    story?: Record<string, unknown>;
  };
  listings: [];
  profileSnapshot: {
    source: "crunchbase-api";
    fingerprint: string;
    title: string;
    summary: string;
    raw: JsonObject;
    sources: string[];
  };
  filings: [];
  metrics: [];
  organization: {
    name: string;
    uuid?: string;
    permalink: string;
    website?: string;
    foundedOn?: string;
    shortDescription?: string;
    categories: string[];
    raw: JsonObject;
  };
  founders: CrunchbaseFounder[];
  storySnapshots: Array<{
    founderPermalink?: string;
    title: string;
    narrative: string;
    source: "crunchbase-api";
    sourceType: "licensed_api";
    url: string;
    sources: string[];
    fingerprint: string;
    raw: JsonObject;
  }>;
  sourceRecords: Array<{
    source: string;
    sourceType: "licensed_api";
    url: string;
    fingerprint: string;
    rawMeta?: JsonObject;
  }>;
};

export type CrunchbaseCompanyPayload = CrunchbaseOrganizationPayload;

function crunchbaseKey(): string | null {
  return process.env.CRUNCHBASE_API_KEY?.trim() || null;
}

export function hasCrunchbaseKey(): boolean {
  return crunchbaseKey() != null;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "string"
  ) {
    return stringValue((value as { value?: unknown }).value);
  }
  return undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function identifier(value: unknown): {
  name?: string;
  uuid?: string;
  permalink?: string;
} {
  const obj = objectValue(value);
  if (!obj) return {};
  return {
    name: stringValue(obj.value) ?? stringValue(obj.name),
    uuid: stringValue(obj.uuid),
    permalink: stringValue(obj.permalink),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const s = stringValue(value);
    if (s) return s;
  }
  return undefined;
}

function entityProperties(entity: JsonObject): JsonObject {
  const data = objectValue(entity.data);
  return objectValue(entity.properties) ?? objectValue(data?.properties) ?? {};
}

function entityCards(entity: JsonObject): JsonObject {
  const data = objectValue(entity.data);
  return objectValue(entity.cards) ?? objectValue(data?.cards) ?? {};
}

function cardItems(cards: JsonObject, cardId: string): JsonObject[] {
  const card = cards[cardId];
  if (Array.isArray(card)) {
    return card.reduce<JsonObject[]>((acc, x) => {
      const obj = objectValue(x);
      if (obj) acc.push(obj);
      return acc;
    }, []);
  }
  const obj = objectValue(card);
  if (!obj) return [];
  const items = obj.items ?? obj.data ?? obj.entities ?? obj.values;
  return arrayValue(items).reduce<JsonObject[]>((acc, x) => {
    const item = objectValue(x);
    if (item) acc.push(item);
    return acc;
  }, []);
}

async function fetchCrunchbaseJson<T>(url: string, ms = 25000): Promise<T> {
  const key = crunchbaseKey();
  if (!key) {
    throw new Error("CRUNCHBASE_API_KEY is not set");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "X-cb-user-key": key,
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function organizationUrl(entityId: string): string {
  const params = new URLSearchParams({
    card_ids: "founders,raised_funding_rounds",
    field_ids:
      "identifier,categories,short_description,rank_org_company,founded_on,website,linkedin,created_at",
  });
  return `${CRUNCHBASE_BASE}/entities/organizations/${encodeURIComponent(
    entityId
  )}?${params.toString()}`;
}

function personUrl(entityId: string): string {
  const params = new URLSearchParams({
    field_ids: "identifier,description,short_description,linkedin,website,created_at",
  });
  return `${CRUNCHBASE_BASE}/entities/people/${encodeURIComponent(
    entityId
  )}?${params.toString()}`;
}

function categoryNames(value: unknown): string[] {
  return arrayValue(value)
    .map((item) => {
      const id = identifier(item);
      return id.name ?? stringValue(item);
    })
    .filter((x): x is string => Boolean(x));
}

function founderFromCard(item: JsonObject): CrunchbaseFounder | null {
  const props = objectValue(item.properties) ?? item;
  const id = identifier(
    props.identifier ??
      props.person_identifier ??
      props.founder_identifier ??
      item.identifier
  );
  const name =
    id.name ??
    firstString(props.name, props.full_name, props.person_name, item.name);
  if (!name) return null;
  return {
    name,
    uuid: id.uuid,
    permalink: id.permalink,
    linkedin: firstString(props.linkedin, props.linkedin_url),
    website: firstString(props.website, props.website_url),
    bio: firstString(props.description, props.short_description),
    raw: item,
  };
}

async function enrichFounder(founder: CrunchbaseFounder): Promise<CrunchbaseFounder> {
  const entityId = founder.permalink ?? founder.uuid;
  if (!entityId) return founder;
  try {
    const entity = await fetchCrunchbaseJson<JsonObject>(personUrl(entityId));
    const props = entityProperties(entity);
    const id = identifier(props.identifier ?? entity.identifier);
    return {
      ...founder,
      uuid: founder.uuid ?? id.uuid,
      permalink: founder.permalink ?? id.permalink,
      linkedin: founder.linkedin ?? firstString(props.linkedin, props.linkedin_url),
      website: founder.website ?? firstString(props.website, props.website_url),
      bio:
        founder.bio ??
        firstString(props.description, props.short_description, props.bio),
      raw: { card: founder.raw, person: entity },
    };
  } catch {
    return founder;
  }
}

function storyForFounder(
  org: CrunchbaseOrganizationPayload["organization"],
  founder: CrunchbaseFounder,
  orgUrl: string
): CrunchbaseOrganizationPayload["storySnapshots"][number] {
  const narrativeParts = [
    founder.bio,
    org.shortDescription
      ? `${founder.name} is listed as a founder of ${org.name}, described by Crunchbase as: ${org.shortDescription}`
      : `${founder.name} is listed as a founder of ${org.name}.`,
    org.foundedOn ? `${org.name} founded on: ${org.foundedOn}.` : undefined,
    org.categories.length ? `Categories: ${org.categories.join(", ")}.` : undefined,
  ].filter(Boolean);
  const raw = { organization: org.raw, founder: founder.raw };
  return {
    founderPermalink: founder.permalink,
    title: `${founder.name} - ${org.name} founder story`,
    narrative: narrativeParts.join("\n"),
    source: "crunchbase-api",
    sourceType: "licensed_api",
    url: orgUrl,
    sources: [orgUrl],
    fingerprint: hash({
      source: "crunchbase-api",
      org: org.permalink,
      founder: founder.permalink ?? founder.uuid ?? founder.name,
      raw,
    }),
    raw,
  };
}

export async function collectCrunchbaseOrganization(
  entityId: string
): Promise<CrunchbaseOrganizationPayload> {
  const url = organizationUrl(entityId);
  const entity = await fetchCrunchbaseJson<JsonObject>(url);
  const props = entityProperties(entity);
  const cards = entityCards(entity);
  const orgId = identifier(props.identifier ?? entity.identifier);
  const name = orgId.name ?? firstString(props.name, props.legal_name) ?? entityId;
  const permalink = orgId.permalink ?? entityId;
  const organization = {
    name,
    uuid: orgId.uuid,
    permalink,
    website: firstString(props.website, props.website_url),
    foundedOn: firstString(props.founded_on),
    shortDescription: firstString(props.short_description, props.description),
    categories: categoryNames(props.categories),
    raw: entity,
  };
  const profileFingerprint = `crunchbase-org:${permalink}`;
  const founders = (
    await Promise.all(
      cardItems(cards, "founders")
        .flatMap((item) => founderFromCard(item) ?? [])
        .map((founder) => enrichFounder(founder))
    )
  ).filter((f, i, all) => {
    const key = f.permalink ?? f.uuid ?? f.name;
    return all.findIndex((x) => (x.permalink ?? x.uuid ?? x.name) === key) === i;
  });

  return {
    company: {
      canonicalName: organization.name,
      legalName: organization.name,
      website: organization.website,
      crunchbaseUuid: organization.uuid,
      crunchbasePermalink: organization.permalink,
      description: organization.shortDescription ?? "",
      story: {
        foundedOn: organization.foundedOn,
        categories: organization.categories,
        shortDescription: organization.shortDescription,
      },
    },
    listings: [],
    profileSnapshot: {
      source: "crunchbase-api",
      fingerprint: profileFingerprint,
      title: `${organization.name} Crunchbase profile`,
      summary: organization.shortDescription ?? "",
      raw: organization.raw,
      sources: [url],
    },
    filings: [],
    metrics: [],
    organization,
    founders,
    storySnapshots: founders.map((founder) =>
      storyForFounder(organization, founder, url)
    ),
    sourceRecords: [
      {
        source: "Crunchbase organization entity lookup",
        sourceType: "licensed_api",
        url,
        fingerprint: hash({ source: "crunchbase-org", entityId, permalink }),
        rawMeta: {
          entityId,
          permalink,
          fieldIds: [
            "identifier",
            "categories",
            "short_description",
            "rank_org_company",
            "founded_on",
            "website",
            "linkedin",
            "created_at",
          ],
          cardIds: ["founders", "raised_funding_rounds"],
        },
      },
    ],
  };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

function filePayloadFromRecord(
  record: JsonObject,
  sourceUrl: string,
  fallbackId: string
): CrunchbaseCompanyPayload {
  const permalink =
    firstString(record.permalink, record.crunchbasePermalink, record.identifier) ??
    fallbackId;
  const name =
    firstString(record.name, record.company_name, record.organization_name) ??
    permalink;
  const uuid = firstString(record.uuid, record.crunchbaseUuid);
  const website = firstString(record.website, record.website_url, record.homepage_url);
  const description = firstString(
    record.short_description,
    record.description,
    record.company_description
  );
  const foundedOn = firstString(record.founded_on, record.foundedOn);
  const categories = Array.isArray(record.categories)
    ? record.categories.flatMap((c) => (stringValue(c) ? [stringValue(c)!] : []))
    : firstString(record.categories)
      ?.split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const raw = record;
  const organization = {
    name,
    uuid,
    permalink,
    website,
    foundedOn,
    shortDescription: description,
    categories,
    raw,
  };
  const fingerprint = `crunchbase-file:${hash({ sourceUrl, permalink, raw })}`;
  return {
    company: {
      canonicalName: name,
      legalName: name,
      website,
      crunchbaseUuid: uuid,
      crunchbasePermalink: permalink,
      description: description ?? "",
      story: { foundedOn, categories, shortDescription: description },
    },
    listings: [],
    profileSnapshot: {
      source: "crunchbase-api",
      fingerprint,
      title: `${name} Crunchbase import`,
      summary: description ?? "",
      raw,
      sources: [sourceUrl],
    },
    filings: [],
    metrics: [],
    organization,
    founders: [],
    storySnapshots: [],
    sourceRecords: [
      {
        source: "Crunchbase permitted import",
        sourceType: "licensed_api",
        url: sourceUrl,
        fingerprint,
        rawMeta: { permalink, uuid },
      },
    ],
  };
}

export async function readCrunchbaseJsonFile(
  path: string
): Promise<CrunchbaseCompanyPayload[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const records = Array.isArray(raw) ? raw : [raw];
  return records.flatMap((record, i) => {
    const obj = objectValue(record);
    return obj ? [filePayloadFromRecord(obj, path, `record-${i + 1}`)] : [];
  });
}

export async function readCrunchbaseCsvFile(
  path: string
): Promise<CrunchbaseCompanyPayload[]> {
  const rows = csvRows(await readFile(path, "utf8"));
  const [headers, ...data] = rows;
  if (!headers?.length) return [];
  return data.map((row, i) => {
    const obj = Object.fromEntries(
      headers.map((h, idx) => [h.trim(), row[idx]?.trim() ?? ""])
    );
    return filePayloadFromRecord(obj, path, `row-${i + 1}`);
  });
}

// ---------------------------------------------------------------------------
// Salesforce connector (CRM). Standard Salesforce OAuth2 web-server flow: the
// user approves on Salesforce, we store the per-org token (encrypted) and a
// refresh token. The live sync derives the org's instance host from the OpenID
// userinfo endpoint, then runs SOQL over Opportunities + Leads → daily revenue,
// conversions (closed-won deals) and new_customers (leads created).
//
// Currently "coming soon" — registered + fully wired, but not in the AVAILABLE
// set, so the UI shows it as not-yet-connectable. To turn it on: create a
// Connected App in Salesforce, set SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET
// (and SALESFORCE_LOGIN_URL=test.salesforce.com for a sandbox), add this
// callback URL to the Connected App, then add "salesforce" to AVAILABLE in
// registry.ts. See docs/integrations-setup.md.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type {
  AuthorizeArgs,
  Connector,
  ExternalAccount,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl, postTokenForm } from "./oauth";
import { genSeries } from "../mock";

const API_VERSION = "v60.0";

function sf() {
  return config.integrations.salesforce;
}

function authBase() {
  return sf().loginUrl.replace(/\/+$/, "");
}

// OpenID userinfo → the org id + the org's instance host (taken from the REST
// URL Salesforce returns). The access token works against the login host here,
// so this is safe to call before we know the instance.
type UserInfo = {
  organization_id?: string;
  preferred_username?: string;
  name?: string;
  urls?: Record<string, string>;
};
async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${authBase()}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Salesforce userinfo failed (HTTP ${res.status})`);
  return (await res.json()) as UserInfo;
}

// Derive the instance origin (e.g. https://acme.my.salesforce.com) from any of
// the templated URLs userinfo returns.
function instanceFromUserInfo(info: UserInfo): string | null {
  const sample = info.urls?.rest || info.urls?.query || info.urls?.sobjects;
  if (!sample) return null;
  try {
    return new URL(sample).origin;
  } catch {
    return null;
  }
}

async function soqlQuery<T>(
  instanceUrl: string,
  accessToken: string,
  soql: string,
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  for (let page = 0; page < 50 && next; page++) {
    const res: Response = await fetch(`${instanceUrl}${next}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Salesforce SOQL failed (HTTP ${res.status})`);
    const body = (await res.json()) as {
      records?: T[];
      nextRecordsUrl?: string | null;
    };
    out.push(...(body.records ?? []));
    next = body.nextRecordsUrl ?? null;
  }
  return out;
}

const day = (iso: string) => iso.slice(0, 10);

export const salesforceConnector: Connector = {
  provider: "salesforce",
  category: "crm",
  label: "Salesforce",
  authType: "oauth2",
  // `api` to query records, `refresh_token`/`offline_access` for a refresh token.
  scopes: ["api", "refresh_token", "offline_access"],
  metrics: ["revenue", "conversions", "new_customers"],

  isConfigured() {
    return Boolean(sf().clientId && sf().clientSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl(`${authBase()}/services/oauth2/authorize`, {
      response_type: "code",
      client_id: sf().clientId,
      redirect_uri: args.redirectUri,
      scope: (this.scopes ?? []).join(" "),
      state: args.state,
    });
  },

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    return postTokenForm(`${authBase()}/services/oauth2/token`, {
      grant_type: "authorization_code",
      code,
      client_id: sf().clientId,
      client_secret: sf().clientSecret,
      redirect_uri: redirectUri,
    });
  },

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    const token = await postTokenForm(`${authBase()}/services/oauth2/token`, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: sf().clientId,
      client_secret: sf().clientSecret,
    });
    // Salesforce omits the refresh token on refresh — keep reusing the old one.
    return { ...token, refreshToken: token.refreshToken ?? refreshToken };
  },

  async listExternalAccounts(token: TokenSet): Promise<ExternalAccount[]> {
    const info = await fetchUserInfo(token.accessToken).catch(() => null);
    if (!info?.organization_id) return [];
    const instanceUrl = instanceFromUserInfo(info);
    return [
      {
        id: info.organization_id,
        name: info.name ? `${info.name} — Salesforce` : "Salesforce org",
        metadata: instanceUrl ? { instanceUrl } : undefined,
      },
    ];
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    if (!ctx.accessToken) throw new Error("Salesforce integration missing token");

    // Prefer the instance host saved at connect; fall back to userinfo.
    let instanceUrl = (ctx.metadata.instanceUrl as string | undefined) || null;
    if (!instanceUrl) {
      const info = await fetchUserInfo(ctx.accessToken);
      instanceUrl = instanceFromUserInfo(info);
    }
    if (!instanceUrl) throw new Error("Salesforce instance URL unavailable");

    const sinceDate = day(ctx.since.toISOString());
    const untilDate = day(ctx.until.toISOString());
    const sinceTs = ctx.since.toISOString().replace(/\.\d+Z$/, "Z");
    const untilTs = ctx.until.toISOString().replace(/\.\d+Z$/, "Z");

    // Closed-won opportunities → revenue + conversions, bucketed by close date.
    const opps = await soqlQuery<{ CloseDate: string; Amount: number | null }>(
      instanceUrl,
      ctx.accessToken,
      `SELECT CloseDate, Amount FROM Opportunity WHERE IsWon = true ` +
        `AND CloseDate >= ${sinceDate} AND CloseDate <= ${untilDate}`,
    );
    const byDayRevenue = new Map<string, number>();
    const byDayWon = new Map<string, number>();
    for (const o of opps) {
      const d = day(o.CloseDate);
      byDayRevenue.set(d, (byDayRevenue.get(d) ?? 0) + (o.Amount ?? 0));
      byDayWon.set(d, (byDayWon.get(d) ?? 0) + 1);
    }

    // New leads → new_customers, bucketed by created date.
    const leads = await soqlQuery<{ CreatedDate: string }>(
      instanceUrl,
      ctx.accessToken,
      `SELECT CreatedDate FROM Lead WHERE CreatedDate >= ${sinceTs} AND CreatedDate <= ${untilTs}`,
    );
    const byDayLeads = new Map<string, number>();
    for (const l of leads) {
      const d = day(l.CreatedDate);
      byDayLeads.set(d, (byDayLeads.get(d) ?? 0) + 1);
    }

    const out: NormalizedMetric[] = [];
    for (const [date, value] of byDayRevenue) out.push({ metric: "revenue", date, value });
    for (const [date, value] of byDayWon) out.push({ metric: "conversions", date, value });
    for (const [date, value] of byDayLeads) out.push({ metric: "new_customers", date, value });
    return out;
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "revenue", base: 4200, growth: 0.008, noise: 0.3, currency: "USD" }),
      ...genSeries(ctx, { metric: "conversions", base: 8, growth: 0.006, noise: 0.4 }),
      ...genSeries(ctx, { metric: "new_customers", base: 34, growth: 0.007, noise: 0.3 }),
    ];
  },
};

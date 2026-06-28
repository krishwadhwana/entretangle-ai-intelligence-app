// ---------------------------------------------------------------------------
// QuickBooks Online connector. Intuit OAuth2. Pulls the P&L report for the
// window → revenue and COGS, which make the financials module / investor kit
// auditable against the founder's actual books. The `realmId` (company id) is
// returned on the OAuth callback and stored as externalAccountId.
// ---------------------------------------------------------------------------
import { config } from "../../config";
import type {
  AuthorizeArgs,
  Connector,
  NormalizedMetric,
  SyncContext,
  TokenSet,
} from "../types";
import { buildAuthorizeUrl, postTokenForm } from "./oauth";
import { genSeries } from "../mock";

const TOKEN_ENDPOINT =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// Production base; sandbox is https://sandbox-quickbooks.api.intuit.com
const API_BASE = "https://quickbooks.api.intuit.com";

function basicAuth(): string {
  const c = config.integrations.quickbooks;
  return Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
}

export const quickbooksConnector: Connector = {
  provider: "quickbooks",
  category: "accounting",
  label: "QuickBooks",
  authType: "oauth2",
  scopes: ["com.intuit.quickbooks.accounting"],
  metrics: ["revenue", "cogs"],

  isConfigured() {
    const c = config.integrations.quickbooks;
    return Boolean(c.clientId && c.clientSecret);
  },

  authorizeUrl(args: AuthorizeArgs): string {
    return buildAuthorizeUrl("https://appcenter.intuit.com/connect/oauth2", {
      client_id: config.integrations.quickbooks.clientId,
      response_type: "code",
      scope: (this.scopes ?? []).join(" "),
      redirect_uri: args.redirectUri,
      state: args.state,
    });
  },

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    return postTokenForm(
      TOKEN_ENDPOINT,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      },
      { Authorization: `Basic ${basicAuth()}` },
    );
  },

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    return postTokenForm(
      TOKEN_ENDPOINT,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { Authorization: `Basic ${basicAuth()}` },
    );
  },

  async sync(ctx: SyncContext): Promise<NormalizedMetric[]> {
    const realmId = ctx.externalAccountId;
    if (!ctx.accessToken || !realmId) {
      throw new Error("QuickBooks integration missing token or realm id");
    }
    // Monthly P&L summary across the window.
    const url =
      `${API_BASE}/v3/company/${realmId}/reports/ProfitAndLoss?` +
      `start_date=${ctx.since.toISOString().slice(0, 10)}` +
      `&end_date=${ctx.until.toISOString().slice(0, 10)}` +
      `&summarize_column_by=Month`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`QuickBooks P&L failed (HTTP ${res.status})`);
    const report = (await res.json()) as QboReport;
    return parsePnl(report, ctx);
  },

  mockSync(ctx: SyncContext): NormalizedMetric[] {
    return [
      ...genSeries(ctx, { metric: "revenue", base: 3000, growth: 0.005, noise: 0.15, currency: "USD" }),
      ...genSeries(ctx, { metric: "cogs", base: 1250, growth: 0.005, noise: 0.15, currency: "USD" }),
    ];
  },
};

type QboReportRow = {
  group?: string;
  Summary?: { ColData: { value: string }[] };
  Rows?: { Row: QboReportRow[] };
};
type QboReport = {
  Columns?: { Column: { ColTitle: string; MetaData?: { Name: string; Value: string }[] }[] };
  Rows?: { Row: QboReportRow[] };
};

/** Walk the P&L report tree for Income and COGS group totals per month column. */
export function parsePnl(report: QboReport, ctx: SyncContext): NormalizedMetric[] {
  // Column titles carry the period end dates; map index → date string.
  const cols = report.Columns?.Column ?? [];
  const colDates = cols.map((c) => {
    const end = c.MetaData?.find((m) => m.Name === "EndDate")?.Value;
    return end || c.ColTitle || "";
  });
  const out: NormalizedMetric[] = [];
  const emit = (metric: "revenue" | "cogs", row?: QboReportRow) => {
    const vals = row?.Summary?.ColData;
    if (!vals) return;
    vals.forEach((cell, i) => {
      const date = colDates[i];
      const num = Number(cell.value);
      if (date && Number.isFinite(num) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        out.push({ metric, date, value: num, currency: "USD" });
      }
    });
  };
  for (const row of report.Rows?.Row ?? []) {
    if (row.group === "Income") emit("revenue", row);
    if (row.group === "COGS") emit("cogs", row);
  }
  void ctx;
  return out;
}

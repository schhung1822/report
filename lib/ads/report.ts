/**
 * Meta ads report built from the Ads MCP. Two layers, like the Pancake side: thin fetchers that talk to the MCP and
 * normalize its rows, and a pure `assembleAdsReport` that turns rows into the report (so it can be tested without a
 * network).
 */
import { listDays } from "@/lib/pancake/dates";
import type { AdsAccountLabel, AdsChannel } from "./labels";
import { AdsError, AdsSession } from "./mcp-client";
import { additiveFromMcp, MCP_METRIC_NAMES, sumAdditive, toMetrics } from "./metrics";
import type { AdsAccount, AdsReport, AdsReportRequest, AdsRow } from "./types";

/** How many campaigns the report lists; the rest are only counted. */
const TOP_CAMPAIGNS = 30;
/** Pages of 200 rows read per query, so a wrong filter can never loop for ever. */
const MAX_PAGES = 12;
const PAGE_SIZE = 200;
/** Meta spend below this (in the account's currency) is noise, not a campaign that ran. */
const MIN_CAMPAIGN_SPEND = 0.01;

type RawAccount = { account_id?: string; name?: string; currency?: string; timezone?: string; status?: string; platform?: string };
type RawAccountsPage = { accounts?: RawAccount[]; has_more?: boolean; next_cursor?: string | null };
type RawRow = {
  account_id?: string;
  currency?: string;
  date?: string;
  campaign_id?: string;
  campaign_name?: string;
  metrics?: Record<string, unknown>;
};
type RawReportPage = { rows?: RawRow[]; has_more?: boolean; next_cursor?: string | null; warnings?: string[]; errors?: unknown[] };

export async function listAdAccounts(session: AdsSession): Promise<AdsAccount[]> {
  const accounts: AdsAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await session.callTool<RawAccountsPage>("ads_list_accounts", { platform: "meta", limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    for (const raw of response.accounts ?? []) {
      if (!raw.account_id) continue;
      accounts.push({
        id: raw.account_id,
        name: raw.name?.trim() || raw.account_id,
        currency: (raw.currency ?? "").toUpperCase(),
        timezone: raw.timezone ?? "",
        status: raw.status ?? "unknown",
      });
    }
    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }
  return accounts;
}

// MCP notices that are true for every call and would only add noise to the report
const NOISE = /chưa chốt|DELETED|cắt bớt để vừa giới hạn|next_cursor/;

/** Reads every page of one `ads_get_report` query and returns its rows plus the MCP's own warnings. */
async function readReport(session: AdsSession, args: Record<string, unknown>, { limit = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const rows: RawRow[] = [];
  const warnings: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await session.callTool<RawReportPage>("ads_get_report", { ...args, limit, ...(cursor ? { cursor } : {}) });
    rows.push(...(response.rows ?? []));
    warnings.push(...(response.warnings ?? []));
    if (response.errors?.length) warnings.push(`Ads MCP báo lỗi ở một số tài khoản: ${JSON.stringify(response.errors).slice(0, 300)}`);
    if (!response.has_more || !response.next_cursor) return { rows, warnings, complete: true };
    cursor = response.next_cursor;
  }
  return { rows, warnings, complete: false };
}

function normalizeRow(raw: RawRow): AdsRow | null {
  if (!raw.account_id) return null;
  return {
    accountId: raw.account_id,
    currency: (raw.currency ?? "").toUpperCase(),
    date: raw.date,
    campaignId: raw.campaign_id,
    campaignName: raw.campaign_name,
    additive: additiveFromMcp(raw.metrics),
  };
}

const metricArgs = { metrics: [...MCP_METRIC_NAMES] };
// campaigns are read with the figures the table shows, to keep each response small
const CAMPAIGN_METRICS = ["spend", "impressions", "clicks", "purchases", "conversion_value", "messages"];
const CAMPAIGN_PAGE_SIZE = 40;

/** Day-by-day rows of the given accounts (one per account and day that has activity). */
export async function fetchDailyRows(session: AdsSession, accountIds: string[], from: string, to: string) {
  const { rows, warnings, complete } = await readReport(session, {
    platforms: ["meta"],
    account_ids: accountIds,
    level: "account",
    granularity: "day",
    date_from: from,
    date_to: to,
    ...metricArgs,
  });
  return { rows: rows.map(normalizeRow).filter((row): row is AdsRow => row !== null && Boolean(row.date)), warnings, complete };
}

/**
 * The campaigns that spent the most in the range, biggest first. Only the first page is read: it holds more than the
 * report lists, and every further page costs several seconds on the MCP. `more` says there are campaigns beyond it.
 */
export async function fetchCampaignRows(session: AdsSession, accountIds: string[], from: string, to: string) {
  const { rows, warnings, complete } = await readReport(session, {
    platforms: ["meta"],
    account_ids: accountIds,
    level: "campaign",
    granularity: "total",
    date_from: from,
    date_to: to,
    filters: { min_spend: MIN_CAMPAIGN_SPEND },
    sort_by: "spend",
    sort_dir: "desc",
    metrics: [...CAMPAIGN_METRICS],
  }, { limit: CAMPAIGN_PAGE_SIZE, maxPages: 1 });
  return { rows: rows.map(normalizeRow).filter((row): row is AdsRow => row !== null && Boolean(row.campaignId)), warnings, more: !complete };
}

export type AdsReportInput = {
  request: AdsReportRequest & { from: string; to: string };
  /** Every account the MCP lists (to name accounts and to tell their currencies apart). */
  accounts: AdsAccount[];
  dayRows: AdsRow[];
  campaignRows: AdsRow[];
  fetchedAt: string;
  /** Warnings the MCP itself returned; duplicates are dropped. */
  mcpWarnings?: string[];
  /** Set when the daily query stopped at the page limit, so the totals may be short. */
  incomplete?: boolean;
  /** Set when there are more campaigns than the page that was read. */
  moreCampaigns?: boolean;
};

/**
 * Builds the report. The report is in ONE currency (the one with the most spend among the chosen accounts), because
 * amounts of different currencies must not be added; accounts of any other currency are left out and named in the
 * warnings.
 */
export function assembleAdsReport(input: AdsReportInput): AdsReport {
  const { request, accounts, dayRows, campaignRows } = input;
  const warnings: string[] = [];
  const byId = new Map(accounts.map((account) => [account.id, account]));

  const wanted = request.accountIds?.length ? request.accountIds : accounts.map((account) => account.id);
  const known = wanted.filter((id) => byId.has(id));
  const unknown = wanted.filter((id) => !byId.has(id));
  if (unknown.length) warnings.push(`Không có quyền hoặc không tìm thấy tài khoản: ${unknown.join(", ")}.`);

  // The currency of the report: VND whenever a chosen account uses it (the reports of this app are in dong). Only
  // when there is none does the currency with the most accounts spending decide; raw amounts of two currencies are
  // never compared, since 99,999 INR is not "more" than 350 VND.
  const spendingAccounts = new Map<string, Set<string>>();
  for (const row of dayRows) {
    if (row.additive.spend > 0) spendingAccounts.set(row.currency, (spendingAccounts.get(row.currency) ?? new Set()).add(row.accountId));
  }
  const currencies = new Set(known.map((id) => (byId.get(id) as AdsAccount).currency));
  const currency =
    [...currencies].sort(
      (a, b) => Number(b === "VND") - Number(a === "VND") || (spendingAccounts.get(b)?.size ?? 0) - (spendingAccounts.get(a)?.size ?? 0),
    )[0] ?? "VND";
  const included = known.filter((id) => (byId.get(id) as AdsAccount).currency === currency);
  const left = known.filter((id) => !included.includes(id));
  if (left.length) {
    warnings.push(
      `Chỉ hiển thị tài khoản dùng ${currency}; đã bỏ ${left.length} tài khoản khác tiền tệ (${left
        .map((id) => `${(byId.get(id) as AdsAccount).name} · ${(byId.get(id) as AdsAccount).currency}`)
        .join(", ")}) vì không cộng chéo tiền tệ.`,
    );
  }
  const keep = new Set(included);

  const days = listDays(request.from, request.to);
  const dayMetrics = new Map(days.map((date) => [date, [] as AdsRow["additive"][]]));
  const accountSums = new Map(included.map((id) => [id, [] as AdsRow["additive"][]]));
  for (const row of dayRows) {
    if (!keep.has(row.accountId) || !row.date) continue;
    dayMetrics.get(row.date)?.push(row.additive);
    accountSums.get(row.accountId)?.push(row.additive);
  }

  const total = sumAdditive([...accountSums.values()].flat());
  const campaigns = campaignRows
    .filter((row) => keep.has(row.accountId) && row.additive.spend > 0)
    .sort((a, b) => b.additive.spend - a.additive.spend);

  if (total.spend === 0) warnings.push("Các tài khoản đã chọn không có chi tiêu quảng cáo trong khoảng ngày này.");
  if (input.incomplete) warnings.push("Dữ liệu quá nhiều nên bị cắt ở giới hạn số trang: tổng có thể thấp hơn thực tế. Hãy chọn khoảng ngày ngắn hơn hoặc ít tài khoản hơn.");
  warnings.push(...Array.from(new Set(input.mcpWarnings ?? [])));
  warnings.push("Ngày tính theo múi giờ của từng tài khoản; số liệu hôm nay/hôm qua chưa chốt, chuyển đổi có thể còn thay đổi tới 28 ngày.");

  return {
    range: { from: request.from, to: request.to, dayCount: days.length },
    currency,
    fetchedAt: input.fetchedAt,
    totals: toMetrics(total),
    accounts: included
      .map((id) => ({ account: byId.get(id) as AdsAccount, metrics: toMetrics(sumAdditive(accountSums.get(id) ?? [])) }))
      .sort((a, b) => b.metrics.spend - a.metrics.spend),
    days: days.map((date) => ({ date, metrics: toMetrics(sumAdditive(dayMetrics.get(date) ?? [])) })),
    campaigns: campaigns.slice(0, TOP_CAMPAIGNS).map((row) => ({
      accountId: row.accountId,
      accountName: byId.get(row.accountId)?.name ?? row.accountId,
      campaignId: row.campaignId as string,
      name: row.campaignName?.trim() || (row.campaignId as string),
      metrics: toMetrics(row.additive),
    })),
    campaignCount: input.moreCampaigns ? null : campaigns.length,
    warnings,
  };
}

/** Fetches and assembles the ads report for a range. */
export async function fetchAdsReport(request: AdsReportRequest, now = Date.now): Promise<AdsReport> {
  const session = await AdsSession.open();
  const accounts = await listAdAccounts(session);
  if (!accounts.length) throw new AdsError("Ads MCP chưa có tài khoản quảng cáo nào được cấp quyền.", 404);

  const wanted = request.accountIds?.length ? request.accountIds.filter((id) => accounts.some((account) => account.id === id)) : accounts.map((account) => account.id);
  if (!wanted.length) throw new AdsError("Không có tài khoản quảng cáo nào hợp lệ để lấy dữ liệu.", 400);

  const [daily, campaigns] = await Promise.all([
    fetchDailyRows(session, wanted, request.from, request.to),
    fetchCampaignRows(session, wanted, request.from, request.to),
  ]);
  return assembleAdsReport({
    request,
    accounts,
    dayRows: daily.rows,
    campaignRows: campaigns.rows,
    fetchedAt: new Date(now()).toISOString(),
    mcpWarnings: [...daily.warnings, ...campaigns.warnings].filter((warning) => !NOISE.test(warning)),
    incomplete: !daily.complete,
    moreCampaigns: campaigns.more,
  });
}

/** The daily spend (VND) of one labelled account. */
export type AccountSpend = {
  accountId: string;
  name: string;
  /** Vietnam labels: the sales channel the account feeds; null = not split by channel. */
  channel: AdsChannel | null;
  spendByDate: Map<string, number>;
};
export type MetaSpend = { accounts: AccountSpend[]; warnings: string[] };

/**
 * Money spent per day (in VND) by the accounts of one market's labels, one entry per account so the report can split
 * it by channel. Only VND accounts count (the reports add them to dong costs); the others are named in `warnings`.
 */
export async function fetchLabeledSpend(labels: AdsAccountLabel[], from: string, to: string): Promise<MetaSpend> {
  const warnings: string[] = [];
  if (!labels.length) return { accounts: [], warnings };
  const session = await AdsSession.open();
  const known = new Map((await listAdAccounts(session)).map((account) => [account.id, account]));

  const usable: { label: AdsAccountLabel; account: AdsAccount }[] = [];
  for (const label of labels) {
    const account = known.get(label.accountId);
    if (!account) warnings.push(`Tài khoản ${label.accountId} có nhãn nhưng Ads MCP không còn cấp quyền nên bị bỏ qua.`);
    else if (account.currency !== "VND") warnings.push(`Tài khoản ${account.name} dùng ${account.currency || "tiền tệ không rõ"}, không phải VND nên bị bỏ qua.`);
    else usable.push({ label, account });
  }
  if (!usable.length) return { accounts: [], warnings };

  const daily = await fetchDailyRows(session, usable.map((entry) => entry.account.id), from, to);
  if (!daily.complete) warnings.push("Chi phí Ads Meta bị cắt ở giới hạn số trang nên có thể thấp hơn thực tế.");
  const accounts = usable.map(({ label, account }) => {
    const spendByDate = new Map<string, number>();
    for (const row of daily.rows) {
      if (row.accountId === account.id && row.date) spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + row.additive.spend);
    }
    return { accountId: account.id, name: account.name, channel: label.channel, spendByDate };
  });
  return { accounts, warnings };
}

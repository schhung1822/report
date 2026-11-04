/** Types of the Meta ads data pulled through the Ads MCP (mcp.activate.vn). Money is in the account's own currency. */

export type AdsAccount = {
  /** "act_123…" as the MCP names it. */
  id: string;
  name: string;
  /** ISO 4217 ("VND", "INR"): amounts are never added across currencies. */
  currency: string;
  timezone: string;
  status: string;
};

/**
 * The figures that can be added up across days, campaigns and accounts. Ratios (CTR, CPC, CPM, CPA, ROAS) are not
 * stored: they are derived from these sums by `deriveRatios`, because an average of ratios is wrong.
 */
export type AdsAdditive = {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  /** Conversions the ad account counts (purchases + leads …), and the value of the purchases. */
  conversions: number;
  conversionValue: number;
  purchases: number;
  leads: number;
  /** Conversations started by messages (the main result of click-to-message ads). */
  messages: number;
  videoViews: number;
};

export type AdsRatios = {
  /** Percent. */
  ctr: number | null;
  cpc: number | null;
  /** Cost per 1,000 impressions. */
  cpm: number | null;
  /** Spend per conversion. */
  cpa: number | null;
  /** Conversion value per unit of spend. */
  roas: number | null;
  /** Spend per purchase and per message conversation. */
  costPerPurchase: number | null;
  costPerMessage: number | null;
};

export type AdsMetrics = AdsAdditive & AdsRatios;

/** One line of an ads report: an account (and a day, or a campaign) with its figures. */
export type AdsRow = {
  accountId: string;
  currency: string;
  /** "YYYY-MM-DD" in the account's time zone, on day-by-day rows. */
  date?: string;
  campaignId?: string;
  campaignName?: string;
  additive: AdsAdditive;
};

export type AdsAccountReport = { account: AdsAccount; metrics: AdsMetrics };
export type AdsDayReport = { date: string; metrics: AdsMetrics };
export type AdsCampaignReport = {
  accountId: string;
  accountName: string;
  campaignId: string;
  name: string;
  metrics: AdsMetrics;
};

export type AdsReportRequest = {
  /** First and last day, "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
  /** Accounts to read; every account the MCP allows when omitted. */
  accountIds?: string[];
};

export type AdsReport = {
  range: { from: string; to: string; dayCount: number };
  /** The one currency this report is in: the accounts of other currencies are left out (and said so in `warnings`). */
  currency: string;
  fetchedAt: string;
  totals: AdsMetrics;
  accounts: AdsAccountReport[];
  /** One entry for every day of the range (days without spend included), oldest first. */
  days: AdsDayReport[];
  /** The campaigns that spent the most, biggest first. */
  campaigns: AdsCampaignReport[];
  /** How many campaigns spent money in the range; null when there are more than were read (the list is then the top ones). */
  campaignCount: number | null;
  warnings: string[];
};

/** Longest range one ads report may cover (same as the Pancake reports). */
export const MAX_ADS_RANGE_DAYS = 93;

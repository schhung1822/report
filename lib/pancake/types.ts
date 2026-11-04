import type { DailyReportData } from "@/lib/daily-report";
import type { CumulativePerformanceRow, DailyPerformanceRow } from "@/lib/performance-report";
import type { RawDailyFinanceRow } from "@/types/finance";
import type { PosDataset } from "./dataset";
import type { ProcessedManagementReport } from "@/types/financial-management";

/** Metrics of one bucket (`result` / `success` / `returned`) of an analytics row. */
export type Bucket = Record<string, number | boolean | null | undefined>;

export type PancakeShop = { id: number; name: string; currency: string };

export type ManagementChannel = "zalo" | "page";

/** One staff member found by scanning the POS: who the shop has, and how much each sold in the scanned range. */
export type StaffScanEntry = {
  /** The name the POS reports show (the one the saved pay is matched on). */
  name: string;
  /** POS department ("SALE", "VẬN ĐƠN"…), when the POS has one for the account. */
  department: string | null;
  orders: number;
  revenue: number;
  /** Days of the range with orders or revenue: the days the pay is charged. */
  days: string[];
  /** The account exists in the POS employee list (false = only seen on orders). */
  employee: boolean;
};

export type StaffScan = {
  shop: PancakeShop;
  range: { from: string; to: string };
  fetchedAt: string;
  /** Biggest revenue first; staff without orders last. */
  staff: StaffScanEntry[];
};

/**
 * One line of the "chi phí ngoài POS" file. Which report uses it depends on the columns that are filled:
 * `staff` -> performance report, `channel` -> Vietnam management report, neither -> shop-wide (Philippines finance).
 * A missing `date` means the amount applies to every day that has POS data.
 */
export type ManualCostRow = {
  /** "YYYY-MM-DD" */
  date?: string;
  channel?: ManagementChannel;
  staff?: string;
  salarySaleCskh: number;
  salaryOther: number;
  fixedCost: number;
  otherCost: number;
  adsCost: number;
  returnProvision: number;
  /** Cost of goods sold typed in by the accountant (the Philippines POS holds none): replaces the POS figure of that day. */
  cogs?: number;
  /** Shipping paid by the shop, typed in: replaces the carrier fee of the POS for that day. */
  shippingCost?: number;
  /** Taxes, fees and charges (a business administration cost, below the selling costs). */
  taxFee?: number;
  /** The line comes from the accountant's daily sheet, which wins over the other lines of the same day and kind. */
  fromSheet?: boolean;
  /** Peso -> VND for that day (Philippines finance only). */
  exchangeRate?: number;
};

export type PancakeSyncRequest = {
  /** First and last day of the report, "YYYY-MM-DD" (inclusive, equal for a one-day report). */
  from: string;
  to: string;
  shopId?: number;
  costs?: ManualCostRow[];
  /**
   * Take the shop's ad spend from the Meta ad accounts labelled for it (lib/ads/labels.ts). On by default; false leaves
   * ads to the POS and the cost lines.
   */
  useMetaAds?: boolean;
};

/** What the labelled Meta ad accounts of a shop spent in the range (see lib/pancake/meta-ads.ts). */
export type MetaAdsSummary = {
  market: "VN" | "PH";
  /** Meta spend is read in VND; the Philippines report converts it to pesos day by day. */
  currency: "VND";
  accounts: { id: string; name: string; channel: ManagementChannel | null }[];
  /** All the accounts' spend in the range. */
  totalSpend: number;
  days: { date: string; spend: number }[];
  /** Vietnam: the spend of each channel's accounts, and of the accounts with no channel chosen. */
  byChannel: { zalo: number; page: number; unassigned: number };
  /** The part that went into the report's costs (the rest was kept as typed in, or could not be converted). */
  appliedSpend: number;
};

/** Longest range one request may cover. */
export const MAX_RANGE_DAYS = 93;

/** VND shops fill `daily`, `performance` and `vn`; PHP shops fill `phRows`. `dataset` is the normalized source of all of them. */
export type PancakeSyncResult = {
  shop: PancakeShop;
  range: { from: string; to: string; dayCount: number };
  /** "dd/mm/yyyy", or "dd/mm/yyyy – dd/mm/yyyy" for several days. */
  reportDate: string;
  fetchedAt: string;
  warnings: string[];
  dataset: PosDataset;
  daily?: DailyReportData;
  performance?: { dailyRows: DailyPerformanceRow[]; cumulativeRows: CumulativePerformanceRow[]; reportDate: string };
  vn?: ProcessedManagementReport;
  /** Daily rows of the range in the shop currency (peso for the Philippines finance report). */
  phRows?: RawDailyFinanceRow[];
  /** Ad spend from the Meta accounts labelled for this shop, when there are any. */
  metaAds?: MetaAdsSummary;
  /** The house rate applied to the Philippines report (null when none was in effect). */
  exchangeRate?: { rate: number; effectiveDate: string } | null;
  /** Set when this result is stored in (or was restored from) the report history. */
  snapshot?: { id: number; createdAt: string; restored: boolean };
};

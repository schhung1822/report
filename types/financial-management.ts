export type ManagementChannel = "zalo" | "page";
export type ManagementTrack = "estimated" | "actual";
export type HiddenStatus = "profit" | "loss" | "balanced";

export interface ProductMetric {
  name: string;
  value: number;
}

export interface RawChannelMetrics {
  revenue: number;
  cogs: number;
  returnProvision: number;
  salarySaleCskh: number;
  salaryOther: number;
  fixedCost: number;
  otherCost: number;
  adsCost: number;
  topRevenueProducts: ProductMetric[];
  topProfitProducts: ProductMetric[];
}

export interface CalculatedChannelMetrics extends RawChannelMetrics {
  totalCogs: number;
  totalSalary: number;
  totalFixedCosts: number;
  profit: number;
}

export interface ChannelMetricsSet {
  zalo: CalculatedChannelMetrics;
  page: CalculatedChannelMetrics;
  total: CalculatedChannelMetrics;
}

export interface NormalizedManagementRow {
  date: string;
  dateLabel: string;
  track: ManagementTrack;
  channel: ManagementChannel;
  metrics: RawChannelMetrics;
}

export interface CumulativeComparison {
  estimated: ChannelMetricsSet;
  actual: ChannelMetricsSet;
  revenueDifference: number;
  profitDifference: number;
  hiddenStatus: HiddenStatus;
}

export interface DailyManagementSnapshot {
  date: string;
  dateLabel: string;
  estimated: ChannelMetricsSet;
  actual: ChannelMetricsSet;
  cumulative: CumulativeComparison;
}

export interface ManagementReportSummary {
  dateFrom: string;
  dateTo: string;
  dateRangeLabel: string;
  estimated: ChannelMetricsSet;
  actual: ChannelMetricsSet;
  revenueDifference: number;
  profitDifference: number;
  hiddenStatus: HiddenStatus;
  topRevenueProducts: ProductMetric[];
  topProfitProducts: ProductMetric[];
}

export interface ProcessedManagementReport {
  sourceSheet: string;
  inputFormat: "long" | "wide";
  days: DailyManagementSnapshot[];
  summary: ManagementReportSummary;
  warnings: string[];
}

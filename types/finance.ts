export type RawNumericValue = number | string | null | undefined;
export type RawDateValue = Date | number | string;

/**
 * Expected normalized row after Step 4 maps Excel/CSV column names.
 * Monetary input is expressed in Philippine Peso (PHP).
 */
export interface RawDailyFinanceRow {
  date: RawDateValue;
  exchangeRate?: RawNumericValue;

  estimatedRevenue: RawNumericValue;
  estimatedProfit: RawNumericValue;
  actualRevenue: RawNumericValue;

  /** Falls back to actualRevenue - totalSalesCost when omitted. */
  actualProfit?: RawNumericValue;

  cogs: RawNumericValue;
  ads: RawNumericValue;
  shippingFees: RawNumericValue;
  payroll: RawNumericValue;

  /** Outsourced services (fixed costs), other selling costs and the inventory-risk provision; all optional, 0 when omitted. */
  outsourcedServices?: RawNumericValue;
  otherCost?: RawNumericValue;
  inventoryProvision?: RawNumericValue;
  /** Taxes, fees and charges: a business administration cost, taken off after the selling costs. 0 when omitted. */
  taxFee?: RawNumericValue;

  moneyInTransit?: RawNumericValue;
  unverifiedMoney?: RawNumericValue;
  pos?: RawNumericValue;
  transfer?: RawNumericValue;

  /** Accepts either Excel decimal form (0.1) or percent form (10). */
  refundRate?: RawNumericValue;
  totalOrders?: RawNumericValue;
  refundedOrders?: RawNumericValue;
}

export interface DualCurrencyAmount {
  peso: number;
  vnd: number;
}

export interface RevenueProfitPair {
  revenue: DualCurrencyAmount;
  profit: DualCurrencyAmount;
}

export interface FinancialComparison {
  estimated: RevenueProfitPair;
  actual: RevenueProfitPair;
  variance: RevenueProfitPair;
}

export interface PnLBreakdown {
  revenue: DualCurrencyAmount;
  cogs: DualCurrencyAmount;
  ads: DualCurrencyAmount;
  shippingFees: DualCurrencyAmount;
  payroll: DualCurrencyAmount;
  outsourcedServices: DualCurrencyAmount;
  otherCost: DualCurrencyAmount;
  /** Taken off the revenue before the cost of goods ("dự phòng rủi ro hàng tồn"). Not part of totalSalesCost. */
  provision: DualCurrencyAmount;
  /** Taxes, fees and charges (administration cost). Not part of totalSalesCost, but taken off the profit. */
  taxFee: DualCurrencyAmount;
  /** COGS + ads + shipping + payroll + outsourced services + other. */
  totalSalesCost: DualCurrencyAmount;
  netProfit: DualCurrencyAmount;
  adsRevenueRatio: number;
}

export interface CashflowBreakdown {
  moneyInTransit: DualCurrencyAmount;
  unverifiedMoney: DualCurrencyAmount;
  pos: DualCurrencyAmount;
  transfer: DualCurrencyAmount;
  total: DualCurrencyAmount;
}

export type RefundTrend = "down" | "up" | "flat" | "unavailable";
export type RefundStatus = "good" | "bad" | "neutral" | "unavailable";

export interface RefundPerformance {
  rate: number | null;
  previousRate: number | null;
  delta: number | null;
  trend: RefundTrend;
  status: RefundStatus;
  /** The order counts behind the rate, when the source has them (null when only a rate was given). */
  totalOrders?: number | null;
  refundedOrders?: number | null;
}

export interface ProcessedDailyFinance {
  sourceIndex: number;
  date: string;
  dateLabel: string;
  exchangeRate: number;
  comparison: FinancialComparison;
  pnl: PnLBreakdown;
  cashflow: CashflowBreakdown;
  refund: RefundPerformance;
  cumulative: FinancialComparison;
}

export interface MonthlyFinanceSummary extends FinancialComparison {
  totalSalesCost: DualCurrencyAmount;
  totalAds: DualCurrencyAmount;
  adsRevenueRatio: number;
}

export interface ProcessedMonthlyFinanceReport {
  defaultExchangeRate: number;
  exchangeRatesUsed: number[];
  days: ProcessedDailyFinance[];
  summary: MonthlyFinanceSummary;
}

export type SignedValueTone = "positive" | "negative";

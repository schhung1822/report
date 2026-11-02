import type {
  CashflowBreakdown,
  DualCurrencyAmount,
  FinancialComparison,
  MonthlyFinanceSummary,
  ProcessedDailyFinance,
  ProcessedMonthlyFinanceReport,
  RawDailyFinanceRow,
  RawDateValue,
  RawNumericValue,
  RefundPerformance,
  RevenueProfitPair,
  SignedValueTone,
} from "@/types/finance";

const MILLISECONDS_PER_DAY = 86_400_000;
const EXCEL_UNIX_EPOCH_OFFSET = 25_569;

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function hasValue(value: RawNumericValue) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function zeroCurrency(): DualCurrencyAmount {
  return { peso: 0, vnd: 0 };
}

function zeroPair(): RevenueProfitPair {
  return { revenue: zeroCurrency(), profit: zeroCurrency() };
}

function zeroComparison(): FinancialComparison {
  return {
    estimated: zeroPair(),
    actual: zeroPair(),
    variance: zeroPair(),
  };
}

export function parseFinanceNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const source = String(value ?? "").trim();
  if (!source) return 0;

  const negative = source.includes("-") || /^\(.*\)$/.test(source);
  let numeric = source.replace(/[^0-9.,]/g, "");
  const commaCount = (numeric.match(/,/g) ?? []).length;
  const dotCount = (numeric.match(/\./g) ?? []).length;

  if (commaCount && dotCount) {
    const decimalSeparator = numeric.lastIndexOf(",") > numeric.lastIndexOf(".") ? "," : ".";
    const decimalLength = numeric.length - numeric.lastIndexOf(decimalSeparator) - 1;

    if (decimalLength > 0 && decimalLength <= 2) {
      const thousandsSeparator = decimalSeparator === "," ? /\./g : /,/g;
      numeric = numeric.replace(thousandsSeparator, "").replace(decimalSeparator, ".");
    } else {
      numeric = numeric.replace(/[.,]/g, "");
    }
  } else if (commaCount || dotCount) {
    const separator = commaCount ? "," : ".";
    const separatorCount = commaCount || dotCount;
    const decimalLength = numeric.length - numeric.lastIndexOf(separator) - 1;

    numeric =
      separatorCount === 1 && decimalLength > 0 && decimalLength <= 2
        ? numeric.replace(separator, ".")
        : numeric.replace(/[.,]/g, "");
  }

  const parsed = Number(numeric || 0);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

export function assertValidExchangeRate(exchangeRate: number) {
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("Tỷ giá phải là một số lớn hơn 0.");
  }
}

export function pesoToVnd(peso: number, exchangeRate: number) {
  assertValidExchangeRate(exchangeRate);
  return Math.round(peso * exchangeRate);
}

export function toDualCurrency(peso: number, exchangeRate: number): DualCurrencyAmount {
  return {
    peso,
    vnd: pesoToVnd(peso, exchangeRate),
  };
}

export function addDualCurrency(...values: DualCurrencyAmount[]): DualCurrencyAmount {
  return values.reduce(
    (total, value) => ({
      peso: total.peso + value.peso,
      vnd: total.vnd + value.vnd,
    }),
    zeroCurrency(),
  );
}

export function subtractDualCurrency(
  actual: DualCurrencyAmount,
  estimated: DualCurrencyAmount,
): DualCurrencyAmount {
  return {
    peso: actual.peso - estimated.peso,
    vnd: actual.vnd - estimated.vnd,
  };
}

export function calculateVariance(
  actualPeso: number,
  estimatedPeso: number,
  exchangeRate: number,
): DualCurrencyAmount {
  return toDualCurrency(actualPeso - estimatedPeso, exchangeRate);
}

export function calculateRefundRate(refundedOrders: number, totalOrders: number): number | null {
  if (totalOrders <= 0) return null;
  return (refundedOrders / totalOrders) * 100;
}

export function calculateRefundPerformance(
  currentRate: number | null,
  previousRate: number | null,
): RefundPerformance {
  if (currentRate === null || previousRate === null) {
    return {
      rate: currentRate,
      previousRate,
      delta: null,
      trend: "unavailable",
      status: "unavailable",
    };
  }

  const delta = currentRate - previousRate;
  if (Math.abs(delta) < Number.EPSILON) {
    return {
      rate: currentRate,
      previousRate,
      delta: 0,
      trend: "flat",
      status: "neutral",
    };
  }

  return {
    rate: currentRate,
    previousRate,
    delta,
    trend: delta < 0 ? "down" : "up",
    status: delta < 0 ? "good" : "bad",
  };
}

export function getSignedValueTone(value: number): SignedValueTone {
  return value < 0 ? "negative" : "positive";
}

export function formatVnd(value: number) {
  return vndFormatter.format(value);
}

export function formatPeso(value: number) {
  return pesoFormatter.format(value);
}

function normalizePercentage(value: RawNumericValue): number | null {
  if (!hasValue(value)) return null;
  const parsed = parseFinanceNumber(value);
  const normalized = Math.abs(parsed) < 1 ? parsed * 100 : parsed;

  if (normalized < 0 || normalized > 100) {
    throw new Error(`Tỷ lệ hoàn không hợp lệ: ${normalized}. Giá trị phải nằm trong khoảng 0–100%.`);
  }
  return normalized;
}

function resolveRefundRate(row: RawDailyFinanceRow) {
  const explicitRate = normalizePercentage(row.refundRate);
  if (explicitRate !== null) return explicitRate;

  if (!hasValue(row.totalOrders) && !hasValue(row.refundedOrders)) return null;
  return calculateRefundRate(
    parseFinanceNumber(row.refundedOrders),
    parseFinanceNumber(row.totalOrders),
  );
}

function resolveExchangeRate(row: RawDailyFinanceRow, fallbackRate: number) {
  const exchangeRate = hasValue(row.exchangeRate)
    ? parseFinanceNumber(row.exchangeRate)
    : fallbackRate;
  assertValidExchangeRate(exchangeRate);
  return exchangeRate;
}

function createPair(
  revenuePeso: number,
  profitPeso: number,
  exchangeRate: number,
): RevenueProfitPair {
  return {
    revenue: toDualCurrency(revenuePeso, exchangeRate),
    profit: toDualCurrency(profitPeso, exchangeRate),
  };
}

function addPair(a: RevenueProfitPair, b: RevenueProfitPair): RevenueProfitPair {
  return {
    revenue: addDualCurrency(a.revenue, b.revenue),
    profit: addDualCurrency(a.profit, b.profit),
  };
}

function addComparison(
  accumulated: FinancialComparison,
  current: FinancialComparison,
): FinancialComparison {
  const estimated = addPair(accumulated.estimated, current.estimated);
  const actual = addPair(accumulated.actual, current.actual);

  return {
    estimated,
    actual,
    variance: {
      revenue: subtractDualCurrency(actual.revenue, estimated.revenue),
      profit: subtractDualCurrency(actual.profit, estimated.profit),
    },
  };
}

function createCashflow(row: RawDailyFinanceRow, exchangeRate: number): CashflowBreakdown {
  const moneyInTransit = toDualCurrency(parseFinanceNumber(row.moneyInTransit), exchangeRate);
  const unverifiedMoney = toDualCurrency(parseFinanceNumber(row.unverifiedMoney), exchangeRate);
  const pos = toDualCurrency(parseFinanceNumber(row.pos), exchangeRate);
  const transfer = toDualCurrency(parseFinanceNumber(row.transfer), exchangeRate);

  return {
    moneyInTransit,
    unverifiedMoney,
    pos,
    transfer,
    total: addDualCurrency(moneyInTransit, unverifiedMoney, pos, transfer),
  };
}

type ParsedDate = {
  iso: string;
  label: string;
};

function createDateResult(year: number, month: number, day: number): ParsedDate {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Ngày báo cáo không hợp lệ: ${day}/${month}/${year}.`);
  }

  const paddedDay = String(day).padStart(2, "0");
  const paddedMonth = String(month).padStart(2, "0");
  return {
    iso: `${year}-${paddedMonth}-${paddedDay}`,
    label: `${paddedDay}/${paddedMonth}/${year}`,
  };
}

export function parseFinanceDate(value: RawDateValue): ParsedDate {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Ngày báo cáo không hợp lệ.");
    return createDateResult(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number") {
    const excelDate = new Date(Math.round((value - EXCEL_UNIX_EPOCH_OFFSET) * MILLISECONDS_PER_DAY));
    return createDateResult(
      excelDate.getUTCFullYear(),
      excelDate.getUTCMonth() + 1,
      excelDate.getUTCDate(),
    );
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) return createDateResult(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  const vietnameseMatch = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (vietnameseMatch) {
    return createDateResult(
      Number(vietnameseMatch[3]),
      Number(vietnameseMatch[2]),
      Number(vietnameseMatch[1]),
    );
  }

  const numericSerial = Number(text);
  if (Number.isFinite(numericSerial) && numericSerial > EXCEL_UNIX_EPOCH_OFFSET) {
    return parseFinanceDate(numericSerial);
  }

  throw new Error(`Không nhận diện được ngày báo cáo: “${text}”.`);
}

function processDailyRow(
  row: RawDailyFinanceRow,
  sourceIndex: number,
  fallbackRate: number,
  previousRefundRate: number | null,
  accumulated: FinancialComparison,
): ProcessedDailyFinance {
  const parsedDate = parseFinanceDate(row.date);
  const exchangeRate = resolveExchangeRate(row, fallbackRate);
  const estimatedRevenue = parseFinanceNumber(row.estimatedRevenue);
  const estimatedProfit = parseFinanceNumber(row.estimatedProfit);
  const actualRevenue = parseFinanceNumber(row.actualRevenue);
  const cogs = parseFinanceNumber(row.cogs);
  const ads = parseFinanceNumber(row.ads);
  const shippingFees = parseFinanceNumber(row.shippingFees);
  const payroll = parseFinanceNumber(row.payroll);
  const totalSalesCostPeso = cogs + ads + shippingFees + payroll;
  const actualProfit = hasValue(row.actualProfit)
    ? parseFinanceNumber(row.actualProfit)
    : actualRevenue - totalSalesCostPeso;

  const estimated = createPair(estimatedRevenue, estimatedProfit, exchangeRate);
  const actual = createPair(actualRevenue, actualProfit, exchangeRate);
  const comparison: FinancialComparison = {
    estimated,
    actual,
    variance: {
      revenue: subtractDualCurrency(actual.revenue, estimated.revenue),
      profit: subtractDualCurrency(actual.profit, estimated.profit),
    },
  };
  const refundRate = resolveRefundRate(row);

  return {
    sourceIndex,
    date: parsedDate.iso,
    dateLabel: parsedDate.label,
    exchangeRate,
    comparison,
    pnl: {
      revenue: actual.revenue,
      cogs: toDualCurrency(cogs, exchangeRate),
      ads: toDualCurrency(ads, exchangeRate),
      shippingFees: toDualCurrency(shippingFees, exchangeRate),
      payroll: toDualCurrency(payroll, exchangeRate),
      totalSalesCost: toDualCurrency(totalSalesCostPeso, exchangeRate),
      netProfit: actual.profit,
      adsRevenueRatio: actualRevenue === 0 ? 0 : (ads / actualRevenue) * 100,
    },
    cashflow: createCashflow(row, exchangeRate),
    refund: calculateRefundPerformance(refundRate, previousRefundRate),
    cumulative: addComparison(accumulated, comparison),
  };
}

export function processMonthlyFinance(
  rows: RawDailyFinanceRow[],
  defaultExchangeRate: number,
): ProcessedMonthlyFinanceReport {
  assertValidExchangeRate(defaultExchangeRate);

  const sortedRows = rows
    .map((row, sourceIndex) => ({ row, sourceIndex, parsedDate: parseFinanceDate(row.date) }))
    .sort(
      (a, b) =>
        a.parsedDate.iso.localeCompare(b.parsedDate.iso) || a.sourceIndex - b.sourceIndex,
    );

  let accumulated = zeroComparison();
  let previousRefundRate: number | null = null;
  let totalSalesCost = zeroCurrency();
  let totalAds = zeroCurrency();
  const exchangeRates = new Set<number>();

  const days = sortedRows.map(({ row, sourceIndex }) => {
    const processed = processDailyRow(
      row,
      sourceIndex,
      defaultExchangeRate,
      previousRefundRate,
      accumulated,
    );

    accumulated = processed.cumulative;
    previousRefundRate = processed.refund.rate;
    totalSalesCost = addDualCurrency(totalSalesCost, processed.pnl.totalSalesCost);
    totalAds = addDualCurrency(totalAds, processed.pnl.ads);
    exchangeRates.add(processed.exchangeRate);
    return processed;
  });

  const summary: MonthlyFinanceSummary = {
    ...accumulated,
    totalSalesCost,
    totalAds,
    adsRevenueRatio:
      accumulated.actual.revenue.peso === 0
        ? 0
        : (totalAds.peso / accumulated.actual.revenue.peso) * 100,
  };

  return {
    defaultExchangeRate,
    exchangeRatesUsed: Array.from(exchangeRates),
    days,
    summary,
  };
}

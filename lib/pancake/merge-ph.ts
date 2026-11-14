/**
 * Adds the reports of several Philippines shops together into one. Every figure is in pesos and every shop's report is built on
 * its own (own costs, own rates), so merging is a sum per day: nothing here recomputes a cost.
 *
 * Meta ads are the one cost shared by the shops; the server books them on a single shop (phAdsShopId in sync.ts), so adding the
 * rows counts them once.
 *
 * Pure and client-safe (no server imports). A figure that only some of the shops could read (previous day, refund trend, open
 * orders) is left out of the merged report rather than shown too low.
 */
import type { RawDailyFinanceRow } from "@/types/finance";
import { round2 } from "./dataset";
import type { CumulativePoint, RefundCumulative, RefundDay, RefundPoint, RefundTrend } from "./refund";
import type { CumulativeReconciliation, StatusRow } from "./status";
import type { OpenOrders, PancakeSyncResult, PreviousDay } from "./types";

const SUMMED_FIELDS = [
  "estimatedRevenue",
  "estimatedProfit",
  "actualRevenue",
  "cogs",
  "ads",
  "shippingFees",
  "payroll",
  "outsourcedServices",
  "otherCost",
  "inventoryProvision",
  "taxFee",
  "moneyInTransit",
  "transfer",
  "totalOrders",
  "refundedOrders",
] as const;
/** Only present on a day whose shipping is the per-product rate: summed when any shop has it. */
const OPTIONAL_FIELDS = ["shippingPedPh", "shippingPh"] as const;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** One row per day: the numbers of every shop that has that day added up. The day's rate is the first one any shop gives. */
export function mergePhRows(lists: RawDailyFinanceRow[][]): RawDailyFinanceRow[] {
  const byDate = new Map<string, RawDailyFinanceRow>();
  for (const row of lists.flat()) {
    const date = String(row.date);
    const merged = byDate.get(date);
    if (!merged) {
      byDate.set(date, { ...row, date });
      continue;
    }
    for (const field of SUMMED_FIELDS) merged[field] = round2(num(merged[field]) + num(row[field]));
    for (const field of OPTIONAL_FIELDS) {
      if (merged[field] != null || row[field] != null) merged[field] = round2(num(merged[field]) + num(row[field]));
    }
    if (!num(merged.exchangeRate) && num(row.exchangeRate)) merged.exchangeRate = row.exchangeRate;
  }
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** The day before the last day, all shops added up; undefined unless every shop has the same day. */
export function mergePreviousDay(list: (PreviousDay | undefined)[]): PreviousDay | undefined {
  const [first, ...rest] = list;
  if (!first || rest.some((item) => !item || item.date !== first.date)) return undefined;
  return {
    date: first.date,
    revenue: round2(list.reduce((sum, item) => sum + (item?.revenue ?? 0), 0)),
    orders: list.reduce((sum, item) => sum + (item?.orders ?? 0), 0),
    refunded: list.reduce((sum, item) => sum + (item?.refunded ?? 0), 0),
  };
}

const addDay = (a: RefundDay, b: RefundDay): RefundDay => ({
  confirmed: round2(a.confirmed + b.confirmed),
  returned: round2(a.returned + b.returned),
  orders: a.orders + b.orders,
  refunded: a.refunded + b.refunded,
});

/** The 7-day refund figures of every shop added up day by day; undefined unless every shop has a trend. */
export function mergeRefundTrend(list: (RefundTrend | undefined)[]): RefundTrend | undefined {
  const trends = list.filter((item): item is RefundTrend => item !== undefined);
  if (!trends.length || trends.length !== list.length) return undefined;
  const byDate = new Map<string, RefundPoint>();
  for (const trend of trends) {
    for (const point of trend.daily) {
      const known = byDate.get(point.date);
      byDate.set(point.date, known ? { date: point.date, ...addDay(known, point) } : point);
    }
  }
  const cumulative = mergeCumulative(trends.map((trend) => trend.cumulative));
  return {
    daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    period: trends.map((trend) => trend.period).reduce(addDay),
    ...(cumulative ? { cumulative } : {}),
  };
}

const addPoint = (a: CumulativePoint, b: CumulativePoint): CumulativePoint => ({ ...addDay(a, b), date: a.date, revenue: round2(a.revenue + b.revenue) });

function sumSeries(series: CumulativePoint[][]) {
  const byDate = new Map<string, CumulativePoint>();
  for (const point of series.flat()) {
    const known = byDate.get(point.date);
    byDate.set(point.date, known ? addPoint(known, point) : point);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** The cumulative figures of every shop added up day by day; undefined unless every shop has them. */
function mergeCumulative(list: (RefundCumulative | undefined)[]): RefundCumulative | undefined {
  const items = list.filter((item): item is RefundCumulative => item !== undefined);
  if (!items.length || items.length !== list.length) return undefined;
  return {
    since: items.map((item) => item.since).sort()[0],
    all: sumSeries(items.map((item) => item.all)),
    month: sumSeries(items.map((item) => item.month)),
    // Only when every shop read its month the accountant's way: the sums are otherwise of two different things.
    ...(items.every((item) => item.monthBasis === "received") ? { monthBasis: "received" as const } : {}),
    ...(items.find((item) => item.legacy)?.legacy ? { legacy: items.find((item) => item.legacy)?.legacy } : {}),
  };
}

/** The money in circulation of every shop added up by status; undefined unless every shop could read it. */
export function mergeOpenOrders(list: (OpenOrders | undefined)[]): OpenOrders | undefined {
  const items = list.filter((item): item is OpenOrders => item !== undefined);
  if (!items.length || items.length !== list.length) return undefined;
  const lines = new Map<string, OpenOrders["lines"][number]>();
  for (const item of items) {
    for (const line of item.lines) {
      const known = lines.get(line.status);
      lines.set(line.status, known ? { ...known, orders: known.orders + line.orders, cod: round2(known.cod + line.cod) } : { ...line });
    }
  }
  return {
    asOf: items.map((item) => item.asOf).sort().at(-1) as string,
    lines: Array.from(lines.values()),
    orders: items.reduce((sum, item) => sum + item.orders, 0),
    cod: round2(items.reduce((sum, item) => sum + item.cod, 0)),
  };
}

/** Where the orders of every shop stand, added up by status and by day. The shops must have read the same window. */
export function mergeReconciliations(list: CumulativeReconciliation[]): CumulativeReconciliation {
  const [first] = list;
  const rows = new Map<string, StatusRow>();
  for (const item of list) {
    for (const row of item.rows) {
      const known = rows.get(row.status);
      rows.set(
        row.status,
        known
          ? {
              ...known,
              orders: known.orders + row.orders,
              amount: round2(known.amount + row.amount),
              prepaid: round2(known.prepaid + row.prepaid),
              cod: round2(known.cod + row.cod),
              counted: round2(known.counted + row.counted),
            }
          : { ...row },
      );
    }
  }
  const daily = new Map<string, { date: string; revenue: number; profit: number }>();
  for (const day of list.flatMap((item) => item.daily)) {
    const known = daily.get(day.date);
    daily.set(day.date, known ? { date: day.date, revenue: round2(known.revenue + day.revenue), profit: round2(known.profit + day.profit) } : { ...day });
  }
  const warnings = Array.from(new Set(list.flatMap((item) => item.warnings)));
  const unreconciled = list.every((item) => item.unreconciled)
    ? { orders: list.reduce((sum, item) => sum + (item.unreconciled?.orders ?? 0), 0), cod: round2(list.reduce((sum, item) => sum + (item.unreconciled?.cod ?? 0), 0)) }
    : undefined;
  if (!unreconciled && list.some((item) => item.unreconciled)) warnings.push("⚠ Một shop không đọc được thẻ đơn chưa đối soát nên dòng này bị bỏ ở báo cáo gộp.");
  const sources = list.map((item) => item.dailySource).filter((item): item is NonNullable<typeof item> => item !== undefined);
  return {
    windowDays: first.windowDays,
    from: first.from,
    to: first.to,
    fetchedAt: list.map((item) => item.fetchedAt).sort().at(-1) as string,
    includesToday: list.some((item) => item.includesToday),
    rows: Array.from(rows.values()).sort((a, b) => Number(a.status) - Number(b.status)),
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
    ...(unreconciled ? { unreconciled } : {}),
    ...(sources.length ? { dailySource: { sheet: sources.reduce((sum, item) => sum + item.sheet, 0), pos: sources.reduce((sum, item) => sum + item.pos, 0) } } : {}),
    warnings,
  };
}

/**
 * The Philippines reports that can be added together: the ones of the newest report's range (shops fetched for another range
 * would not line up day by day), in shop order. Fewer than two means there is nothing to merge.
 */
export function mergeablePhResults(results: PancakeSyncResult[]): PancakeSyncResult[] {
  const ph = results.filter((result) => result.phRows && result.shop.currency.toUpperCase() === "PHP");
  const newest = ph.reduce<PancakeSyncResult | null>((best, item) => (!best || item.fetchedAt > best.fetchedAt ? item : best), null);
  if (!newest) return [];
  return ph.filter((result) => result.range.from === newest.range.from && result.range.to === newest.range.to).sort((a, b) => a.shop.id - b.shop.id);
}

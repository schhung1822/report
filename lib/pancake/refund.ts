/**
 * Philippines shop: the refund rate as the business reads it.
 *
 *     refund rate = returned revenue / successful (confirmed) revenue, added up over the 7 most recent days up to the day
 *
 * Returns count against the day their order was created, so a single recent day always shows almost no refunds. The 7-day figure
 * is what stays meaningful, and the report uses the latest one for every day of its month (a rate of 10% on the 5th, 12% on the
 * 6th: the 6th's 12% is then used for all the days of the month). Pure: the caller gives the figures of each day.
 */
import { addDays, listDays } from "./dates";

/** One day's figures: successful and returned revenue (the shop's currency) and orders. */
export type RefundDay = { confirmed: number; returned: number; orders: number; refunded: number };

/** The figures of the `REFUND_WINDOW_DAYS` days ending on `date` (that day included). */
export type RefundPoint = RefundDay & { date: string };

/** The refund rate is worked out over this many days up to the day shown. */
export const REFUND_WINDOW_DAYS = 7;

export type RefundTrend = {
  /** One point per day from the first day shown to the report's last day; each one is the window of the days ending on it. */
  daily: RefundPoint[];
  /** The report's whole range. */
  period: RefundDay;
  /** Cumulative figures (whole history, and the month to date) of the report's last days; absent when the history could not be read. */
  cumulative?: RefundCumulative;
};

/** One day's figures plus the sales (whole value of the orders, after returns) of the day: what the cumulative cards add up. */
export type CumulativeDay = RefundDay & { revenue: number };

/** Everything from the start of the period up to and including `date`. */
export type CumulativePoint = CumulativeDay & { date: string };

/**
 * The refund rate read over a long period instead of a 7-day window. Returns count against the day their order was created, so a
 * short window is mostly orders whose returns have not arrived yet and jumps around; the whole history, and the month to date,
 * settle on what the shop really loses.
 */
export type RefundCumulative = {
  /** First day of the history the "all" figures were added up from. */
  since: string;
  /** One point per day for the last days of the report (plus the day before them), each the total from `since` up to that day. */
  all: CumulativePoint[];
  /** The same days, each the total from the 1st of its own month up to that day. */
  month: CumulativePoint[];
  /**
   * "received": `month` is read the accountant's way (receivedMonthPoint): orders created since the 1st that the customer has
   * received (status "Đã nhận"), for the last day and the day before only. Absent: `month` is every confirmed order.
   */
  monthBasis?: "received";
  /** Set when `all` includes the totals of an old shop typed in by hand (legacy-totals.ts). */
  legacy?: { label: string | null };
};

/** What the POS order list says about the received (status 3) and returned (status 5) orders created from the 1st of the month up to a day. */
export type ReceivedTotals = { orders: number; cod: number; prepaid: number };

/**
 * The month-to-date point the way the accountant's report reads it: the revenue is the whole value (COD + prepaid) of the orders the customer has received,
 * the orders are those received plus those returned (status 5, the "đơn đã nhận" the refund count is set against), and the refund rate
 * is the refunded value (returned + being returned + partly returned, taken from `point`) over the value of the received orders.
 * Statuses change, so a past day read today differs from what that day's report showed.
 */
export function receivedMonthPoint(point: CumulativePoint, received: ReceivedTotals, returned: ReceivedTotals): CumulativePoint {
  return {
    ...point,
    revenue: round2(received.cod + received.prepaid),
    confirmed: round2(received.cod + received.prepaid),
    orders: received.orders + returned.orders,
  };
}

/** How many days before the report's last day the cumulative series starts (the trend of the last week, 7 days plus the last day). */
export const CUMULATIVE_TREND_DAYS = 7;

/**
 * Statuses the statistics do not count as returned but the business does: 4 and 18 "returning" and 15 "partly returned" (status 5,
 * returned, already is in the statistics' returned figures).
 */
export const RETURNING_STATUSES = [4, 18, 15];
const PART_RETURNED = 15;

/** The fields of a POS order the returning amounts are read from. */
export type ReturningOrder = {
  inserted_at?: string | null;
  status?: number | string | null;
  total_price?: number | null;
  total_quantity?: number | null;
  items?: { quantity?: number | null; returned_count?: number | null; return_quantity?: number | null }[] | null;
};

/**
 * The refunded value of each order that is being returned, with the day it was created (returns count on that day), UTC offset in
 * hours. A returning order counts in full; a partly returned one counts for the share of its items that came back.
 */
export function returningAmounts(orders: ReturningOrder[], utcOffsetHours: number) {
  const result: { date: string; amount: number }[] = [];
  for (const order of orders) {
    const created = order.inserted_at ? Date.parse(order.inserted_at.endsWith("Z") ? order.inserted_at : `${order.inserted_at}Z`) : NaN;
    if (!Number.isFinite(created)) continue;
    let share = 1;
    if (Number(order.status) === PART_RETURNED) {
      const items = order.items ?? [];
      const sold = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity ?? 0)), 0) || Math.max(0, Number(order.total_quantity ?? 0));
      const back = items.reduce((sum, item) => sum + Math.max(0, Number(item.returned_count ?? item.return_quantity ?? 0)), 0);
      share = sold > 0 ? Math.min(1, back / sold) : 1;
    }
    result.push({ date: new Date(created + utcOffsetHours * 3_600_000).toISOString().slice(0, 10), amount: round2(Math.max(0, Number(order.total_price ?? 0)) * share) });
  }
  return result;
}

/** Returned / confirmed in per cent, or null when nothing was confirmed. */
export function refundRate(confirmed: number, returned: number) {
  return confirmed > 0 ? (Math.abs(returned) / confirmed) * 100 : null;
}

/**
 * The first day whose figures are needed: the window of the first day shown starts `REFUND_WINDOW_DAYS - 1` days earlier. The first
 * day shown is the range's first day, or the day before the last day when that falls earlier (a one-day report compares with the
 * day before).
 */
export function refundWindowStart(from: string, to: string) {
  const dayBefore = addDays(to, -1);
  return addDays(dayBefore < from ? dayBefore : from, -(REFUND_WINDOW_DAYS - 1));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * One point per day from `start` + 6 days to `to`, each the sum of the 7 days ending on it (`start` is the first day read, see
 * `refundWindowStart`); `day` gives a day's figures (missing days count as nothing).
 */
export function buildRefundTrend(start: string, from: string, to: string, day: (date: string) => RefundDay | undefined): RefundTrend {
  const daily: RefundPoint[] = [];
  const period: RefundDay = { confirmed: 0, returned: 0, orders: 0, refunded: 0 };
  const dates = listDays(start, to);
  for (const [index, date] of dates.entries()) {
    const figures = day(date);
    if (figures && date >= from) {
      period.confirmed = round2(period.confirmed + figures.confirmed);
      period.returned = round2(period.returned + Math.abs(figures.returned));
      period.orders += figures.orders;
      period.refunded += figures.refunded;
    }
    if (index < REFUND_WINDOW_DAYS - 1) continue;
    const window: RefundDay = { confirmed: 0, returned: 0, orders: 0, refunded: 0 };
    for (const earlier of dates.slice(index - (REFUND_WINDOW_DAYS - 1), index + 1)) {
      const item = day(earlier);
      if (!item) continue;
      window.confirmed = round2(window.confirmed + item.confirmed);
      window.returned = round2(window.returned + Math.abs(item.returned));
      window.orders += item.orders;
      window.refunded += item.refunded;
    }
    daily.push({ date, ...window });
  }
  return { daily, period };
}

/**
 * The cumulative series: for each of the `CUMULATIVE_TREND_DAYS` + 1 days ending on `to`, the total of every day from `since` up to
 * it (`all`) and of the days of its own month up to it (`month`). `day` gives a day's figures (missing days count as nothing).
 */
export function buildCumulative(since: string, to: string, day: (date: string) => CumulativeDay | undefined): RefundCumulative {
  const shownFrom = addDays(to, -CUMULATIVE_TREND_DAYS);
  const zero = (): CumulativeDay => ({ confirmed: 0, returned: 0, orders: 0, refunded: 0, revenue: 0 });
  const add = (total: CumulativeDay, item: CumulativeDay | undefined) => {
    if (!item) return total;
    return {
      confirmed: round2(total.confirmed + item.confirmed),
      returned: round2(total.returned + Math.abs(item.returned)),
      orders: total.orders + item.orders,
      refunded: total.refunded + item.refunded,
      revenue: round2(total.revenue + item.revenue),
    };
  };
  const all: CumulativePoint[] = [];
  const month: CumulativePoint[] = [];
  let allTotal = zero();
  let monthTotal = zero();
  for (const date of listDays(since, to)) {
    if (date.endsWith("-01")) monthTotal = zero();
    const figures = day(date);
    allTotal = add(allTotal, figures);
    monthTotal = add(monthTotal, figures);
    if (date < shownFrom) continue;
    all.push({ date, ...allTotal });
    month.push({ date, ...monthTotal });
  }
  return { since, all, month };
}

/**
 * The refund rate every day of `date`'s month is shown and provisioned with: the month-to-date rate of section IV's "Lũy kế tháng"
 * card as of the report's last day of that month (the same figures, so the two always agree). Null when the report has no such point
 * for the month (a range that starts in an earlier month has none for it) or nothing was sold yet; the caller then falls back to the
 * 7-day rate (`latestOfMonth`).
 */
export function monthToDateRate(trend: RefundTrend | undefined, date: string) {
  const month = date.slice(0, 7);
  let found: CumulativePoint | undefined;
  for (const point of trend?.cumulative?.month ?? []) if (point.date.startsWith(month) && (!found || point.date > found.date)) found = point;
  return found ? refundRate(found.confirmed, found.returned) : null;
}

/** The latest point of the month of `date` (the 7-day rate the report falls back to). */
export function latestOfMonth(trend: RefundTrend, date: string) {
  const month = date.slice(0, 7);
  let found: RefundPoint | undefined;
  for (const point of trend.daily) if (point.date.startsWith(month)) found = point;
  return found;
}

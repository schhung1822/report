/**
 * Vietnam shop: the return provision ("Dự phòng hoàn") worked out from the shop's own history instead of typed by hand.
 *
 * Returns arrive one to two weeks after an order was created and the POS counts them on the creation day, so the recent days
 * always look better than they will end up. The estimated figures of a day therefore carry a provision for the returns still to
 * come:
 *
 *     provision of a day = revenue of the day x refund rate of the orders created 30-90 days before that day
 *
 * The orders of that window are old enough for their returns to have come back (refund = returned, being returned and partly
 * returned, like the Philippines refund rate: see refund.ts), so the rate is a settled one. It is worked out per day, from the
 * same window, so a day shows the same provision whatever the range of the report. The goods of a returned order go back to the
 * shop, so the cost of goods is reduced by the same share (the real loss is the margin of the returned orders).
 *
 * The revenue of the report already has the returned orders taken off (they count on the creation day), so the rate is applied
 * to the revenue before returns and what already came back is deducted: the day carries only the returns still to come
 * (see mapManagementRows). Pure: the caller gives the figures of each day.
 */
import { addDays } from "./dates";
import type { RefundDay } from "./refund";

/** The orders counted for the rate of a day were created between this many days and that many days before it. */
export const PROVISION_FROM_DAYS = 90;
export const PROVISION_TO_DAYS = 30;

export type ProvisionRate = {
  /** Refund rate of the window as a fraction (0.093 = 9.3%). */
  rate: number;
  /** Successful and returned revenue the rate is made of, and the window's days. */
  confirmed: number;
  returned: number;
  from: string;
  to: string;
};

/** The first and last day of the window that gives the rate of `date`. */
export function provisionWindow(date: string) {
  return { from: addDays(date, -PROVISION_FROM_DAYS), to: addDays(date, -PROVISION_TO_DAYS) };
}

/** The first and last day whose figures are needed for the days of `from`..`to`. */
export function provisionRange(from: string, to: string) {
  return { from: provisionWindow(from).from, to: provisionWindow(to).to };
}

/**
 * The refund rate of each of `dates`. `day` gives the figures of one day (missing days count as nothing). A day whose window has
 * no successful revenue (a shop that is too young) has no rate: no provision is made for it.
 */
export function provisionRates(dates: string[], day: (date: string) => RefundDay | undefined): Map<string, ProvisionRate> {
  const result = new Map<string, ProvisionRate>();
  for (const date of dates) {
    const window = provisionWindow(date);
    let confirmed = 0;
    let returned = 0;
    for (let current = window.from; current <= window.to; current = addDays(current, 1)) {
      const figures = day(current);
      if (!figures) continue;
      confirmed += figures.confirmed;
      returned += Math.abs(figures.returned);
    }
    if (confirmed > 0) result.set(date, { rate: Math.min(1, returned / confirmed), confirmed, returned, ...window });
  }
  return result;
}

/**
 * Which days of the profit sheet have to be read from the POS again. Pure, so the rule is tested without a database.
 *
 * A stored day is final once it was read after the day ended (in the POS day buckets' time zone). A day read while it was
 * still going on (today, typically) is read again, but at most every REFETCH_MINUTES so opening the page twice does not
 * query the POS twice. Older days can still change in the POS (returns come in days later): the page's update button reads
 * the whole month again.
 *
 * Philippines days (`monthRate`) carry the month-to-date refund rate of the day they were read (the sales and the cost of goods are
 * multiplied by 1 - rate, see mapFinanceDays). That rate moves every day and the whole month is shown with the same one, so a day of a
 * month that has not ended is read again once a day (that reads the month to date in one query), and a day of a finished month is
 * final only when it was read after the month ended.
 */
import { addDays, todayAt } from "../pancake/dates";

export const REFETCH_MINUTES = 30;

export type StoredDay = { date: string; fetchedAt: string };

/** The moment a day ends, in milliseconds, for days bucketed at UTC+`offsetHours`. */
export function dayEndMs(date: string, offsetHours: number) {
  return Date.parse(`${addDays(date, 1)}T00:00:00Z`) - offsetHours * 3_600_000;
}

/** The last day of the month of `date`. */
function monthEnd(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function needsFetch(date: string, stored: StoredDay | undefined, nowMs: number, offsetHours: number, monthRate = false) {
  if (!stored) return true;
  const fetched = Date.parse(stored.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  if (monthRate) {
    if (fetched >= dayEndMs(monthEnd(date), offsetHours)) return false;
    // Read before today began: the rate of the month has moved since.
    if (fetched < dayEndMs(addDays(todayAt(offsetHours, nowMs), -1), offsetHours)) return true;
  }
  if (fetched >= dayEndMs(date, offsetHours)) return false;
  return nowMs - fetched >= REFETCH_MINUTES * 60_000;
}

/** The smallest range covering every day that needs reading (one POS query), or null when all stored days are good. */
export function rangeToFetch(dates: string[], stored: StoredDay[], nowMs: number, offsetHours: number, monthRate = false) {
  const byDate = new Map(stored.map((day) => [day.date, day]));
  const due = dates.filter((date) => needsFetch(date, byDate.get(date), nowMs, offsetHours, monthRate));
  return due.length ? { from: due[0], to: due[due.length - 1] } : null;
}

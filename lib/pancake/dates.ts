/** Date helpers for Pancake queries. Dates are "YYYY-MM-DD" strings in Pancake's day-bucket timezone (UTC+7). */

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** First day of the month containing `date`. */
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** "2026-11-03" -> "03/11/2026", the format the report pages use. */
export function toDmy(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** "03/11/2026" for one day, "01/11/2026 – 03/11/2026" for a range. */
export function rangeLabel(from: string, to: string) {
  return from === to ? toDmy(from) : `${toDmy(from)} – ${toDmy(to)}`;
}

/** Local start/end of a day, as the UTC instants Pancake expects (`utcOffsetHours` = bucket timezone, e.g. 7). */
export function dayBoundsUtc(date: string, utcOffsetHours: number, edge: "start" | "end") {
  const [year, month, day] = date.split("-").map(Number);
  const localMs =
    edge === "start" ? Date.UTC(year, month - 1, day, 0, 0, 0) : Date.UTC(year, month - 1, day, 23, 59, 59);
  return new Date(localMs - utcOffsetHours * 3_600_000).toISOString().replace(".000Z", "Z");
}

/**
 * Pancake buckets `Time.day` in UTC+7 for every shop (verified on a PHP shop: a UTC+8 window drops the last hour),
 * so day boundaries must use +7 regardless of the shop's country. Overridable via PANCAKE_UTC_OFFSET_HOURS.
 */
export function bucketUtcOffset(override = process.env.PANCAKE_UTC_OFFSET_HOURS) {
  const parsed = override === undefined || override.trim() === "" ? NaN : Number(override);
  return Number.isFinite(parsed) && parsed >= -12 && parsed <= 14 ? parsed : 7;
}

/** "YYYY-MM-DD" plus `count` days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, count: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
}

/** Inclusive list of days from `from` to `to`. Empty when `from` is after `to`. */
export function listDays(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Splits an inclusive range into consecutive chunks of at most `maxDays` days. */
export function chunkRange(from: string, to: string, maxDays: number) {
  const chunks: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    chunks.push({ from: start, to: end < to ? end : to });
  }
  return chunks;
}

/** Today's date in a timezone given as a UTC offset in hours. */
export function todayAt(utcOffsetHours: number, now = Date.now()) {
  return new Date(now + utcOffsetHours * 3_600_000).toISOString().slice(0, 10);
}

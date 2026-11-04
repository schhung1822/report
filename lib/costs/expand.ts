import { listDays, isValidIsoDate } from "../pancake/dates";
import type { ManualCostRow } from "../pancake/types";
import type { CostEntryInput, CostType } from "./types";

/**
 * Which ManualCostRow amount field each stored cost type feeds. A bonus is part of what a staff member costs, so the
 * reports count it as salary.
 */
const FIELD_OF: Record<CostType, keyof Pick<ManualCostRow, "salarySaleCskh" | "salaryOther" | "fixedCost" | "otherCost" | "adsCost" | "returnProvision">> = {
  salary_sale_cskh: "salarySaleCskh",
  salary_other: "salaryOther",
  bonus: "salarySaleCskh",
  fixed_cost: "fixedCost",
  other_cost: "otherCost",
  ads_cost: "adsCost",
  return_provision: "returnProvision",
};

function daysInMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The amount an entry charges on one day.
 *  - daily   : the full amount every day.
 *  - once    : the full amount on `validFrom` only.
 *  - monthly : amount / days-in-month per day, computed in whole cents; the last day of the month takes the
 *              remainder so a complete month adds up to exactly `amount` (no rounding drift).
 *  - monthly with `workDays` : amount / workDays per day (to the cent). Which days that applies to is the caller's job.
 * Whether the day lies inside the validity window is the caller's job.
 */
export function amountOnDay(entry: Pick<CostEntryInput, "amount" | "period" | "validFrom"> & { workDays?: number | null }, date: string) {
  if (entry.period === "daily") return entry.amount;
  if (entry.period === "once") return date === entry.validFrom ? entry.amount : 0;
  if (entry.workDays) return Math.round(entry.amount / entry.workDays * 100) / 100;

  const dim = daysInMonth(date);
  const cents = Math.round(entry.amount * 100);
  const baseCents = Math.floor(cents / dim);
  const dayOfMonth = Number(date.slice(8, 10));
  return (dayOfMonth === dim ? cents - baseCents * (dim - 1) : baseCents) / 100;
}

/** The pay of one working day: what a staff member's monthly amount costs for each day they worked. */
export function dailyRate(amount: number, workDays: number) {
  return workDays > 0 ? Math.round((amount / workDays) * 100) / 100 : 0;
}

export type ExpandOptions = {
  /**
   * Whether a staff member worked on a day (had orders or revenue). Entries with `workDays` only charge those days; without
   * it they charge every day, which is what an estimate made without any order data has to assume.
   */
  worked?: (staffName: string, date: string) => boolean;
};

/**
 * Turns stored entries into dated cost lines for `from`..`to` (inclusive), so every report treats database costs
 * exactly like the lines of the cost file. Days outside an entry's validity window get nothing.
 */
export function expandCostEntries(entries: CostEntryInput[], from: string, to: string, options: ExpandOptions = {}): ManualCostRow[] {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return [];
  const days = listDays(from, to);
  const rows: ManualCostRow[] = [];

  for (const entry of entries) {
    const field = FIELD_OF[entry.costType];
    for (const date of days) {
      if (date < entry.validFrom || (entry.validTo !== null && date > entry.validTo)) continue;
      if (entry.workDays && entry.staffName && options.worked && !options.worked(entry.staffName, date)) continue;
      const amount = amountOnDay(entry, date);
      if (amount <= 0) continue;
      rows.push({
        date,
        channel: entry.scope === "channel" ? (entry.channel ?? undefined) : undefined,
        staff: entry.scope === "staff" ? (entry.staffName ?? undefined) : undefined,
        salarySaleCskh: 0,
        salaryOther: 0,
        fixedCost: 0,
        otherCost: 0,
        adsCost: 0,
        returnProvision: 0,
        [field]: amount,
      });
    }
  }
  return rows;
}

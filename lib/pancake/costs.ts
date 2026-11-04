import { normalizeText } from "../workbook";
import type { PosDataset } from "./dataset";
import type { ManagementChannel, ManualCostRow } from "./types";

export type CostScope =
  | { kind: "shop" }
  | { kind: "channel"; channel: ManagementChannel }
  | { kind: "staff"; staff: string };

/** Every amount a cost line can carry. */
export const COST_FIELDS = ["salarySaleCskh", "salaryOther", "fixedCost", "otherCost", "adsCost", "returnProvision", "cogs", "shippingCost", "taxFee"] as const;
export type CostField = (typeof COST_FIELDS)[number];
export type CostTotals = Record<CostField, number>;

export function emptyCosts(): CostTotals {
  return Object.fromEntries(COST_FIELDS.map((field) => [field, 0])) as CostTotals;
}

function addTo(totals: CostTotals, row: Partial<Record<CostField, number>>) {
  for (const field of COST_FIELDS) totals[field] += row[field] ?? 0;
}

function rowMatches(row: ManualCostRow, date: string, scope: CostScope) {
  if (row.date && row.date !== date) return false;
  if (scope.kind === "staff") return Boolean(row.staff) && normalizeText(row.staff) === normalizeText(scope.staff);
  if (row.staff) return false;
  if (scope.kind === "channel") return row.channel === scope.channel;
  return !row.channel;
}

/** Sums every cost line that applies to `date` within `scope`. */
export function costsFor(rows: ManualCostRow[], date: string, scope: CostScope): CostTotals {
  const totals = emptyCosts();
  for (const row of rows) {
    if (!rowMatches(row, date, scope)) continue;
    addTo(totals, row);
  }
  return totals;
}

/** Exchange rate for a day: the last matching shop-wide line that has one. */
export function exchangeRateFor(rows: ManualCostRow[], date: string): number | undefined {
  let rate: number | undefined;
  for (const row of rows) {
    if (!row.exchangeRate || row.exchangeRate <= 0 || row.staff || row.channel) continue;
    if (!row.date || row.date === date) rate = row.exchangeRate;
  }
  return rate;
}

/**
 * Everything that applies to `date` whatever its scope: shop-wide, per channel and per staff lines together. The
 * Philippines report has one department and no channels, so every cost counts there.
 */
export function costsForAnyScope(rows: ManualCostRow[], date: string): CostTotals {
  const totals = emptyCosts();
  for (const row of rows) {
    if (row.date && row.date !== date) continue;
    addTo(totals, row);
  }
  return totals;
}

/**
 * The lines that name no channel: shop-wide lines and the lines of every staff member. The Vietnam management report is
 * per channel, so these are shared out between Zalo and Page (see `splitByShare`).
 */
export function costsWithoutChannel(rows: ManualCostRow[], date: string): CostTotals {
  const totals = emptyCosts();
  for (const row of rows) {
    if (row.date && row.date !== date) continue;
    if (row.channel && !row.staff) continue;
    addTo(totals, row);
  }
  return totals;
}

/** Splits costs in two by a share (0..1) for the first part; the second part is the rest, so nothing is lost to rounding. */
export function splitByShare(costs: CostTotals, share: number): [CostTotals, CostTotals] {
  const first = emptyCosts();
  const second = emptyCosts();
  for (const key of Object.keys(costs) as (keyof CostTotals)[]) {
    first[key] = Math.round(costs[key] * share * 100) / 100;
    second[key] = Math.round((costs[key] - first[key]) * 100) / 100;
  }
  return [first, second];
}

/**
 * Whether a staff member worked on a day: had orders or revenue on it in the POS. Pay that is charged per working day
 * (monthly pay over the standard working days) only costs those days. Spelling differences in the name are ignored.
 */
export function staffWorkedOn(dataset: PosDataset) {
  const worked = new Set((dataset.staffDays ?? []).map((day) => `${normalizeText(day.name)}|${day.date}`));
  return (staffName: string, date: string) => worked.has(`${normalizeText(staffName)}|${date}`);
}

/** Distinct staff names mentioned in the cost lines (original spelling of the first mention). */
export function staffInCosts(rows: ManualCostRow[]) {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.staff && !names.has(normalizeText(row.staff))) names.set(normalizeText(row.staff), row.staff);
  }
  return Array.from(names.values());
}

/** Sums `costsFor` over several days: a per-day line (no date) counts once for every day of the range. */
export function costsForDays(rows: ManualCostRow[], dates: string[], scope: CostScope): CostTotals {
  const totals = emptyCosts();
  for (const date of dates) {
    addTo(totals, costsFor(rows, date, scope));
  }
  return totals;
}

export function hasAnyCost(costs: CostTotals) {
  return Object.values(costs).some((value) => value > 0);
}

/** Fields the accountant's daily sheet can fill, with the name a report warning gives them. */
const SHEET_FIELD_LABEL: Partial<Record<CostField, string>> = {
  salarySaleCskh: "lương CSKH/Sale",
  salaryOther: "lương bộ phận khác",
  fixedCost: "định phí",
  otherCost: "chi phí khác",
  adsCost: "ads",
  returnProvision: "dự phòng hoàn",
};

export type SheetPrecedence = {
  rows: ManualCostRow[];
  /** What the sheet replaced: the field, and how many days had other lines of it dropped. */
  replaced: { field: CostField; label: string; days: number }[];
};

/**
 * The accountant's daily sheet is the book of record for the days and kinds it fills. For a day on which the sheet has a
 * positive amount of a kind (say CSKH pay), the other lines of that kind on that day (monthly estimates, per-staff pay, a
 * typed-in file) are dropped, so nothing is counted twice. A sheet cell that is empty or 0 replaces nothing. Used for the
 * reports of the whole shop; the staff performance report keeps the per-staff pay it is made of.
 */
export function applySheetPrecedence(rows: ManualCostRow[]): SheetPrecedence {
  const declared = new Set<string>();
  for (const row of rows) {
    if (!row.fromSheet || !row.date) continue;
    for (const field of COST_FIELDS) if ((row[field] ?? 0) > 0) declared.add(`${row.date}|${field}`);
  }
  if (!declared.size) return { rows, replaced: [] };

  const droppedDays = new Map<CostField, Set<string>>();
  const result: ManualCostRow[] = [];
  for (const row of rows) {
    if (row.fromSheet) {
      result.push(row);
      continue;
    }
    const copy: ManualCostRow = { ...row };
    for (const field of COST_FIELDS) {
      const amount = copy[field] ?? 0;
      // A line without a date applies to every day, so it is only cut on the days the sheet fills: it cannot be split here.
      if (amount <= 0 || !copy.date || !declared.has(`${copy.date}|${field}`)) continue;
      copy[field] = 0;
      droppedDays.set(field, (droppedDays.get(field) ?? new Set()).add(copy.date));
    }
    const keeps = COST_FIELDS.some((field) => (copy[field] ?? 0) > 0) || Boolean(copy.exchangeRate);
    if (keeps) result.push(copy);
  }
  const replaced = Array.from(droppedDays, ([field, days]) => ({ field, label: SHEET_FIELD_LABEL[field] ?? field, days: days.size }));
  return { rows: result, replaced };
}

/** The days between `dates` that the sheet has no amount for at all. */
export function daysWithoutSheet(rows: ManualCostRow[], dates: string[]) {
  const filled = new Set(rows.filter((row) => row.fromSheet && row.date && COST_FIELDS.some((field) => (row[field] ?? 0) > 0)).map((row) => row.date));
  return dates.filter((date) => !filled.has(date));
}

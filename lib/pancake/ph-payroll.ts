/**
 * Staff pay shared out by revenue: the Philippines staff pay (typed per person in dong) and the Vietnam shop's two monthly totals
 * (salary of sale/CSKH and of the other departments, typed in dong for the whole shop).
 *
 * The people are paid a monthly amount in dong (pay and bonus typed per staff member). The report is in pesos, so the day's cost is
 *
 *     total monthly pay (dong) / average rate  x  revenue of the day / revenue of the month
 *
 * i.e. the month's pay in pesos, in proportion to the share of the month's revenue the day made. A finished month uses its real
 * revenue, so its days add up to exactly the month's pay. A month that is still running uses an estimate: the revenue of the
 * complete days so far, scaled to the whole month (revenue so far / days so far x days in the month). Every day of the month uses
 * the same denominator, so a day's figure does not depend on which range the report covers.
 *
 * (Dividing by the revenue from the 1st to each day instead makes every day look like the first one: the shares add up to far
 * more than 100%. That was the first version and it charged 2.3x the month's pay in four days.)
 *
 * Pure: the caller gives the revenue and the rate of every day.
 */
import type { CostEntryInput, CostType } from "../costs/types";
import { listDays, monthStart, toDmy } from "./dates";
import type { ManualCostRow } from "./types";

type PayEntry = Pick<CostEntryInput, "scope" | "period" | "costType" | "amount" | "validFrom" | "validTo">;

/** Cost types that are staff pay: a bonus is part of what a person costs, like in the other reports. */
const PAY_FIELD: Partial<Record<CostType, "salarySaleCskh" | "salaryOther">> = {
  salary_sale_cskh: "salarySaleCskh",
  salary_other: "salaryOther",
  bonus: "salarySaleCskh",
};

/** A monthly pay or bonus of one staff member (Philippines): the entries this module shares out by revenue. */
export function isRevenueSharedPay(entry: Pick<CostEntryInput, "scope" | "period" | "costType">) {
  return entry.scope === "staff" && entry.period === "monthly" && entry.costType in PAY_FIELD;
}

/** The monthly salary total of the whole shop (Vietnam: sale/CSKH, other departments): shared out by revenue too. */
export function isRevenueSharedTotal(entry: Pick<CostEntryInput, "scope" | "period" | "costType">) {
  return entry.scope === "shop" && entry.period === "monthly" && (entry.costType === "salary_sale_cskh" || entry.costType === "salary_other");
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function monthEnd(date: string) {
  const [year, month] = date.split("-").map(Number);
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * The last day whose revenue is read for the month of `date`: the end of a finished month; for a running month the latest
 * complete day (`asOf`, normally yesterday), or the 1st itself when that is all there is.
 */
export function revenueHorizon(date: string, asOf: string) {
  const first = monthStart(date);
  const end = monthEnd(date);
  return asOf >= end ? end : asOf < first ? first : asOf;
}

export type PayMonth = {
  /** "YYYY-MM" */
  month: string;
  /** Total monthly pay in dong (of the last report day in that month). */
  dong: number;
  /** Average dong per peso over the days read. */
  averageRate: number;
  /** The same pay in pesos. */
  pesos: number;
  /** Last day whose revenue was read, and that revenue in pesos. */
  readTo: string;
  revenueRead: number;
  /** Revenue the month is shared by: the real one for a finished month, else the estimate. */
  monthRevenue: number;
  finished: boolean;
};

export type SharedPay = { rows: ManualCostRow[]; months: PayMonth[] };

/**
 * One shop-wide cost line (pesos) per report day that has revenue.
 *  - `entries`    : the monthly pay entries (only those `isRevenueSharedPay` or `isRevenueSharedTotal` accepts are read). An entry counts on the days in its
 *                   validity window, so a raise leaves the earlier days at the old amount.
 *  - `dates`      : the days of the report.
 *  - `revenue`    : revenue of any day up to the month's horizon (pesos); days with none count 0.
 *  - `dongPerPeso`: the rate of a day.
 *  - `asOf`       : the latest day with complete figures (yesterday).
 */
export function sharePayByRevenue(
  entries: PayEntry[],
  dates: string[],
  revenue: (date: string) => number,
  dongPerPeso: (date: string) => number,
  asOf: string,
): SharedPay {
  const pay = entries.filter((entry) => (isRevenueSharedPay(entry) || isRevenueSharedTotal(entry)) && entry.amount > 0);
  const rows: ManualCostRow[] = [];
  const months = new Map<string, PayMonth>();
  const basis = new Map<string, { revenueRead: number; monthRevenue: number; averageRate: number; readTo: string; finished: boolean } | null>();

  const monthBasis = (date: string) => {
    const key = date.slice(0, 7);
    if (basis.has(key)) return basis.get(key) ?? null;
    const readTo = revenueHorizon(date, asOf);
    const read = listDays(monthStart(date), readTo);
    const revenueRead = read.reduce((sum, day) => sum + Math.max(0, revenue(day)), 0);
    const rates = read.map(dongPerPeso).filter((rate) => rate > 0);
    const averageRate = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
    const finished = readTo === monthEnd(date);
    const monthRevenue = finished ? revenueRead : (revenueRead / read.length) * Number(monthEnd(date).slice(8, 10));
    const result = averageRate > 0 && monthRevenue > 0 ? { revenueRead, monthRevenue, averageRate, readTo, finished } : null;
    basis.set(key, result);
    return result;
  };

  for (const date of dates) {
    const dongOf = (field: "salarySaleCskh" | "salaryOther") =>
      pay
        .filter((entry) => PAY_FIELD[entry.costType] === field && entry.validFrom <= date && (entry.validTo === null || date <= entry.validTo))
        .reduce((sum, entry) => sum + entry.amount, 0);
    const sale = dongOf("salarySaleCskh");
    const other = dongOf("salaryOther");
    const today = Math.max(0, revenue(date));
    const known = monthBasis(date);
    if (sale + other <= 0 || !known || today <= 0) continue;

    const share = today / known.monthRevenue;
    rows.push({
      date,
      salarySaleCskh: round2((sale / known.averageRate) * share),
      salaryOther: round2((other / known.averageRate) * share),
      fixedCost: 0,
      otherCost: 0,
      adsCost: 0,
      returnProvision: 0,
    });
    months.set(date.slice(0, 7), {
      month: date.slice(0, 7),
      dong: sale + other,
      averageRate: round2(known.averageRate),
      pesos: round2((sale + other) / known.averageRate),
      readTo: known.readTo,
      revenueRead: round2(known.revenueRead),
      monthRevenue: round2(known.monthRevenue),
      finished: known.finished,
    });
  }
  return { rows, months: Array.from(months.values()) };
}

/** One line per month for the report's notes (Vietnam shop: whole-shop totals in dong). */
export function describeSharedTotals(months: PayMonth[]) {
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
  return months.map((item) => {
    const base = `Lương tổng tháng ${item.month.slice(5)}/${item.month.slice(0, 4)}: ${money.format(item.dong)} ₫ (lương Sale/CSKH + bộ phận khác), chia cho từng ngày = lương tháng × doanh thu ngày ÷ doanh thu cả tháng`;
    return item.finished
      ? `${base} (doanh thu tháng ${money.format(item.monthRevenue)} ₫, các ngày cộng lại đúng bằng lương tháng).`
      : `${base} (dự tính doanh thu tháng ${money.format(item.monthRevenue)} ₫ = doanh thu ${money.format(item.revenueRead)} ₫ đến ${toDmy(item.readTo)} quy ra cả tháng; tháng chưa kết thúc nên lương các ngày mới bằng phần đã trôi qua của lương tháng).`;
  });
}

/** One line per month for the report's notes. */
export function describeSharedPay(months: PayMonth[]) {
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
  return months.map((item) => {
    const base = `Lương/thưởng nhân sự Phil tháng ${item.month.slice(5)}/${item.month.slice(0, 4)}: ${money.format(item.dong)} ₫ ÷ tỷ giá trung bình ${money.format(item.averageRate)} = ${money.format(item.pesos)} ₱, chia cho từng ngày theo doanh thu ngày ÷ doanh thu cả tháng`;
    return item.finished
      ? `${base} (${money.format(item.monthRevenue)} ₱, các ngày cộng lại đúng bằng lương tháng).`
      : `${base} (dự tính ${money.format(item.monthRevenue)} ₱ = doanh thu ${money.format(item.revenueRead)} ₱ đến ${toDmy(item.readTo)} quy ra cả tháng; tháng chưa kết thúc nên tổng lương các ngày mới bằng phần đã trôi qua của lương tháng).`;
  });
}


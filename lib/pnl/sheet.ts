/**
 * The monthly profit sheet ("báo cáo quản trị dự kiến lợi nhuận"): one row per line of the income statement, one column per
 * day. Lines the system knows (POS sales, Meta ads, staff pay) are read from the report of the month; lines only the
 * accountant knows are cells of the daily cost sheet (see lib/costs/daily-sheet.ts) and can be typed into the sheet.
 *
 * Pure: the rows of each shop and how a day's values are computed, so the page and the tests share one definition. The
 * figures are the ones the finance reports use, so the profit here is the profit there.
 */
import type { SheetChannel, SheetLine, SheetMarket } from "../costs/daily-sheet";
import type { RawDailyFinanceRow } from "@/types/finance";
import type { ProcessedManagementReport } from "@/types/financial-management";
import { parseFinanceDate, parseFinanceNumber } from "@/utils/finance";

export type PnlSource = "POS" | "Meta" | "Lương" | "Nhập";
export type PnlStyle = "revenue" | "major" | "line" | "detail" | "ratio" | "result";

export type PnlRow = {
  id: string;
  /** Number shown in the STT column ("" for the channel rows under a line). */
  stt: string;
  label: string;
  /** Column heading where space is short (the report table); the full label is the tooltip. */
  short?: string;
  style: PnlStyle;
  source?: PnlSource;
  /** Value the report computed for the day (a key of `PnlDayValues`). For a typed line it is what the day falls back to. */
  key?: string;
  /** A cell of the daily cost sheet that can be typed into. */
  input?: { line: SheetLine; channel: SheetChannel };
  /** The sum of these rows; with `key`, the report's value when they add up to nothing. */
  sum?: string[];
  /** A result computed from other rows of the same day. */
  calc?: (value: (id: string) => number) => number;
  /** A percentage: row `of` over row `over`. */
  ratio?: { of: string; over: string };
};

/** What the report computed for one day, by key ("revenue", "zalo.fixedCost"…). */
export type PnlDayValues = Record<string, number>;

const PH_ROWS: PnlRow[] = [
  { id: "1", stt: "1", label: "Doanh số bán hàng và cung cấp dịch vụ", short: "Doanh số", style: "revenue", source: "POS", key: "revenue" },
  { id: "2", stt: "2", label: "CP dự phòng rủi ro hàng tồn", short: "Dự phòng hàng tồn", style: "major", source: "Nhập", key: "provision", input: { line: "return_provision", channel: "" } },
  { id: "3", stt: "3", label: "Doanh thu thuần", short: "DT thuần", style: "major", calc: (v) => v("1") - v("2") },
  { id: "4", stt: "4", label: "Giá vốn hàng bán", short: "Giá vốn", style: "major", source: "Nhập", key: "cogs", input: { line: "cogs", channel: "" } },
  { id: "5", stt: "5", label: "Lợi nhuận gộp", short: "LN gộp", style: "result", calc: (v) => v("3") - v("4") },
  { id: "8", stt: "8", label: "Tổng chi phí bán hàng", short: "Tổng CP bán hàng", style: "major", sum: ["8.1", "8.2", "8.3", "8.4", "8.5"] },
  { id: "8.1", stt: "8.1", label: "Chi phí ADS", short: "ADS", style: "line", source: "Meta", key: "ads" },
  { id: "ads-ratio", stt: "", label: "Tỷ lệ ADS / doanh số", short: "Tỷ lệ ADS", style: "ratio", ratio: { of: "8.1", over: "1" } },
  { id: "8.2", stt: "8.2", label: "Chi phí dịch vụ mua ngoài", short: "Dịch vụ mua ngoài", style: "line", source: "Nhập", key: "outsourced", input: { line: "fixed_cost", channel: "" } },
  { id: "8.3", stt: "8.3", label: "Chi phí giao hàng bán", short: "Giao hàng", style: "line", key: "shipping", sum: ["8.3.1", "8.3.2"] },
  { id: "8.3.1", stt: "8.3.1", label: "Giao hàng từ PED đến Phi", short: "Giao PED → Phi", style: "detail", source: "Nhập", key: "shippingPedPh", input: { line: "shipping_ped_ph", channel: "" } },
  { id: "8.3.2", stt: "8.3.2", label: "Giao hàng bên Phi", short: "Giao bên Phi", style: "detail", source: "Nhập", key: "shippingPh", input: { line: "shipping_ph", channel: "" } },
  { id: "8.4", stt: "8.4", label: "Chi phí lương", short: "Lương", style: "line", source: "Lương", key: "payroll" },
  { id: "8.5", stt: "8.5", label: "Chi phí khác", style: "line", source: "Nhập", key: "other", input: { line: "other_cost", channel: "" } },
  { id: "9", stt: "9", label: "Tổng chi phí quản lý doanh nghiệp", short: "Tổng CP quản lý", style: "major", sum: ["9.1"] },
  { id: "9.1", stt: "9.1", label: "Thuế, phí và lệ phí", short: "Thuế, phí", style: "line", source: "Nhập", key: "tax", input: { line: "tax_fee", channel: "" } },
  { id: "10", stt: "10", label: "Lợi nhuận thuần", short: "LN thuần", style: "result", calc: (v) => v("5") - v("8") - v("9") },
];

/** Vietnam: the lines the accountant types are per channel, so each gets a Zalo and a Page row under the total. */
function byChannel(id: string, line: SheetLine, field: string): PnlRow[] {
  return (["zalo", "page"] as const).map((channel) => ({
    id: `${id}.${channel}`,
    stt: "",
    label: channel === "zalo" ? "Kênh Zalo" : "Kênh Page",
    style: "detail" as const,
    source: "Nhập" as const,
    key: `${channel}.${field}`,
    input: { line, channel },
  }));
}

const VN_ROWS: PnlRow[] = [
  { id: "1", stt: "1", label: "Doanh số bán hàng", short: "Doanh số", style: "revenue", source: "POS", key: "total.revenue" },
  { id: "2", stt: "2", label: "Giá vốn dự tính hoàn (dự phòng)", short: "Dự phòng hoàn", style: "major", sum: ["2.zalo", "2.page"] },
  ...byChannel("2", "return_provision", "returnProvision"),
  { id: "3", stt: "3", label: "Doanh thu thuần", short: "DT thuần", style: "major", calc: (v) => v("1") - v("2") },
  { id: "4", stt: "4", label: "Giá vốn hàng bán", short: "Giá vốn", style: "major", source: "POS", key: "total.cogs" },
  { id: "5", stt: "5", label: "Lợi nhuận gộp", short: "LN gộp", style: "result", calc: (v) => v("3") - v("4") },
  { id: "8", stt: "8", label: "Tổng chi phí bán hàng", short: "Tổng CP bán hàng", style: "major", sum: ["8.1", "8.2", "8.3", "8.4", "8.5"] },
  { id: "8.1", stt: "8.1", label: "Chi phí ADS", short: "ADS", style: "line", source: "Meta", key: "total.adsCost" },
  { id: "ads-ratio", stt: "", label: "Tỷ lệ ADS / doanh số", short: "Tỷ lệ ADS", style: "ratio", ratio: { of: "8.1", over: "1" } },
  { id: "8.2", stt: "8.2", label: "Lương Sale / CSKH", style: "line", source: "Lương", key: "total.salarySaleCskh" },
  { id: "8.3", stt: "8.3", label: "Lương bộ phận khác", short: "Lương BP khác", style: "line", source: "Lương", key: "total.salaryOther" },
  { id: "8.4", stt: "8.4", label: "Chi phí cố định", style: "line", sum: ["8.4.zalo", "8.4.page"] },
  ...byChannel("8.4", "fixed_cost", "fixedCost"),
  { id: "8.5", stt: "8.5", label: "Chi phí khác", style: "line", sum: ["8.5.zalo", "8.5.page"] },
  ...byChannel("8.5", "other_cost", "otherCost"),
  { id: "10", stt: "10", label: "Lợi nhuận thuần", short: "LN thuần", style: "result", calc: (v) => v("5") - v("8") },
];

export const PNL_ROWS: Record<SheetMarket, PnlRow[]> = { VND: VN_ROWS, PHP: PH_ROWS };

/** The days of a Philippines report as sheet values (pesos). These are the figures of its daily results table. */
export function phDayValues(rows: RawDailyFinanceRow[]): Map<string, PnlDayValues> {
  const days = new Map<string, PnlDayValues>();
  for (const row of rows) {
    days.set(parseFinanceDate(row.date).iso, {
      revenue: parseFinanceNumber(row.actualRevenue),
      provision: parseFinanceNumber(row.inventoryProvision),
      cogs: parseFinanceNumber(row.cogs),
      ads: parseFinanceNumber(row.ads),
      outsourced: parseFinanceNumber(row.outsourcedServices),
      shipping: parseFinanceNumber(row.shippingFees),
      // Only days whose shipping is the per-product rate carry the two legs; a day with a typed total shows them empty.
      ...(row.shippingPedPh !== undefined ? { shippingPedPh: parseFinanceNumber(row.shippingPedPh), shippingPh: parseFinanceNumber(row.shippingPh) } : {}),
      payroll: parseFinanceNumber(row.payroll),
      other: parseFinanceNumber(row.otherCost),
      tax: parseFinanceNumber(row.taxFee),
    });
  }
  return days;
}

const VN_FIELDS = ["revenue", "cogs", "returnProvision", "salarySaleCskh", "salaryOther", "fixedCost", "otherCost", "adsCost"] as const;

/** The days of a Vietnam report as sheet values (dong), per channel and in total: the "actual" figures the report shows. */
export function vnDayValues(report: ProcessedManagementReport): Map<string, PnlDayValues> {
  const days = new Map<string, PnlDayValues>();
  for (const day of report.days) {
    const values: PnlDayValues = {};
    for (const channel of ["zalo", "page", "total"] as const) {
      for (const field of VN_FIELDS) values[`${channel}.${field}`] = Number(day.actual[channel][field]) || 0;
    }
    days.set(day.date, values);
  }
  return days;
}

/** A typed or stored cell of the daily cost sheet; `typed` when it was typed on the page and not saved yet. */
export type PnlCell = { amount: number; typed: boolean };

export type PnlComputed = {
  /** Row id -> one value per day (same order as `days`). */
  byDay: Map<string, number[]>;
  /** Row id -> value of the whole range (a ratio row: the ratio of the totals). */
  total: Map<string, number>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Computes every row for every day.
 *  - A typed cell counts as typed (0 too). A stored cell above zero replaces the report's figure for that day, like it does in
 *    the report; a stored 0 replaces nothing (the report then uses its estimate or the POS figure).
 *  - A sum that comes to nothing falls back to the report's figure when it has a `key` (Philippines shipping: the POS fee).
 */
export function computePnl(
  rows: PnlRow[],
  days: string[],
  report: Map<string, PnlDayValues>,
  cell: (date: string, line: SheetLine, channel: SheetChannel) => PnlCell | undefined,
): PnlComputed {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byDay = new Map<string, number[]>(rows.map((row) => [row.id, []]));

  days.forEach((date, index) => {
    const known = report.get(date) ?? {};
    const memo = new Map<string, number>();
    const value = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      const row = byId.get(id);
      let result = 0;
      if (row?.input) {
        const found = cell(date, row.input.line, row.input.channel);
        if (found && (found.typed || found.amount > 0)) result = found.amount;
        else result = row.key ? (known[row.key] ?? 0) : 0;
      } else if (row?.sum) {
        result = row.sum.reduce((total, part) => total + value(part), 0);
        if (result === 0 && row.key) result = known[row.key] ?? 0;
      } else if (row?.calc) {
        result = row.calc(value);
      } else if (row?.ratio) {
        const over = value(row.ratio.over);
        result = over ? (value(row.ratio.of) / over) * 100 : 0;
      } else if (row?.key) {
        result = known[row.key] ?? 0;
      }
      result = round2(result);
      memo.set(id, result);
      return result;
    };
    for (const row of rows) (byDay.get(row.id) as number[])[index] = value(row.id);
  });

  const total = new Map<string, number>();
  for (const row of rows) total.set(row.id, round2((byDay.get(row.id) as number[]).reduce((sum, amount) => sum + amount, 0)));
  for (const row of rows) {
    if (!row.ratio) continue;
    const over = total.get(row.ratio.over) ?? 0;
    total.set(row.id, over ? round2(((total.get(row.ratio.of) ?? 0) / over) * 100) : 0);
  }
  return { byDay, total };
}

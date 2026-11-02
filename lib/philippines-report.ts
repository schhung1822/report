import { findColumnByAlias, type SheetData } from "@/lib/workbook";
import type { ProcessedMonthlyFinanceReport, RawDailyFinanceRow } from "@/types/finance";
import { processMonthlyFinance } from "@/utils/finance";

/** Used when a row has no exchange rate of its own. Editable on the report page. */
export const PH_DEFAULT_EXCHANGE_RATE = 450;

const PH_COLUMNS = {
  date: ["date", "ngay", "ngay bao cao"],
  exchangeRate: ["exchange rate", "ty gia php vnd", "ty gia peso", "ty gia"],
  estimatedRevenue: ["estimated revenue", "doanh thu du tinh", "dt du tinh"],
  estimatedProfit: ["estimated profit", "loi nhuan du tinh", "ln du tinh"],
  actualRevenue: ["actual revenue", "doanh thu thuc te", "dt thuc te"],
  actualProfit: ["actual profit", "loi nhuan thuc te", "ln thuc te"],
  cogs: ["cogs", "gia von"],
  ads: ["ads", "chi phi ads", "chi phi marketing"],
  shippingFees: ["shipping fees", "shipping", "phi van chuyen"],
  payroll: ["payroll", "chi phi luong", "luong"],
  moneyInTransit: ["money in transit", "tien dang ve", "tien dang chuyen"],
  unverifiedMoney: ["unverified money", "tien chua doi soat", "tien chua xac nhan"],
  pos: ["pos"],
  transfer: ["transfer", "chuyen khoan"],
  refundRate: ["refund rate", "ty le hoan"],
  totalOrders: ["total orders", "tong don", "tong so don"],
  refundedOrders: ["refunded orders", "don hoan", "so don hoan"],
} as const;

type PhColumnKey = keyof typeof PH_COLUMNS;

const REQUIRED_COLUMNS: { key: PhColumnKey; label: string }[] = [
  { key: "date", label: "Ngày" },
  { key: "estimatedRevenue", label: "Doanh thu dự tính" },
  { key: "estimatedProfit", label: "Lợi nhuận dự tính" },
  { key: "actualRevenue", label: "Doanh thu thực tế" },
];

export type ParsedPhilippinesSheet = { rows: RawDailyFinanceRow[]; warnings: string[] };

/** Maps one sheet to raw daily rows (peso). Throws a user-facing Error when required columns are missing. */
export function parsePhilippinesSheet(sheet: SheetData): ParsedPhilippinesSheet {
  const columns = Object.fromEntries(
    (Object.keys(PH_COLUMNS) as PhColumnKey[]).map((key) => [key, findColumnByAlias(sheet.headers, PH_COLUMNS[key])]),
  ) as Record<PhColumnKey, string | undefined>;

  const missing = REQUIRED_COLUMNS.filter(({ key }) => !columns[key]).map(({ label }) => label);
  if (missing.length) throw new Error(`Thiếu cột bắt buộc: ${missing.join(", ")}.`);

  const read = (row: Record<string, unknown>, key: PhColumnKey) =>
    columns[key] ? (row[columns[key] as string] as RawDailyFinanceRow["cogs"]) : undefined;

  const rows: RawDailyFinanceRow[] = sheet.rows
    .filter((row) => String(row[columns.date as string] ?? "").trim() !== "")
    .map((row) => ({
      date: row[columns.date as string] as RawDailyFinanceRow["date"],
      exchangeRate: read(row, "exchangeRate"),
      estimatedRevenue: read(row, "estimatedRevenue"),
      estimatedProfit: read(row, "estimatedProfit"),
      actualRevenue: read(row, "actualRevenue"),
      actualProfit: read(row, "actualProfit"),
      cogs: read(row, "cogs"),
      ads: read(row, "ads"),
      shippingFees: read(row, "shippingFees"),
      payroll: read(row, "payroll"),
      moneyInTransit: read(row, "moneyInTransit"),
      unverifiedMoney: read(row, "unverifiedMoney"),
      pos: read(row, "pos"),
      transfer: read(row, "transfer"),
      refundRate: read(row, "refundRate"),
      totalOrders: read(row, "totalOrders"),
      refundedOrders: read(row, "refundedOrders"),
    }));

  if (!rows.length) throw new Error("Không có dòng dữ liệu nào có ngày hợp lệ.");

  const warnings: string[] = [];
  const optionalMissing = (["cogs", "ads", "shippingFees", "payroll"] as PhColumnKey[]).filter((key) => !columns[key]);
  if (optionalMissing.length) {
    warnings.push(`Thiếu cột chi phí (${optionalMissing.join(", ")}) nên được tính bằng 0.`);
  }
  return { rows, warnings };
}

/** Wraps processMonthlyFinance and turns its validation errors into readable messages. */
export function processPhilippinesRows(rows: RawDailyFinanceRow[], exchangeRate: number): ProcessedMonthlyFinanceReport {
  return processMonthlyFinance(rows, exchangeRate);
}

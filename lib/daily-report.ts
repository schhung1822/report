import { normalizeText } from "@/lib/workbook";

export type Expense = { payer: string; supplier: string; amount: number };
export type DailyReportData = {
  reportDate: string;
  revenue: number;
  bankTransfer: number;
  codReceivable: number;
  shippingFee: number;
  expenses: Expense[];
};
export type ExpenseGroup = { payer: string; items: Expense[]; total: number };

export const DAILY_SAMPLE_DATA: DailyReportData = {
  reportDate: "29/10/2026",
  revenue: 41_856_000,
  bankTransfer: 4_799_999,
  codReceivable: 38_505_001,
  shippingFee: 724_641,
  expenses: [
    { payer: "Hưng", supplier: "Nhung rubi", amount: 1_250_000 },
    { payer: "Hưng", supplier: "Lưu giày", amount: 860_000 },
    { payer: "Hưng", supplier: "Bao bì An Phát", amount: 520_000 },
    { payer: "A Kiên", supplier: "Kho Thành Công", amount: 2_400_000 },
    { payer: "A Nam", supplier: "Văn phòng phẩm", amount: 780_000 },
  ],
};

export const DAILY_COLUMN_ALIASES = {
  reportDate: ["ngay bao cao", "ngay", "report date", "date"],
  revenue: ["doanh so", "doanh thu", "revenue"],
  bankTransfer: ["nhan tien chuyen khoan", "tien chuyen khoan", "chuyen khoan", "tong thu thuc te"],
  codReceivable: ["tien phai thu khach cod", "tien phai thu khach", "phai thu khach cod", "tien cod", "cod"],
  shippingFee: ["phi tra don vi vc", "phi don vi vc", "phi van chuyen", "shipping fee"],
  payer: ["nguoi chi", "nguoi thanh toan", "payer"],
  supplier: ["ten ncc", "nha cung cap", "ncc", "noi dung chi", "supplier"],
  expenseAmount: ["so tien chi", "tien chi", "chi phi", "expense amount"],
} as const;

const moneyFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export function formatDailyMoney(value: number) {
  return `${moneyFormatter.format(value)} ₫`;
}

function findColumn(headers: string[], aliases: readonly string[]) {
  const normalizedHeaders = headers.map((original) => ({ original, normalized: normalizeText(original) }));
  for (const alias of aliases) {
    const match = normalizedHeaders.find((header) => header.normalized === alias);
    if (match) return match.original;
  }
  for (const alias of aliases) {
    const match = normalizedHeaders.find(
      (header) => header.normalized.includes(alias) || alias.includes(header.normalized),
    );
    if (match) return match.original;
  }
  return undefined;
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const amount = Number(text.replace(/[^0-9]/g, "") || 0);
  return text.includes("-") || /^\(.*\)$/.test(text) ? -amount : amount;
}

function parseReportDate(value: unknown) {
  if (typeof value === "number" && value > 0) {
    const date = new Date(Math.round((value - 25_569) * 86_400_000));
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
    }
  }
  const text = String(value ?? "").trim();
  if (!text) return DAILY_SAMPLE_DATA.reportDate;
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return isoDate
    ? `${isoDate[3].padStart(2, "0")}/${isoDate[2].padStart(2, "0")}/${isoDate[1]}`
    : text;
}

function firstFilledValue(rows: Record<string, unknown>[], column?: string) {
  if (!column) return undefined;
  return rows.find((row) => String(row[column] ?? "").trim())?.[column];
}

export function groupExpenses(expenses: Expense[]): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup>();
  expenses.forEach((expense) => {
    const payer = expense.payer.trim() || "Chưa xác định";
    const key = normalizeText(payer);
    const currentGroup = groups.get(key);
    if (currentGroup) {
      currentGroup.items.push(expense);
      currentGroup.total += expense.amount;
    } else {
      groups.set(key, { payer, items: [expense], total: expense.amount });
    }
  });
  return Array.from(groups.values());
}

export function deriveDaily(data: DailyReportData) {
  const supplierExpenses = data.expenses.reduce((total, expense) => total + expense.amount, 0);
  const totalIncome = data.bankTransfer;
  const totalExpense = data.shippingFee + supplierExpenses;
  const cashMovement = totalIncome - totalExpense;
  return {
    expenseGroups: groupExpenses(data.expenses),
    supplierExpenses,
    totalIncome,
    totalExpense,
    cashMovement,
    projectedBalance: cashMovement + data.codReceivable,
  };
}

/** Builds the daily report from the rows of one sheet. Throws a user-facing Error when nothing is recognizable. */
export function parseDailyRows(rows: Record<string, unknown>[]): {
  data: DailyReportData;
  rowCount: number;
  missingColumns: number;
} {
  if (!rows.length) throw new Error("Sheet không có dòng dữ liệu.");

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const columns = {
    reportDate: findColumn(headers, DAILY_COLUMN_ALIASES.reportDate),
    revenue: findColumn(headers, DAILY_COLUMN_ALIASES.revenue),
    bankTransfer: findColumn(headers, DAILY_COLUMN_ALIASES.bankTransfer),
    codReceivable: findColumn(headers, DAILY_COLUMN_ALIASES.codReceivable),
    shippingFee: findColumn(headers, DAILY_COLUMN_ALIASES.shippingFee),
    payer: findColumn(headers, DAILY_COLUMN_ALIASES.payer),
    supplier: findColumn(headers, DAILY_COLUMN_ALIASES.supplier),
    expenseAmount: findColumn(headers, DAILY_COLUMN_ALIASES.expenseAmount),
  };
  if (!Object.values(columns).some(Boolean)) {
    throw new Error("Không nhận diện được cột dữ liệu. Hãy dùng đúng tên cột trong file mẫu.");
  }

  const expenses = rows
    .map((row) => ({
      payer: String(columns.payer ? row[columns.payer] : "").trim(),
      supplier: String(columns.supplier ? row[columns.supplier] : "").trim(),
      amount: parseMoney(columns.expenseAmount ? row[columns.expenseAmount] : 0),
    }))
    .filter((expense) => expense.payer || expense.supplier || expense.amount)
    .map((expense) => ({
      ...expense,
      payer: expense.payer || "Chưa xác định",
      supplier: expense.supplier || "Khoản chi",
    }));

  return {
    data: {
      reportDate: parseReportDate(firstFilledValue(rows, columns.reportDate)),
      revenue: parseMoney(firstFilledValue(rows, columns.revenue)),
      bankTransfer: parseMoney(firstFilledValue(rows, columns.bankTransfer)),
      codReceivable: parseMoney(firstFilledValue(rows, columns.codReceivable)),
      shippingFee: parseMoney(firstFilledValue(rows, columns.shippingFee)),
      expenses,
    },
    rowCount: rows.length,
    missingColumns: Object.values(columns).filter((value) => !value).length,
  };
}

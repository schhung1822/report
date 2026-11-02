import { readWorkbookSheets, type SheetData } from "@/lib/workbook";

export type DailyPerformanceRow = {
  name: string;
  revenue: number;
  cogs: number;
  shipping: number;
  salary: number;
  fixedCost: number;
  ads: number;
  totalCost: number;
  grossProfit: number;
  estimatedReturn: number;
  netRevenue: number;
  netProfit: number;
};

export type CumulativePerformanceRow = {
  name: string;
  totalOrders: number;
  successOrders: number;
  convRate: number;
  totalRevenue: number;
  totalProfit: number;
  receivedRevenue: number;
  receivedProfit: number;
};

export type ParsedPerformanceFile = {
  dailyRows: DailyPerformanceRow[];
  cumulativeRows: CumulativePerformanceRow[];
  reportDate?: string;
  dailySheetName: string;
  cumulativeSheetName?: string;
  warnings: string[];
};

type RawDailyRow = Omit<
  DailyPerformanceRow,
  "totalCost" | "grossProfit" | "estimatedReturn" | "netRevenue" | "netProfit"
>;

type SheetRows = {
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
};

const DAILY_COLUMNS = {
  name: ["name", "ten nhan su", "nhan su", "ten", "agent"],
  revenue: ["revenue", "tong tien don hang", "doanh thu", "doanh so"],
  cogs: ["cogs", "gia von don ban dau", "gia von", "cost of goods sold"],
  shipping: ["shipping", "chi phi van chuyen", "phi van chuyen", "shipping cost"],
  salary: ["salary", "chi phi luong", "luong", "salary cost"],
  fixedCost: ["fixedcost", "fixed cost", "chi phi co dinh", "dinh phi"],
  ads: ["ads", "chi phi ads", "ads cost", "quang cao", "chi phi quang cao"],
} as const;

const CUMULATIVE_COLUMNS = {
  name: ["name", "ten nhan su", "nhan su", "ten", "agent"],
  totalOrders: ["total orders", "tong so don", "tong don", "so don"],
  successOrders: ["success orders", "successful orders", "don thanh cong", "so don thanh cong"],
  totalRevenue: ["total revenue", "doanh thu tong len don", "tong doanh thu", "doanh thu len don"],
  totalProfit: ["total profit", "loi nhuan tong len don", "tong loi nhuan", "loi nhuan len don"],
  receivedRevenue: ["received revenue", "doanh thu thuc nhan", "doanh thu da nhan"],
  receivedProfit: ["received profit", "loi nhuan thuc nhan", "loi nhuan da nhan"],
} as const;

const DAILY_LABELS: Record<keyof typeof DAILY_COLUMNS, string> = {
  name: "Name / Tên nhân sự",
  revenue: "Revenue / Tổng tiền đơn hàng",
  cogs: "COGS / Giá vốn đơn ban đầu",
  shipping: "Shipping / Chi phí vận chuyển",
  salary: "Salary / Chi phí lương",
  fixedCost: "FixedCost / Chi phí cố định",
  ads: "Ads / Chi phí ads",
};

const CUMULATIVE_LABELS: Record<keyof typeof CUMULATIVE_COLUMNS, string> = {
  name: "Name / Tên nhân sự",
  totalOrders: "Total Orders / Tổng số đơn",
  successOrders: "Success Orders / Đơn thành công",
  totalRevenue: "Total Revenue / Doanh thu tổng lên đơn",
  totalProfit: "Total Profit / Lợi nhuận tổng lên đơn",
  receivedRevenue: "Received Revenue / Doanh thu thực nhận",
  receivedProfit: "Received Profit / Lợi nhuận thực nhận",
};

const REPORT_DATE_ALIASES = ["report date", "date", "ngay bao cao", "ngay"];

export function normalizeColumnName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseNumericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const source = String(value ?? "").trim();
  if (!source) return 0;

  const negative = source.includes("-") || /^\(.*\)$/.test(source);
  let numeric = source.replace(/[^0-9.,]/g, "");
  const commaCount = (numeric.match(/,/g) ?? []).length;
  const dotCount = (numeric.match(/\./g) ?? []).length;

  if (commaCount && dotCount) {
    const decimalSeparator = numeric.lastIndexOf(",") > numeric.lastIndexOf(".") ? "," : ".";
    const decimalLength = numeric.length - numeric.lastIndexOf(decimalSeparator) - 1;
    if (decimalLength > 0 && decimalLength <= 2) {
      const thousandsSeparator = decimalSeparator === "," ? /\./g : /,/g;
      numeric = numeric.replace(thousandsSeparator, "").replace(decimalSeparator, ".");
    } else {
      numeric = numeric.replace(/[.,]/g, "");
    }
  } else if (commaCount || dotCount) {
    const separator = commaCount ? "," : ".";
    const count = commaCount || dotCount;
    const decimalLength = numeric.length - numeric.lastIndexOf(separator) - 1;
    numeric =
      count === 1 && decimalLength > 0 && decimalLength <= 2
        ? numeric.replace(separator, ".")
        : numeric.replace(/[.,]/g, "");
  }

  const parsed = Number(numeric || 0);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

export function calculateDailyRow(row: RawDailyRow): DailyPerformanceRow {
  const totalCost = row.cogs + row.shipping + row.salary + row.fixedCost + row.ads;
  const grossProfit = row.revenue - totalCost;
  const estimatedReturn = row.revenue * 0.1;

  return {
    ...row,
    totalCost,
    grossProfit,
    estimatedReturn,
    netRevenue: row.revenue - estimatedReturn,
    netProfit: grossProfit - estimatedReturn,
  };
}

function findColumn(headers: string[], aliases: readonly string[]) {
  const normalizedHeaders = headers.map((original) => ({
    original,
    normalized: normalizeColumnName(original),
  }));

  for (const alias of aliases) {
    const match = normalizedHeaders.find((header) => header.normalized === alias);
    if (match) return match.original;
  }

  for (const alias of aliases) {
    const match = normalizedHeaders.find(
      (header) =>
        header.normalized.length > 2 &&
        (header.normalized.includes(alias) || alias.includes(header.normalized)),
    );
    if (match) return match.original;
  }

  return undefined;
}

function mapColumns<T extends Record<string, readonly string[]>>(headers: string[], definitions: T) {
  return Object.fromEntries(
    Object.entries(definitions).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  ) as { [K in keyof T]: string | undefined };
}

function getFilledValue(rows: Record<string, unknown>[], column?: string) {
  if (!column) return undefined;
  return rows.find((row) => String(row[column] ?? "").trim())?.[column];
}

function parseDate(value: unknown) {
  if (typeof value === "number" && value > 0) {
    const date = new Date(Math.round((value - 25_569) * 86_400_000));
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
    }
  }

  const text = String(value ?? "").trim();
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return isoDate
    ? `${isoDate[3].padStart(2, "0")}/${isoDate[2].padStart(2, "0")}/${isoDate[1]}`
    : text || undefined;
}

function scoreSheet<T extends Record<string, readonly string[]>>(sheet: SheetRows, definitions: T) {
  const columns = mapColumns(sheet.headers, definitions);
  return {
    sheet,
    columns,
    score: Object.values(columns).filter(Boolean).length,
  };
}

export async function parsePerformanceFile(file: File): Promise<ParsedPerformanceFile> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
    throw new Error("Định dạng không hợp lệ. Vui lòng chọn file .xlsx, .xls hoặc .csv.");
  }

  return parsePerformanceSheets(await readWorkbookSheets(await file.arrayBuffer()));
}

/** Picks the best-matching daily and cumulative sheets among the given sheets. */
export function parsePerformanceSheets(allSheets: SheetData[]): ParsedPerformanceFile {
  const sheets: SheetRows[] = allSheets.filter((sheet) => sheet.rows.length > 0);

  if (!sheets.length) throw new Error("File không có sheet hoặc dòng dữ liệu hợp lệ.");

  const dailyCandidates = sheets
    .map((sheet) => scoreSheet(sheet, DAILY_COLUMNS))
    .sort((a, b) => b.score - a.score);
  const dailyCandidate = dailyCandidates[0];
  const missingDaily = (Object.keys(DAILY_COLUMNS) as (keyof typeof DAILY_COLUMNS)[]).filter(
    (key) => !dailyCandidate.columns[key],
  );

  if (missingDaily.length) {
    throw new Error(
      `Thiếu cột bắt buộc trong dữ liệu ngày: ${missingDaily.map((key) => DAILY_LABELS[key]).join(", ")}.`,
    );
  }

  const dailyColumns = dailyCandidate.columns as Record<keyof typeof DAILY_COLUMNS, string>;
  const dailyRows = dailyCandidate.sheet.rows
    .map((row) =>
      calculateDailyRow({
        name: String(row[dailyColumns.name] ?? "").trim(),
        revenue: parseNumericValue(row[dailyColumns.revenue]),
        cogs: parseNumericValue(row[dailyColumns.cogs]),
        shipping: parseNumericValue(row[dailyColumns.shipping]),
        salary: parseNumericValue(row[dailyColumns.salary]),
        fixedCost: parseNumericValue(row[dailyColumns.fixedCost]),
        ads: parseNumericValue(row[dailyColumns.ads]),
      }),
    )
    .filter((row) => row.name);

  if (!dailyRows.length) {
    throw new Error("Đã nhận diện được cột nhưng không có nhân sự hợp lệ trong dữ liệu ngày.");
  }

  const cumulativeCandidates = sheets
    .map((sheet) => scoreSheet(sheet, CUMULATIVE_COLUMNS))
    .sort((a, b) => b.score - a.score);
  const cumulativeCandidate = cumulativeCandidates[0];
  const cumulativeKeys = Object.keys(CUMULATIVE_COLUMNS) as (keyof typeof CUMULATIVE_COLUMNS)[];
  const missingCumulative = cumulativeKeys.filter((key) => !cumulativeCandidate.columns[key]);
  const warnings: string[] = [];
  let cumulativeRows: CumulativePerformanceRow[] = [];
  let cumulativeSheetName: string | undefined;

  if (!missingCumulative.length) {
    const columns = cumulativeCandidate.columns as Record<keyof typeof CUMULATIVE_COLUMNS, string>;
    cumulativeRows = cumulativeCandidate.sheet.rows
      .map((row) => {
        const totalOrders = parseNumericValue(row[columns.totalOrders]);
        const successOrders = parseNumericValue(row[columns.successOrders]);
        return {
          name: String(row[columns.name] ?? "").trim(),
          totalOrders,
          successOrders,
          convRate: totalOrders > 0 ? (successOrders / totalOrders) * 100 : 0,
          totalRevenue: parseNumericValue(row[columns.totalRevenue]),
          totalProfit: parseNumericValue(row[columns.totalProfit]),
          receivedRevenue: parseNumericValue(row[columns.receivedRevenue]),
          receivedProfit: parseNumericValue(row[columns.receivedProfit]),
        };
      })
      .filter((row) => row.name);
    cumulativeSheetName = cumulativeCandidate.sheet.name;
  } else {
    warnings.push(
      cumulativeCandidate.score >= 2
        ? `Không đọc được lũy kế vì thiếu: ${missingCumulative.map((key) => CUMULATIVE_LABELS[key]).join(", ")}.`
        : "Không tìm thấy dữ liệu lũy kế tháng; báo cáo vẫn được tạo từ dữ liệu ngày.",
    );
  }

  const reportDateColumn = findColumn(dailyCandidate.sheet.headers, REPORT_DATE_ALIASES);

  return {
    dailyRows,
    cumulativeRows,
    reportDate: parseDate(getFilledValue(dailyCandidate.sheet.rows, reportDateColumn)),
    dailySheetName: dailyCandidate.sheet.name,
    cumulativeSheetName,
    warnings,
  };
}

/** Team totals plus the groupings the performance report needs (revenue split and net-profit ranking). */
export function summarizePerformance(dailyRows: DailyPerformanceRow[]) {
  const overview = dailyRows.reduce(
    (total, row) => ({
      revenue: total.revenue + row.revenue,
      cost: total.cost + row.totalCost,
      grossProfit: total.grossProfit + row.grossProfit,
      netProfit: total.netProfit + row.netProfit,
    }),
    { revenue: 0, cost: 0, grossProfit: 0, netProfit: 0 },
  );

  const totals = new Map([
    ["CSKH", 0],
    ["PAGE", 0],
    ["Khác", 0],
  ]);
  dailyRows.forEach((row) => {
    const name = row.name.toUpperCase();
    const group = name.includes("CSKH") ? "CSKH" : name.includes("PAGE") ? "PAGE" : "Khác";
    totals.set(group, (totals.get(group) ?? 0) + row.revenue);
  });
  const revenueDistribution = Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value !== 0);

  const rankedDailyRows = [...dailyRows].sort((a, b) => b.netProfit - a.netProfit);
  return { overview, revenueDistribution, rankedDailyRows };
}

import { findColumnByAlias, normalizeText, readWorkbookSheets } from "@/lib/workbook";
import { parseFinanceDate, parseFinanceNumber } from "@/utils/finance";
import type { ManualCostRow } from "./types";

const COLUMNS = {
  date: ["ngay", "date"],
  channel: ["kenh", "channel"],
  staff: ["nhan su", "ten nhan su", "staff"],
  salarySaleCskh: ["luong cskh sale", "luong sale cskh", "salary sale cskh"],
  salaryOther: ["luong bp khac", "luong bo phan khac", "luong cac bp khac", "salary other"],
  fixedCost: ["dinh phi", "chi phi co dinh", "fixed cost"],
  otherCost: ["chi phi khac", "other cost"],
  adsCost: ["chi phi marketing", "chi phi ads", "ads cost", "marketing"],
  returnProvision: ["du phong hoan", "return provision"],
  exchangeRate: ["ty gia", "exchange rate"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

const AMOUNT_KEYS = ["salarySaleCskh", "salaryOther", "fixedCost", "otherCost", "adsCost", "returnProvision"] as const;

export const COST_TEMPLATE_CSV = [
  ["Ngày", "Kênh", "Nhân sự", "Lương CSKH-Sale", "Lương BP khác", "Định phí", "Chi phí khác", "Chi phí marketing", "Dự phòng hoàn", "Tỷ giá"],
  // Shop VN, by channel. An empty date = the same amount every day.
  ["", "Zalo", "", "15000000", "6000000", "8000000", "3000000", "0", "13000000", ""],
  ["", "Page", "", "18000000", "8000000", "11000000", "4000000", "9000000", "18000000", ""],
  // Shop VN, per staff member (performance report). A date limits the line to that day.
  ["03/11/2026", "", "Tên nhân sự như trong POS", "500000", "0", "200000", "0", "0", "", ""],
  // Shop PH: no channel / staff = whole shop. "Tỷ giá" = 1 peso in VND.
  ["", "", "", "2500", "0", "", "", "1200", "", "450"],
]
  .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
  .join("\r\n");

function parseChannel(value: unknown, line: number) {
  const text = normalizeText(value);
  if (!text) return undefined;
  if (text.includes("zalo")) return "zalo" as const;
  if (text.includes("page") || text.includes("facebook") || text === "fb") return "page" as const;
  throw new Error(`Dòng ${line}: Kênh “${String(value)}” không hợp lệ (dùng Zalo hoặc Page).`);
}

/** Reads the cost file (.xlsx/.xls/.csv, first sheet with recognizable columns) into cost lines. */
export async function parseCostFile(file: File): Promise<ManualCostRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
    throw new Error("File chi phí phải là .xlsx, .xls hoặc .csv.");
  }

  const sheets = await readWorkbookSheets(await file.arrayBuffer(), { rawText: extension === "csv" });
  const sheet = sheets.find((candidate) =>
    AMOUNT_KEYS.some((key) => findColumnByAlias(candidate.headers, COLUMNS[key])),
  );
  if (!sheet) throw new Error("Không nhận diện được cột chi phí. Hãy dùng đúng tên cột trong file mẫu.");

  const columns = Object.fromEntries(
    (Object.keys(COLUMNS) as ColumnKey[]).map((key) => [key, findColumnByAlias(sheet.headers, COLUMNS[key])]),
  ) as Record<ColumnKey, string | undefined>;
  const read = (row: Record<string, unknown>, key: ColumnKey) => (columns[key] ? row[columns[key] as string] : undefined);

  const rows: ManualCostRow[] = [];
  sheet.rows.forEach((raw, index) => {
    const line = index + 2;
    const amounts = Object.fromEntries(AMOUNT_KEYS.map((key) => [key, parseFinanceNumber(read(raw, key))])) as Pick<
      ManualCostRow,
      (typeof AMOUNT_KEYS)[number]
    >;
    const rate = parseFinanceNumber(read(raw, "exchangeRate"));
    if (AMOUNT_KEYS.every((key) => amounts[key] === 0) && rate === 0) return;
    if (AMOUNT_KEYS.some((key) => amounts[key] < 0)) throw new Error(`Dòng ${line}: số tiền không được âm.`);

    const dateValue = read(raw, "date");
    const staff = String(read(raw, "staff") ?? "").trim();
    let date: string | undefined;
    if (String(dateValue ?? "").trim() !== "") {
      try {
        date = parseFinanceDate(dateValue as string | number | Date).iso;
      } catch {
        throw new Error(`Dòng ${line}: ngày “${String(dateValue)}” không hợp lệ.`);
      }
    }

    rows.push({
      ...amounts,
      date,
      channel: parseChannel(read(raw, "channel"), line),
      staff: staff || undefined,
      exchangeRate: rate > 0 ? rate : undefined,
    });
  });

  if (!rows.length) throw new Error("File chi phí không có dòng nào có số tiền.");
  return rows;
}

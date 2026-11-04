/**
 * The accountant's daily cost sheet: one list of costs per day (and per channel for the Vietnam shop) that the accountant
 * compiles and that is typed into the system through an Excel template instead of being estimated from monthly amounts.
 *
 * This file is pure (no database, no network): the columns of each shop's sheet, building the Excel template / export,
 * reading a filled file, validating cells and turning them into the cost lines the reports use.
 */
import { listDays, isValidIsoDate, toDmy } from "../pancake/dates";
import type { ManagementChannel, ManualCostRow } from "../pancake/types";
import { findColumnByAlias, normalizeText, readWorkbookSheets } from "../workbook";
import { parseFinanceDate, parseFinanceNumber } from "@/utils/finance";
import type { CostField } from "../pancake/costs";

/** Vietnam shop (dong, per channel) or Philippines shop (pesos, one department). */
export type SheetMarket = "VND" | "PHP";

export const SHEET_LINES = [
  "return_provision",
  "fixed_cost",
  "other_cost",
  "cogs",
  "shipping_ped_ph",
  "shipping_ph",
  "tax_fee",
] as const;
export type SheetLine = (typeof SHEET_LINES)[number];

/** "" = the whole shop (Philippines). */
export type SheetChannel = "" | ManagementChannel;
export type SheetCell = { date: string; channel: SheetChannel; line: SheetLine; amount: number };

/** The cost field of the report lines each sheet line feeds. */
export const FIELD_OF_LINE: Record<SheetLine, CostField> = {
  return_provision: "returnProvision",
  fixed_cost: "fixedCost",
  other_cost: "otherCost",
  cogs: "cogs",
  shipping_ped_ph: "shippingCost",
  shipping_ph: "shippingCost",
  tax_fee: "taxFee",
};

export type SheetColumn = {
  line: SheetLine;
  /** Header written in the template. */
  header: string;
  /** Other spellings accepted when reading a file (normalized: no accents, lower case). */
  aliases: string[];
  /** One line explaining what to put in the column. */
  hint: string;
};

export const SHEET_COLUMNS: Record<SheetMarket, SheetColumn[]> = {
  VND: [
    {
      line: "return_provision",
      header: "Giá vốn dự tính hoàn",
      aliases: ["gia von du tinh hoan", "gia von hoan", "du phong hoan"],
      hint: "Dự phòng giá vốn hàng hoàn của kênh trong ngày.",
    },
    {
      line: "fixed_cost",
      header: "Chi phí cố định",
      aliases: ["chi phi co dinh", "chi phi co dinh khac", "dinh phi"],
      hint: "Định phí phân bổ cho kênh trong ngày.",
    },
    {
      line: "other_cost",
      header: "Chi phí khác",
      aliases: ["chi phi khac"],
      hint: "Chi phí phát sinh khác của kênh trong ngày.",
    },
  ],
  PHP: [
    {
      line: "cogs",
      header: "Giá vốn hàng bán",
      aliases: ["gia von hang ban", "gia von"],
      hint: "Giá vốn của ngày (POS shop Phil không có giá vốn).",
    },
    {
      line: "return_provision",
      header: "CP dự phòng rủi ro hàng tồn",
      aliases: ["cp du phong rui ro hang ton", "du phong rui ro hang ton", "cp du phong", "du phong"],
      hint: "Trừ vào doanh số để ra doanh thu thuần.",
    },
    {
      line: "fixed_cost",
      header: "Chi phí dịch vụ mua ngoài",
      aliases: ["chi phi dich vu mua ngoai", "dich vu mua ngoai"],
      hint: "Chi phí dịch vụ mua ngoài của ngày.",
    },
    {
      line: "shipping_ped_ph",
      header: "Giao hàng từ PED đến Phi",
      aliases: ["chi phi giao hang tu ped den phi", "giao hang tu ped den phi", "ped den phi"],
      hint: "Có số thì thay cho phí vận chuyển POS (cộng với cột bên cạnh).",
    },
    {
      line: "shipping_ph",
      header: "Giao hàng bên Phi",
      aliases: ["chi phi giao hang ben phi", "giao hang ben phi", "ben phi"],
      hint: "Phí giao hàng trong nước Phi.",
    },
    {
      line: "other_cost",
      header: "Chi phí khác",
      aliases: ["chi phi khac"],
      hint: "Chi phí bán hàng khác.",
    },
    {
      line: "tax_fee",
      header: "Thuế, phí và lệ phí",
      aliases: ["thue phi va le phi", "thue phi le phi", "thue phi", "thue"],
      hint: "Chi phí quản lý doanh nghiệp, trừ riêng sau chi phí bán hàng.",
    },
  ],
};

/**
 * Columns an accountant's list may still carry but that this sheet does not take: pay is typed in the system (tab “Lương nhân
 * sự”) and ad spend is read from Meta by itself. They are skipped, with a note, instead of being read twice.
 */
const SKIPPED_COLUMNS: { label: string; aliases: string[] }[] = [
  { label: "lương (nhập ở tab Lương nhân sự)", aliases: ["chi phi luong", "luong cskh", "luong sale", "luong cac bo phan khac", "luong bo phan khac", "luong bp khac", "cac bo phan khac", "sale page", "cskh", "luong"] },
  { label: "ads (tự lấy từ Ads Meta)", aliases: ["chi phi ads", "chi phi marketing", "ty le ads", "ads", "marketing"] },
];

/** The channels one row of the template is written for. */
export const SHEET_CHANNELS: Record<SheetMarket, SheetChannel[]> = { VND: ["zalo", "page"], PHP: [""] };
export const CHANNEL_NAME: Record<ManagementChannel, string> = { zalo: "Zalo", page: "Page" };

/** Most days / cells one import can carry (a year of days for two channels is 730 rows). */
export const MAX_SHEET_DAYS = 400;
export const MAX_SHEET_CELLS = 8_000;

const cellKey = (cell: Pick<SheetCell, "date" | "channel" | "line">) => `${cell.date}|${cell.channel}|${cell.line}`;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function sheetMarketOf(currency: string | undefined): SheetMarket {
  return currency?.toUpperCase() === "PHP" ? "PHP" : "VND";
}

// ---------------------------------------------------------------------------------------------------------- validation

export type ValidatedCells = { ok: true; cells: SheetCell[] } | { ok: false; error: string };

/** Checks cells that came from the browser (or the database) against the sheet of a market. */
export function validateSheetCells(value: unknown, market: SheetMarket): ValidatedCells {
  if (!Array.isArray(value)) return { ok: false, error: "Danh sách chi phí không hợp lệ." };
  if (value.length === 0) return { ok: false, error: "Không có ô chi phí nào để lưu." };
  if (value.length > MAX_SHEET_CELLS) return { ok: false, error: `Mỗi lần chỉ lưu tối đa ${MAX_SHEET_CELLS} ô.` };

  const allowedLines = new Set<SheetLine>(SHEET_COLUMNS[market].map((column) => column.line));
  const allowedChannels = new Set<SheetChannel>(SHEET_CHANNELS[market]);
  const seen = new Set<string>();
  const dates = new Set<string>();
  const cells: SheetCell[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false, error: "Có ô chi phí không hợp lệ." };
    const raw = item as Record<string, unknown>;
    if (!isValidIsoDate(raw.date)) return { ok: false, error: "Có ô chi phí với ngày không hợp lệ." };
    const channel = (raw.channel ?? "") as SheetChannel;
    if (!allowedChannels.has(channel)) {
      return { ok: false, error: market === "VND" ? "Mỗi ô chi phí của shop Việt Nam phải thuộc kênh Zalo hoặc Page." : "Shop Philippines không chia theo kênh." };
    }
    const line = raw.line as SheetLine;
    if (!allowedLines.has(line)) return { ok: false, error: `Khoản “${String(raw.line)}” không có trong bảng của shop này.` };
    const amount = raw.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1e12) {
      return { ok: false, error: "Số tiền phải là số không âm." };
    }
    const cell: SheetCell = { date: raw.date, channel, line, amount: round2(amount) };
    if (seen.has(cellKey(cell))) return { ok: false, error: `Ô ${toDmy(cell.date)} bị trùng trong danh sách.` };
    seen.add(cellKey(cell));
    dates.add(cell.date);
    cells.push(cell);
  }
  if (dates.size > MAX_SHEET_DAYS) return { ok: false, error: `Mỗi lần chỉ lưu tối đa ${MAX_SHEET_DAYS} ngày.` };
  return { ok: true, cells };
}

// ------------------------------------------------------------------------------------------------- cells -> report lines

/** One cost line per day and channel, carrying all the amounts of that day. They win over estimates (see applySheetPrecedence). */
export function sheetCellsToCostRows(cells: SheetCell[]): ManualCostRow[] {
  const rows = new Map<string, ManualCostRow>();
  for (const cell of cells) {
    if (cell.amount <= 0) continue;
    const key = `${cell.date}|${cell.channel}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        date: cell.date,
        channel: cell.channel || undefined,
        salarySaleCskh: 0,
        salaryOther: 0,
        fixedCost: 0,
        otherCost: 0,
        adsCost: 0,
        returnProvision: 0,
        fromSheet: true,
      };
      rows.set(key, row);
    }
    const field = FIELD_OF_LINE[cell.line];
    row[field] = round2((row[field] ?? 0) + cell.amount);
  }
  return Array.from(rows.values()).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

// --------------------------------------------------------------------------------------------------------- the workbook

function rowsFor(market: SheetMarket, from: string, to: string, cells: SheetCell[]) {
  const columns = SHEET_COLUMNS[market];
  const channels = SHEET_CHANNELS[market];
  const byKey = new Map(cells.map((cell) => [cellKey(cell), cell.amount]));
  const header = ["Ngày", ...(market === "VND" ? ["Kênh"] : []), ...columns.map((column) => column.header)];
  const body = listDays(from, to).flatMap((date) =>
    channels.map((channel) => [
      toDmy(date),
      ...(market === "VND" ? [CHANNEL_NAME[channel as ManagementChannel]] : []),
      ...columns.map((column) => byKey.get(cellKey({ date, channel, line: column.line })) ?? ""),
    ]),
  );
  return [header, ...body];
}

function guideRows(market: SheetMarket) {
  const columns = SHEET_COLUMNS[market];
  return [
    ["HƯỚNG DẪN NHẬP BẢNG CHI PHÍ KẾ TOÁN THEO NGÀY"],
    [market === "VND" ? "Shop Việt Nam · đơn vị: đồng (₫) · mỗi ngày có 2 dòng: Zalo và Page" : "Shop Philippines · đơn vị: peso (₱) · mỗi ngày 1 dòng"],
    [],
    ["1. Điền số tiền vào các ô của sheet “Chi phí theo ngày”. Không đổi tên cột, không xoá cột Ngày / Kênh."],
    ["2. Ô để trống = giữ nguyên số đã lưu. Ô điền 0 = lưu là 0. Muốn xoá cả ngày, dùng nút xoá trên trang."],
    ["3. Doanh số và giá vốn (Việt Nam) lấy tự động từ Pancake POS, không điền ở đây. Dòng “Tổng” của kế toán không cần điền (hệ thống tự cộng)."],
    ["4. Nhập lại cùng ngày sẽ ghi đè số cũ của ngày đó; nhập nhiều lần không bị cộng dồn."],
    ["5. Ngày nào bảng này có số (>0) cho một khoản thì hệ thống dùng số kế toán thay cho số ước tính của đúng ngày và khoản đó (ví dụ chi phí cố định nhập hằng tháng)."],
    ["6. Lương nhân sự nhập ở tab “Lương nhân sự” trên hệ thống; chi phí ads tự lấy từ Ads Meta. Hai khoản này KHÔNG điền vào file."],
    [],
    ["Cột", "Ý nghĩa"],
    ...columns.map((column) => [column.header, column.hint]),
  ];
}

/**
 * The Excel file: a sheet “Chi phí theo ngày” with a row per day (and channel) from `from` to `to`, filled with the amounts
 * already stored in `cells`, and a sheet “Hướng dẫn”. With no cells it is the blank template.
 */
export async function buildSheetWorkbook(market: SheetMarket, from: string, to: string, cells: SheetCell[] = []): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  const data = XLSX.utils.aoa_to_sheet(rowsFor(market, from, to, cells));
  const columnCount = SHEET_COLUMNS[market].length + (market === "VND" ? 2 : 1);
  data["!cols"] = Array.from({ length: columnCount }, (_, index) => ({ wch: index === 0 ? 12 : index === 1 && market === "VND" ? 8 : 24 }));
  XLSX.utils.book_append_sheet(workbook, data, "Chi phí theo ngày");

  const guide = XLSX.utils.aoa_to_sheet(guideRows(market));
  guide["!cols"] = [{ wch: 34 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, guide, "Hướng dẫn");

  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// ---------------------------------------------------------------------------------------------------------- reading a file

export type ParsedSheet = {
  cells: SheetCell[];
  /** Problems that make the file unsafe to save: nothing is saved while there are any. */
  errors: string[];
  /** Things worth knowing that do not stop the import (skipped total rows, empty rows…). */
  notes: string[];
  days: string[];
};

/** Empty, or a dash the accountant typed for "nothing". */
function isEmptyCell(value: unknown) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return text === "" || /^[-–—]+$/.test(text);
}

/**
 * SheetJS reads a CSV without a byte-order mark in an old Western code page, which garbles Vietnamese headers. A CSV that is
 * valid UTF-8 gets the mark so it is read as UTF-8 (what Excel's "CSV UTF-8" and most tools write).
 */
function asUtf8Csv(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return data;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return data;
  }
  const withMark = new Uint8Array(bytes.length + 3);
  withMark.set([0xef, 0xbb, 0xbf]);
  withMark.set(bytes, 3);
  return withMark.buffer;
}

/** Reads a filled template (.xlsx / .xls / .csv). Never throws for bad content: problems are listed in `errors`. */
export async function parseSheetFile(data: ArrayBuffer, extension: string, market: SheetMarket): Promise<ParsedSheet> {
  const result: ParsedSheet = { cells: [], errors: [], notes: [], days: [] };
  const sheets = await readWorkbookSheets(extension === "csv" ? asUtf8Csv(data) : data, { rawText: extension === "csv" });
  const columns = SHEET_COLUMNS[market];

  const sheet = sheets.find(
    (candidate) => findColumnByAlias(candidate.headers, ["ngay", "date"]) && columns.some((column) => findColumnByAlias(candidate.headers, column.aliases)),
  );
  if (!sheet) {
    result.errors.push("Không nhận diện được bảng: cần cột Ngày và ít nhất một cột chi phí. Hãy dùng đúng tên cột của file mẫu.");
    return result;
  }

  const dateColumn = findColumnByAlias(sheet.headers, ["ngay", "date"]) as string;
  const channelColumn = findColumnByAlias(sheet.headers, ["kenh", "channel"]);
  if (market === "VND" && !channelColumn) {
    result.errors.push("Shop Việt Nam cần cột Kênh (Zalo / Page) trong bảng.");
    return result;
  }

  const mapped: { column: SheetColumn; header: string }[] = [];
  const claimed = new Map<string, string>();
  for (const column of columns) {
    const header = findColumnByAlias(sheet.headers, column.aliases);
    if (!header) continue;
    if (header === dateColumn || header === channelColumn) continue;
    const owner = claimed.get(header);
    if (owner) {
      result.errors.push(`Cột “${header}” khớp với cả “${owner}” và “${column.header}”. Hãy đổi tên cột cho rõ.`);
      continue;
    }
    claimed.set(header, column.header);
    mapped.push({ column, header });
  }
  const skipped = SKIPPED_COLUMNS.filter((group) => {
    const header = findColumnByAlias(sheet.headers, group.aliases);
    return header !== undefined && header !== dateColumn && header !== channelColumn && !claimed.has(header);
  });
  if (skipped.length) result.notes.push(`Bỏ qua cột ${skipped.map((group) => group.label).join("; ")}.`);
  const missing = columns.filter((column) => !mapped.some((item) => item.column.line === column.line)).map((column) => column.header);
  if (missing.length) result.notes.push(`Không có cột: ${missing.join(", ")} (các khoản này giữ nguyên).`);
  if (result.errors.length) return result;

  const seen = new Map<string, number>();
  const days = new Set<string>();
  let totalRows = 0;

  sheet.rows.forEach((raw, index) => {
    const line = index + 2;
    const amounts = mapped.filter(({ header }) => !isEmptyCell(raw[header]));
    const dateRaw = raw[dateColumn];
    if (isEmptyCell(dateRaw)) {
      if (amounts.length) result.errors.push(`Dòng ${line}: có số tiền nhưng thiếu Ngày.`);
      return;
    }

    let date: string;
    try {
      date = parseFinanceDate(dateRaw as string | number | Date).iso;
    } catch {
      result.errors.push(`Dòng ${line}: ngày “${String(dateRaw)}” không hợp lệ.`);
      return;
    }

    let channel: SheetChannel = "";
    if (market === "VND") {
      const text = normalizeText(raw[channelColumn as string]);
      if (text.includes("tong") || text.includes("cong")) {
        totalRows += 1;
        return;
      }
      if (text.includes("zalo")) channel = "zalo";
      else if (text.includes("page") || text.includes("facebook") || text === "fb") channel = "page";
      else {
        if (amounts.length) result.errors.push(`Dòng ${line}: Kênh “${String(raw[channelColumn as string] ?? "")}” không hợp lệ (dùng Zalo hoặc Page).`);
        return;
      }
    }
    if (!amounts.length) return;

    for (const { column, header } of amounts) {
      const text = String(raw[header]).trim();
      const amount = parseFinanceNumber(raw[header]);
      if (!/\d/.test(text) && typeof raw[header] !== "number") {
        result.errors.push(`Dòng ${line}, cột “${column.header}”: “${text}” không phải số.`);
        continue;
      }
      if (amount < 0) {
        result.errors.push(`Dòng ${line}, cột “${column.header}”: số tiền không được âm.`);
        continue;
      }
      const cell: SheetCell = { date, channel, line: column.line, amount: round2(amount) };
      const first = seen.get(cellKey(cell));
      if (first) {
        result.errors.push(`Dòng ${line} trùng ngày${market === "VND" ? "/kênh" : ""} với dòng ${first} (cột “${column.header}”).`);
        continue;
      }
      seen.set(cellKey(cell), line);
      result.cells.push(cell);
      days.add(date);
    }
  });

  result.days = Array.from(days).sort();
  if (totalRows) result.notes.push(`Bỏ qua ${totalRows} dòng “Tổng” (hệ thống tự cộng Zalo + Page).`);
  if (result.days.length > MAX_SHEET_DAYS) result.errors.push(`File có ${result.days.length} ngày, tối đa ${MAX_SHEET_DAYS} ngày mỗi lần.`);
  if (!result.cells.length && !result.errors.length) result.errors.push("File không có ô nào có số tiền.");
  return result;
}

/** How a parsed file compares with what is stored: new cells, changed values, unchanged ones. */
export function compareWithStored(cells: SheetCell[], stored: SheetCell[]) {
  const before = new Map(stored.map((cell) => [cellKey(cell), cell.amount]));
  let added = 0;
  let changed = 0;
  let same = 0;
  for (const cell of cells) {
    const old = before.get(cellKey(cell));
    if (old === undefined) added += 1;
    else if (old !== cell.amount) changed += 1;
    else same += 1;
  }
  return { added, changed, same };
}

/** Totals per sheet line (for the preview). */
export function totalsByLine(cells: SheetCell[]) {
  const totals = new Map<SheetLine, number>();
  for (const cell of cells) totals.set(cell.line, round2((totals.get(cell.line) ?? 0) + cell.amount));
  return totals;
}

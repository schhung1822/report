import { parseDailyRows, type DailyReportData } from "@/lib/daily-report";
import { parseFinancialManagementSheets } from "@/lib/financial-management";
import { parsePerformanceSheets, type CumulativePerformanceRow, type DailyPerformanceRow, type SharedPerformanceCosts } from "@/lib/performance-report";
import { PH_DEFAULT_EXCHANGE_RATE, parsePhilippinesSheet, processPhilippinesRows } from "@/lib/philippines-report";
import { normalizeText, readWorkbookSheets, type SheetData } from "@/lib/workbook";
import type { RawDailyFinanceRow } from "@/types/finance";
import type { ProcessedManagementReport } from "@/types/financial-management";

export type ReportKey = "daily" | "performance" | "vn" | "ph";

export const REPORT_LABELS: Record<ReportKey, string> = {
  daily: "Báo cáo ngày",
  performance: "Hiệu suất",
  vn: "Quản trị TC · Việt",
  ph: "Quản trị TC · Philippines",
};

export type SheetStatus = {
  key: ReportKey;
  state: "ok" | "missing" | "error";
  /** Sheet(s) the data was read from. */
  sheetName?: string;
  message?: string;
};

export type ConsolidatedData = {
  daily: DailyReportData | null;
  performance: { dailyRows: DailyPerformanceRow[]; cumulativeRows: CumulativePerformanceRow[]; reportDate?: string; sharedCosts?: SharedPerformanceCosts } | null;
  vn: ProcessedManagementReport | null;
  /** Raw peso rows; processed on the page so the exchange rate stays editable. */
  phRows: RawDailyFinanceRow[] | null;
  statuses: SheetStatus[];
};

function findSheet(sheets: SheetData[], test: (normalizedName: string) => boolean) {
  return sheets.find((sheet) => test(normalizeText(sheet.name)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không thể đọc sheet này.";
}

/** Reads a multi-sheet workbook (see the template) into data for each report tab. One bad sheet never blocks the others. */
export async function parseConsolidatedWorkbook(buffer: ArrayBuffer): Promise<ConsolidatedData> {
  const sheets = await readWorkbookSheets(buffer);

  const dailySheet = findSheet(sheets, (name) => name.includes("bao cao ngay"));
  const perfDaily = findSheet(sheets, (name) => name.includes("hieu suat") && name.includes("ngay"));
  const perfCumulative = findSheet(sheets, (name) => name.includes("hieu suat") && name.includes("luy ke"));
  const phSheet = findSheet(sheets, (name) => name.includes("philippines"));
  const vnSheet = findSheet(sheets, (name) => name.includes("viet") && !name.includes("philippines"));

  const result: ConsolidatedData = { daily: null, performance: null, vn: null, phRows: null, statuses: [] };
  const record = (key: ReportKey, sheetName: string | undefined, run: () => string | void) => {
    if (!sheetName) {
      result.statuses.push({ key, state: "missing" });
      return;
    }
    try {
      const message = run();
      result.statuses.push({ key, state: "ok", sheetName, message: message || undefined });
    } catch (error) {
      result.statuses.push({ key, state: "error", sheetName, message: errorMessage(error) });
    }
  };

  record("daily", dailySheet?.name, () => {
    const { data, missingColumns } = parseDailyRows(dailySheet!.rows);
    result.daily = data;
    if (missingColumns) return `${missingColumns} cột chưa tìm thấy, được đặt bằng 0.`;
  });

  record("performance", perfDaily?.name, () => {
    const parsed = parsePerformanceSheets([perfDaily!, ...(perfCumulative ? [perfCumulative] : [])]);
    result.performance = { dailyRows: parsed.dailyRows, cumulativeRows: parsed.cumulativeRows, reportDate: parsed.reportDate };
    if (parsed.warnings.length) return parsed.warnings.join(" ");
  });

  record("vn", vnSheet?.name, () => {
    const report = parseFinancialManagementSheets([vnSheet!]);
    result.vn = report;
    const hasPage = report.summary.actual.page.revenue !== 0 || report.summary.estimated.page.revenue !== 0;
    // This sheet only carries the Zalo channel, so "missing Page rows" warnings are expected noise.
    const notes = report.warnings.filter((warning) => !/\bPage\b/.test(warning));
    if (hasPage) notes.push("Sheet có dữ liệu kênh Page — báo cáo Việt chỉ hiển thị kênh Zalo.");
    if (notes.length) return notes.join(" ");
  });

  record("ph", phSheet?.name, () => {
    const parsed = parsePhilippinesSheet(phSheet!);
    // Validate dates and numbers now, so problems show up on upload rather than later.
    processPhilippinesRows(parsed.rows, PH_DEFAULT_EXCHANGE_RATE);
    result.phRows = parsed.rows;
    if (parsed.warnings.length) return parsed.warnings.join(" ");
  });

  if (result.statuses.every((status) => status.state === "missing")) {
    throw new Error(
      "Không tìm thấy sheet báo cáo nào. Hãy dùng đúng tên sheet như trong file mẫu (Báo cáo ngày, Hiệu suất - Ngày, QTTC Việt, QTTC Philippines).",
    );
  }
  return result;
}

import type { OpenOrders, PreviousDay, RefundTrend } from "@/lib/pancake/types";
import type { CumulativePerformanceRow, DailyPerformanceRow, SharedPerformanceCosts } from "@/lib/performance-report";
import type { RawDailyFinanceRow } from "@/types/finance";
import type { ProcessedManagementReport } from "@/types/financial-management";

/** The reports the external API sends to Lark, in the order they are sent. */
export type ExternalReportKey = "performance" | "vn" | "ph";

export const EXTERNAL_REPORT_LABELS: Record<ExternalReportKey, string> = {
  performance: "Hiệu suất",
  vn: "Quản trị Việt",
  ph: "Quản trị Phil",
};

/** Same paper sizes as the "Tải PDF" button of the consolidated report page. */
export const EXTERNAL_PDF_FORMAT: Record<ExternalReportKey, "a4" | "a3"> = { performance: "a4", vn: "a3", ph: "a3" };

type Reconcile = { shopId: number | number[]; to: string };

/**
 * What the print page (/print/report) needs to draw one report. The server hands it to the page before it loads
 * (window.__REPORT_PAYLOAD__); the page then draws it with the very same views as the report pages.
 */
export type PrintPayload =
  | {
      type: "performance";
      dailyRows: DailyPerformanceRow[];
      cumulativeRows: CumulativePerformanceRow[];
      sharedCosts?: SharedPerformanceCosts;
      reportDate: string;
    }
  | { type: "vn"; report: ProcessedManagementReport; reconcile?: Reconcile }
  | {
      type: "ph";
      /** Raw peso rows: the page processes them with the exchange rate, as the report page does. */
      phRows: RawDailyFinanceRow[];
      rate: number;
      reconcile?: Reconcile;
      previousDay?: PreviousDay;
      refundTrend?: RefundTrend;
      openOrders?: OpenOrders;
      mergedShops?: string[];
    };

declare global {
  interface Window {
    __REPORT_PAYLOAD__?: PrintPayload;
    /** Set by the print page once the report is drawn. */
    __reportReady?: boolean;
    /** Set by the print page: renders the report to a PDF and returns it as base64. */
    __makePdf?: (format: "a4" | "a3") => Promise<string>;
  }
}

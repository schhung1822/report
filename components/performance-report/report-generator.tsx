"use client";

import { useRef, useState } from "react";
import { FileDown, RotateCcw } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { PancakeSyncCard } from "@/components/pancake-sync-card";
import { PerformanceReportView } from "@/components/reports/performance-report-view";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildPerformanceAnalysisData } from "@/lib/analysis-data";
import {
  calculateDailyRow,
  CumulativePerformanceRow,
  parsePerformanceFile,
} from "@/lib/performance-report";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import {
  larkSentMessage,
  renderReportToPng,
  safeFilePart,
  saveReportAsPdf,
  sendReportToLark,
  triggerDownload,
  type LarkFormat,
} from "@/lib/report-export";

const SAMPLE_DAILY_ROWS = [
  calculateDailyRow({ name: "DIỆU LINH CSKH", revenue: 68_500_000, cogs: 31_200_000, shipping: 4_100_000, salary: 5_500_000, fixedCost: 2_100_000, ads: 7_800_000 }),
  calculateDailyRow({ name: "NGỌC ANH CSKH", revenue: 55_800_000, cogs: 27_400_000, shipping: 3_600_000, salary: 5_200_000, fixedCost: 1_900_000, ads: 6_900_000 }),
  calculateDailyRow({ name: "THU HÀ CSKH", revenue: 42_700_000, cogs: 20_600_000, shipping: 3_100_000, salary: 4_800_000, fixedCost: 1_800_000, ads: 5_500_000 }),
  calculateDailyRow({ name: "HỒNG PAGE 1", revenue: 74_200_000, cogs: 36_800_000, shipping: 4_900_000, salary: 5_900_000, fixedCost: 2_200_000, ads: 9_600_000 }),
  calculateDailyRow({ name: "TRANG PAGE 2", revenue: 61_300_000, cogs: 31_700_000, shipping: 4_300_000, salary: 5_600_000, fixedCost: 2_100_000, ads: 8_100_000 }),
  calculateDailyRow({ name: "MINH PAGE 3", revenue: 28_900_000, cogs: 17_600_000, shipping: 2_900_000, salary: 4_700_000, fixedCost: 1_700_000, ads: 6_200_000 }),
  calculateDailyRow({ name: "LAN CSKH", revenue: 23_600_000, cogs: 14_900_000, shipping: 2_500_000, salary: 4_500_000, fixedCost: 1_600_000, ads: 4_800_000 }),
];

const SAMPLE_CUMULATIVE_ROWS: CumulativePerformanceRow[] = [
  { name: "DIỆU LINH CSKH", totalOrders: 568, successOrders: 491, convRate: 86.44, totalRevenue: 1_625_000_000, totalProfit: 412_000_000, receivedRevenue: 1_428_000_000, receivedProfit: 354_000_000 },
  { name: "HỒNG PAGE 1", totalOrders: 602, successOrders: 503, convRate: 83.55, totalRevenue: 1_744_000_000, totalProfit: 398_000_000, receivedRevenue: 1_502_000_000, receivedProfit: 321_000_000 },
  { name: "NGỌC ANH CSKH", totalOrders: 511, successOrders: 431, convRate: 84.34, totalRevenue: 1_420_000_000, totalProfit: 338_000_000, receivedRevenue: 1_236_000_000, receivedProfit: 286_000_000 },
  { name: "TRANG PAGE 2", totalOrders: 496, successOrders: 402, convRate: 81.05, totalRevenue: 1_362_000_000, totalProfit: 306_000_000, receivedRevenue: 1_148_000_000, receivedProfit: 247_000_000 },
  { name: "THU HÀ CSKH", totalOrders: 447, successOrders: 359, convRate: 80.31, totalRevenue: 1_184_000_000, totalProfit: 264_000_000, receivedRevenue: 987_000_000, receivedProfit: 211_000_000 },
  { name: "MINH PAGE 3", totalOrders: 389, successOrders: 296, convRate: 76.09, totalRevenue: 918_000_000, totalProfit: 176_000_000, receivedRevenue: 744_000_000, receivedProfit: 137_000_000 },
  { name: "LAN CSKH", totalOrders: 328, successOrders: 241, convRate: 73.48, totalRevenue: 762_000_000, totalProfit: 128_000_000, receivedRevenue: 601_000_000, receivedProfit: 92_000_000 },
];

export default function ReportGenerator() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [dailyRows, setDailyRows] = useState(SAMPLE_DAILY_ROWS);
  const [cumulativeRows, setCumulativeRows] = useState(SAMPLE_CUMULATIVE_ROWS);
  const [reportDate, setReportDate] = useState("02/11/2026");
  const [summary, setSummary] = useState(
    "Doanh thu trong ngày duy trì tích cực. Nhóm cần tiếp tục tối ưu tỷ lệ hoàn và kiểm soát chi phí quảng cáo ở các nhân sự có lợi nhuận ròng âm.",
  );
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  const [notice, setNotice] = useState<NoticeState>({
    type: "success",
    message: "Đang hiển thị dữ liệu mẫu để xem trước bố cục báo cáo.",
  });

  async function handleFile(file: File) {
    setIsParsing(true);
    setNotice({ type: "warning", message: "Đang đọc và kiểm tra cấu trúc file..." });
    try {
      const parsed = await parsePerformanceFile(file);
      setDailyRows(parsed.dailyRows);
      setCumulativeRows(parsed.cumulativeRows);
      setFileName(file.name);
      if (parsed.reportDate) setReportDate(parsed.reportDate);

      const sheetMessage = parsed.cumulativeSheetName
        ? `Daily: “${parsed.dailySheetName}”, lũy kế: “${parsed.cumulativeSheetName}”.`
        : `Daily: “${parsed.dailySheetName}”.`;
      setNotice({
        type: parsed.warnings.length ? "warning" : "success",
        message: `Đã nhập ${parsed.dailyRows.length} nhân sự. ${sheetMessage}${parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : ""}`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Không thể đọc file dữ liệu.",
      });
    } finally {
      setIsParsing(false);
    }
  }

  function resetSample() {
    setDailyRows(SAMPLE_DAILY_ROWS);
    setCumulativeRows(SAMPLE_CUMULATIVE_ROWS);
    setFileName("");
    setNotice({ type: "success", message: "Đã khôi phục dữ liệu mẫu." });
  }

  function downloadCsvTemplate() {
    const rows = [
      ["Ngày báo cáo", "Tên nhân sự", "Tổng tiền đơn hàng", "Giá vốn đơn ban đầu", "Chi phí vận chuyển", "Chi phí lương", "Chi phí cố định", "Chi phí ads"],
      ["02/11/2026", "DIỆU LINH CSKH", "68500000", "31200000", "4100000", "5500000", "2100000", "7800000"],
      ["", "HỒNG PAGE 1", "74200000", "36800000", "4900000", "5900000", "2200000", "9600000"],
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    triggerDownload(url, "mau-bao-cao-hieu-suat.csv");
    URL.revokeObjectURL(url);
  }

  async function exportImage() {
    setExporting("image");
    try {
      const dataUrl = await renderReportToPng(reportRef.current);
      triggerDownload(dataUrl, `bao-cao-hieu-suat-${safeFilePart(reportDate)}.png`);
      setNotice({ type: "success", message: "Đã tải ảnh báo cáo PNG chất lượng cao." });
    } catch {
      setNotice({ type: "error", message: "Không thể tạo ảnh báo cáo. Vui lòng thử lại." });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      await saveReportAsPdf(reportRef.current, `bao-cao-hieu-suat-${safeFilePart(reportDate)}.pdf`, { margin: 7 });
      setNotice({ type: "success", message: "Đã tải báo cáo PDF A4 dọc." });
    } catch {
      setNotice({ type: "error", message: "Không thể xuất PDF. Vui lòng thử lại." });
    } finally {
      setExporting(null);
    }
  }

  async function sendToLark(format: LarkFormat) {
    // Same as exporting: swap the editable summary for static text so it appears in the image.
    setExporting(format === "pdf" ? "pdf" : "image");
    try {
      await sendReportToLark(reportRef.current, `bao-cao-hieu-suat-${safeFilePart(reportDate)}.png`, { format, pdf: { margin: 7 } });
      setNotice({ type: "success", message: larkSentMessage(format) });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark." });
    } finally {
      setExporting(null);
    }
  }

  return (
    <ReportWorkspace
      header={
        <PageHeader title="Báo cáo hiệu suất" description="Phân tích doanh thu, lợi nhuận và lũy kế theo nhân sự.">
          <Input
            value={reportDate}
            onChange={(event) => setReportDate(event.target.value)}
            aria-label="Ngày báo cáo"
            placeholder="dd/mm/yyyy"
            className="h-9 w-36 font-medium"
          />
          <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
          <SendToLarkButton reportName="Báo cáo hiệu suất" disabled={exporting !== null} onConfirm={sendToLark} />
        </PageHeader>
      }
      aside={
        <>
          <PancakeSyncCard
            currencies={["VND"]}
            hint="Tự lấy doanh thu, giá vốn, phí vận chuyển, ads và lũy kế tháng theo từng nhân sự của shop Việt Nam. Lương và định phí từng người nhập ở mục “Chi phí nhân sự”."
            onSynced={({ performance }) => {
              if (!performance) return;
              setDailyRows(performance.dailyRows);
              setCumulativeRows(performance.cumulativeRows);
              setReportDate(performance.reportDate);
              setFileName("");
            }}
          />

          <ConfigSection title="Tệp dữ liệu" collapsible defaultOpen={!fileName}>
            <FileDropzone
              compact
              fileName={fileName}
              isParsing={isParsing}
              hint="Tự nhận diện sheet daily và lũy kế"
              onFile={(file) => void handleFile(file)}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="outline" size="sm" onClick={downloadCsvTemplate}>
                <FileDown />
                CSV mẫu
              </Button>
              <Button variant="outline" size="sm" onClick={resetSample}>
                <RotateCcw />
                Dữ liệu mẫu
              </Button>
            </div>
          </ConfigSection>
        </>
      }
    >
      <Notice notice={notice} />

      <AiAnalysisPanel
        reportType="performance"
        onUseSummary={setSummary}
        getData={() => buildPerformanceAnalysisData(dailyRows, cumulativeRows, reportDate)}
      />

      <ReportViewport>
        <PerformanceReportView
          reportRef={reportRef}
          dailyRows={dailyRows}
          cumulativeRows={cumulativeRows}
          reportDate={reportDate}
          summary={summary}
          onSummaryChange={setSummary}
          exporting={exporting !== null}
        />
      </ReportViewport>
    </ReportWorkspace>
  );
}

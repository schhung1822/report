"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Clipboard, RotateCcw } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { PancakeSyncCard } from "@/components/pancake-sync-card";
import {
  ExportButtons,
  PageHeader,
  ReportFooter,
  ReportHeader,
  ReportViewport,
} from "@/components/report-ui";
import { ManagementCharts } from "@/components/charts/report-chart-blocks";
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace";
import { Button } from "@/components/ui/button";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import { Textarea } from "@/components/ui/textarea";
import { settleChartAnimations } from "@/hooks/use-chart-motion";
import { larkSentMessage, saveReportAsPdf, sendReportToLark, type LarkFormat } from "@/lib/report-export";
import { reportFileName } from "@/lib/report-filename";
import { rangeLabel } from "@/lib/pancake/dates";
import {
  CumulativeVarianceTable,
  DailyBreakdownTable,
  DashboardContainer,
  formatManagementCurrency,
  PerformanceNarratives,
  TopMetricsCards,
  TopProductsSection,
} from "@/components/financial-management/dashboard-sections";
import {
  parseFinancialManagementFile,
  processNormalizedManagementRows,
} from "@/lib/financial-management";
import type {
  CalculatedChannelMetrics,
  ChannelMetricsSet,
  ManagementChannel,
  ManagementTrack,
  NormalizedManagementRow,
  ProcessedManagementReport,
  RawChannelMetrics,
} from "@/types/financial-management";

function sampleMetrics(
  revenue: number,
  costs: {
    cogs: number;
    returns: number;
    salary: number;
    salaryOther: number;
    fixed: number;
    other: number;
    ads?: number;
  },
  productSeed: string,
): RawChannelMetrics {
  return {
    revenue,
    cogs: costs.cogs,
    returnProvision: costs.returns,
    salarySaleCskh: costs.salary,
    salaryOther: costs.salaryOther,
    fixedCost: costs.fixed,
    otherCost: costs.other,
    adsCost: costs.ads ?? 0,
    topRevenueProducts: [
      { name: `${productSeed} Premium`, value: revenue * 0.42 },
      { name: `${productSeed} Classic`, value: revenue * 0.31 },
      { name: `${productSeed} Basic`, value: revenue * 0.17 },
    ],
    topProfitProducts: [
      { name: `${productSeed} Premium`, value: revenue * 0.13 },
      { name: `${productSeed} Classic`, value: revenue * 0.08 },
      { name: `${productSeed} Basic`, value: revenue * 0.04 },
    ],
  };
}

function sampleRow(
  date: string,
  label: string,
  track: ManagementTrack,
  channel: ManagementChannel,
  metrics: RawChannelMetrics,
): NormalizedManagementRow {
  return { date, dateLabel: label, track, channel, metrics };
}

const SAMPLE_ROWS: NormalizedManagementRow[] = [
  sampleRow("2026-11-01", "01/11/2026", "estimated", "zalo", sampleMetrics(165_000_000, { cogs: 72_000_000, returns: 13_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_000_000 }, "Serum")),
  sampleRow("2026-11-01", "01/11/2026", "estimated", "page", sampleMetrics(215_000_000, { cogs: 98_000_000, returns: 18_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Kem dưỡng")),
  sampleRow("2026-11-01", "01/11/2026", "actual", "zalo", sampleMetrics(158_000_000, { cogs: 74_000_000, returns: 15_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_500_000 }, "Serum")),
  sampleRow("2026-11-01", "01/11/2026", "actual", "page", sampleMetrics(228_000_000, { cogs: 99_000_000, returns: 17_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Kem dưỡng")),
  sampleRow("2026-11-02", "02/11/2026", "estimated", "zalo", sampleMetrics(172_000_000, { cogs: 76_000_000, returns: 14_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_000_000 }, "Toner")),
  sampleRow("2026-11-02", "02/11/2026", "estimated", "page", sampleMetrics(224_000_000, { cogs: 102_000_000, returns: 18_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Sữa rửa mặt")),
  sampleRow("2026-11-02", "02/11/2026", "actual", "zalo", sampleMetrics(168_000_000, { cogs: 79_000_000, returns: 16_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_000_000 }, "Toner")),
  sampleRow("2026-11-02", "02/11/2026", "actual", "page", sampleMetrics(239_000_000, { cogs: 104_000_000, returns: 17_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Sữa rửa mặt")),
  sampleRow("2026-11-03", "03/11/2026", "estimated", "zalo", sampleMetrics(180_000_000, { cogs: 78_000_000, returns: 14_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_000_000 }, "Mặt nạ")),
  sampleRow("2026-11-03", "03/11/2026", "estimated", "page", sampleMetrics(232_000_000, { cogs: 105_000_000, returns: 19_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Combo dưỡng")),
  sampleRow("2026-11-03", "03/11/2026", "actual", "zalo", sampleMetrics(171_000_000, { cogs: 82_000_000, returns: 17_000_000, salary: 15_000_000, salaryOther: 6_000_000, fixed: 8_000_000, other: 3_000_000 }, "Mặt nạ")),
  sampleRow("2026-11-03", "03/11/2026", "actual", "page", sampleMetrics(246_000_000, { cogs: 106_000_000, returns: 18_000_000, salary: 18_000_000, salaryOther: 8_000_000, fixed: 11_000_000, other: 4_000_000 }, "Combo dưỡng")),
];

const SAMPLE_REPORT = processNormalizedManagementRows(SAMPLE_ROWS, "Dữ liệu mẫu");

function hiddenStatusLabel(report: ProcessedManagementReport) {
  return report.summary.hiddenStatus === "profit"
    ? "Lãi ngầm"
    : report.summary.hiddenStatus === "loss"
      ? "Lỗ ngầm"
      : "Cân bằng";
}

function generateCaption(report: ProcessedManagementReport) {
  const actual = report.summary.actual;
  return `📊 BÁO CÁO TÀI CHÍNH KỲ ${report.summary.dateRangeLabel}
💰 Doanh thu: ${formatManagementCurrency(actual.total.revenue)}
📉 Lợi nhuận: ${formatManagementCurrency(actual.total.profit)} (Zalo: ${formatManagementCurrency(actual.zalo.profit)}, Page: ${formatManagementCurrency(actual.page.profit)})
🔥 Trạng thái lũy kế: ${hiddenStatusLabel(report)} ${formatManagementCurrency(report.summary.profitDifference)}
Chi tiết xem ảnh đính kèm!`;
}

function channelSnapshot(metrics: CalculatedChannelMetrics) {
  return {
    doanhThu: metrics.revenue,
    tongGiaVon: metrics.totalCogs,
    tongLuong: metrics.totalSalary,
    chiPhiMarketing: metrics.adsCost,
    tongDinhPhi: metrics.totalFixedCosts,
    loiNhuan: metrics.profit,
  };
}

function metricsSetSnapshot(set: ChannelMetricsSet) {
  return { zalo: channelSnapshot(set.zalo), page: channelSnapshot(set.page), tong: channelSnapshot(set.total) };
}

/** Compact, Vietnamese-keyed view of the report for the AI prompt (omits per-day product lists). */
function buildAnalysisData(report: ProcessedManagementReport) {
  const { summary } = report;
  return {
    kyBaoCao: summary.dateRangeLabel,
    tongKy: {
      duTinh: metricsSetSnapshot(summary.estimated),
      thucTe: metricsSetSnapshot(summary.actual),
      chenhLechDoanhThu: summary.revenueDifference,
      chenhLechLoiNhuan: summary.profitDifference,
      trangThaiLuyKe: hiddenStatusLabel(report),
    },
    topSanPhamDoanhThu: summary.topRevenueProducts,
    topSanPhamLoiNhuan: summary.topProfitProducts,
    theoNgay: report.days.map((day) => ({
      ngay: day.dateLabel,
      duTinh: metricsSetSnapshot(day.estimated),
      thucTe: metricsSetSnapshot(day.actual),
      luyKe: {
        chenhLechDoanhThu: day.cumulative.revenueDifference,
        chenhLechLoiNhuan: day.cumulative.profitDifference,
      },
    })),
    canhBaoKhiDocFile: report.warnings,
  };
}

function triggerDownload(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function FinancialManagementReportGenerator() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState(SAMPLE_REPORT);
  // "dd/mm/yyyy" (– "dd/mm/yyyy") picked in the Pancake POS card when the report on screen came from there, for the file name.
  const [posDateLabel, setPosDateLabel] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<NoticeState>({
    type: "success",
    message: "Đang hiển thị dữ liệu mẫu để kiểm tra bố cục dashboard.",
  });
  const caption = useMemo(() => generateCaption(report), [report]);

  async function handleFile(file: File) {
    setIsParsing(true);
    setNotice({ type: "warning", message: "Đang đọc, kiểm tra và tính lũy kế dữ liệu..." });
    try {
      const parsed = await parseFinancialManagementFile(file);
      setReport(parsed);
      setPosDateLabel(null);
      setFileName(file.name);
      setNotice({
        type: parsed.warnings.length ? "warning" : "success",
        message: `Đã đọc ${parsed.days.length} ngày từ sheet “${parsed.sourceSheet}” (${parsed.inputFormat} format).${parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : ""}`,
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
    setReport(SAMPLE_REPORT);
    setPosDateLabel(null);
    setFileName("");
    setNotice({ type: "success", message: "Đã khôi phục dữ liệu mẫu." });
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = caption;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function renderReport() {
    if (!reportRef.current) throw new Error("Không tìm thấy dashboard.");
    settleChartAnimations();
    await waitForPaint();
    const { toPng } = await import("html-to-image");
    return toPng(reportRef.current, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      pixelRatio: 2,
      width: reportRef.current.scrollWidth,
      height: reportRef.current.scrollHeight,
      style: { margin: "0", transform: "none" },
    });
  }

  async function sendToLark(format: LarkFormat) {
    try {
      await sendReportToLark(reportRef.current, reportFileName("vn", posDateLabel ?? report.summary.dateRangeLabel, "png"), { format });
      setNotice({ type: "success", message: larkSentMessage(format) });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark." });
    }
  }

  async function exportImage() {
    setExporting("image");
    try {
      const dataUrl = await renderReport();
      triggerDownload(
        dataUrl,
        reportFileName("vn", posDateLabel ?? report.summary.dateRangeLabel, "png"),
      );
      setNotice({
        type: "success",
        message: "Đã tải ảnh PNG. Caption đã được tạo sẵn bên dưới để sao chép.",
      });
    } catch {
      setNotice({ type: "error", message: "Không thể tạo ảnh dashboard. Vui lòng thử lại." });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      await saveReportAsPdf(reportRef.current, reportFileName("vn", posDateLabel ?? report.summary.dateRangeLabel, "pdf"), { format: "a3" });
      setNotice({ type: "success", message: "Đã tải báo cáo PDF A3 dọc." });
    } catch {
      setNotice({ type: "error", message: "Không thể xuất PDF. Vui lòng thử lại." });
    } finally {
      setExporting(null);
    }
  }

  return (
    <ReportWorkspace
      header={
        <PageHeader
          title="Báo cáo quản trị tài chính"
          description="So sánh Dự tính và Thực tế theo kênh Zalo, Page và kiểm toán Lãi/Lỗ ngầm."
        >
          <ExportButtons
            exporting={exporting}
            onImage={() => void exportImage()}
            onPdf={() => void exportPdf()}
            imageLabel="Xuất ảnh + Caption"
          />
          <SendToLarkButton reportName="Báo cáo quản trị tài chính" disabled={exporting !== null} onConfirm={sendToLark} />
        </PageHeader>
      }
      aside={
        <>
          <PancakeSyncCard
            currencies={["VND"]}
            hint="Tự lấy doanh thu, giá vốn và top sản phẩm theo kênh Zalo / Page (dự tính & thực tế) từ shop Việt Nam. Lương, định phí, ads, dự phòng hoàn theo kênh nhập ở trang Chi phí cố định."
            onSynced={({ vn, range }) => {
              if (!vn) {
                setNotice({ type: "warning", message: "Pancake POS chưa có dữ liệu để tạo báo cáo quản trị." });
                return;
              }
              setReport(vn);
              setPosDateLabel(rangeLabel(range.from, range.to));
              setFileName("");
            }}
          />

          <ConfigSection title="Tệp dữ liệu" collapsible defaultOpen={!fileName}>
            <FileDropzone
              compact
              fileName={fileName}
              isParsing={isParsing}
              hint="Long format (cột Channel) hoặc wide format (Zalo_/Page_)"
              onFile={(file) => void handleFile(file)}
            />
            <Button variant="outline" size="sm" className="w-full" onClick={resetSample}>
              <RotateCcw />
              Dữ liệu mẫu
            </Button>
          </ConfigSection>

          <ConfigSection title="Caption Zalo / Telegram" collapsible defaultOpen={false}>
            <Textarea readOnly value={caption} rows={7} className="resize-none bg-muted/30 text-xs leading-5" />
            <Button size="sm" className="w-full" onClick={() => void copyCaption()}>
              {copied ? <Check /> : <Clipboard />}
              {copied ? "Đã sao chép" : "Sao chép caption"}
            </Button>
          </ConfigSection>
        </>
      }
    >
      <Notice notice={notice} />

      <AiAnalysisPanel reportType="management" getData={() => buildAnalysisData(report)} />

      <ReportViewport>
        <DashboardContainer reportRef={reportRef}>
          <ReportHeader
            eyebrow="Executive Financial Review"
            title="Báo cáo quản trị tài chính"
            subtitle="Đối chiếu Dự tính · Thực tế và kiểm toán Lãi/Lỗ ngầm"
            metaLabel="Kỳ báo cáo"
            metaValue={report.summary.dateRangeLabel}
          />
          <div className="space-y-8 p-10">
            <TopMetricsCards report={report} />
            <ManagementCharts report={report} channel="total" />
            <DailyBreakdownTable report={report} />
            <PerformanceNarratives report={report} />
            <TopProductsSection report={report} />
            <CumulativeVarianceTable report={report} />
            <ReportFooter
              left={`Nguồn: ${report.sourceSheet} · ${report.inputFormat} format`}
              right="Đơn vị tiền tệ: Việt Nam Đồng (VND)"
            />
          </div>
        </DashboardContainer>
      </ReportViewport>
    </ReportWorkspace>
  );
}

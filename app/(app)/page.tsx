"use client";

import { useRef, useState } from "react";
import { FileDown, RefreshCcw } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { PancakeSyncCard } from "@/components/pancake-sync-card";
import { DailyManualEntry } from "@/components/daily/daily-manual-entry";
import { DailyReportView } from "@/components/reports/daily-report-view";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildDailyAnalysisData } from "@/lib/analysis-data";
import { DAILY_SAMPLE_DATA, deriveDaily, parseDailyRows, type DailyReportData } from "@/lib/daily-report";
import { saveBankDraft, saveExpenseDraft } from "@/lib/daily-expenses";
import { useDailyManual } from "@/lib/use-daily-manual";
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
import { readWorkbookSheets } from "@/lib/workbook";

export default function Home() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [reportData, setReportData] = useState<DailyReportData>(DAILY_SAMPLE_DATA);
  const [companyName, setCompanyName] = useState("CÔNG TY TNHH THƯƠNG MẠI NỘI BỘ");
  const [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>({
    type: "success",
    message: "Đang hiển thị dữ liệu mẫu. Tải file lên để tạo báo cáo thực tế.",
  });
  const [isParsing, setIsParsing] = useState(false);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);

  // The typed bank transfer and cash-out ledger are laid over the POS / file figures (blank ledger rows dropped).
  const manual = useDailyManual(reportData);
  const viewData = manual.view ?? reportData;
  const { expenseGroups } = deriveDaily(viewData);

  async function parseFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
      setNotice({ type: "error", message: "Định dạng chưa được hỗ trợ. Vui lòng chọn file .xlsx, .xls hoặc .csv." });
      return;
    }
    setIsParsing(true);
    setNotice(null);
    try {
      const [firstSheet] = await readWorkbookSheets(await file.arrayBuffer());
      if (!firstSheet) throw new Error("File không có sheet dữ liệu.");
      if (!firstSheet.rows.length) throw new Error("Sheet đầu tiên không có dòng dữ liệu.");

      const { data, rowCount, missingColumns } = parseDailyRows(firstSheet.rows);
      setReportData(data);
      // A file carries its own ledger and bank transfer: they replace what was typed for that date.
      saveExpenseDraft(data.reportDate, data.expenses);
      saveBankDraft(data.reportDate, undefined);
      manual.reload(data.reportDate);
      setFileName(file.name);
      setNotice({
        type: "success",
        message: missingColumns
          ? `Đã đọc ${rowCount} dòng. ${missingColumns} cột chưa tìm thấy được đặt bằng 0 hoặc để trống.`
          : `Đã đọc ${rowCount} dòng và nhận diện đầy đủ các cột dữ liệu.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Không thể đọc file. Vui lòng kiểm tra lại cấu trúc dữ liệu.",
      });
    } finally {
      setIsParsing(false);
    }
  }

  function resetToSample() {
    setReportData(DAILY_SAMPLE_DATA);
    setFileName("");
    setNotice({ type: "success", message: "Đã khôi phục dữ liệu mẫu." });
  }

  function downloadTemplate() {
    const csv = [
      ["Ngày báo cáo", "Doanh số", "Nhận tiền chuyển khoản", "Tiền phải thu khách (COD)", "Phí trả đơn vị VC", "Người chi", "Tên NCC", "Số tiền chi"],
      ["29/10/2026", "41856000", "4799999", "38505001", "724641", "Hưng", "Nhung rubi", "1250000"],
      ["", "", "", "", "", "Hưng", "Lưu giày", "860000"],
      ["", "", "", "", "", "A Kiên", "Kho Thành Công", "2400000"],
    ]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "mau-bao-cao-tai-chinh.csv");
    URL.revokeObjectURL(url);
  }

  async function exportImage() {
    setExporting("image");
    setNotice(null);
    try {
      const dataUrl = await renderReportToPng(reportRef.current);
      triggerDownload(dataUrl, `bao-cao-tai-chinh-${safeFilePart(reportData.reportDate)}.png`);
      setNotice({ type: "success", message: "Đã tạo ảnh PNG chất lượng cao." });
    } catch {
      setNotice({ type: "error", message: "Không thể tạo ảnh. Vui lòng thử lại trên trình duyệt Chrome hoặc Edge." });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    setNotice(null);
    try {
      await saveReportAsPdf(reportRef.current, `bao-cao-tai-chinh-${safeFilePart(reportData.reportDate)}.pdf`);
      setNotice({ type: "success", message: "Đã xuất báo cáo PDF khổ A4 ngang." });
    } catch {
      setNotice({ type: "error", message: "Không thể xuất PDF. Vui lòng thử lại sau." });
    } finally {
      setExporting(null);
    }
  }

  async function sendToLark(format: LarkFormat) {
    try {
      await sendReportToLark(reportRef.current, `bao-cao-tai-chinh-${safeFilePart(reportData.reportDate)}.png`, { format });
      setNotice({ type: "success", message: larkSentMessage(format) });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark." });
    }
  }

  return (
    <ReportWorkspace
      header={
        <PageHeader title="Báo cáo tài chính hàng ngày" description="Tải dữ liệu đối soát, kiểm tra số liệu và xuất báo cáo.">
          <ExportButtons
            exporting={exporting}
            onImage={() => void exportImage()}
            onPdf={() => void exportPdf()}
            imageLabel="Tải ảnh (Caption)"
          />
          <SendToLarkButton reportName="Báo cáo tài chính hàng ngày" disabled={exporting !== null} onConfirm={sendToLark} />
        </PageHeader>
      }
      aside={
        <>
          <PancakeSyncCard
            currencies={["VND"]}
            hint="Tự lấy doanh số, tiền chuyển khoản, COD phải thu và phí vận chuyển từ shop Việt Nam. Khoản chi NCC nhập ở bảng kê bên dưới."
            onSynced={({ daily }) => {
              if (!daily) return;
              // POS has no cash-out ledger and no reliable bank transfer: what was typed for that date is kept.
              setReportData({ ...daily, expenses: [] });
              setFileName("");
            }}
          />

          <ConfigSection title="Tệp dữ liệu" collapsible defaultOpen={!fileName}>
            <FileDropzone
              compact
              fileName={fileName}
              isParsing={isParsing}
              hint="Kéo thả hoặc bấm chọn (.xlsx, .xls, .csv)"
              onFile={(file) => void parseFile(file)}
            />
            <Button variant="outline" size="sm" className="w-full" onClick={downloadTemplate}>
              <FileDown />
              Tải file CSV mẫu
            </Button>
          </ConfigSection>

          <ConfigSection title="Thiết lập báo cáo">
            <div className="space-y-1">
              <Label htmlFor="company-name" className="text-[11px] text-muted-foreground">
                Tên đơn vị
              </Label>
              <Input id="company-name" className="h-8 text-xs" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-date" className="text-[11px] text-muted-foreground">
                Ngày báo cáo
              </Label>
              <Input
                id="report-date"
                className="h-8 text-xs"
                value={reportData.reportDate}
                onChange={(event) => {
                  manual.moveTo(event.target.value);
                  setReportData((current) => ({ ...current, reportDate: event.target.value }));
                }}
                placeholder="dd/mm/yyyy"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {expenseGroups.length} nhóm người chi · {viewData.expenses.length} khoản chi NCC
              </p>
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={resetToSample}>
                <RefreshCcw />
                Dữ liệu mẫu
              </Button>
            </div>
          </ConfigSection>
        </>
      }
    >
      <Notice notice={notice} />

      <DailyManualEntry manual={manual} reportDate={reportData.reportDate} />

      <AiAnalysisPanel reportType="daily" getData={() => buildDailyAnalysisData(viewData, companyName)} />

      <ReportViewport>
        <DailyReportView reportRef={reportRef} data={viewData} companyName={companyName} />
      </ReportViewport>
    </ReportWorkspace>
  );
}

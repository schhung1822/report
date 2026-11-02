"use client";

import { useRef, useState } from "react";
import { FileDown, RefreshCcw } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { DailyReportView } from "@/components/reports/daily-report-view";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { buildDailyAnalysisData } from "@/lib/analysis-data";
import { DAILY_SAMPLE_DATA, deriveDaily, parseDailyRows, type DailyReportData } from "@/lib/daily-report";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import { renderReportToPng, safeFilePart, saveReportAsPdf, sendReportToLark, triggerDownload } from "@/lib/report-export";
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

  const { expenseGroups } = deriveDaily(reportData);

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

  async function sendToLark() {
    try {
      await sendReportToLark(reportRef.current, `bao-cao-tai-chinh-${safeFilePart(reportData.reportDate)}.png`);
      setNotice({ type: "success", message: "Đã gửi ảnh báo cáo tới nhóm Lark." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi ảnh tới Lark." });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title="Báo cáo tài chính hàng ngày" description="Tải dữ liệu đối soát, kiểm tra số liệu và xuất báo cáo.">
        <ExportButtons
          exporting={exporting}
          onImage={() => void exportImage()}
          onPdf={() => void exportPdf()}
          imageLabel="Tải ảnh (Caption)"
        />
        <SendToLarkButton reportName="Báo cáo tài chính hàng ngày" disabled={exporting !== null} onConfirm={sendToLark} />
      </PageHeader>

      <div className="space-y-6">
        <div className="grid items-start gap-4 print:hidden md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Dữ liệu nguồn</CardTitle>
              <CardDescription>Hỗ trợ file .xlsx, .xls và .csv</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FileDropzone
                fileName={fileName}
                isParsing={isParsing}
                hint="hoặc bấm để chọn file"
                onFile={(file) => void parseFile(file)}
              />
              <Button variant="outline" size="lg" className="w-full" onClick={downloadTemplate}>
                <FileDown />
                Tải file CSV mẫu
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Thiết lập báo cáo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Tên đơn vị</Label>
                  <Input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="report-date">Ngày báo cáo</Label>
                  <Input
                    id="report-date"
                    value={reportData.reportDate}
                    onChange={(event) => setReportData((current) => ({ ...current, reportDate: event.target.value }))}
                    placeholder="dd/mm/yyyy"
                  />
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <dl className="flex gap-8 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Nhóm người chi</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{expenseGroups.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Khoản chi NCC</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{reportData.expenses.length}</dd>
                  </div>
                </dl>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetToSample}>
                  <RefreshCcw />
                  Khôi phục dữ liệu mẫu
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <section className="min-w-0 space-y-4">
          <Notice notice={notice} />

          <AiAnalysisPanel reportType="daily" getData={() => buildDailyAnalysisData(reportData, companyName)} />

          <ReportViewport>
            <DailyReportView reportRef={reportRef} data={reportData} companyName={companyName} />
          </ReportViewport>
        </section>
      </div>
    </main>
  );
}

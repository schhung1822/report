"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, FileSpreadsheet, Minus, Sparkles } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { DailyReportView } from "@/components/reports/daily-report-view";
import { PerformanceReportView } from "@/components/reports/performance-report-view";
import { PhFinanceView } from "@/components/reports/ph-finance-view";
import { VnManagementView } from "@/components/reports/vn-management-view";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildDailyAnalysisData,
  buildPerformanceAnalysisData,
  buildPhAnalysisData,
  buildVnManagementAnalysisData,
} from "@/lib/analysis-data";
import { buildConsolidatedTemplate, TEMPLATE_SHEETS } from "@/lib/consolidated-template";
import {
  parseConsolidatedWorkbook,
  REPORT_LABELS,
  type ConsolidatedData,
  type ReportKey,
  type SheetStatus,
} from "@/lib/consolidated-report";
import { PH_DEFAULT_EXCHANGE_RATE, processPhilippinesRows } from "@/lib/philippines-report";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import { renderReportToPng, saveReportAsPdf, sendReportToLark, triggerDownload } from "@/lib/report-export";
import { cn } from "@/lib/utils";

const TAB_KEYS: ReportKey[] = ["daily", "performance", "vn", "ph"];

const EXPECTED_SHEET: Record<ReportKey, string> = {
  daily: TEMPLATE_SHEETS.daily,
  performance: TEMPLATE_SHEETS.performanceDaily,
  vn: TEMPLATE_SHEETS.vn,
  ph: TEMPLATE_SHEETS.ph,
};

const PDF_FORMAT: Record<ReportKey, "a4" | "a3"> = { daily: "a4", performance: "a4", vn: "a3", ph: "a3" };

export function ConsolidatedReport() {
  // One ref per tab: a shared ref gets reset to null when the previous tab unmounts after the new one mounted.
  const dailyRef = useRef<HTMLDivElement>(null);
  const performanceRef = useRef<HTMLDivElement>(null);
  const vnRef = useRef<HTMLDivElement>(null);
  const phRef = useRef<HTMLDivElement>(null);
  const reportRefs = { daily: dailyRef, performance: performanceRef, vn: vnRef, ph: phRef };
  const [data, setData] = useState<ConsolidatedData | null>(null);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [tab, setTab] = useState<ReportKey>("daily");
  const [companyName, setCompanyName] = useState("CÔNG TY TNHH THƯƠNG MẠI NỘI BỘ");
  const [phRate, setPhRate] = useState(String(PH_DEFAULT_EXCHANGE_RATE));
  const [summary, setSummary] = useState("");
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);

  const phRows = data?.phRows ?? null;
  // While the field is empty or invalid (e.g. mid-typing), keep rendering with the default rate.
  const phRateValue = Number(phRate) > 0 ? Number(phRate) : PH_DEFAULT_EXCHANGE_RATE;
  const phRateInvalid = !(Number(phRate) > 0);
  const phResult = useMemo(() => {
    if (!phRows) return null;
    try {
      return { report: processPhilippinesRows(phRows, phRateValue) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Không thể xử lý dữ liệu Philippines." };
    }
  }, [phRows, phRateValue]);

  const available: Record<ReportKey, boolean> = {
    daily: Boolean(data?.daily),
    performance: Boolean(data?.performance),
    vn: Boolean(data?.vn),
    ph: Boolean(data?.phRows),
  };
  const canExport = available[tab] && !(tab === "ph" && !phResult?.report);

  async function loadBuffer(buffer: ArrayBuffer, label: string) {
    setIsParsing(true);
    setNotice(null);
    try {
      const parsed = await parseConsolidatedWorkbook(buffer);
      setData(parsed);
      setFileName(label);
      setSummary("");
      const firstReady = TAB_KEYS.find((key) =>
        parsed.statuses.some((status) => status.key === key && status.state === "ok"),
      );
      if (firstReady) setTab(firstReady);
      const problems = parsed.statuses.filter((status) => status.state === "error").length;
      setNotice(
        problems
          ? { type: "warning", message: `Đã đọc file nhưng ${problems} sheet bị lỗi. Xem chi tiết bên dưới.` }
          : { type: "success", message: "Đã đọc file và tạo các báo cáo." },
      );
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể đọc file." });
    } finally {
      setIsParsing(false);
    }
  }

  async function handleFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "xls"].includes(extension)) {
      setNotice({ type: "error", message: "Vui lòng chọn file Excel (.xlsx hoặc .xls) theo mẫu." });
      return;
    }
    await loadBuffer(await file.arrayBuffer(), file.name);
  }

  async function loadSample() {
    await loadBuffer(await buildConsolidatedTemplate(), "Dữ liệu mẫu");
  }

  async function downloadTemplate() {
    const buffer = await buildConsolidatedTemplate();
    const url = URL.createObjectURL(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    triggerDownload(url, "mau-bao-cao-tong-hop.xlsx");
    URL.revokeObjectURL(url);
  }

  // Evaluated inside event handlers only: Cache Components forbids reading the clock during render.
  const filenameBase = () => `bao-cao-tong-hop-${tab}-${new Date().toISOString().slice(0, 10)}`;

  async function exportImage() {
    setExporting("image");
    try {
      triggerDownload(await renderReportToPng(reportRefs[tab].current), `${filenameBase()}.png`);
      setNotice({ type: "success", message: `Đã tải ảnh báo cáo “${REPORT_LABELS[tab]}”.` });
    } catch (error) {
      console.error("export image failed", error);
      setNotice({ type: "error", message: `Không thể tạo ảnh báo cáo: ${describeExportError(error)}` });
    } finally {
      setExporting(null);
    }
  }

  async function sendToLark() {
    // The performance tab swaps its editable summary for static text while `exporting` is set.
    setExporting("image");
    try {
      await sendReportToLark(reportRefs[tab].current, `${filenameBase()}.png`);
      setNotice({ type: "success", message: `Đã gửi ảnh báo cáo “${REPORT_LABELS[tab]}” tới nhóm Lark.` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi ảnh tới Lark." });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      await saveReportAsPdf(reportRefs[tab].current, `${filenameBase()}.pdf`, { format: PDF_FORMAT[tab] });
      setNotice({ type: "success", message: `Đã tải PDF báo cáo “${REPORT_LABELS[tab]}”.` });
    } catch (error) {
      console.error("export pdf failed", error);
      setNotice({ type: "error", message: `Không thể xuất PDF: ${describeExportError(error)}` });
    } finally {
      setExporting(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Báo cáo tổng hợp"
        description="Một file Excel nhiều sheet, xem tất cả báo cáo trong cùng một trang qua các tab."
      >
        <Button variant="outline" size="lg" onClick={() => void downloadTemplate()}>
          <FileSpreadsheet />
          Tải mẫu Excel
        </Button>
        {canExport ? (
          <>
            <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
            <SendToLarkButton reportName={REPORT_LABELS[tab]} disabled={exporting !== null} onConfirm={sendToLark} />
          </>
        ) : null}
      </PageHeader>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Dữ liệu nguồn</CardTitle>
          <CardDescription>
            Tải file theo mẫu: mỗi sheet là một báo cáo. Sheet nào thiếu thì tab đó để trống.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <FileDropzone
              className="flex-1"
              fileName={fileName}
              isParsing={isParsing}
              hint="Chọn file .xlsx theo mẫu tổng hợp"
              onFile={(file) => void handleFile(file)}
            />
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="company-name" className="text-xs text-muted-foreground">
                  Tên đơn vị (báo cáo ngày)
                </Label>
                <Input
                  id="company-name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="h-9 w-64"
                />
              </div>
              <Button variant="outline" size="lg" className="h-9" onClick={() => void loadSample()}>
                <Sparkles />
                Dữ liệu mẫu
              </Button>
            </div>
          </div>

          {data ? <SheetStatusList statuses={data.statuses} /> : null}
        </CardContent>
      </Card>

      <Notice notice={notice} />

      {!data ? (
        <EmptyState onTemplate={() => void downloadTemplate()} onSample={() => void loadSample()} />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as ReportKey)} className="gap-4">
          <div className="overflow-x-auto print:hidden">
            <TabsList className="h-10 min-w-max">
              {TAB_KEYS.map((key) => (
                <TabsTrigger key={key} value={key} className="px-3">
                  <span
                    className={cn("size-1.5 rounded-full", available[key] ? "bg-emerald-500" : "bg-muted-foreground/30")}
                    aria-hidden="true"
                  />
                  {REPORT_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="daily" className="space-y-4">
            {data.daily ? (
              <>
                <AiAnalysisPanel reportType="daily" getData={() => buildDailyAnalysisData(data.daily!, companyName)} />
                <ReportViewport>
                  <DailyReportView reportRef={dailyRef} data={data.daily} companyName={companyName} />
                </ReportViewport>
              </>
            ) : (
              <MissingTab reportKey="daily" status={statusOf(data, "daily")} />
            )}
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            {data.performance ? (
              <>
                <AiAnalysisPanel
                  reportType="performance"
                  onUseSummary={setSummary}
                  getData={() =>
                    buildPerformanceAnalysisData(
                      data.performance!.dailyRows,
                      data.performance!.cumulativeRows,
                      data.performance!.reportDate ?? "",
                    )
                  }
                />
                <ReportViewport>
                  <PerformanceReportView
                    reportRef={performanceRef}
                    dailyRows={data.performance.dailyRows}
                    cumulativeRows={data.performance.cumulativeRows}
                    reportDate={data.performance.reportDate ?? ""}
                    summary={summary}
                    onSummaryChange={setSummary}
                    exporting={exporting !== null}
                  />
                </ReportViewport>
              </>
            ) : (
              <MissingTab reportKey="performance" status={statusOf(data, "performance")} />
            )}
          </TabsContent>

          <TabsContent value="vn" className="space-y-4">
            {data.vn ? (
              <>
                <AiAnalysisPanel reportType="management" getData={() => buildVnManagementAnalysisData(data.vn!)} />
                <ReportViewport>
                  <VnManagementView reportRef={vnRef} report={data.vn} />
                </ReportViewport>
              </>
            ) : (
              <MissingTab reportKey="vn" status={statusOf(data, "vn")} />
            )}
          </TabsContent>

          <TabsContent value="ph" className="space-y-4">
            {data.phRows ? (
              <>
                <Card size="sm" className="print:hidden">
                  <CardContent className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="ph-rate" className="text-xs text-muted-foreground">
                        Tỷ giá mặc định (1 ₱ = ? ₫)
                      </Label>
                      <Input
                        id="ph-rate"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={phRate}
                        onChange={(event) => setPhRate(event.target.value)}
                        className="h-9 w-40"
                      />
                    </div>
                    <p className={cn("max-w-xl pb-2 text-xs", phRateInvalid ? "text-destructive" : "text-muted-foreground")}>
                      {phRateInvalid
                        ? `Tỷ giá phải lớn hơn 0, đang tạm dùng ${PH_DEFAULT_EXCHANGE_RATE}.`
                        : "Chỉ áp dụng cho những ngày không có tỷ giá riêng trong cột “Tỷ giá PHP-VND” của sheet."}
                    </p>
                  </CardContent>
                </Card>
                {phResult?.report ? (
                  <>
                    <AiAnalysisPanel reportType="philippines" getData={() => buildPhAnalysisData(phResult.report!)} />
                    <ReportViewport>
                      <PhFinanceView reportRef={phRef} report={phResult.report} />
                    </ReportViewport>
                  </>
                ) : (
                  <Notice notice={{ type: "error", message: phResult?.error ?? "Không thể xử lý dữ liệu Philippines." }} />
                )}
              </>
            ) : (
              <MissingTab reportKey="ph" status={statusOf(data, "ph")} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function describeExportError(error: unknown) {
  if (error instanceof Error) return error.message;
  // html-to-image rejects with an Event (e.g. from a failed image load) rather than an Error.
  const target = (error as { target?: { src?: string } } | null)?.target;
  return target?.src ? `không tải được tài nguyên ${target.src.slice(0, 80)}` : "lỗi không xác định.";
}

function statusOf(data: ConsolidatedData, key: ReportKey) {
  return data.statuses.find((status) => status.key === key);
}

function SheetStatusList({ statuses }: { statuses: SheetStatus[] }) {
  const details = statuses.filter((status) => status.message);
  return (
    <div className="space-y-2 border-t pt-4">
      <ul className="flex flex-wrap gap-2">
        {statuses.map((status) => (
          <li key={status.key}>
            <Badge
              variant={status.state === "error" ? "destructive" : "secondary"}
              className={cn("h-6 gap-1.5 px-2.5", status.state === "ok" && "bg-emerald-50 text-emerald-700")}
              title={status.sheetName}
            >
              {status.state === "ok" ? <Check /> : status.state === "error" ? <CircleAlert /> : <Minus />}
              {REPORT_LABELS[status.key]}
              {status.state === "missing" ? " · thiếu sheet" : null}
            </Badge>
          </li>
        ))}
      </ul>
      {details.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {details.map((status) => (
            <li key={status.key} className={cn(status.state === "error" && "text-destructive")}>
              <span className="font-medium">{REPORT_LABELS[status.key]}:</span> {status.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MissingTab({ reportKey, status }: { reportKey: ReportKey; status?: SheetStatus }) {
  const isError = status?.state === "error";
  return (
    <EmptyBox
      icon={<FileSpreadsheet className="size-8 text-muted-foreground/60" />}
      title={isError ? "Không đọc được dữ liệu của báo cáo này" : "Chưa có dữ liệu cho báo cáo này"}
    >
      {isError ? status?.message : `Thêm sheet “${EXPECTED_SHEET[reportKey]}” vào file rồi tải lên lại.`}
    </EmptyBox>
  );
}

function EmptyState({ onTemplate, onSample }: { onTemplate: () => void; onSample: () => void }) {
  return (
    <EmptyBox
      icon={<FileSpreadsheet className="size-8 text-muted-foreground/60" />}
      title="Chưa có dữ liệu"
      actions={
        <>
          <Button size="lg" onClick={onTemplate}>
            <FileSpreadsheet />
            Tải mẫu Excel
          </Button>
          <Button variant="outline" size="lg" onClick={onSample}>
            <Sparkles />
            Xem dữ liệu mẫu
          </Button>
        </>
      }
    >
      Tải mẫu Excel, điền số liệu vào từng sheet rồi tải file lên để xem các báo cáo trong cùng một trang.
    </EmptyBox>
  );
}

function EmptyBox({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-background px-6 py-14 text-center print:hidden">
      {icon}
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{children}</p>
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

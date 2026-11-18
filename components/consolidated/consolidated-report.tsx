"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, FileSpreadsheet, Minus, Sparkles } from "lucide-react";
import { AiAnalysisPanel } from "@/components/ai-analysis";
import { FileDropzone } from "@/components/file-dropzone";
import { Notice, type NoticeState } from "@/components/notice";
import { PancakeSyncCard } from "@/components/pancake-sync-card";
import type { PancakeSyncResult } from "@/lib/pancake/types";
import { rangeLabel } from "@/lib/pancake/dates";
import { mergeablePhResults, mergeOpenOrders, mergePhRows, mergePreviousDay, mergeRefundTrend } from "@/lib/pancake/merge-ph";
import { DailyManualEntry } from "@/components/daily/daily-manual-entry";
import { DailyReportView } from "@/components/reports/daily-report-view";
import { PerformanceReportView } from "@/components/reports/performance-report-view";
import { PhFinanceView } from "@/components/reports/ph-finance-view";
import { VnManagementView } from "@/components/reports/vn-management-view";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { reportFileName } from "@/lib/report-filename";
import { PH_DEFAULT_EXCHANGE_RATE, processPhilippinesRows } from "@/lib/philippines-report";
import { useDailyManual } from "@/lib/use-daily-manual";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import { larkSentMessage, renderReportToPng, saveReportAsPdf, sendReportToLark, triggerDownload, type LarkFormat } from "@/lib/report-export";
import { cn } from "@/lib/utils";
import { POS_SOURCE_SHEET } from "@/types/financial-management";

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
  const [shopResults, setShopResults] = useState<Record<number, PancakeSyncResult>>({});
  const [activeShop, setActiveShop] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  // The user picked one Philippines shop instead of the merged report (which is the default once two or more are fetched).
  const [phSingle, setPhSingle] = useState(false);

  // Typed bank transfer and cash-out ledger are laid over the daily report from the POS / Excel file.
  const dailyManual = useDailyManual(data?.daily ?? null);

  // Philippines shops fetched for the same range are added together into one report.
  const phGroup = useMemo(() => mergeablePhResults(Object.values(shopResults)), [shopResults]);
  const phMerged = !phSingle && phGroup.length > 1;
  const phRows = useMemo(
    () => (phMerged ? mergePhRows(phGroup.map((result) => result.phRows ?? [])) : (data?.phRows ?? null)),
    [phMerged, phGroup, data?.phRows],
  );
  const phExtras = useMemo(() => {
    if (!phMerged) {
      const shown = shopResults[activeShop.PHP];
      return { previousDay: shown?.previousDay, refundTrend: shown?.refundTrend, openOrders: shown?.openOrders };
    }
    return {
      previousDay: mergePreviousDay(phGroup.map((result) => result.previousDay)),
      refundTrend: mergeRefundTrend(phGroup.map((result) => result.refundTrend)),
      openOrders: mergeOpenOrders(phGroup.map((result) => result.openOrders)),
    };
  }, [phMerged, phGroup, shopResults, activeShop.PHP]);
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
  // The cumulative reconciliation needs the Pancake shop on screen; a report read from an Excel file has none.
  const reconcileOf = (currency: "VND" | "PHP") => {
    if (currency === "PHP" && phMerged) return { shopId: phGroup.map((result) => result.shop.id), to: phGroup[0].range.to };
    const result = shopResults[activeShop[currency]];
    return result ? { shopId: result.shop.id, to: result.range.to } : undefined;
  };

  async function loadBuffer(buffer: ArrayBuffer, label: string) {
    setIsParsing(true);
    setNotice(null);
    try {
      const parsed = await parseConsolidatedWorkbook(buffer);
      // The file replaces every report, so the Pancake shops fetched before no longer describe what is on screen.
      setShopResults({});
      setActiveShop({});
      setPhSingle(false);
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

  /** Merges one shop's data into the tabs it feeds: VND shops fill daily/performance/vn, PHP shops fill ph. */
  function syncFromPancake(result: PancakeSyncResult, options: { keepTab?: boolean } = {}) {
    // Remember every shop's report: with several shops of one currency, the one on screen can be switched.
    setShopResults((previous) => ({ ...previous, [result.shop.id]: result }));
    setActiveShop((previous) => ({ ...previous, [result.shop.currency.toUpperCase()]: result.shop.id }));
    const updates: SheetStatus[] = [];
    if (result.phRows) {
      // Show the stored house rate in the default-rate box (days without their own rate use it).
      if (result.exchangeRate) setPhRate(String(result.exchangeRate.rate));
      updates.push({ key: "ph", state: "ok", sheetName: "Pancake POS" });
    }
    if (result.daily && result.performance) {
      updates.push({ key: "daily", state: "ok", sheetName: "Pancake POS" }, { key: "performance", state: "ok", sheetName: "Pancake POS" });
    }
    if (result.vn) {
      updates.push({ key: "vn", state: "ok", sheetName: "Pancake POS" });
    } else if (result.daily) {
      updates.push({ key: "vn", state: "error", sheetName: "Pancake POS", message: "Pancake POS chưa có đơn nào trong khoảng ngày để tạo báo cáo quản trị." });
    }
    const updated = new Set(updates.map((status) => status.key));

    // Functional update: several results can be applied back to back (restoring the Vietnam and the Philippines
    // report on page load) and each must build on the previous one.
    setData((previous) => {
      const base: ConsolidatedData = previous ?? { daily: null, performance: null, vn: null, phRows: null, statuses: [] };
      const next: ConsolidatedData = { ...base };
      if (result.phRows) next.phRows = result.phRows;
      if (result.daily && result.performance) {
        next.daily = result.daily;
        next.performance = result.performance;
      }
      if (result.vn) next.vn = result.vn;
      next.statuses = TAB_KEYS.map(
        (key) => updates.find((status) => status.key === key) ?? base.statuses.find((status) => status.key === key) ?? { key, state: "missing" as const },
      );
      return next;
    });
    setFileName("Pancake POS");
    setSummary("");
    if (!options.keepTab) setTab((current) => TAB_KEYS.find((key) => updated.has(key)) ?? current);
    setNotice(null);
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

  /** The Pancake POS result the tab on screen was made from, or undefined when it was read from an Excel file. */
  const posResultOfTab = (): PancakeSyncResult | undefined => {
    if (tab === "ph") return phMerged ? phGroup[0] : shopResults[activeShop.PHP]?.phRows ? shopResults[activeShop.PHP] : undefined;
    const vnd = shopResults[activeShop.VND];
    if (tab === "vn") return data?.vn?.sourceSheet === POS_SOURCE_SHEET ? vnd : undefined;
    return vnd?.daily && vnd.performance ? vnd : undefined;
  };

  // The date in the file name is the day (range) the data was taken from Pancake POS for: the "Từ ngày – Đến ngày" picked
  // there, not the days that happen to have orders. A report read from an Excel file uses its own date. Evaluated inside
  // event handlers only: Cache Components forbids reading the clock during render, and a label with no date falls back to today.
  const reportDateLabel = (): string | undefined => {
    const pos = posResultOfTab();
    if (pos) return rangeLabel(pos.range.from, pos.range.to);
    if (tab === "daily") return data?.daily?.reportDate;
    if (tab === "performance") return data?.performance?.reportDate;
    if (tab === "vn") return data?.vn?.summary.dateRangeLabel;
    const days = phResult?.report?.days ?? [];
    if (!days.length) return undefined;
    const [first, last] = [days[0].dateLabel, days[days.length - 1].dateLabel];
    return first === last ? first : `${first} – ${last}`;
  };
  const exportName = (extension: "png" | "pdf") => reportFileName(tab, reportDateLabel(), extension);

  async function exportImage() {
    setExporting("image");
    try {
      triggerDownload(await renderReportToPng(reportRefs[tab].current), exportName("png"));
      setNotice({ type: "success", message: `Đã tải ảnh báo cáo “${REPORT_LABELS[tab]}”.` });
    } catch (error) {
      console.error("export image failed", error);
      setNotice({ type: "error", message: `Không thể tạo ảnh báo cáo: ${describeExportError(error)}` });
    } finally {
      setExporting(null);
    }
  }

  async function sendToLark(format: LarkFormat) {
    // The performance tab swaps its editable summary for static text while `exporting` is set.
    setExporting(format === "pdf" ? "pdf" : "image");
    try {
      await sendReportToLark(reportRefs[tab].current, exportName("png"), { format, pdf: { format: PDF_FORMAT[tab] } });
      setNotice({ type: "success", message: larkSentMessage(format, `“${REPORT_LABELS[tab]}”`) });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark." });
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      await saveReportAsPdf(reportRefs[tab].current, exportName("pdf"), { format: PDF_FORMAT[tab] });
      setNotice({ type: "success", message: `Đã tải PDF báo cáo “${REPORT_LABELS[tab]}”.` });
    } catch (error) {
      console.error("export pdf failed", error);
      setNotice({ type: "error", message: `Không thể xuất PDF: ${describeExportError(error)}` });
    } finally {
      setExporting(null);
    }
  }

  return (
    <ReportWorkspace
      header={
        <PageHeader
          title="Báo cáo tổng hợp"
          description="Lấy số liệu từ Pancake POS hoặc một file Excel nhiều sheet; xem tất cả báo cáo qua các tab."
        >
          {canExport ? (
            <>
              <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
              <SendToLarkButton reportName={REPORT_LABELS[tab]} disabled={exporting !== null} onConfirm={sendToLark} />
            </>
          ) : null}
        </PageHeader>
      }
      aside={
        <>
          <PancakeSyncCard
            allowAllShops
            hint="Chọn “Tất cả shop” để lấy mọi shop một lần, hoặc chọn shop Việt Nam để điền Báo cáo ngày, Hiệu suất và Quản trị TC · Việt; chọn shop Philippines để điền Quản trị TC · Philippines. Mỗi lần lấy chỉ cập nhật các tab của shop đó."
            onSynced={syncFromPancake}
          />

          <ConfigSection title="Tệp Excel tổng hợp" collapsible defaultOpen={!data}>
            <FileDropzone
              compact
              fileName={fileName}
              isParsing={isParsing}
              hint="Chọn file .xlsx theo mẫu tổng hợp"
              onFile={(file) => void handleFile(file)}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}>
                <FileSpreadsheet />
                Mẫu Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadSample()}>
                <Sparkles />
                Dữ liệu mẫu
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-name" className="text-[11px] text-muted-foreground">
                Tên đơn vị (báo cáo ngày)
              </Label>
              <Input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="h-8 text-xs" />
            </div>
            {data ? <SheetStatusList statuses={data.statuses} /> : null}
          </ConfigSection>
        </>
      }
    >
      <Notice notice={notice} />

      <ShopSwitcher
        results={Object.values(shopResults)}
        active={activeShop}
        onPick={(result) => {
          if (result.shop.currency.toUpperCase() === "PHP") setPhSingle(true);
          syncFromPancake(result, { keepTab: true });
        }}
        phMerge={phGroup.length > 1 ? { count: phGroup.length, active: phMerged, onPick: () => setPhSingle(false) } : undefined}
      />

      {!data ? (
        <EmptyState onTemplate={() => void downloadTemplate()} onSample={() => void loadSample()} />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as ReportKey)} className="gap-4">
          <div className="overflow-x-auto print:hidden">
            <TabsList className="h-11 min-w-max gap-1 border p-1 shadow-xs">
              {TAB_KEYS.map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="px-4 font-semibold text-foreground/70 hover:bg-background hover:text-foreground data-active:bg-primary! data-active:text-primary-foreground! data-active:shadow-md"
                >
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
            {data.daily && dailyManual.view ? (
              <>
                <DailyManualEntry manual={dailyManual} reportDate={data.daily.reportDate} />
                <AiAnalysisPanel reportType="daily" getData={() => buildDailyAnalysisData(dailyManual.view!, companyName)} />
                <ReportViewport>
                  <DailyReportView reportRef={dailyRef} data={dailyManual.view} companyName={companyName} />
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
                    sharedCosts={data.performance.sharedCosts}
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
                  <VnManagementView reportRef={vnRef} report={data.vn} reconcile={data.vn.sourceSheet === POS_SOURCE_SHEET ? reconcileOf("VND") : undefined} />
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
                        : phMerged
                          ? `Báo cáo gộp ${phGroup.length} shop (${phGroup.map((result) => result.shop.name).join(" + ")}): cộng số liệu từng shop theo ngày, chi phí Ads Meta (nhãn PH) chỉ tính một lần.`
                          : "Chỉ áp dụng cho những ngày không có tỷ giá riêng trong cột “Tỷ giá PHP-VND” của sheet."}
                    </p>
                  </CardContent>
                </Card>
                {phResult?.report ? (
                  <>
                    <AiAnalysisPanel reportType="philippines" getData={() => buildPhAnalysisData(phResult.report!)} />
                    <ReportViewport>
                      <PhFinanceView reportRef={phRef} report={phResult.report} reconcile={reconcileOf("PHP")} previousDay={phExtras.previousDay} refundTrend={phExtras.refundTrend} openOrders={phExtras.openOrders} mergedShops={phMerged ? phGroup.map((result) => result.shop.name) : undefined} />
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
    </ReportWorkspace>
  );
}

const CURRENCY_TITLE: Record<string, string> = { VND: "Shop Việt Nam (VND)", PHP: "Shop Philippines (PHP)" };

/**
 * When "all shops" fetched several shops of the same currency, each report tab shows one of them.
 * This row lets the user pick which; it is hidden while every currency has a single shop.
 */
function ShopSwitcher({
  results,
  active,
  onPick,
  phMerge,
}: {
  results: PancakeSyncResult[];
  active: Record<string, number>;
  onPick: (result: PancakeSyncResult) => void;
  /** Philippines shops that can be added together into one report (shown first in that row). */
  phMerge?: { count: number; active: boolean; onPick: () => void };
}) {
  const groups = new Map<string, PancakeSyncResult[]>();
  for (const result of results) {
    const currency = result.shop.currency.toUpperCase();
    groups.set(currency, [...(groups.get(currency) ?? []), result]);
  }
  const multi = Array.from(groups).filter(([, list]) => list.length > 1);
  if (!multi.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 print:hidden">
      {multi.map(([currency, list]) => (
        <div key={currency} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{CURRENCY_TITLE[currency] ?? currency}:</span>
          {currency === "PHP" && phMerge ? (
            <Button size="xs" variant={phMerge.active ? "default" : "outline"} aria-pressed={phMerge.active} onClick={phMerge.onPick}>
              Gộp {phMerge.count} shop
            </Button>
          ) : null}
          {list.map((result) => (
            <Button
              key={result.shop.id}
              size="xs"
              variant={active[currency] === result.shop.id && !(currency === "PHP" && phMerge?.active) ? "default" : "outline"}
              onClick={() => onPick(result)}
            >
              {result.shop.name}
            </Button>
          ))}
        </div>
      ))}
    </div>
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

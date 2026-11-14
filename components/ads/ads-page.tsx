"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import { CloudDownload, LoaderCircle, Megaphone, Tags } from "lucide-react"
import { AdsAccountPicker, useAdsAccounts, useStoredIds } from "@/components/ads/ads-accounts"
import { AdsLabelsDialog, useAdsLabels } from "@/components/ads/ads-labels"
import { AdsReportView } from "@/components/ads/ads-report"
import { Notice, type NoticeState } from "@/components/notice"
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui"
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace"
import { SendToLarkButton } from "@/components/send-to-lark-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_ADS_RANGE_DAYS, type AdsReport } from "@/lib/ads/types"
import { dayCount, localDate, RANGE_PRESETS } from "@/lib/range-presets"
import { larkSentMessage, renderReportToPng, saveReportAsPdf, sendReportToLark, triggerDownload, type LarkFormat } from "@/lib/report-export"

const noopSubscribe = () => () => {}

export function AdsPage() {
  const reportRef = useRef<HTMLDivElement>(null)
  const { accounts, configured, loading: accountsLoading, error: accountsError } = useAdsAccounts()
  const [selected, setSelected] = useStoredIds("ads-report-accounts")
  const adsLabels = useAdsLabels()
  const [labelsOpen, setLabelsOpen] = useState(false)
  // Today's date must not be read while the page is prerendered: the defaults come from an external-store read that is
  // empty on the server and the real date in the browser. Once the user picks a day, that choice wins.
  const defaultFrom = useSyncExternalStore(noopSubscribe, () => localDate(-7), () => "")
  const defaultTo = useSyncExternalStore(noopSubscribe, () => localDate(-1), () => "")
  const [pickedFrom, setFrom] = useState<string | null>(null)
  const [pickedTo, setTo] = useState<string | null>(null)
  const from = pickedFrom ?? defaultFrom
  const to = pickedTo ?? defaultTo
  const [report, setReport] = useState<AdsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  const days = dayCount(from, to)
  const rangeValid = days >= 1 && days <= MAX_ADS_RANGE_DAYS
  const baseName = report ? `quang-cao-meta-${report.range.from}_${report.range.to}` : "quang-cao-meta"
  // only ids that still exist: an account removed from the MCP must not be sent
  const chosen = selected.filter((id) => accounts.some((account) => account.id === id))

  function changeFrom(value: string) {
    setFrom(value)
    if (value && (!to || value > to)) setTo(value)
  }

  function changeTo(value: string) {
    setTo(value)
    if (value && (!from || value < from)) setFrom(value)
  }

  async function load() {
    setLoading(true)
    setNotice({ type: "warning", message: "Đang lấy dữ liệu quảng cáo từ Meta (có thể mất 10–30 giây)..." })
    try {
      const response = await fetch("/api/ads/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, accountIds: chosen.length ? chosen : undefined }),
      })
      const payload = (await response.json().catch(() => null)) as (AdsReport & { error?: string }) | null
      if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.")
      setReport(payload)
      setNotice({ type: "success", message: `Đã lấy ${payload.range.dayCount} ngày quảng cáo (${payload.accounts.length} tài khoản · ${payload.currency}).` })
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lấy dữ liệu quảng cáo." })
    } finally {
      setLoading(false)
    }
  }

  async function exportImage() {
    setExporting("image")
    setNotice(null)
    try {
      triggerDownload(await renderReportToPng(reportRef.current), `${baseName}.png`)
      setNotice({ type: "success", message: "Đã tải ảnh báo cáo PNG." })
    } catch {
      setNotice({ type: "error", message: "Không thể tạo ảnh báo cáo. Vui lòng thử lại." })
    } finally {
      setExporting(null)
    }
  }

  async function exportPdf() {
    setExporting("pdf")
    setNotice(null)
    try {
      await saveReportAsPdf(reportRef.current, `${baseName}.pdf`, { format: "a3" })
      setNotice({ type: "success", message: "Đã tải báo cáo PDF A3 ngang." })
    } catch {
      setNotice({ type: "error", message: "Không thể xuất PDF. Vui lòng thử lại." })
    } finally {
      setExporting(null)
    }
  }

  async function sendToLark(format: LarkFormat) {
    try {
      await sendReportToLark(reportRef.current, `${baseName}.png`, { format, pdf: { format: "a3" } })
      setNotice({ type: "success", message: larkSentMessage(format) })
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark." })
    }
  }

  const control = "h-8 px-2 text-xs"

  return (
    <ReportWorkspace
      header={
        <PageHeader title="Quảng cáo Meta" description="Chi tiêu, ROAS, tin nhắn và chiến dịch từ các tài khoản quảng cáo trong BM, lấy qua Ads MCP.">
          {report ? (
            <>
              <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
              <SendToLarkButton reportName="Báo cáo quảng cáo Meta" disabled={exporting !== null} onConfirm={sendToLark} />
            </>
          ) : null}
        </PageHeader>
      }
      aside={
        <ConfigSection title="Dữ liệu quảng cáo">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ads-from" className="text-[11px] text-muted-foreground">
                Từ ngày
              </Label>
              <Input id="ads-from" type="date" value={from} onChange={(event) => changeFrom(event.target.value)} disabled={loading} className={control} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ads-to" className="text-[11px] text-muted-foreground">
                Đến ngày
              </Label>
              <Input id="ads-to" type="date" value={to} onChange={(event) => changeTo(event.target.value)} disabled={loading} className={control} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="xs"
                disabled={loading}
                onClick={() => {
                  const range = preset.range()
                  setFrom(range.from)
                  setTo(range.to)
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              Tài khoản quảng cáo {accountsLoading ? "(đang tải…)" : `(${chosen.length ? `đã chọn ${chosen.length}/${accounts.length}` : `chưa chọn = lấy tất cả ${accounts.length}`})`}
            </p>
            {accounts.length ? <AdsAccountPicker accounts={accounts} selected={chosen} onChange={setSelected} disabled={loading} labels={adsLabels.labels} /> : null}
            {accounts.length ? (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setLabelsOpen(true)} disabled={!adsLabels.configured}>
                <Tags />
                Gắn nhãn shop Việt / Phil ({adsLabels.labels.length})
              </Button>
            ) : null}
            {!adsLabels.configured ? <p className="text-[11px] text-amber-700">Cần cấu hình MySQL (MYSQL_URL) và chạy database/schema.sql để lưu nhãn.</p> : null}
            {adsLabels.error ? <p className="text-[11px] text-destructive">{adsLabels.error}</p> : null}
          </div>

          <Button size="lg" className="h-9 w-full" onClick={() => void load()} disabled={loading || !rangeValid || !configured || accountsLoading}>
            {loading ? <LoaderCircle className="animate-spin" /> : <CloudDownload />}
            Lấy dữ liệu
          </Button>
          <p className={`text-[11px] ${rangeValid || !from ? "text-muted-foreground" : "text-destructive"}`}>
            {rangeValid ? `${days} ngày` : `Khoảng ngày phải từ 1 đến ${MAX_ADS_RANGE_DAYS} ngày.`}
          </p>

          {!configured ? <Notice notice={{ type: "warning", message: "Chưa cấu hình ADS_MCP_URL trong .env.local." }} /> : null}
          {accountsError ? <Notice notice={{ type: "warning", message: accountsError }} /> : null}
          <Notice notice={notice} />

          {report?.warnings.length ? (
            <details className="rounded-lg border bg-muted/30 px-2.5 py-1.5">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Ghi chú ({report.warnings.length})</summary>
              <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4 text-[11px] leading-4 text-muted-foreground">
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </ConfigSection>
      }
    >
      {report ? (
        <ReportViewport>
          <AdsReportView reportRef={reportRef} report={report} />
        </ReportViewport>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Megaphone className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Chưa có dữ liệu</p>
            <p className="max-w-md text-xs text-muted-foreground">Chọn khoảng ngày và tài khoản ở cột bên phải rồi bấm “Lấy dữ liệu”.</p>
          </CardContent>
        </Card>
      )}
      <AdsLabelsDialog open={labelsOpen} onOpenChange={setLabelsOpen} accounts={accounts} labels={adsLabels.labels} onSave={adsLabels.save} />
    </ReportWorkspace>
  )
}

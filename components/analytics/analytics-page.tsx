"use client"

import { useRef, useState } from "react"
import { Activity } from "lucide-react"
import { AnalyticsReport } from "@/components/analytics/analytics-report"
import { Notice, type NoticeState } from "@/components/notice"
import { PancakeSyncCard } from "@/components/pancake-sync-card"
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui"
import { ReportWorkspace } from "@/components/report-workspace"
import { SendToLarkButton } from "@/components/send-to-lark-button"
import { Card, CardContent } from "@/components/ui/card"
import {
  larkSentMessage,
  renderReportToPng,
  safeFilePart,
  saveReportAsPdf,
  sendReportToLark,
  triggerDownload,
  type LarkFormat,
} from "@/lib/report-export"
import type { PancakeSyncResult } from "@/lib/pancake/types"

export function AnalyticsPage() {
  const reportRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<PancakeSyncResult | null>(null)
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  const baseName = result ? `phan-tich-van-hanh-${safeFilePart(result.shop.name)}-${result.range.from}_${result.range.to}` : "phan-tich-van-hanh"

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
      setNotice({ type: "success", message: "Đã tải báo cáo PDF A3 dọc." })
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

  return (
    <ReportWorkspace
      header={
        <PageHeader title="Phân tích vận hành" description="Trạng thái đơn, nguồn đơn, tỷ lệ hoàn, chốt đơn, quảng cáo, COD và cơ cấu bán hàng, tính từ dữ liệu Pancake POS.">
          {result ? (
            <>
              <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
              <SendToLarkButton reportName="Báo cáo phân tích vận hành" disabled={exporting !== null} onConfirm={sendToLark} />
            </>
          ) : null}
        </PageHeader>
      }
      aside={
        <PancakeSyncCard
          hint="Dùng cho cả shop Việt Nam (VND) và Philippines (PHP). Báo cáo này chỉ dùng số liệu POS; lương và định phí không được tính."
          onSynced={(next) => setResult(next)}
        />
      }
    >
      <Notice notice={notice} />
      {result ? (
        <ReportViewport>
          <AnalyticsReport reportRef={reportRef} dataset={result.dataset} metaAds={result.metaAds} />
        </ReportViewport>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Activity className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Chưa có dữ liệu</p>
            <p className="max-w-md text-xs text-muted-foreground">Chọn shop và khoảng ngày ở cột bên phải rồi bấm “Lấy dữ liệu”. Báo cáo đã lấy lần trước sẽ tự hiện lại khi mở trang.</p>
          </CardContent>
        </Card>
      )}
    </ReportWorkspace>
  )
}
